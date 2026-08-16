import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
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
import { DebugModeWarningDialog } from './os/debug-mode-warning-dialog.tsx'
import { requestDebugModeConfirm } from './os/debug-mode-confirm-store.ts'
import { seedDebugEnvAccountIfEmpty } from './os/debug-env-seed.ts'
import { parseDebugLaunchParams, stripDebugLaunchParams } from './os/debug-launch.ts'
import { EXPERIMENTAL_SETTINGS_CHANGED_EVENT } from './os/experimental-settings-storage.ts'
import { osOpenApp } from './os/os-open-app-bridge.ts'
import { showProcessIsolationFallbackNotification } from './os/process-isolation-fallback.ts'
import { OsShell } from './os/os-shell.tsx'
import { SetupAssistant } from './os/setup-assistant.tsx'
import './os/boot-splash.css'
import './os/boot-transition.css'

const DOCUMENT_TITLE = 'Instant OS'
const SPLASH_EXIT_MS = 1000
const SETUP_ENTER_MS = 1050
const PROCESS_ISOLATION_FALLBACK_NOTIFY_DELAY_MS = 1000
const DEBUG_BOOT_COMMAND_DELAY_MS = 200
const DEBUG_BOOT_COMMAND_RETRY_MS = 300
const DEBUG_BOOT_COMMAND_RETRY_LIMIT = 5

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
  const debugLaunch = useMemo(() => parseDebugLaunchParams(location.search), [])
  const [debugConfirmed, setDebugConfirmed] = useState(false)

  useEffect(() => {
    document.title = DOCUMENT_TITLE
    claimBootSplash()
    void applyProcessIsolationCapability()
  }, [])

  // Debug 模式：进入桌面前必须经过一次全局安全警告；取消则清除参数回退正常启动流程
  useEffect(() => {
    if (!debugLaunch.enabled || debugConfirmed) {
      return
    }

    let cancelled = false
    void requestDebugModeConfirm({ command: debugLaunch.command }).then((confirmed) => {
      if (cancelled) {
        return
      }
      if (confirmed) {
        // 钥匙串为空时用 Debug env 播种，使钥匙串界面与实际生效配置一致
        seedDebugEnvAccountIfEmpty()
        setDebugConfirmed(true)
      } else {
        location.replace(stripDebugLaunchParams(location.href))
      }
    })

    return () => {
      cancelled = true
    }
  }, [debugLaunch.enabled, debugLaunch.command, debugConfirmed])

  useEffect(() => {
    if (bootPhase !== 'booting') {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      startBootSplashColdExit()

      if (debugLaunch.enabled && !debugConfirmed) {
        // 等待 Debug 模式确认；保持 booting，警告框覆盖在 splash 之上
        return
      }

      if (apiReady || debugLaunch.enabled) {
        setBootPhase('cold-entering')
        return
      }

      setBootPhase('setup-boot-entering')
    })

    return () => window.cancelAnimationFrame(frame)
  }, [apiReady, bootPhase, debugLaunch.enabled, debugConfirmed])

  // Debug 模式确认并进入桌面后，在系统终端中执行启动命令
  useEffect(() => {
    if (bootPhase !== 'desktop' || !debugLaunch.enabled || !debugConfirmed || !debugLaunch.command) {
      return
    }

    let cancelled = false
    let attempt = 0

    const tryOpenTerminal = () => {
      if (cancelled) {
        return
      }
      try {
        osOpenApp('terminal', { bootCommand: debugLaunch.command })
      } catch {
        attempt += 1
        if (attempt < DEBUG_BOOT_COMMAND_RETRY_LIMIT) {
          window.setTimeout(tryOpenTerminal, DEBUG_BOOT_COMMAND_RETRY_MS)
        }
      }
    }

    const timer = window.setTimeout(tryOpenTerminal, DEBUG_BOOT_COMMAND_DELAY_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [bootPhase, debugLaunch.command, debugLaunch.enabled, debugConfirmed])

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
      const waitingForDebugConfirm = debugLaunch.enabled && !debugConfirmed
      const hideCursor =
        !waitingForDebugConfirm &&
        (bootPhase === 'booting' ||
          bootPhase === 'cold-entering' ||
          bootPhase === 'setup-boot-entering' ||
          bootPhase === 'setup-entering')
      setBootCursorHidden(hideCursor)
    }

    applyBootCursorVisibility()
    window.addEventListener(EXPERIMENTAL_SETTINGS_CHANGED_EVENT, applyBootCursorVisibility)
    return () => {
      window.removeEventListener(EXPERIMENTAL_SETTINGS_CHANGED_EVENT, applyBootCursorVisibility)
    }
  }, [bootPhase, debugConfirmed, debugLaunch.enabled])

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

      {debugLaunch.enabled && <DebugModeWarningDialog />}
    </div>
  )
}
