import { getQuickJS, type QuickJSWASMModule } from 'quickjs-emscripten'

let runtimePromise: Promise<QuickJSWASMModule> | undefined

/** 懒加载共享 QuickJS WASM 模块（宿主侧单例，多次调用复用同一实例）。 */
export function loadQuickJsRuntime(): Promise<QuickJSWASMModule> {
  runtimePromise ??= getQuickJS()
  return runtimePromise
}
