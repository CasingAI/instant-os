/**
 * 宿主桥接错误文案（webview / instant-shell → guest）。
 * message 带 [source] 前缀，便于区分桥接错误与 WASM 硬崩。
 */

export type QuickJsBridgeSource = 'webview' | 'instant-shell'

export function formatQuickJsBridgeErrorMessage(
  source: QuickJsBridgeSource,
  error: unknown,
): string {
  const raw = error instanceof Error ? error.message : String(error)
  const prefix = `[${source}] `
  if (raw.startsWith(prefix)) {
    return raw
  }
  return `${prefix}${raw}`
}
