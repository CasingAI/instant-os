import { osOpenApp } from './os-open-app-bridge.ts'

export const OPEN_KEYCHAIN_AI_PROVIDERS_EVENT = 'instant-os:open-keychain-ai-providers'

let pendingAiProviders = false

export function openKeychainAiProvidersView() {
  pendingAiProviders = true
  try {
    osOpenApp('keychain')
  } catch {
    // 系统尚未挂载 openApp（极少见）；仍保留 pending，钥匙串打开后会 consume
  }
  window.dispatchEvent(new CustomEvent(OPEN_KEYCHAIN_AI_PROVIDERS_EVENT))
}

export function consumePendingOpenKeychainAiProvidersView(): boolean {
  if (!pendingAiProviders) {
    return false
  }
  pendingAiProviders = false
  return true
}
