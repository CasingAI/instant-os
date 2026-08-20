import { useEffect, useState } from 'preact/hooks'
import type { ComponentType } from 'preact'
import { isExtAppId, isGeneratedAppId } from '../os/types.ts'
import type { AppId, BuiltinAppId, WindowState } from '../os/types.ts'

type HostAppComponent = ComponentType<{ windowId?: string; appId?: string }>

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; Component: HostAppComponent }
  | { status: 'error'; message: string }

/**
 * loaders 再套一层 import()，避免 51 个应用的 import() 出现在桌面壳的静态图里。
 */
function loadWindowApp(appId: AppId): Promise<HostAppComponent> {
  return import('../os/app-registry-loaders.ts').then((loaders) => {
    if (isGeneratedAppId(appId)) {
      return loaders.loadGeneratedAppComponent(appId)
    }
    if (isExtAppId(appId)) {
      return loaders.loadExtAppComponent(appId)
    }
    return loaders.loadBuiltinApp(appId as BuiltinAppId)
  })
}

function formatLoadError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return '应用模块加载失败'
}

export function WindowAppBody({ window }: { window: WindowState }) {
  const [retryNonce, setRetryNonce] = useState(0)
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    void loadWindowApp(window.appId)
      .then((Component) => {
        if (!cancelled) setState({ status: 'ready', Component })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: formatLoadError(error) })
      })
    return () => {
      cancelled = true
    }
  }, [window.appId, retryNonce])

  if (state.status === 'loading') {
    return (
      <div class="window-app-body window-app-body--loading" role="status">
        正在打开…
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div class="window-app-body window-app-body--error" role="alert">
        <p>{state.message}</p>
        <button
          type="button"
          class="window-app-body__retry"
          onClick={() => setRetryNonce((value) => value + 1)}
        >
          重试
        </button>
      </div>
    )
  }

  const { Component } = state
  if (isGeneratedAppId(window.appId) || isExtAppId(window.appId)) {
    return <Component appId={window.appId} windowId={window.id} />
  }
  return <Component windowId={window.id} />
}
