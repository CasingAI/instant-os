import { useCallback, useEffect, useState } from 'preact/hooks'
import { useOpenAiReady } from './ai/use-openai-ready.ts'
import {
  claimBootSplash,
  removeBootSplash,
  setBootCursorHidden,
  startBootSplashColdExit,
} from './os/boot-splash-host.ts'
import {
  applyProcessIsolationCapability,
  shouldShowProcessIsolationFallbackNotification,
} from './os/apply-process-isolation-capability.ts'
import { EXPERIMENTAL_SETTINGS_CHANGED_EVENT } from './os/experimental-settings-storage.ts'
import { showProcessIsolationFallbackNotification } from './os/process-isolation-fallback.ts'
import { OsShell } from './os/os-shell.tsx'
import { SetupAssistant } from './os/setup-assistant.tsx'
import './os/boot-splash.css'
import './os/boot-transition.css'

const DOCUMENT_TITLE = 'Instant OS'
const SPLASH_EXIT_MS = 1000
const SETUP_ENTER_MS = 1050
const PROCESS_ISOLATION_FALLBACK_NOTIFY_DELAY_MS = 1000

type BootPhase =
  | 'booting'
  | 'setup-boot-entering'
  | 'setup'
  | 'cold-entering'
  | 'setup-entering'
  | 'desktop'

export function App() {
  const apiReady = useOpenAiReady()
  const [bootPhase, setBootPhase] = useState<BootPhase>('booting')

  useEffect(() => {
    document.title = DOCUMENT_TITLE
    claimBootSplash()
    void applyProcessIsolationCapability()
  }, [])

  useEffect(() => {
    if (bootPhase !== 'booting') {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      startBootSplashColdExit()

      if (apiReady) {
        setBootPhase('cold-entering')
        return
      }

      setBootPhase('setup-boot-entering')
    })

    return () => window.cancelAnimationFrame(frame)
  }, [apiReady, bootPhase])

  useEffect(() => {
    if (bootPhase === 'cold-entering' || bootPhase === 'setup-boot-entering') {
      const timer = window.setTimeout(() => {
        removeBootSplash()
        setBootPhase(bootPhase === 'cold-entering' ? 'desktop' : 'setup')
      }, SPLASH_EXIT_MS)
      return () => window.clearTimeout(timer)
    }

    if (bootPhase === 'setup-entering') {
      const timer = window.setTimeout(() => {
        setBootPhase('desktop')
      }, SETUP_ENTER_MS)
      return () => window.clearTimeout(timer)
    }
  }, [bootPhase])

  useEffect(() => {
    const applyBootCursorVisibility = () => {
      const hideCursor =
        bootPhase === 'booting' ||
        bootPhase === 'cold-entering' ||
        bootPhase === 'setup-boot-entering' ||
        bootPhase === 'setup-entering'
      setBootCursorHidden(hideCursor)
    }

    applyBootCursorVisibility()
    window.addEventListener(EXPERIMENTAL_SETTINGS_CHANGED_EVENT, applyBootCursorVisibility)
    return () => {
      window.removeEventListener(EXPERIMENTAL_SETTINGS_CHANGED_EVENT, applyBootCursorVisibility)
    }
  }, [bootPhase])

  useEffect(() => {
    if (bootPhase !== 'desktop') {
      return
    }

    const timer = window.setTimeout(() => {
      if (shouldShowProcessIsolationFallbackNotification()) {
        showProcessIsolationFallbackNotification()
      }
    }, PROCESS_ISOLATION_FALLBACK_NOTIFY_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [bootPhase])

  const handleSetupLaunch = useCallback(() => {
    setBootPhase('setup-entering')
  }, [])

  const showDesktop =
    bootPhase === 'cold-entering' || bootPhase === 'setup-entering' || bootPhase === 'desktop'
  const showSetup =
    bootPhase === 'setup-boot-entering' || bootPhase === 'setup' || bootPhase === 'setup-entering'

  return (
    <div class="boot-root">
      {showDesktop && (
        <div
          class={`boot-root__desktop${
            bootPhase === 'cold-entering'
              ? ' boot-root__desktop--cold-entering'
              : bootPhase === 'setup-entering'
                ? ' boot-root__desktop--setup-entering'
                : bootPhase === 'desktop'
                  ? ' boot-root__desktop--entered'
                  : ''
          }`}
        >
          <OsShell />
        </div>
      )}

      {bootPhase === 'setup-entering' && (
        <div class="boot-root__flash boot-root__flash--active" aria-hidden="true" />
      )}

      {showSetup && (
        <div
          class={`boot-root__setup${
            bootPhase === 'setup-boot-entering'
              ? ' boot-root__setup--cold-entering'
              : bootPhase === 'setup-entering'
                ? ' boot-root__setup--exiting'
                : ''
          }`}
        >
          <SetupAssistant
            onLaunch={handleSetupLaunch}
            launching={bootPhase === 'setup-entering'}
          />
        </div>
      )}
    </div>
  )
}
