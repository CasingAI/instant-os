import type { ChromoErrorPayload, ChromoLoadFailedPayload } from './chromo-bridge.ts'

export type ChromoPageFaultSeverity = 'fatal' | 'load'

export type ChromoPageFault = {
  severity: ChromoPageFaultSeverity
  code?: string
  message: string
  url?: string
  bridgeBuild?: string
  swBuild?: string
}

const FATAL_CODES = new Set([
  'VERSION_MISMATCH',
  'NO_SW',
  'INSECURE',
  'NO_STREAM',
  'SW_REGISTER_FAILED',
  'NO_IFRAME',
])

const LOAD_CODES = new Set([
  'SW_NOT_READY',
  'LOAD_TIMEOUT',
  'LOAD_NETWORK_ERROR',
  'BAD_URL',
  'RELOAD_ERROR',
])

function isRpcCode(code: string): boolean {
  if (
    code === 'HISTORY_ERROR' ||
    code === 'SESSION_BAD_ID' ||
    code === 'EVAL_BAD_REQUEST' ||
    code === 'CONSOLE_BAD_REQUEST' ||
    code === 'SCREENSHOT_BAD_REQUEST' ||
    code === 'NETWORK_BODY_BAD_REQUEST' ||
    code === 'NETWORK_BAD_REQUEST' ||
    code === 'HOT_PROBE_BAD_REQUEST' ||
    code === 'NETWORK_HOT_PROBE_BAD_REQUEST'
  ) {
    return true
  }
  return code.startsWith('NETWORK_') && code.endsWith('_BAD_REQUEST')
}

/**
 * Map VC_ERROR payload to a page fault, or null for RPC-only errors
 * that should not update global page UI.
 */
export function pageFaultFromError(payload: ChromoErrorPayload): ChromoPageFault | null {
  const code = payload.code?.trim() || undefined
  const message = payload.message?.trim() || '发生未知错误'

  if (code && isRpcCode(code)) {
    return null
  }

  if (code && FATAL_CODES.has(code)) {
    return {
      severity: 'fatal',
      code,
      message,
      bridgeBuild: payload.bridgeBuild,
      swBuild: payload.swBuild,
    }
  }

  if (code && LOAD_CODES.has(code)) {
    return {
      severity: 'load',
      code,
      message,
    }
  }

  // Unknown VC_ERROR without a known load code: treat as fatal if it looks
  // like a hard stop, otherwise as load so the user still sees a full-page UI.
  if (code === 'VERSION_MISMATCH' || message.includes('version mismatch')) {
    return {
      severity: 'fatal',
      code: code || 'VERSION_MISMATCH',
      message,
      bridgeBuild: payload.bridgeBuild,
      swBuild: payload.swBuild,
    }
  }

  return {
    severity: 'load',
    code,
    message,
  }
}

export function pageFaultFromLoadFailed(payload: ChromoLoadFailedPayload): ChromoPageFault {
  const code = payload.code?.trim() || undefined
  const message = payload.message?.trim() || '页面加载失败'
  return {
    severity: 'load',
    code,
    message,
    url: payload.url || undefined,
  }
}

/** Flat string for Network summary / legacy pageError consumers. */
export function formatPageFault(fault?: ChromoPageFault | null): string | undefined {
  if (!fault) {
    return undefined
  }
  const base = fault.code ? `${fault.code}: ${fault.message}` : fault.message
  return fault.url ? `${base} (${fault.url})` : base
}
