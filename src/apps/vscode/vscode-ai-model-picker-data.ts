import type { FlatEnabledModel } from '../../ai/ai-providers.ts'
import { labelForVscodeAiModelProvider } from './vscode-ai-model-display.ts'
import {
  encodeVscodeModelPickerValue,
  formatVscodeAiModelRefKey,
  isVscodeModelCapabilityValue,
  labelForPreferredCapabilityModel,
  labelForVscodeAiModel,
  labelForVscodeModelPickerValue,
  listVscodeAiTextModels,
  listVscodeAiVisionModels,
  resolveVscodeCapabilityPickerModelKey,
} from './vscode-ai-models.ts'
import type {
  VscodeAiContextWindowPref,
  VscodeAiModelOptionPrefs,
  VscodeAiThinkingEffortPref,
} from './vscode-prefs.ts'

export type VscodeAiModelPickerPin = {
  key: string
  /** 当前解析到的模型展示名 */
  primary: string
  /** 副基座 / 基座 */
  tag: string
  /** 供应商 */
  secondary?: string
  /** 钉住所指向的实际 modelKey；有则用于从全量列表去重 */
  resolvedModelKey?: string
}

export type VscodeAiModelPickerSelectionMode = 'agent' | 'completion' | 'vision'

/** `query` 应为已 trim + toLowerCase；空串匹配全部。 */
export function modelMatchesQuery(model: FlatEnabledModel, query: string): boolean {
  if (!query) return true
  const haystack =
    `${labelForVscodeAiModel(model)} ${model.modelId} ${labelForVscodeAiModelProvider(model)}`.toLowerCase()
  return haystack.includes(query)
}

export function filterVscodeAiModelsByQuery(
  models: readonly FlatEnabledModel[],
  query: string,
): FlatEnabledModel[] {
  const normalized = query.trim().toLowerCase()
  return models.filter((model) => modelMatchesQuery(model, normalized))
}

/** 从全量列表排除钉住项已解析到的 modelKey，避免快捷行与「全部」重复。 */
export function filterModelsExcludingPinnedKeys(
  models: readonly FlatEnabledModel[],
  pins: readonly VscodeAiModelPickerPin[],
): FlatEnabledModel[] {
  const excluded = new Set<string>()
  for (const pin of pins) {
    const key =
      pin.resolvedModelKey ?? resolveVscodeCapabilityPickerModelKey(pin.key)
    if (key) excluded.add(key)
  }
  if (excluded.size === 0) return [...models]
  return models.filter(
    (model) =>
      !excluded.has(
        formatVscodeAiModelRefKey({
          providerEntryId: model.providerEntryId,
          modelId: model.modelId,
        }),
      ),
  )
}

function pinForCapability(
  capability: 'text' | 'text-secondary' | 'vision',
  tag: string,
): VscodeAiModelPickerPin {
  const key = encodeVscodeModelPickerValue(capability)
  const modelKey = resolveVscodeCapabilityPickerModelKey(key)
  const model = modelKey
    ? (capability === 'vision'
        ? listVscodeAiVisionModels()
        : listVscodeAiTextModels()
      ).find(
        (item) =>
          formatVscodeAiModelRefKey({
            providerEntryId: item.providerEntryId,
            modelId: item.modelId,
          }) === modelKey,
      )
    : undefined
  return {
    key,
    primary: model
      ? labelForVscodeAiModel(model)
      : capability === 'vision'
        ? '未配置'
        : (labelForPreferredCapabilityModel(capability) ?? '未配置'),
    tag,
    secondary: model ? labelForVscodeAiModelProvider(model) : undefined,
    ...(modelKey ? { resolvedModelKey: modelKey } : {}),
  }
}

/** agent / completion / vision 模式下列表顶部的能力快捷项。 */
export function listVscodeAiModelCapabilityPins(
  selectionMode: VscodeAiModelPickerSelectionMode | undefined,
): readonly VscodeAiModelPickerPin[] {
  if (selectionMode === 'vision') {
    return [pinForCapability('vision', '视觉')]
  }
  if (selectionMode !== 'agent' && selectionMode !== 'completion') return []
  return [
    pinForCapability('text-secondary', '副基座'),
    pinForCapability('text', '基座'),
  ]
}

export function filterVscodeAiModelPickerPins(
  pins: readonly VscodeAiModelPickerPin[],
  query: string,
): readonly VscodeAiModelPickerPin[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return pins
  return pins.filter((item) => {
    const haystack =
      `${item.primary} ${item.tag} ${item.secondary ?? ''}`.toLowerCase()
    return haystack.includes(normalized)
  })
}

export function labelForVscodeModelPickerDisplay(
  value: string,
  models: readonly FlatEnabledModel[],
  selectionMode?: VscodeAiModelPickerSelectionMode,
): string {
  if (isVscodeModelCapabilityValue(value)) {
    return labelForVscodeModelPickerValue(value)
  }
  const selected = models.find(
    (model) =>
      formatVscodeAiModelRefKey({
        providerEntryId: model.providerEntryId,
        modelId: model.modelId,
      }) === value,
  )
  if (selected) return labelForVscodeAiModel(selected)
  if (selectionMode === 'completion' || selectionMode === 'agent' || selectionMode === 'vision') {
    return labelForVscodeModelPickerValue(value)
  }
  return value || '未配置文本模型'
}

function isModelOptionEmpty(prefs: VscodeAiModelOptionPrefs): boolean {
  return (
    prefs.thinkingEnabled === undefined &&
    prefs.thinkingEffort === undefined &&
    prefs.contextWindow === undefined
  )
}

function upsertModelOption(
  options: Record<string, VscodeAiModelOptionPrefs>,
  modelKey: string,
  nextPrefs: VscodeAiModelOptionPrefs,
): Record<string, VscodeAiModelOptionPrefs> {
  const next = { ...options }
  if (isModelOptionEmpty(nextPrefs)) {
    delete next[modelKey]
  } else {
    next[modelKey] = nextPrefs
  }
  return next
}

export function withVscodeAiThinkingEnabled(
  options: Record<string, VscodeAiModelOptionPrefs>,
  modelKey: string,
  thinkingEnabled: boolean,
): Record<string, VscodeAiModelOptionPrefs> {
  const current = options[modelKey] ?? {}
  return {
    ...options,
    [modelKey]: { ...current, thinkingEnabled },
  }
}

export function withVscodeAiThinkingEffort(
  options: Record<string, VscodeAiModelOptionPrefs>,
  modelKey: string,
  thinkingEffort: VscodeAiThinkingEffortPref,
): Record<string, VscodeAiModelOptionPrefs> {
  const current = options[modelKey] ?? {}
  if (thinkingEffort === 'default') {
    const { thinkingEffort: _removed, ...rest } = current
    return upsertModelOption(options, modelKey, rest)
  }
  return {
    ...options,
    [modelKey]: { ...current, thinkingEffort },
  }
}

export function withVscodeAiContextWindow(
  options: Record<string, VscodeAiModelOptionPrefs>,
  modelKey: string,
  contextWindow: VscodeAiContextWindowPref,
): Record<string, VscodeAiModelOptionPrefs> {
  const current = options[modelKey] ?? {}
  if (contextWindow === 'system') {
    const { contextWindow: _removed, ...rest } = current
    return upsertModelOption(options, modelKey, rest)
  }
  return {
    ...options,
    [modelKey]: { ...current, contextWindow },
  }
}
