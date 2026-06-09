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
  }
  pushError: (source: string, detail: string) => void
  pushConsole: (level: string, args: IArguments | unknown[]) => void
  activate: (primaryReason: unknown) => void
  renderCrashScreen: (primaryMessage?: string) => void
  safeString: (value: unknown) => string
}

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

type ErrorBoundaryProps = {
  children: ComponentChildren
}

type ErrorBoundaryState = {
  hasError: boolean
}

export class BootErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  componentDidCatch(error: unknown, errorInfo: { componentStack?: string }) {
    this.setState({ hasError: true })
    reportCrash('react.error-boundary', error, errorInfo.componentStack)
  }

  render() {
    if (this.state.hasError || isCrashScreenActive()) {
      return undefined
    }

    return this.props.children
  }
}
