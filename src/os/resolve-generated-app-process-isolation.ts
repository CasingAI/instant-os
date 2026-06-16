import { loadExperimentalSettings } from './experimental-settings-storage.ts'
import {
  readSandboxedCorsSupport,
  SANDBOXED_CORS_PROBE_COMPLETED_EVENT,
} from './detect-sandboxed-cors-support.ts'

export { SANDBOXED_CORS_PROBE_COMPLETED_EVENT }

/** 用户开启进程隔离且 CORS 探测已通过时，才实际使用隔离加载。 */
export function isGeneratedAppProcessIsolationActive(): boolean {
  if (!loadExperimentalSettings().generatedAppProcessIsolation) {
    return false
  }

  return readSandboxedCorsSupport() === true
}
