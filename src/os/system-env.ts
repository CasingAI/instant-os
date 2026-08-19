/** Instant OS 内置系统默认环境变量（终端 / QuickJS 未覆盖时的起点）。 */
export const DEFAULT_SYSTEM_ENV_ENTRIES: Readonly<Record<string, string>> = {
  HOME: '/user',
  USER: 'user',
  PATH: '/bin:/usr/bin',
  LANG: 'zh_CN.UTF-8',
  NODE_ENV: 'development',
}

/** 旧设置页写入的 localStorage 键；默认表改为代码常量后一次性清掉。 */
const LEGACY_STORAGE_KEY = 'instant-os-system-env-settings'

let discardedLegacySettings = false

function discardLegacySystemEnvSettings(): void {
  if (discardedLegacySettings) {
    return
  }
  discardedLegacySettings = true
  try {
    if (localStorage.getItem(LEGACY_STORAGE_KEY) !== null) {
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    }
  } catch {
    // 忽略删旧键失败
  }
}

/** 返回系统默认环境变量浅拷贝，供终端 / QuickJS 创建使用。 */
export function getResolvedSystemEnv(): Record<string, string> {
  discardLegacySystemEnvSettings()
  return { ...DEFAULT_SYSTEM_ENV_ENTRIES }
}
