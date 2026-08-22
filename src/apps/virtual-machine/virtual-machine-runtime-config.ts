const VM_RUNTIME_PORT = '6175'
const DEFAULT_DEV_ORIGIN = `http://localhost:${VM_RUNTIME_PORT}`

function readViteEnv(): { DEV?: boolean; VITE_VM_RUNTIME_ORIGIN?: string } | undefined {
  try {
    return (import.meta as ImportMeta & { env?: { DEV?: boolean; VITE_VM_RUNTIME_ORIGIN?: string } })
      .env
  } catch {
    return undefined
  }
}

function loopbackAlias(hostname: string): string | undefined {
  if (hostname === 'localhost') {
    return '127.0.0.1'
  }
  if (hostname === '127.0.0.1') {
    return 'localhost'
  }
  return undefined
}

/**
 * Dev iframe origin. Use the other loopback host so V86 is cross-site
 * (`localhost` vs `127.0.0.1`); same-site iframes share the renderer and freeze Instant OS.
 */
export function defaultDevRuntimeOrigin(pageOrigin?: string): string {
  if (!pageOrigin) {
    return DEFAULT_DEV_ORIGIN
  }
  try {
    const url = new URL(pageOrigin)
    const alias = loopbackAlias(url.hostname)
    if (!alias) {
      return DEFAULT_DEV_ORIGIN
    }
    url.hostname = alias
    url.port = VM_RUNTIME_PORT
    url.pathname = '/'
    url.search = ''
    url.hash = ''
    return url.origin
  } catch {
    return DEFAULT_DEV_ORIGIN
  }
}

function pageOrigin(): string | undefined {
  try {
    return window.location.origin
  } catch {
    return undefined
  }
}

/** Cross-origin V86 runtime. Dev defaults to the Instant-virtual-machine Vite port. */
export function getVmRuntimeOrigin(): string | undefined {
  const env = readViteEnv()
  const configured = env?.VITE_VM_RUNTIME_ORIGIN?.trim().replace(/\/+$/, '')
  if (configured) {
    return configured
  }
  if (env?.DEV) {
    return defaultDevRuntimeOrigin(pageOrigin())
  }
  return undefined
}

export function isVmRuntimeConfigured(): boolean {
  return getVmRuntimeOrigin() !== undefined
}

/**
 * 根据构建模式为运行时 origin 拼接 `?v86=debug|release` 参数。
 * 当 baseOrigin 为 undefined 时原样返回。
 */
export function buildVmRuntimeOriginWithMode(
  baseOrigin: string | undefined,
  buildMode: string,
): string | undefined {
  if (!baseOrigin) {
    return baseOrigin
  }
  try {
    const url = new URL(baseOrigin)
    url.searchParams.set('v86', buildMode)
    return url.origin + url.pathname + url.search + url.hash
  } catch {
    return baseOrigin
  }
}
