import { normalizeExtAppManifest, type ExtAppManifest } from './ext-app-types.ts'
import type { ExtAppId } from './types.ts'

export type ResolvedExtAppManifest = {
  manifest: ExtAppManifest
  devUrl: string
  entryUrl: string
  iconUrl: string
}

export class ExtAppManifestFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExtAppManifestFetchError'
  }
}

function normalizeDevUrlInput(input: string): URL {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new ExtAppManifestFetchError('请输入开发服务器地址')
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`

  let parsed: URL
  try {
    parsed = new URL(withProtocol)
  } catch {
    throw new ExtAppManifestFetchError('地址格式无效')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ExtAppManifestFetchError('仅支持 http 或 https 地址')
  }

  return parsed
}

function resolveAssetUrl(base: URL, relativePath: string): string {
  return new URL(relativePath, base).href
}

export async function fetchExtAppManifest(devUrlInput: string): Promise<ResolvedExtAppManifest> {
  const base = normalizeDevUrlInput(devUrlInput)
  const manifestUrl = resolveAssetUrl(base, 'instant-os.manifest.json')

  let response: Response
  try {
    response = await fetch(manifestUrl, { method: 'GET', cache: 'no-store' })
  } catch {
    throw new ExtAppManifestFetchError(
      `无法连接 ${base.origin}，请确认开发服务器已启动且允许跨域访问 manifest`,
    )
  }

  if (!response.ok) {
    throw new ExtAppManifestFetchError(
      `读取 manifest 失败（${response.status}）。请确认已执行 pnpm dev 且存在 instant-os.manifest.json`,
    )
  }

  let raw: unknown
  try {
    raw = await response.json()
  } catch {
    throw new ExtAppManifestFetchError('manifest 不是有效的 JSON')
  }

  const manifest = normalizeExtAppManifest(raw)
  if (!manifest) {
    throw new ExtAppManifestFetchError('manifest 格式不符合 Instant OS 外链应用规范')
  }

  return {
    manifest,
    devUrl: base.href,
    entryUrl: resolveAssetUrl(base, manifest.entry),
    iconUrl: resolveAssetUrl(base, manifest.icon),
  }
}

export function isExtAppIdRegistered(id: ExtAppId, registeredIds: readonly ExtAppId[]): boolean {
  return registeredIds.includes(id)
}
