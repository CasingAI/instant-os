import { useEffect, useRef, useState } from 'preact/hooks'
import { Button } from '../ui/button.tsx'
import { getAppDefinition } from '../os/app-registry.tsx'
import { isBuiltinAppId } from '../os/builtin-app-display-names.ts'
import { isExtAppId, isGeneratedAppId } from '../os/types.ts'
import type { WindowState } from '../os/types.ts'
import {
  loadWindowApp,
  peekWindowApp,
  type HostAppComponent,
} from './window-app-load.ts'
import {
  remainingWindowSplashMs,
  windowSplashIconSize,
  WINDOW_SPLASH_FADE_MS,
  WINDOW_SPLASH_MIN_MS,
} from './window-app-splash.ts'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; Component: HostAppComponent }
  | { status: 'error'; message: string }

type SplashPhase = 'shown' | 'exiting' | 'hidden'

function formatLoadError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return '应用模块加载失败'
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

function WindowAppSplashArt({ window }: { window: WindowState }) {
  if (isGeneratedAppId(window.appId) || isExtAppId(window.appId) || !isBuiltinAppId(window.appId)) {
    return undefined
  }
  const definition = getAppDefinition(window.appId)
  if (!definition) return undefined
  const Icon = definition.icon
  const size = windowSplashIconSize(window.width, window.height)
  return (
    <span
      class="window-app-body__splash-icon"
      aria-hidden="true"
      style={{ width: `${size}px`, height: `${size}px` }}
    >
      <Icon size={size} />
    </span>
  )
}

function splashLabel(window: WindowState): string {
  if (isBuiltinAppId(window.appId)) {
    return getAppDefinition(window.appId)?.name ?? window.title
  }
  return window.title
}

function WindowAppSplashPanel({
  window,
  state,
  onRetry,
  className,
  role,
  'aria-busy': ariaBusy,
  'aria-live': ariaLive,
  onTransitionEnd,
}: {
  window: WindowState
  state: LoadState
  onRetry: () => void
  className?: string
  role?: 'alert' | 'status'
  'aria-busy'?: boolean
  'aria-live'?: 'polite' | 'off'
  onTransitionEnd?: (event: TransitionEvent) => void
}) {
  const isError = state.status === 'error'

  return (
    <div
      class={className}
      role={role}
      aria-busy={ariaBusy}
      aria-live={ariaLive}
      onTransitionEnd={onTransitionEnd}
    >
      <div class="window-app-body__splash-stack">
        <div class="window-app-body__splash-icon-slot">
          <WindowAppSplashArt window={window} />
        </div>
        <div class="window-app-body__splash-description">
          {isError ? (
            <p class="window-app-body__splash-message">{state.message}</p>
          ) : (
            <p class="window-app-body__splash-name">{splashLabel(window)}</p>
          )}
        </div>
        <div class="window-app-body__splash-action" aria-hidden={isError ? undefined : true}>
          {isError ? (
            <Button tone="primary" onClick={onRetry}>
              重试
            </Button>
          ) : undefined}
        </div>
      </div>
    </div>
  )
}

export function WindowAppBody({ window }: { window: WindowState }) {
  // 迷你窗直接呈现正文，不播应用启动 splash
  const skipSplash = window.chromeKind === 'mini'
  const [retryNonce, setRetryNonce] = useState(0)
  const [state, setState] = useState<LoadState>(() => {
    const cached = peekWindowApp(window.appId)
    return cached ? { status: 'ready', Component: cached } : { status: 'loading' }
  })
  const [splashPhase, setSplashPhase] = useState<SplashPhase>(() => (skipSplash ? 'hidden' : 'shown'))
  const shownAtRef = useRef(Date.now())

  useEffect(() => {
    let cancelled = false
    const cached = peekWindowApp(window.appId)
    if (cached) {
      setState({ status: 'ready', Component: cached })
    } else {
      setState({ status: 'loading' })
    }
    if (!skipSplash) {
      shownAtRef.current = Date.now()
      setSplashPhase('shown')
    }
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
  }, [window.appId, retryNonce, skipSplash])

  useEffect(() => {
    if (skipSplash || splashPhase !== 'shown' || state.status !== 'ready') return
    const remaining = remainingWindowSplashMs({
      shownAt: shownAtRef.current,
      now: Date.now(),
      contentReady: true,
      minMs: WINDOW_SPLASH_MIN_MS,
    })
    if (remaining === undefined) return

    const reveal = () => {
      if (prefersReducedMotion()) {
        setSplashPhase('hidden')
        return
      }
      setSplashPhase('exiting')
    }

    if (remaining <= 0) {
      reveal()
      return
    }
    const timer = globalThis.setTimeout(reveal, remaining)
    return () => globalThis.clearTimeout(timer)
  }, [skipSplash, splashPhase, state.status, window.appId, retryNonce])

  useEffect(() => {
    if (splashPhase !== 'exiting') return
    const timer = globalThis.setTimeout(() => setSplashPhase('hidden'), WINDOW_SPLASH_FADE_MS + 50)
    return () => globalThis.clearTimeout(timer)
  }, [splashPhase])

  const handleSplashTransitionEnd = (event: TransitionEvent) => {
    if (event.propertyName !== 'opacity') return
    if (event.currentTarget !== event.target) return
    if (splashPhase === 'exiting') setSplashPhase('hidden')
  }

  const content = (() => {
    if (state.status === 'ready') {
      const Component = state.Component
      if (isGeneratedAppId(window.appId) || isExtAppId(window.appId)) {
        return <Component appId={window.appId} windowId={window.id} />
      }
      return <Component windowId={window.id} />
    }
    if (skipSplash && state.status === 'error') {
      return (
        <WindowAppSplashPanel
          window={window}
          state={state}
          onRetry={() => setRetryNonce((value) => value + 1)}
          className="window-app-body__splash window-app-body__splash--static"
          role="alert"
        />
      )
    }
    return undefined
  })()

  const splashBusy = splashPhase === 'shown' && state.status !== 'error'

  return (
    <div class="window-app-body">
      <div class="window-app-body__content">{content}</div>
      {splashPhase !== 'hidden' ? (
        <WindowAppSplashPanel
          window={window}
          state={state}
          onRetry={() => setRetryNonce((value) => value + 1)}
          className={`window-app-body__splash${splashPhase === 'exiting' ? ' window-app-body__splash--exiting' : ''}`}
          role={state.status === 'error' ? 'alert' : 'status'}
          aria-busy={splashBusy || undefined}
          aria-live={state.status === 'error' ? undefined : 'polite'}
          onTransitionEnd={handleSplashTransitionEnd}
        />
      ) : undefined}
    </div>
  )
}
