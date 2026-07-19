import type { AppId, BuiltinAppId } from './types.ts'

/** 与 AppDefinition.multiWindow 保持同步；独立模块避免 os-context ↔ app-registry 循环依赖 */
const MULTI_WINDOW_BUILTINS = new Set<BuiltinAppId>()

export function isMultiWindowApp(appId: AppId): boolean {
  return MULTI_WINDOW_BUILTINS.has(appId as BuiltinAppId)
}
