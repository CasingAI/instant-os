import { getAppDefinition } from './app-registry.tsx'
import type { BuiltinAppId } from './types.ts'

/** 内置应用在系统中的显示名称；以 {@link APP_REGISTRY} 为唯一数据源。 */
export function getBuiltinAppName(appId: BuiltinAppId): string {
  return getAppDefinition(appId)?.name ?? appId
}

/** 「在 {应用名} 中打开」的标准文案。 */
export function formatOpenInBuiltinAppLabel(appId: BuiltinAppId): string {
  return `在 ${getBuiltinAppName(appId)} 中打开`
}
