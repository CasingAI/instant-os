import type { AppId, BuiltinAppId } from './types.ts'

/** 与 AppDefinition.windowless 保持同步；独立模块避免 os-context ↔ app-registry 循环依赖 */
const WINDOWLESS_BUILTINS = new Set<BuiltinAppId>(['archive-utility', 'webview'])

export function isWindowlessApp(appId: AppId): boolean {
  return WINDOWLESS_BUILTINS.has(appId as BuiltinAppId)
}
