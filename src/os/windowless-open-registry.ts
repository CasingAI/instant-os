/**
 * 无窗口应用的打开意图登记表。
 *
 * 无窗口应用（AppDefinition.windowless）没有窗口组件：被打开时系统按 appId
 * 在这里取登记的处理函数执行打开意图（挂载镜像、发通知等），不建窗。
 * 处理函数由各能力模块自行注册（对齐 file-open-registry 模式），
 * 避免本模块 import 应用 UI。
 */
import type { AppId, OpenAppOptions } from './types.ts'

export type WindowlessOpenHandler = (options: OpenAppOptions | undefined) => void | Promise<void>

const handlers = new Map<AppId, WindowlessOpenHandler>()

export function registerWindowlessOpenHandler(appId: AppId, handler: WindowlessOpenHandler): void {
  handlers.set(appId, handler)
}

export function getWindowlessOpenHandler(appId: AppId): WindowlessOpenHandler | undefined {
  return handlers.get(appId)
}
