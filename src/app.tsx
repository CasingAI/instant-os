import { useEffect, useState } from 'preact/hooks'
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
import { osOpenApp } from './os/os-open-app-bridge.ts'
import { showProcessIsolationFallbackNotification } from './os/process-isolation-fallback.ts'
import { OsShell } from './os/os-shell.tsx'
import { hasSeenWelcome, markWelcomeSeen } from './os/welcome-first-run.ts'
import './os/boot-splash.css'
import './os/boot-transition.css'

const DOCUMENT_TITLE = 'Instant OS'
const SPLASH_EXIT_MS = 1000
const PROCESS_ISOLATION_FALLBACK_NOTIFY_DELAY_MS = 1000
/** 首次运行：桌面淡入完成后再拉起欢迎窗口，避免与启动过渡重叠 */
const WELCOME_OPEN_DELAY_MS = 600

type BootPhase = 'booting' | 'cold-entering' | 'desktop'

export function App() {
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
      setBootPhase('cold-entering')
    })

    return () => window.cancelAnimationFrame(frame)
  }, [bootPhase])

  useEffect(() => {
    if (bootPhase === 'cold-entering') {
      const timer = window.setTimeout(() => {
        removeBootSplash()
        setBootPhase('desktop')
      }, SPLASH_EXIT_MS)
      return () => window.clearTimeout(timer)
    }
  }, [bootPhase])

  useEffect(() => {
    const applyBootCursorVisibility = () => {
      const hideCursor =
        bootPhase === 'booting' || bootPhase === 'cold-entering'
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

  // 首次运行自动打开欢迎 APP；不阻塞桌面，可随时关闭
  useEffect(() => {
    if (bootPhase !== 'desktop' || hasSeenWelcome()) {
      return
    }

    const timer = window.setTimeout(() => {
      try {
        osOpenApp('welcome')
      } catch {
        // 系统尚未就绪等罕见情况；标记已见，避免反复尝试
      } finally {
        markWelcomeSeen()
      }
    }, WELCOME_OPEN_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [bootPhase])

  return (
    <div class="boot-root">
      {bootPhase !== 'booting' && (
        <div
          class={`boot-root__desktop${
            bootPhase === 'cold-entering'
              ? ' boot-root__desktop--cold-entering'
              : ' boot-root__desktop--entered'
          }`}
        >
          <OsShell />
        </div>
      )}
    </div>
  )
}
