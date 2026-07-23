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
 * 长驻实例请用 {@link createQuickJsAsyncContext}（每实例独立 Asyncify 模块）。
 */
export function loadQuickJsRuntime(): Promise<QuickJSWASMModule> {
  syncRuntimePromise ??= getQuickJS()
  return syncRuntimePromise
}

/**
 * 为每个 QuickJS 实例创建独立 Asyncify context（底层新建 WASM 模块，可独立 suspend）。
 * 销毁时只需 `context.dispose()`（勿再单独 dispose runtime，Asyncify 下会踩 HostRef）。
 */
export function createQuickJsAsyncContext(
  options?: ContextOptions,
): Promise<QuickJSAsyncContext> {
  return newAsyncContext(options)
}
