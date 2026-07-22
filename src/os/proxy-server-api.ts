import {
  listRecentProxyServerRequests,
  recordProxyServerRequest,
} from './proxy-server-metrics.ts'
import {
  isProxyServerConnected,
  loadProxyServerSettings,
  PROXY_SERVER_PATH_PREFIX,
  normalizeProxyBaseUrl,
  patchProxyServerSettings,
  saveProxyServerSettings,
  type ProxyServerSettings,
} from './proxy-server-settings-storage.ts'

export { isProxyServerConnected } from './proxy-server-settings-storage.ts'
export type { ProxyServerSettings } from './proxy-server-settings-storage.ts'

/** 连通性探测目标：体积小、公开可达 */
const PROBE_TARGET_URL = 'https://www.cloudflare.com/cdn-cgi/trace'

export class ProxyServerApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProxyServerApiError'
  }
}

function estimateBodyBytes(body: BodyInit | undefined | null): number {
  if (body === undefined || body === null) {
    return 0
  }
  if (typeof body === 'string') {
    return new TextEncoder().encode(body).length
  }
  if (body instanceof ArrayBuffer) {
    return body.byteLength
  }
  if (ArrayBuffer.isView(body)) {
    return body.byteLength
  }
  if (body instanceof Blob) {
    return body.size
  }
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return new TextEncoder().encode(body.toString()).length
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    // FormData 无法精确计量，记为 0
    return 0
  }
  return 0
}

function resolveTargetUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input
  }
  if (input instanceof URL) {
    return input.href
  }
  return input.url
}

/**
 * 将绝对目标 URL 拼成 Worker 代理地址：`{base}/-----{target}`。
 * `baseOverride` 用于连接探测（尚未标记 connected）。
 */
export function buildProxiedUrl(targetUrl: string, baseOverride?: string): string {
  const settings = loadProxyServerSettings()
  const base = normalizeProxyBaseUrl(baseOverride ?? settings.proxyBaseUrl)
  if (!base) {
    throw new ProxyServerApiError(
      '未配置代理服务器地址，请先在「系统设置 → 代理服务器」中填写 Worker 根 URL',
    )
  }

  let absolute: URL
  try {
    absolute = new URL(targetUrl)
  } catch {
    throw new ProxyServerApiError('目标地址必须是绝对 URL（含 http:// 或 https://）')
  }

  if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') {
    throw new ProxyServerApiError('仅支持 http/https 目标地址')
  }

  return `${base}${PROXY_SERVER_PATH_PREFIX}${absolute.href}`
}

async function measureDownloadBytes(response: Response): Promise<{
  response: Response
  downloadBytes: number
}> {
  const contentLength = response.headers.get('content-length')
  if (contentLength) {
    const parsed = Number(contentLength)
    if (Number.isFinite(parsed) && parsed >= 0) {
      return { response, downloadBytes: parsed }
    }
  }

  try {
    const clone = response.clone()
    const buffer = await clone.arrayBuffer()
    return { response, downloadBytes: buffer.byteLength }
  } catch {
    return { response, downloadBytes: 0 }
  }
}

/**
 * 经系统代理服务器发起请求。未连接时抛错。
 * 现有 CF Worker 侧主要支持 GET（对目标只做 `fetch(targetUrl)`）；
 * 调用方仍可传 init，浏览器会请求 Worker，但 Worker 未必转发 method/body。
 */
export async function proxiedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (!isProxyServerConnected()) {
    throw new ProxyServerApiError(
      '代理服务器未连接，请先在「系统设置 → 代理服务器」中连接',
    )
  }

  const targetUrl = resolveTargetUrl(input)
  const method = (
    init?.method ??
    (typeof input !== 'string' && !(input instanceof URL) ? input.method : undefined) ??
    'GET'
  ).toUpperCase()
  const uploadBytes = estimateBodyBytes(init?.body)
  const startedAt = Date.now()
  let host = ''
  try {
    host = new URL(targetUrl).host
  } catch {
    host = targetUrl
  }

  const proxyUrl = buildProxiedUrl(targetUrl)

  try {
    const rawResponse = await fetch(proxyUrl, init)
    const { response, downloadBytes } = await measureDownloadBytes(rawResponse)
    const endedAt = Date.now()
    recordProxyServerRequest({
      startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt - startedAt),
      method,
      targetUrl,
      host,
      status: response.status,
      ok: response.ok,
      errorMessage: undefined,
      uploadBytes,
      downloadBytes,
    })
    return response
  } catch (error) {
    const endedAt = Date.now()
    const message = error instanceof Error ? error.message : String(error)
    recordProxyServerRequest({
      startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt - startedAt),
      method,
      targetUrl,
      host,
      status: undefined,
      ok: false,
      errorMessage: message,
      uploadBytes,
      downloadBytes: 0,
    })
    throw error
  }
}

export type ProxyServerProbeResult =
  | { ok: true; durationMs: number }
  | { ok: false; message: string }

/** 用给定（或已保存）的 Worker 根地址探测代理是否可用。不要求已连接。 */
export async function probeProxyServer(proxyBaseUrl?: string): Promise<ProxyServerProbeResult> {
  const settings = loadProxyServerSettings()
  const base = normalizeProxyBaseUrl(proxyBaseUrl ?? settings.proxyBaseUrl)
  if (!base) {
    return { ok: false, message: '请先填写有效的 Worker 根 URL（如 https://xxx.workers.dev）' }
  }

  let proxyUrl: string
  try {
    proxyUrl = buildProxiedUrl(PROBE_TARGET_URL, base)
  } catch (error) {
    return {
      ok: false,
      message: error instanceof ProxyServerApiError ? error.message : '无法构造代理地址',
    }
  }

  const startedAt = Date.now()
  try {
    const response = await fetch(proxyUrl)
    const durationMs = Math.max(0, Date.now() - startedAt)
    if (!response.ok) {
      return {
        ok: false,
        message: `代理服务器返回 HTTP ${response.status}`,
      }
    }
    // Worker 失败时可能以 200 返回 "ERR412" 等文本
    const text = (await response.text()).trim()
    if (text.startsWith('ERR') || text.startsWith('err')) {
      return { ok: false, message: `代理服务器拒绝请求：${text.slice(0, 80)}` }
    }
    return { ok: true, durationMs }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `无法联系代理服务器：${message}` }
  }
}

export type ProxyServerConnectResult =
  | { ok: true; settings: ProxyServerSettings; durationMs: number }
  | { ok: false; message: string; settings: ProxyServerSettings }

/** 保存 URL 并探测；成功则标记已连接。 */
export async function connectProxyServer(proxyBaseUrl: string): Promise<ProxyServerConnectResult> {
  const normalized = normalizeProxyBaseUrl(proxyBaseUrl)
  if (!normalized) {
    return {
      ok: false,
      message: '请填写有效的 http(s) Worker 根 URL',
      settings: loadProxyServerSettings(),
    }
  }

  // 先写入 URL、保持未连接，避免探测失败时误显示菜单栏图标
  if (!saveProxyServerSettings({ version: 1, proxyBaseUrl: normalized, connected: false })) {
    return {
      ok: false,
      message: '无法保存代理服务器设置（存储空间可能已满）',
      settings: loadProxyServerSettings(),
    }
  }

  const probe = await probeProxyServer(normalized)
  if (!probe.ok) {
    return { ok: false, message: probe.message, settings: loadProxyServerSettings() }
  }

  if (!patchProxyServerSettings({ connected: true })) {
    return {
      ok: false,
      message: '探测成功但无法保存连接状态',
      settings: loadProxyServerSettings(),
    }
  }

  return {
    ok: true,
    settings: loadProxyServerSettings(),
    durationMs: probe.durationMs,
  }
}

export function disconnectProxyServer(): boolean {
  return patchProxyServerSettings({ connected: false })
}

export function getProxyServerHost(): string | undefined {
  const { proxyBaseUrl, connected } = loadProxyServerSettings()
  if (!connected || !proxyBaseUrl) {
    return undefined
  }
  try {
    return new URL(proxyBaseUrl).host
  } catch {
    return undefined
  }
}

export function peekRecentProxyServerActivity(limit = 5) {
  return listRecentProxyServerRequests(limit)
}
