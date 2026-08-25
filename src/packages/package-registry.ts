import { recordSystemDebugTimeline } from '../os/system-debug-log.ts'
import { maxSatisfying } from './package-semver.ts'
import type {
  PackageServiceConfig,
  RegistryPackageVersion,
} from './package-types.ts'

function assertAllowedUrl(url: string, config: PackageServiceConfig): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`无效的 registry URL: ${url}`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`不允许的协议: ${parsed.protocol}`)
  }
  if (!config.allowedHosts.includes(parsed.hostname)) {
    throw new Error(`registry 主机不在白名单: ${parsed.hostname}`)
  }
  return parsed
}

async function fetchWithLimits(
  url: string,
  config: PackageServiceConfig,
  signal: AbortSignal | undefined,
): Promise<Response> {
  assertAllowedUrl(url, config)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.fetchTimeoutMs)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const response = await fetch(url, { signal: controller.signal })
    return response
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

function detectNative(meta: Record<string, unknown>): boolean {
  if (meta.gypfile === true) return true
  if (typeof meta.binary === 'object' && meta.binary !== null) return true
  const scripts = meta.scripts
  if (scripts && typeof scripts === 'object') {
    const s = scripts as Record<string, string>
    for (const key of ['install', 'postinstall', 'preinstall']) {
      const cmd = s[key]
      if (cmd && /node-gyp|prebuild|nan\b|binding\.gyp/i.test(cmd)) return true
    }
  }
  return false
}

export async function fetchPackageMetadata(
  name: string,
  config: PackageServiceConfig,
  signal?: AbortSignal,
): Promise<{
  name: string
  versions: Record<string, RegistryPackageVersion>
  'dist-tags': Record<string, string>
}> {
  const base = config.registryUrl.replace(/\/+$/, '')
  const url = `${base}/${encodeURIComponent(name).replace(/%40/g, '@')}`
  const response = await fetchWithLimits(url, config, signal)
  if (!response.ok) {
    throw new Error(`获取包元数据失败 ${name}: HTTP ${response.status}`)
  }
  const json = (await response.json()) as {
    name?: string
    versions?: Record<string, Record<string, unknown>>
    'dist-tags'?: Record<string, string>
  }
  const versions: Record<string, RegistryPackageVersion> = {}
  for (const [ver, meta] of Object.entries(json.versions ?? {})) {
    const dist = meta.dist as { tarball?: string; integrity?: string; shasum?: string } | undefined
    if (!dist?.tarball) continue
    versions[ver] = {
      version: ver,
      dist: {
        tarball: dist.tarball,
        integrity: dist.integrity,
        shasum: dist.shasum,
      },
      dependencies: meta.dependencies as Record<string, string> | undefined,
      peerDependencies: meta.peerDependencies as Record<string, string> | undefined,
      peerDependenciesMeta: meta.peerDependenciesMeta as
        | Record<string, { optional?: boolean }>
        | undefined,
      bin: meta.bin as string | Record<string, string> | undefined,
      main: typeof meta.main === 'string' ? meta.main : undefined,
      module: typeof meta.module === 'string' ? meta.module : undefined,
      exports: meta.exports,
      hasNative: detectNative(meta),
    }
  }
  return {
    name: json.name ?? name,
    versions,
    'dist-tags': json['dist-tags'] ?? {},
  }
}

export async function resolveRegistryVersion(
  name: string,
  range: string,
  config: PackageServiceConfig,
  signal?: AbortSignal,
): Promise<RegistryPackageVersion> {
  const meta = await fetchPackageMetadata(name, config, signal)
  let wanted = range.trim()
  if (wanted === '' || wanted === 'latest' || wanted === '*') {
    wanted = meta['dist-tags'].latest ?? '*'
  }
  if (meta['dist-tags'][wanted]) {
    wanted = meta['dist-tags'][wanted]!
  }
  const version =
    meta.versions[wanted]?.version ??
    maxSatisfying(Object.keys(meta.versions), wanted)
  if (!version || !meta.versions[version]) {
    throw new Error(`无法解析 ${name}@${range}`)
  }
  return meta.versions[version]!
}

export type DownloadTarballProgress = {
  received: number
  /** Content-Length；未知时为 undefined */
  total?: number
}

export async function downloadTarball(
  tarballUrl: string,
  config: PackageServiceConfig,
  signal?: AbortSignal,
  onProgress?: (progress: DownloadTarballProgress) => void,
): Promise<Uint8Array> {
  const downloadStartAt = performance.now()
  assertAllowedUrl(tarballUrl, config)
  const response = await fetchWithLimits(tarballUrl, config, signal)
  if (!response.ok) {
    throw new Error(`下载 tarball 失败: HTTP ${response.status}`)
  }

  const contentLengthHeader = response.headers.get('content-length')
  const totalFromHeader =
    contentLengthHeader && /^\d+$/.test(contentLengthHeader)
      ? Number(contentLengthHeader)
      : undefined
  if (totalFromHeader !== undefined && totalFromHeader > config.maxTarballBytes) {
    throw new Error(
      `tarball 超过上限（${config.maxTarballBytes} bytes）：${totalFromHeader}`,
    )
  }

  const body = response.body
  if (!body) {
    const buffer = new Uint8Array(await response.arrayBuffer())
    if (buffer.byteLength > config.maxTarballBytes) {
      throw new Error(
        `tarball 超过上限（${config.maxTarballBytes} bytes）：${buffer.byteLength}`,
      )
    }
    onProgress?.({ received: buffer.byteLength, total: buffer.byteLength })
    recordSystemDebugTimeline({
      layer: 'npm',
      op: 'tarball-downloaded',
      detail: `${buffer.byteLength}B (no-stream)`,
      durationMs: Math.round(performance.now() - downloadStartAt),
    })
    return buffer
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    signal?.throwIfAborted()
    const { done, value } = await reader.read()
    if (done) break
    if (!value || value.byteLength === 0) continue
    received += value.byteLength
    if (received > config.maxTarballBytes) {
      await reader.cancel().catch(() => undefined)
      throw new Error(
        `tarball 超过上限（${config.maxTarballBytes} bytes）：${received}`,
      )
    }
    chunks.push(value)
    onProgress?.({
      received,
      total: totalFromHeader,
    })
  }

  const buffer = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.byteLength
  }
  onProgress?.({ received: buffer.byteLength, total: buffer.byteLength })
  // 主线程流读拼缓冲：npm install 下载阶段的主要占用
  recordSystemDebugTimeline({
    layer: 'npm',
    op: 'tarball-downloaded',
    detail: `${buffer.byteLength}B ${chunks.length} chunks`,
    durationMs: Math.round(performance.now() - downloadStartAt),
  })
  return buffer
}
