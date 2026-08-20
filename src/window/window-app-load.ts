import type { ComponentType } from 'preact'
import { isExtAppId, isGeneratedAppId } from '../os/types.ts'
import type { AppId, BuiltinAppId } from '../os/types.ts'

export type HostAppComponent = ComponentType<{ windowId?: string; appId?: string }>

const resolved = new Map<AppId, HostAppComponent>()
const inflight = new Map<AppId, Promise<HostAppComponent>>()
let loadersPromise: Promise<typeof import('../os/app-registry-loaders.ts')> | undefined

function loadAppLoaders(): Promise<typeof import('../os/app-registry-loaders.ts')> {
  loadersPromise ??= import('../os/app-registry-loaders.ts').catch((error: unknown) => {
    loadersPromise = undefined
    throw error
  })
  return loadersPromise
}

function fetchWindowApp(appId: AppId): Promise<HostAppComponent> {
  return loadAppLoaders().then((loaders) => {
    if (isGeneratedAppId(appId)) {
      return loaders.loadGeneratedAppComponent(appId) as Promise<HostAppComponent>
    }
    if (isExtAppId(appId)) {
      return loaders.loadExtAppComponent(appId) as Promise<HostAppComponent>
    }
    return loaders.loadBuiltinApp(appId as BuiltinAppId)
  })
}

/** 同步读取已解析的窗口应用组件；未加载完时返回 undefined。 */
export function peekWindowApp(appId: AppId): HostAppComponent | undefined {
  return resolved.get(appId)
}

export function loadWindowApp(appId: AppId): Promise<HostAppComponent> {
  const cached = resolved.get(appId)
  if (cached) return Promise.resolve(cached)

  const pending = inflight.get(appId)
  if (pending) return pending

  const next = fetchWindowApp(appId)
    .then((Component) => {
      resolved.set(appId, Component)
      inflight.delete(appId)
      return Component
    })
    .catch((error: unknown) => {
      inflight.delete(appId)
      throw error
    })
  inflight.set(appId, next)
  return next
}

export function prefetchWindowApp(appId: AppId): void {
  void loadWindowApp(appId)
}

/** 只预热 loaders 模块，不拉具体应用。 */
export function prefetchAppLoaders(): void {
  void loadAppLoaders()
}
