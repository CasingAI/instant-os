import { getPageWorkerOrigin } from '../page-host/page-host-config.ts'
import {
  listRecentProxyServerRequests,
  recordProxyServerRequest,
} from './proxy-server-metrics.ts'
import { PowError, readBodyBytes, solvePowForBody } from './pow-client.ts'
import {
  isProxyServerConnected,
  loadProxyServerSettings,
  PROXY_SERVER_FREE_ORIGIN,
  PROXY_SERVER_PATH_PREFIX,
  PROXY_SERVER_SHARED_ORIGIN,
  normalizeProxyBaseUrl,
  saveProxyServerSettings,
  type ProxyServerPresetId,
  type ProxyServerSettings,
} from './proxy-server-settings-storage.ts'

export { isProxyServerConnected } from './proxy-server-settings-storage.ts'
export type { ProxyServerSettings } from './proxy-server-settings-storage.ts'

/** 连通性探测目标：体积小、公开可达 */
const PROBE_TARGET_URL = 'https://www.cloudflare.com/cdn-cgi/trace'

export const PROXY_SERVER_NOT_CONFIGURED_MESSAGE =
  '未配置代理服务器，请先在「系统设置 → 代理服务器」中选择 Instant 共享或填写自定义 Worker'

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
 * 解析用于代理/探测的 Worker origin。
 * 传入 `baseOverride` 时只解析该字符串；未传则读已保存配置。均无则 undefined。
 */
export function resolveProxyWorkerOrigin(baseOverride?: string): string | undefined {
  if (baseOverride !== undefined) {
    return normalizeProxyBaseUrl(baseOverride) || undefined
  }
  return getPageWorkerOrigin()
}

/**
 * 将绝对目标 URL 拼成 Worker 代理地址：`{base}/-----{target}`。
 * `baseOverride` 用于连接探测（尚未标记 connected）。
 */
export function buildProxiedUrl(targetUrl: string, baseOverride?: string): string {
  const base = resolveProxyWorkerOrigin(baseOverride)
  if (!base) {
    throw new ProxyServerApiError(PROXY_SERVER_NOT_CONFIGURED_MESSAGE)
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

function estimateDownloadBytes(response: Response): number {
  const contentLength = response.headers.get('content-length')
  if (!contentLength) {
    // 无 Content-Length 时不要读 body：会耗尽流式响应（如 chat SSE），
    // 且在整段生成完成前拖住 create()，「等待响应」期间 abort 也停不住。
    return 0
  }
  const parsed = Number(contentLength)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

/**
 * 经 WebView / virtual-chromo Worker 的宿主 CORS relay 发起请求。未连接时抛错。
 * Worker 侧转发 method/body，并返回 access-control-allow-origin: *。
 */
export async function proxiedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (!getPageWorkerOrigin()) {
    throw new ProxyServerApiError(PROXY_SERVER_NOT_CONFIGURED_MESSAGE)
  }
  if (!isProxyServerConnected()) {
    throw new ProxyServerApiError(PROXY_SERVER_NOT_CONFIGURED_MESSAGE)
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

  const origin = getPageWorkerOrigin()
  // 免费额度网关：一切产生费用的 POST 请求先完成一次 PoW（无状态验证）
  const isFreeGateway = origin === PROXY_SERVER_FREE_ORIGIN
  let proxyInit = init
  if (isFreeGateway && method === 'POST') {
    let bodyBytes: Uint8Array | undefined
    try {
      bodyBytes = await readBodyBytes(init)
      if (bodyBytes) {
        const powHeaders = await solvePowForBody(origin, bodyBytes, init?.signal ?? undefined)
        proxyInit = {
          ...init,
          headers: mergeHeaders(init?.headers, powHeaders),
          body: bodyBytes as BodyInit,
        }
      }
    } catch (error) {
      if (error instanceof PowError) {
        throw error
      }
      throw new ProxyServerApiError(
        error instanceof Error ? `PoW 计算失败：${error.message}` : 'PoW 计算失败',
      )
    }
  }

  const proxyUrl = buildProxiedUrl(targetUrl)

  try {
    const response = await fetch(proxyUrl, proxyInit)
    const downloadBytes = estimateDownloadBytes(response)
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

/** 把 PoW headers 合并进既有 headers（不覆盖既有同名 header） */
function mergeHeaders(
  headers: HeadersInit | undefined,
  extra: Record<string, string>,
): HeadersInit {
  const merged = new Headers(headers)
  for (const [key, value] of Object.entries(extra)) {
    merged.set(key, value)
  }
  return merged
}

export type ProxyServerProbeResult =
  | { ok: true; durationMs: number }
  | { ok: false; message: string }

/** 用给定（或已保存）的 Worker 根地址探测代理是否可用。不要求已连接。 */
export async function probeProxyServer(
  proxyBaseUrl?: string,
  options?: { signal?: AbortSignal },
): Promise<ProxyServerProbeResult> {
  const base =
    proxyBaseUrl !== undefined
      ? normalizeProxyBaseUrl(proxyBaseUrl) || undefined
      : getPageWorkerOrigin()
  if (!base) {
    return { ok: false, message: PROXY_SERVER_NOT_CONFIGURED_MESSAGE }
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
    const response = await fetch(proxyUrl, { signal: options?.signal })
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
    if (options?.signal?.aborted) {
      return { ok: false, message: '已取消' }
    }
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `无法联系代理服务器：${message}` }
  }
}

export type ProxyServerConnectResult =
  | { ok: true; settings: ProxyServerSettings; durationMs: number }
  | { ok: false; message: string; settings: ProxyServerSettings }

function originForPreset(
  preset: ProxyServerPresetId,
  customProxyBaseUrl: string,
): string | undefined {
  if (preset === 'off') {
    return undefined
  }
  if (preset === 'shared') {
    return PROXY_SERVER_SHARED_ORIGIN
  }
  if (preset === 'instant-free') {
    return PROXY_SERVER_FREE_ORIGIN
  }
  return normalizeProxyBaseUrl(customProxyBaseUrl) || undefined
}

/**
 * 选择服务器并保存。有有效 origin 即同时用于浏览与宿主出网。
 * `off` 立即关闭；`custom` 且地址无效时只保存选择。
 * 有 origin 时会探测连通性（结果仅作反馈，不另设开关）。
 */
export async function selectProxyServerPreset(
  preset: ProxyServerPresetId,
  customProxyBaseUrl?: string,
  options?: { signal?: AbortSignal },
): Promise<ProxyServerConnectResult> {
  const current = loadProxyServerSettings()
  const nextCustom =
    customProxyBaseUrl !== undefined
      ? normalizeProxyBaseUrl(customProxyBaseUrl)
      : current.customProxyBaseUrl

  if (preset === 'off') {
    if (
      !saveProxyServerSettings({
        version: 2,
        preset: 'off',
        customProxyBaseUrl: nextCustom,
        connected: false,
      })
    ) {
      return {
        ok: false,
        message: '无法保存代理服务器设置（存储空间可能已满）',
        settings: loadProxyServerSettings(),
      }
    }
    return { ok: true, settings: loadProxyServerSettings(), durationMs: 0 }
  }

  const origin = originForPreset(preset, nextCustom)
  if (!origin) {
    if (
      !saveProxyServerSettings({
        version: 2,
        preset,
        customProxyBaseUrl: nextCustom,
        connected: false,
      })
    ) {
      return {
        ok: false,
        message: '无法保存代理服务器设置（存储空间可能已满）',
        settings: loadProxyServerSettings(),
      }
    }
    return {
      ok: false,
      message: '请填写有效的 http(s) Worker 根 URL',
      settings: loadProxyServerSettings(),
    }
  }

  if (
    !saveProxyServerSettings({
      version: 2,
      preset,
      customProxyBaseUrl: nextCustom,
      connected: true,
    })
  ) {
    return {
      ok: false,
      message: '无法保存代理服务器设置（存储空间可能已满）',
      settings: loadProxyServerSettings(),
    }
  }

  const probe = await probeProxyServer(origin, { signal: options?.signal })
  if (!probe.ok) {
    return { ok: false, message: probe.message, settings: loadProxyServerSettings() }
  }

  return {
    ok: true,
    settings: loadProxyServerSettings(),
    durationMs: probe.durationMs,
  }
}

/** @deprecated 使用 selectProxyServerPreset；保留给旧调用 */
export async function connectProxyServer(proxyBaseUrl: string): Promise<ProxyServerConnectResult> {
  return selectProxyServerPreset('custom', proxyBaseUrl)
}

export function disconnectProxyServer(): boolean {
  return saveProxyServerSettings({
    ...loadProxyServerSettings(),
    preset: 'off',
    connected: false,
  })
}

export function getProxyServerHost(): string | undefined {
  if (!isProxyServerConnected()) {
    return undefined
  }
  const origin = getPageWorkerOrigin()
  if (!origin) {
    return undefined
  }
  try {
    return new URL(origin).host
  } catch {
    return undefined
  }
}

export function peekRecentProxyServerActivity(limit = 5) {
  return listRecentProxyServerRequests(limit)
}
