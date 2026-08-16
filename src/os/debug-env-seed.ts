/**
 * Debug 模式 env 预置播种：
 * - 仅当 dev 构建 + ?debug=1（isDebugMode）且钥匙串尚未配置任何账户时，
 *   把 VITE_DEBUG_OPENAI_*（默认 OpenCode Go / grok-4.5）写入钥匙串，
 *   使钥匙串界面与实际生效的 AI 配置一致。
 * - 钥匙串已有配置时不做任何写入（钥匙串优先，忽略 Debug env）。
 * - 不触碰非 Debug 模式（isDebugMode 为 false 时直接返回）。
 */
import {
  CURRENT_PRESET_SYNC_REVISION,
  applyTextPreferredToProviders,
  defaultProviderEntry,
  reconcilePreferredByCapability,
} from '../ai/ai-providers.ts'
import {
  loadAccountSettings,
  saveAccountSettings,
} from './account-settings-storage.ts'
import { isDebugMode } from './debug-launch.ts'

const DEBUG_PROVIDER_ID = 'opencode-go' as const
const DEBUG_DEFAULT_MODEL = 'grok-4.5'

/**
 * 钥匙串为空时，用 Debug env 预置配置播种钥匙串。
 * @returns 是否实际写入了钥匙串
 */
export function seedDebugEnvAccountIfEmpty(): boolean {
  if (!isDebugMode()) {
    return false
  }
  if (loadAccountSettings()) {
    // 钥匙串已有配置：忽略 Debug env，保持钥匙串优先
    return false
  }

  const debugApiKey = import.meta.env.VITE_DEBUG_OPENAI_API_KEY?.trim()
  if (!debugApiKey) {
    return false
  }

  const debugBaseURL = import.meta.env.VITE_DEBUG_OPENAI_BASE_URL?.trim()
  const debugModel = import.meta.env.VITE_DEBUG_OPENAI_MODEL?.trim()

  const entry = defaultProviderEntry(DEBUG_PROVIDER_ID)
  entry.apiKey = debugApiKey
  if (debugBaseURL) {
    entry.baseURL = debugBaseURL
  }

  const defaultModel = debugModel || DEBUG_DEFAULT_MODEL
  if (!entry.enabledModels.some((model) => model.modelId === defaultModel)) {
    entry.enabledModels.push({ modelId: defaultModel, name: defaultModel })
  }
  entry.defaultModel = defaultModel

  const reconciled = reconcilePreferredByCapability([entry], undefined, 0)
  const settings = {
    version: 2 as const,
    providers: applyTextPreferredToProviders(
      [entry],
      reconciled.preferredByCapability,
    ),
    preferredIndex: reconciled.preferredIndex,
    preferredByCapability: reconciled.preferredByCapability,
    presetSyncRevision: CURRENT_PRESET_SYNC_REVISION,
  }
  return saveAccountSettings(settings)
}
