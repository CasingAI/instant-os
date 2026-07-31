/** 主线程按需加载 app-registry（含 React/CSS）。勿从 Worker 依赖链引用。 */
let registryModulePromise: Promise<typeof import('./app-registry.tsx')> | undefined

export function loadAppRegistryModule(): Promise<typeof import('./app-registry.tsx')> {
  registryModulePromise ??= import('./app-registry.tsx')
  return registryModulePromise
}
