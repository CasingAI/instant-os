import { normalizeInstantShellUrl } from '../terminal/instant-shell/instant-shell-url.ts'
import { osOpenApp } from './os-open-app-bridge.ts'
import type { BuiltinAppId } from './types.ts'
import { getDefaultUrlOpenApp } from './url-open-registry.ts'

export type OpenSystemUrlOptions = {
  /** 指定打开程序；缺省使用用户偏好或注册表默认项 */
  appId?: BuiltinAppId
}

/** 在系统内打开 http(s) 链接（统一入口，类似文件打开注册表） */
export function openSystemUrl(url: string, options?: OpenSystemUrlOptions): void {
  const normalized = normalizeInstantShellUrl(url)
  const appId = options?.appId ?? getDefaultUrlOpenApp()
  osOpenApp(appId, { url: normalized })
}
