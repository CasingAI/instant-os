import {
  listEnabledModelsForCapability,
  resolvePreferredModelRef,
  type AiTokenizerFamily,
  type FlatEnabledModel,
  type PreferredModelRef,
} from '../../ai/ai-providers.ts'
import { listSupportedReasoningEfforts } from '../../ai/ai-thinking.ts'
import { resolveTokenizerFamily } from '../../ai/model-tokenizer.ts'
import { mergeOpenAiConfig, type OpenAiConfig } from '../../ai/openai-config.ts'
import { subscribeOpenAiConfig } from '../../ai/openai-config-events.ts'
import {
  loadAccountSettings,
  openAiConfigForModelRef,
} from '../../os/account-settings-storage.ts'
import {
  loadVscodePrefs,
  VSCODE_AI_CONTEXT_WINDOW_PRESETS,
  VSCODE_AI_THINKING_EFFORT_PRESETS,
  type VscodeAiContextWindowPref,
  type VscodeAiModelOptionPrefs,
  type VscodeAiThinkingEffortPref,
  type VscodeModelSource,
  type VscodePrefs,
} from './vscode-prefs.ts'
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

function preferredCapabilityKey(
  capability: 'text' | 'text-secondary',
): string | undefined {
  const settings = loadAccountSettings()
  if (!settings) return undefined
  const preferred = resolvePreferredModelRef(settings, capability)
  if (!preferred) return undefined
  const models = listVscodeAiTextModels()
  if (
    !models.some(
      (item) =>
        item.providerEntryId === preferred.providerEntryId &&
        item.modelId === preferred.modelId,
    )
  ) {
    return undefined
  }
  return formatVscodeAiModelRefKey(preferred)
}

/** 按来源解析实际模型键（副基座 / 基座 / 指定） */
function resolveModelKeyFromSource(
  source: VscodeModelSource,
  customKey: string | undefined,
): string | undefined {
  if (source === 'custom') {
    return resolveVscodeAiModelRefKey(customKey)
  }
  if (source === 'text') {
    return preferredCapabilityKey('text') ?? resolveVscodeAiModelRefKey(undefined)
  }
  return (
    preferredCapabilityKey('text-secondary') ??
    preferredCapabilityKey('text') ??
    resolveVscodeAiModelRefKey(undefined)
  )
}

/** 按补全来源解析实际模型键（副基座 / 基座 / 指定） */
export function resolveVscodeCompletionModelKey(
  prefs?: Pick<VscodePrefs, 'completionModelSource' | 'completionModelKey'>,
): string | undefined {
  const resolved = prefs ?? loadVscodePrefs()
  return resolveModelKeyFromSource(
    resolved.completionModelSource,
    resolved.completionModelKey,
  )
}

/** 按 Agent 来源解析实际模型键（副基座 / 基座 / 指定） */
export function resolveVscodeAiModelKey(
  prefs?: Pick<VscodePrefs, 'aiModelSource' | 'aiModelKey'>,
): string | undefined {
  const resolved = prefs ?? loadVscodePrefs()
  return resolveModelKeyFromSource(resolved.aiModelSource, resolved.aiModelKey)
}

export type VscodeAiCapabilityTags = {
  text?: PreferredModelRef
  textSecondary?: PreferredModelRef
}

/** 读取当前基座 / 副基座首选，供模型列表标签使用 */
export function loadVscodeAiCapabilityTags(): VscodeAiCapabilityTags {
  const settings = loadAccountSettings()
  if (!settings) return {}
  return {
    text: resolvePreferredModelRef(settings, 'text'),
    textSecondary: resolvePreferredModelRef(settings, 'text-secondary'),
  }
}

export function tagsForVscodeAiModelKey(
  modelKey: string,
  tags?: VscodeAiCapabilityTags,
): Array<'基座' | '副基座'> {
  const ref = parseVscodeAiModelRefKey(modelKey)
  if (!ref) return []
  const resolved = tags ?? loadVscodeAiCapabilityTags()
  const labels: Array<'基座' | '副基座'> = []
  if (
    resolved.text &&
    resolved.text.providerEntryId === ref.providerEntryId &&
    resolved.text.modelId === ref.modelId
  ) {
    labels.push('基座')
  }
  if (
    resolved.textSecondary &&
    resolved.textSecondary.providerEntryId === ref.providerEntryId &&
    resolved.textSecondary.modelId === ref.modelId
  ) {
    labels.push('副基座')
  }
  return labels
}

export function resolveVscodeAiContextWindowPrefForModelKey(
  modelKey: string,
  options?: Record<string, VscodeAiModelOptionPrefs>,
): VscodeAiContextWindowPref {
  const override =
    options?.[modelKey]?.contextWindow ??
    loadVscodePrefs().aiModelOptions[modelKey]?.contextWindow
  if (
    override === 'system' ||
    (typeof override === 'number' &&
      (VSCODE_AI_CONTEXT_WINDOW_PRESETS as readonly number[]).includes(override))
  ) {
    return override
  }
  return 'system'
}

export function resolveVscodeAiThinkingEnabledForModelKey(
  modelKey: string,
  options?: Record<string, VscodeAiModelOptionPrefs>,
): boolean {
  const override =
    options?.[modelKey]?.thinkingEnabled ??
    loadVscodePrefs().aiModelOptions[modelKey]?.thinkingEnabled
  if (typeof override === 'boolean') return override

  const settings = loadAccountSettings()
  const ref = parseVscodeAiModelRefKey(modelKey)
  if (!settings || !ref) return false
  const entry = settings.providers.find((item) => item.id === ref.providerEntryId)
  return entry?.thinkingEnabled ?? false
}

export function resolveVscodeAiThinkingEffortPrefForModelKey(
  modelKey: string,
  options?: Record<string, VscodeAiModelOptionPrefs>,
): VscodeAiThinkingEffortPref {
  const override =
    options?.[modelKey]?.thinkingEffort ??
    loadVscodePrefs().aiModelOptions[modelKey]?.thinkingEffort
  if (
    !(
      override === 'default' ||
      (typeof override === 'string' &&
        (VSCODE_AI_THINKING_EFFORT_PRESETS as readonly string[]).includes(override))
    )
  ) {
    return 'default'
  }
  if (override === 'default') return 'default'

  const settings = loadAccountSettings()
  const ref = parseVscodeAiModelRefKey(modelKey)
  const entry = settings?.providers.find((item) => item.id === ref?.providerEntryId)
  if (entry && ref) {
    const supported = listSupportedReasoningEfforts(entry.providerId, ref.modelId)
    if (supported !== null && !supported.includes(override)) {
      return 'default'
    }
  }
  return override
}

export function openAiConfigForVscodeAiModelKey(
  storedKey: string | undefined,
): OpenAiConfig {
  const key = resolveVscodeAiModelRefKey(storedKey)
  const settings = loadAccountSettings()
  let config = mergeOpenAiConfig(undefined, 'text')
  if (settings && key) {
    const ref = parseVscodeAiModelRefKey(key)
    if (ref) {
      const partial = openAiConfigForModelRef(settings, ref, 'text')
      if (partial) {
        config = mergeOpenAiConfig(partial, 'text')
      }
    }
  }

  if (key) {
    const modelOptions = loadVscodePrefs().aiModelOptions[key]
    const thinkingOverride = modelOptions?.thinkingEnabled
    const effortPref = resolveVscodeAiThinkingEffortPrefForModelKey(key)
    const thinkingEnabled =
      typeof thinkingOverride === 'boolean'
        ? thinkingOverride
        : config.thinkingEnabled
    const thinkingEffort =
      thinkingEnabled && effortPref !== 'default' ? effortPref : undefined
    if (typeof thinkingOverride === 'boolean' || thinkingEffort) {
      return {
        ...config,
        ...(typeof thinkingOverride === 'boolean' ? { thinkingEnabled } : {}),
        ...(thinkingEffort ? { thinkingEffort } : {}),
      }
    }
  }
  return config
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

export function useVscodeAiCapabilityTags(): VscodeAiCapabilityTags {
  const [revision, setRevision] = useState(0)
  useEffect(() => subscribeOpenAiConfig(() => setRevision((value) => value + 1)), [])
  return useMemo(() => {
    void revision
    return loadVscodeAiCapabilityTags()
  }, [revision])
}

export function labelForVscodeAiModel(model: FlatEnabledModel): string {
  return model.name.trim() || model.modelId
}

const MODEL_CAPABILITY_PREFIX = '@capability:'

export type VscodeModelPickerDecoded = {
  source: VscodeModelSource
  modelKey?: string
}

export function encodeVscodeModelPickerValue(
  source: VscodeModelSource,
  modelKey?: string,
): string {
  if (source === 'text-secondary') return `${MODEL_CAPABILITY_PREFIX}text-secondary`
  if (source === 'text') return `${MODEL_CAPABILITY_PREFIX}text`
  return modelKey?.trim() || ''
}

export function decodeVscodeModelPickerValue(value: string): VscodeModelPickerDecoded {
  const trimmed = value.trim()
  if (trimmed === `${MODEL_CAPABILITY_PREFIX}text-secondary`) {
    return { source: 'text-secondary' }
  }
  if (trimmed === `${MODEL_CAPABILITY_PREFIX}text`) {
    return { source: 'text' }
  }
  return { source: 'custom', modelKey: trimmed || undefined }
}

export function isVscodeModelCapabilityValue(value: string): boolean {
  return (
    value === `${MODEL_CAPABILITY_PREFIX}text-secondary` ||
    value === `${MODEL_CAPABILITY_PREFIX}text`
  )
}

/** 将 picker 值（含 @capability:…）解析为实际 modelKey，供编辑/悬停提示使用 */
export function resolveVscodeCapabilityPickerModelKey(
  pickerValue: string,
): string | undefined {
  const decoded = decodeVscodeModelPickerValue(pickerValue)
  if (decoded.source === 'custom') {
    return resolveVscodeAiModelRefKey(decoded.modelKey)
  }
  if (decoded.source === 'text') {
    return preferredCapabilityKey('text')
  }
  return preferredCapabilityKey('text-secondary') ?? preferredCapabilityKey('text')
}

/** 模型来源选项的展示名（含当前解析到的模型名） */
export function labelForVscodeModelSource(
  source: VscodeModelSource,
  customKey?: string,
): string {
  if (source === 'custom') {
    const key = resolveVscodeAiModelRefKey(customKey)
    const models = listVscodeAiTextModels()
    const ref = key ? parseVscodeAiModelRefKey(key) : undefined
    const model = ref
      ? models.find(
          (item) =>
            item.providerEntryId === ref.providerEntryId && item.modelId === ref.modelId,
        )
      : undefined
    const name = model ? labelForVscodeAiModel(model) : undefined
    return name ? name : '指定模型'
  }
  const key =
    source === 'text'
      ? preferredCapabilityKey('text')
      : preferredCapabilityKey('text-secondary') ?? preferredCapabilityKey('text')
  const models = listVscodeAiTextModels()
  const ref = key ? parseVscodeAiModelRefKey(key) : undefined
  const model = ref
    ? models.find(
        (item) =>
          item.providerEntryId === ref.providerEntryId && item.modelId === ref.modelId,
      )
    : undefined
  const name = model ? labelForVscodeAiModel(model) : undefined
  const prefix = source === 'text' ? '基座' : '副基座'
  return name ? `${prefix} · ${name}` : prefix
}

export function labelForVscodeModelPickerValue(value: string): string {
  const decoded = decodeVscodeModelPickerValue(value)
  return labelForVscodeModelSource(decoded.source, decoded.modelKey)
}

/** @deprecated 使用 encodeVscodeModelPickerValue */
export const encodeVscodeCompletionPickerValue = encodeVscodeModelPickerValue
/** @deprecated 使用 decodeVscodeModelPickerValue */
export const decodeVscodeCompletionPickerValue = decodeVscodeModelPickerValue
/** @deprecated 使用 isVscodeModelCapabilityValue */
export const isVscodeCompletionCapabilityValue = isVscodeModelCapabilityValue
/** @deprecated 使用 labelForVscodeModelPickerValue */
export const labelForVscodeCompletionPickerValue = labelForVscodeModelPickerValue
/** @deprecated 使用 labelForVscodeModelSource */
export const labelForVscodeCompletionModelSource = labelForVscodeModelSource
export type VscodeCompletionPickerDecoded = VscodeModelPickerDecoded

/** 解析 capability 首选对应的模型展示名 */
export function labelForPreferredCapabilityModel(
  capability: 'text' | 'text-secondary',
): string | undefined {
  const key = preferredCapabilityKey(capability)
  if (!key) return undefined
  const ref = parseVscodeAiModelRefKey(key)
  if (!ref) return undefined
  const model = listVscodeAiTextModels().find(
    (item) =>
      item.providerEntryId === ref.providerEntryId && item.modelId === ref.modelId,
  )
  return model ? labelForVscodeAiModel(model) : undefined
}
