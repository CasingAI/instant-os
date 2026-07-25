import {
  listEnabledModelsForCapability,
  resolvePreferredModelRef,
  type AiTokenizerFamily,
  type FlatEnabledModel,
  type PreferredModelRef,
} from '../../ai/ai-providers.ts'
import { resolveTokenizerFamily } from '../../ai/model-tokenizer.ts'
import { mergeOpenAiConfig, type OpenAiConfig } from '../../ai/openai-config.ts'
import { subscribeOpenAiConfig } from '../../ai/openai-config-events.ts'
import {
  loadAccountSettings,
  openAiConfigForModelRef,
} from '../../os/account-settings-storage.ts'
import { useEffect, useMemo, useState } from 'preact/hooks'

export function formatVscodeAiModelRefKey(ref: PreferredModelRef): string {
  return `${ref.providerEntryId}:${ref.modelId}`
}

export function parseVscodeAiModelRefKey(key: string): PreferredModelRef | undefined {
  const separator = key.indexOf(':')
  if (separator <= 0) return undefined
  const providerEntryId = key.slice(0, separator)
  const modelId = key.slice(separator + 1)
  if (!providerEntryId || !modelId) return undefined
  return { providerEntryId, modelId }
}

export function listVscodeAiTextModels(): FlatEnabledModel[] {
  const settings = loadAccountSettings()
  if (!settings || settings.providers.length === 0) return []
  return listEnabledModelsForCapability(settings.providers, 'text')
}

export function resolveVscodeAiModelRefKey(storedKey: string | undefined): string | undefined {
  const models = listVscodeAiTextModels()
  if (models.length === 0) return undefined

  if (storedKey) {
    const ref = parseVscodeAiModelRefKey(storedKey)
    if (
      ref &&
      models.some(
        (item) =>
          item.providerEntryId === ref.providerEntryId && item.modelId === ref.modelId,
      )
    ) {
      return storedKey
    }
  }

  const settings = loadAccountSettings()
  const preferred = settings ? resolvePreferredModelRef(settings, 'text') : undefined
  if (preferred) {
    const key = formatVscodeAiModelRefKey(preferred)
    if (
      models.some(
        (item) =>
          item.providerEntryId === preferred.providerEntryId &&
          item.modelId === preferred.modelId,
      )
    ) {
      return key
    }
  }

  const first = models[0]
  if (!first) return undefined
  return formatVscodeAiModelRefKey({
    providerEntryId: first.providerEntryId,
    modelId: first.modelId,
  })
}

export function openAiConfigForVscodeAiModelKey(
  storedKey: string | undefined,
): OpenAiConfig {
  const key = resolveVscodeAiModelRefKey(storedKey)
  const settings = loadAccountSettings()
  if (settings && key) {
    const ref = parseVscodeAiModelRefKey(key)
    if (ref) {
      const partial = openAiConfigForModelRef(settings, ref, 'text')
      if (partial) {
        return mergeOpenAiConfig(partial, 'text')
      }
    }
  }
  return mergeOpenAiConfig(undefined, 'text')
}

/** 解析 VS Code 模型键对应的词表族（条目覆盖 > modelId 推断） */
export function tokenizerFamilyForVscodeAiModelKey(
  storedKey: string | undefined,
): AiTokenizerFamily | undefined {
  const key = resolveVscodeAiModelRefKey(storedKey)
  const settings = loadAccountSettings()
  const ref = key ? parseVscodeAiModelRefKey(key) : undefined
  const modelId =
    ref?.modelId ?? openAiConfigForVscodeAiModelKey(storedKey).defaultModel
  let override: AiTokenizerFamily | undefined
  if (settings && ref) {
    const provider = settings.providers.find(
      (entry) => entry.id === ref.providerEntryId,
    )
    override = provider?.enabledModels.find(
      (model) => model.modelId === ref.modelId,
    )?.tokenizerFamily
  }
  return resolveTokenizerFamily(modelId, override)
}

export function useVscodeAiTextModels(): FlatEnabledModel[] {
  const [revision, setRevision] = useState(0)
  useEffect(() => subscribeOpenAiConfig(() => setRevision((value) => value + 1)), [])
  return useMemo(() => {
    void revision
    return listVscodeAiTextModels()
  }, [revision])
}

export function labelForVscodeAiModel(model: FlatEnabledModel): string {
  return model.name.trim() || model.modelId
}
