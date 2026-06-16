import { detectSandboxedCorsSupport } from './detect-sandboxed-cors-support.ts'
import { loadExperimentalSettings } from './experimental-settings-storage.ts'

let corsUnsupportedWhileIsolationEnabled = false

/** 本次启动 CORS 探测失败且用户未在实验性特性中关闭进程隔离。 */
export function shouldShowProcessIsolationFallbackNotification(): boolean {
  return corsUnsupportedWhileIsolationEnabled
}

/** 启动时探测 CORS；失败时不改 localStorage，仅标记需提示用户。 */
export function applyProcessIsolationCapability(): Promise<void> {
  return detectSandboxedCorsSupport().then((supported) => {
    if (supported) {
      corsUnsupportedWhileIsolationEnabled = false
      return
    }

    const settings = loadExperimentalSettings()
    if (!settings.generatedAppProcessIsolation) {
      corsUnsupportedWhileIsolationEnabled = false
      return
    }

    corsUnsupportedWhileIsolationEnabled = true
  })
}
