import { Component, type ComponentChildren } from 'preact'

type CrashEntry = {
  at: string
  source: string
  detail: string
}

type ConsoleEntry = {
  at: string
  level: string
  text: string
}

type CrashGuardGlobal = {
  state: {
    activated: boolean
    errors: CrashEntry[]
    consoleLogs: ConsoleEntry[]
    moduleExecuted: boolean
    bootComplete: boolean
  }
  pushError: (source: string, detail: string) => void
  pushConsole: (level: string, args: IArguments | unknown[]) => void
  activate: (primaryReason: unknown) => void
  dismiss: () => void
  renderCrashScreen: (primaryMessage?: string) => void
  safeString: (value: unknown) => string
  markModuleExecuted: () => void
  markBootMainLoaded?: () => void
  markBootComplete: () => void
  loadMainModule: () => void
  setBootStatus?: (message: string) => void
  setBootProgress?: (ratio: number) => void
}

const CRASH_DISMISS_EVENT = 'instant-os-crash-dismiss'

declare global {
  interface Window {
    __INSTANT_OS_CRASH__?: CrashGuardGlobal
  }
}

const CRASH_TEST_PARAM = 'instant_crash'

export type CrashTestMode = 'boot' | 'reject' | 'font' | 'react'

function getCrashGuard(): CrashGuardGlobal | undefined {
  return window.__INSTANT_OS_CRASH__
}

export function getCrashTestMode(): CrashTestMode | undefined {
  if (typeof location === 'undefined') {
    return undefined
  }

  const params = new URLSearchParams(location.search)
  const raw = params.get(CRASH_TEST_PARAM)
  if (raw === null) {
    return undefined
  }

  if (raw === '' || raw === '1' || raw === 'boot') {
    return 'boot'
  }
  if (raw === 'reject' || raw === 'font' || raw === 'react') {
    return raw
  }

  return 'boot'
}

export function reportCrash(source: string, error: unknown, extra?: string): void {
  const guard = getCrashGuard()
  const detail = [
    guard?.safeString(error) ?? String(error),
    extra,
  ]
    .filter(Boolean)
    .join('\n')

  guard?.pushError(source, detail)
  guard?.activate(detail)
}

export function isCrashScreenActive(): boolean {
  return getCrashGuard()?.state.activated === true
}

export function dismissCrashScreen(): void {
  getCrashGuard()?.dismiss()
}

export function markBootModuleExecuted(): void {
  getCrashGuard()?.markModuleExecuted()
}

export function markBootMainLoaded(): void {
  getCrashGuard()?.markBootMainLoaded?.()
}

export function markBootComplete(): void {
  getCrashGuard()?.markBootComplete()
}

type ErrorBoundaryProps = {
  children: ComponentChildren
}

type ErrorBoundaryState = {
  hasError: boolean
}

export class BootErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  private handleCrashDismiss = () => {
    if (this.state.hasError) {
      this.setState({ hasError: false })
    }
  }

  componentDidMount() {
    window.addEventListener(CRASH_DISMISS_EVENT, this.handleCrashDismiss)
  }

  componentWillUnmount() {
    window.removeEventListener(CRASH_DISMISS_EVENT, this.handleCrashDismiss)
  }

  componentDidCatch(error: unknown, errorInfo: { componentStack?: string }) {
    this.setState({ hasError: true })
    reportCrash('react.error-boundary', error, errorInfo.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return undefined
    }

    return this.props.children
  }
}
