/**
 * 单窗口强制：AI 生成应用永远只允许一扇窗口（数据走 iframe shim + postMessage
 * 异步落盘，多窗口会产生写入竞争）。重复打开同一应用时聚焦既有窗口。
 *
 * icode 预览窗口（icode 应用内部的 iframe）不经过 OS 窗口系统，天然不受此约束；
 * 已发布为真实应用的 `gen:icode:*` 应用走 openGeneratedApp，仍受单窗口约束。
 */
import type { AppId, WindowState } from './types.ts'

export function resolveSingleWindowForApp(
  windows: readonly WindowState[],
  appId: AppId,
): WindowState | undefined {
  const live = windows.filter((window) => !window.closing && window.appId === appId)
  return live.find((window) => !window.minimized) ?? live.find((window) => window.minimized)
}
