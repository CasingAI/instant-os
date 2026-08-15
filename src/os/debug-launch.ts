/**
 * Debug 模式启动参数：
 * - 仅 dev 构建（import.meta.env.DEV）生效，生产构建一律关闭。
 * - `?debug=1`：绕过初始化直接进入桌面，并弹出全局安全警告。
 * - `?cmd=<URL编码JS>`：确认后注入系统终端执行的启动命令（可选）。
 */
export type DebugLaunchParams = {
  enabled: boolean
  command?: string
}

export function isDebugMode(search?: string): boolean {
  if (!import.meta.env.DEV) {
    return false
  }
  const raw = search ?? (typeof location !== 'undefined' ? location.search : '')
  const params = new URLSearchParams(raw)
  const debug = params.get('debug')
  return debug !== null && debug !== '' && debug !== '0' && debug !== 'false'
}

export function parseDebugLaunchParams(search: string): DebugLaunchParams {
  if (!isDebugMode(search)) {
    return { enabled: false }
  }
  const command = new URLSearchParams(search).get('cmd')?.trim()
  return { enabled: true, command: command || undefined }
}

/** 从 URL 中移除 debug/cmd 参数，用于取消 Debug 模式后回退到正常启动流程。 */
export function stripDebugLaunchParams(url: string): string {
  const base = typeof location !== 'undefined' ? location.href : undefined
  const parsed = new URL(url, base)
  parsed.searchParams.delete('debug')
  parsed.searchParams.delete('cmd')
  return parsed.href
}
