import {
  hasEffectiveDevAiCredentials,
  readEffectiveAiApiBase,
  readEffectiveAiApiKey,
  readEffectiveAiModel,
} from './instant-os-dev-settings.ts'

export type InstantOsRuntimeMode = 'host' | 'dev-standalone' | 'standalone'

export function isDevToolsEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_INSTANT_OS_DEV_TOOLS === 'true'
}

export function isRunningInsideInstantOsHost(): boolean {
  try {
    return window.parent !== window
  } catch {
    return false
  }
}

export function resolveInstantOsRuntimeMode(): InstantOsRuntimeMode {
  if (isRunningInsideInstantOsHost()) {
    return 'host'
  }

  if (isDevToolsEnabled()) {
    return 'dev-standalone'
  }

  return 'standalone'
}

export function readDevAiApiBase(): string | undefined {
  return readEffectiveAiApiBase()
}

export function readDevAiApiKey(): string | undefined {
  return readEffectiveAiApiKey()
}

export function readDevAiModel(): string {
  return readEffectiveAiModel()
}

export function hasDevAiCredentials(): boolean {
  return hasEffectiveDevAiCredentials()
}
