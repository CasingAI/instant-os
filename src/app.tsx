import { useCallback, useEffect, useState } from 'preact/hooks'
import { useOpenAiReady } from './ai/use-openai-ready.ts'
import {
  claimBootSplash,
  removeBootSplash,
  startBootSplashColdExit,
} from './os/boot-splash-host.ts'
import { OsShell } from './os/os-shell.tsx'
import { SetupAssistant } from './os/setup-assistant.tsx'
import './os/boot-splash.css'
import './os/boot-transition.css'

const DOCUMENT_TITLE = 'Instant OS'
const COLD_ENTER_MS = 1000
const SETUP_ENTER_MS = 1050

type BootPhase = 'booting' | 'setup' | 'cold-entering' | 'setup-entering' | 'desktop'

export function App() {
  const apiReady = useOpenAiReady()
  const [bootPhase, setBootPhase] = useState<BootPhase>('booting')

  useEffect(() => {
    document.title = DOCUMENT_TITLE
    claimBootSplash()
  }, [])

  useEffect(() => {
    if (bootPhase !== 'booting') {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      if (apiReady) {
        startBootSplashColdExit()
        setBootPhase('cold-entering')
        return
      }

      removeBootSplash()
      setBootPhase('setup')
    })

    return () => window.cancelAnimationFrame(frame)
  }, [apiReady, bootPhase])

  useEffect(() => {
    if (bootPhase === 'cold-entering') {
      const timer = window.setTimeout(() => {
        removeBootSplash()
        setBootPhase('desktop')
      }, COLD_ENTER_MS)
      return () => window.clearTimeout(timer)
    }

    if (bootPhase === 'setup-entering') {
      const timer = window.setTimeout(() => {
        setBootPhase('desktop')
      }, SETUP_ENTER_MS)
      return () => window.clearTimeout(timer)
    }
  }, [bootPhase])

  const handleSetupLaunch = useCallback(() => {
    setBootPhase('setup-entering')
  }, [])

  const showDesktop =
    bootPhase === 'cold-entering' || bootPhase === 'setup-entering' || bootPhase === 'desktop'
  const showSetup = bootPhase === 'setup' || bootPhase === 'setup-entering'

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
            bootPhase === 'setup-entering' ? ' boot-root__setup--exiting' : ''
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
