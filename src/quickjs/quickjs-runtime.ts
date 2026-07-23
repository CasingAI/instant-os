import {
  getQuickJS,
  newAsyncContext,
  type ContextOptions,
  type QuickJSAsyncContext,
  type QuickJSWASMModule,
} from 'quickjs-emscripten'

let syncRuntimePromise: Promise<QuickJSWASMModule> | undefined

/**
 * 懒加载共享 sync QuickJS WASM（沙箱短任务用）。
 *
 * 仅当宿主能保证 guest **不会**调用 `*Sync` / 其它可挂起桥时使用。
 * 通用脚本（Virtual JS / 终端实例）不可按「是否需要 Sync」选 sync/Asyncify——
 * 事先无法预知——故不做通用双轨；长驻请用 {@link createQuickJsAsyncContext}。
 */
export function loadQuickJsRuntime(): Promise<QuickJSWASMModule> {
  syncRuntimePromise ??= getQuickJS()
  return syncRuntimePromise
}

/**
 * 为每个 QuickJS 实例创建独立 Asyncify context（底层新建 WASM 模块，可独立 suspend）。
 *
 * 策略（L1.7）：长驻实例统一走本路径；每实例一份模块 → 多实例互不抢挂起槽。
 * 同模块禁止嵌套挂起（Sync 内再 Sync / 可挂起 import）；不做自动排队。
 * 销毁时只需 `context.dispose()`（勿再单独 dispose runtime，Asyncify 下会踩 HostRef）。
 */
export function createQuickJsAsyncContext(
  options?: ContextOptions,
): Promise<QuickJSAsyncContext> {
  return newAsyncContext(options)
}
