import type { AppId, OpenAppOptions } from './types.ts'

type OpenAppFn = (appId: AppId, options?: OpenAppOptions) => string | undefined

let openAppImpl: OpenAppFn | undefined

export function registerOsOpenApp(fn: OpenAppFn): () => void {
  openAppImpl = fn
  return () => {
    if (openAppImpl === fn) {
      openAppImpl = undefined
    }
  }
}

export function osOpenApp(appId: AppId, options?: OpenAppOptions): string | undefined {
  if (!openAppImpl) {
    throw new Error('系统尚未就绪，无法打开应用')
  }
  return openAppImpl(appId, options)
}
