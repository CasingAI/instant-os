import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from './device-storage.ts'
import { setPackageServiceConfig } from '../packages/package-service.ts'
import { DEFAULT_PACKAGE_SERVICE_CONFIG } from '../packages/package-types.ts'

export type NpmRegistryPresetId = 'npmjs' | 'npmmirror' | 'custom'

export type NpmRegistrySettings = {
  version: 1
  preset: NpmRegistryPresetId
  /** 自定义源根 URL；preset 为 custom 时生效 */
  customRegistryUrl: string
}

export const NPM_REGISTRY_SETTINGS_CHANGED_EVENT = 'instant-os:npm-registry-settings-changed'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.npmRegistrySettings

export const NPM_REGISTRY_PRESETS: Record<
  Exclude<NpmRegistryPresetId, 'custom'>,
  { label: string; registryUrl: string; extraHosts: readonly string[] }
> = {
  npmjs: {
    label: '官方 npm',
    registryUrl: 'https://registry.npmjs.org',
    extraHosts: ['registry.npmjs.org'],
  },
  npmmirror: {
    label: 'npmmirror',
    registryUrl: 'https://registry.npmmirror.com',
    extraHosts: ['registry.npmmirror.com', 'cdn.npmmirror.com'],
  },
}

const DEFAULT_SETTINGS: NpmRegistrySettings = {
  version: 1,
  preset: 'npmjs',
  customRegistryUrl: '',
}

/** 规范化 registry 根 URL：保留 origin + pathname（去尾斜杠），仅 http(s) */
export function normalizeRegistryUrl(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return undefined
    }
    const path = url.pathname.replace(/\/+$/, '')
    return `${url.origin}${path === '/' ? '' : path}`
  } catch {
    return undefined
  }
}

function normalizeSettings(raw: unknown): NpmRegistrySettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SETTINGS }
  }
  const record = raw as Record<string, unknown>
  const presetRaw = record.preset
  const preset: NpmRegistryPresetId =
    presetRaw === 'npmjs' || presetRaw === 'npmmirror' || presetRaw === 'custom'
      ? presetRaw
      : 'npmjs'
  const customRegistryUrl =
    typeof record.customRegistryUrl === 'string' ? record.customRegistryUrl.trim() : ''
  return {
    version: 1,
    preset,
    customRegistryUrl,
  }
}

export function loadNpmRegistrySettings(): NpmRegistrySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return normalizeSettings(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function resolveNpmRegistryUrl(settings: NpmRegistrySettings): string | undefined {
  if (settings.preset === 'custom') {
    return normalizeRegistryUrl(settings.customRegistryUrl)
  }
  return NPM_REGISTRY_PRESETS[settings.preset].registryUrl
}

export function buildAllowedHostsForNpmSettings(
  settings: NpmRegistrySettings,
): string[] {
  const hosts = new Set<string>(DEFAULT_PACKAGE_SERVICE_CONFIG.allowedHosts)
  if (settings.preset === 'custom') {
    const url = normalizeRegistryUrl(settings.customRegistryUrl)
    if (url) {
      try {
        hosts.add(new URL(url).hostname.toLowerCase())
      } catch {
        // ignore
      }
    }
  } else {
    for (const host of NPM_REGISTRY_PRESETS[settings.preset].extraHosts) {
      hosts.add(host)
    }
  }
  return [...hosts]
}

export function applyNpmRegistrySettingsToPackageService(
  settings: NpmRegistrySettings = loadNpmRegistrySettings(),
): { ok: true; registryUrl: string } | { ok: false; message: string } {
  const registryUrl = resolveNpmRegistryUrl(settings)
  if (!registryUrl) {
    return { ok: false, message: '无效的 registry URL' }
  }
  setPackageServiceConfig({
    registryUrl,
    allowedHosts: buildAllowedHostsForNpmSettings(settings),
  })
  return { ok: true, registryUrl }
}

export function saveNpmRegistrySettings(settings: NpmRegistrySettings): boolean {
  const payload = normalizeSettings(settings)
  if (payload.preset === 'custom') {
    const normalized = normalizeRegistryUrl(payload.customRegistryUrl)
    if (!normalized) return false
    payload.customRegistryUrl = normalized
  }
  const applied = applyNpmRegistrySettingsToPackageService(payload)
  if (!applied.ok) return false
  if (!writeLocalStorageItem(STORAGE_KEY, JSON.stringify(payload))) {
    return false
  }
  window.dispatchEvent(new CustomEvent(NPM_REGISTRY_SETTINGS_CHANGED_EVENT))
  return true
}

export function patchNpmRegistrySettings(patch: Partial<NpmRegistrySettings>): boolean {
  return saveNpmRegistrySettings({ ...loadNpmRegistrySettings(), ...patch })
}

export function subscribeNpmRegistrySettings(listener: () => void): () => void {
  window.addEventListener(NPM_REGISTRY_SETTINGS_CHANGED_EVENT, listener)
  return () => window.removeEventListener(NPM_REGISTRY_SETTINGS_CHANGED_EVENT, listener)
}

export async function probeNpmRegistry(
  registryUrl: string,
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<{ ok: true; durationMs: number } | { ok: false; message: string; durationMs: number }> {
  const base = normalizeRegistryUrl(registryUrl)
  if (!base) {
    return { ok: false, message: '无效的 registry URL', durationMs: 0 }
  }
  const url = `${base}/lodash`
  const timeoutMs = options?.timeoutMs ?? 15_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  options?.signal?.addEventListener('abort', onAbort)
  const started = performance.now()
  try {
    const response = await fetch(url, { signal: controller.signal })
    const durationMs = Math.round(performance.now() - started)
    if (!response.ok) {
      return {
        ok: false,
        message: `HTTP ${response.status}`,
        durationMs,
      }
    }
    // 轻量校验：能解析出 versions / dist-tags 即视为 npm 兼容源
    const json = (await response.json()) as { versions?: unknown; 'dist-tags'?: unknown }
    if (!json.versions && !json['dist-tags']) {
      return {
        ok: false,
        message: '响应不像 npm packument',
        durationMs,
      }
    }
    return { ok: true, durationMs }
  } catch (error) {
    const durationMs = Math.round(performance.now() - started)
    if (controller.signal.aborted) {
      return { ok: false, message: '超时或已取消', durationMs }
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      durationMs,
    }
  } finally {
    clearTimeout(timer)
    options?.signal?.removeEventListener('abort', onAbort)
  }
}

/** 模块加载时把已保存源接到 PackageService */
applyNpmRegistrySettingsToPackageService()
