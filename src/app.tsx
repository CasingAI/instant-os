import { useCallback, useEffect, useState } from 'preact/hooks'
import { OsShell } from './os/os-shell.tsx'
import { SetupAssistant } from './os/setup-assistant.tsx'
import { useOpenAiReady } from './ai/use-openai-ready.ts'
import './os/boot-transition.css'

const ENTER_DESKTOP_MS = 1050

type BootPhase = 'setup' | 'entering' | 'desktop'

export function App() {
  const apiReady = useOpenAiReady()
  const [bootPhase, setBootPhase] = useState<BootPhase>(() => (apiReady ? 'desktop' : 'setup'))

  useEffect(() => {
    if (bootPhase !== 'entering') {
      return
    }

    const timer = window.setTimeout(() => {
      setBootPhase('desktop')
    }, ENTER_DESKTOP_MS)

    return () => window.clearTimeout(timer)
  }, [bootPhase])

  const handleSetupLaunch = useCallback(() => {
    setBootPhase('entering')
  }, [])

  const showDesktop = bootPhase === 'entering' || bootPhase === 'desktop'
  const showSetup = bootPhase === 'setup' || bootPhase === 'entering'

  return (
    <div class="boot-root">
      {showDesktop && (
        <div
          class={`boot-root__desktop${
            bootPhase === 'entering'
              ? ' boot-root__desktop--entering'
              : bootPhase === 'desktop'
                ? ' boot-root__desktop--entered'
                : ''
          }`}
        >
          <OsShell />
        </div>
      )}

      {bootPhase === 'entering' && (
        <div class="boot-root__flash boot-root__flash--active" aria-hidden="true" />
      )}

      {showSetup && (
        <div class={`boot-root__setup${bootPhase === 'entering' ? ' boot-root__setup--exiting' : ''}`}>
          <SetupAssistant onLaunch={handleSetupLaunch} launching={bootPhase === 'entering'} />
        </div>
      )}
    </div>
  )
}
