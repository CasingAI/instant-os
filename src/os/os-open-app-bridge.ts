import type { AppId, OpenAppOptions } from './types.ts'

type OpenAppFn = (appId: AppId, options?: OpenAppOptions) => void

let openAppImpl: OpenAppFn | undefined

export function registerOsOpenApp(fn: OpenAppFn): () => void {
  openAppImpl = fn
  return () => {
    if (openAppImpl === fn) {
      openAppImpl = undefined
    }
  }
}

export function osOpenApp(appId: AppId, options?: OpenAppOptions): void {
  if (!openAppImpl) {
    throw new Error('系统尚未就绪，无法打开应用')
  }
  openAppImpl(appId, options)
}
