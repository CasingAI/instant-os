export type AiProviderId = 'openai' | 'deepseek' | 'mimo' | 'mimo-token-plan' | 'custom'

/** 内置模型能力：文本 / 视觉 / 语音识别 / 语音合成 */
export const AI_MODEL_CAPABILITIES = [
  'text',
  'vision',
  'speech-recognition',
  'speech-synthesis',
] as const
export type AiModelCapability = (typeof AI_MODEL_CAPABILITIES)[number]

export const AI_MODEL_CAPABILITY_LABELS: Record<AiModelCapability, string> = {
  text: '文本',
  vision: '图像识别',
  'speech-recognition': '语音识别',
  'speech-synthesis': '语音合成',
}

const CAP_TEXT = ['text'] as const satisfies readonly AiModelCapability[]
const CAP_TEXT_VISION = ['text', 'vision'] as const satisfies readonly AiModelCapability[]
const CAP_TEXT_VISION_SPEECH_RECOGNITION = [
  'text',
  'vision',
  'speech-recognition',
] as const satisfies readonly AiModelCapability[]
const CAP_SPEECH_RECOGNITION = [
  'speech-recognition',
] as const satisfies readonly AiModelCapability[]
const CAP_SPEECH_SYNTHESIS = [
  'speech-synthesis',
] as const satisfies readonly AiModelCapability[]

export type AiModelPreset = {
  id: string
  name: string
  /** 该模型支持的能力标注 */
  capabilities: readonly AiModelCapability[]
}

export type AiProviderPreset = {
  id: AiProviderId
  name: string
  baseURL: string
  models: readonly AiModelPreset[]
  defaultModel: string
}

// --- V2 multi-provider types ---

export type AiModelEntry = {
  modelId: string
  name: string
  /**
   * 用户自定义模型的能力标注。内置预设模型可不写，运行时从预设解析。
   * 第三方自定义模型仅允许 text / vision；识别与合成暂不开放。
   */
  capabilities?: AiModelCapability[]
}

export type AiProviderEntry = {
  id: string
  providerId: AiProviderId
  name?: string
  apiKey: string
  baseURL?: string
  enabledModels: AiModelEntry[]
  defaultModel: string
  thinkingEnabled: boolean
}

/** 某能力下的首选模型指针（供应商条目 id + 模型 id） */
export type PreferredModelRef = {
  providerEntryId: string
  modelId: string
}

/** 按能力分别记录首选模型；缺省项表示该能力暂无可用首选 */
export type PreferredByCapability = {
  [K in AiModelCapability]?: PreferredModelRef
}

export type AccountSettingsV2 = {
  version: 2
  providers: AiProviderEntry[]
  /**
   * 兼容旧逻辑：指向文本能力首选所在的供应商下标。
   * 与 preferredByCapability.text 保持同步。
   */
  preferredIndex: number
  /** 文本 / 图像识别 / 语音识别 / 语音合成各自的首选模型 */
  preferredByCapability: PreferredByCapability
  /**
   * 预设模型清单同步版本。低于 CURRENT 时，加载会把缺失的内置模型一次性补进 enabledModels。
   */
  presetSyncRevision?: number
}

/** 预设模型同步版本：上调后，下次加载会为各供应商补全新增的内置模型 */
export const CURRENT_PRESET_SYNC_REVISION = 1

export const AI_PROVIDER_PRESETS: readonly AiProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', capabilities: CAP_TEXT },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', capabilities: CAP_TEXT },
    ],
    defaultModel: 'deepseek-v4-flash',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-5.5', name: 'GPT-5.5', capabilities: CAP_TEXT_VISION },
      { id: 'gpt-5.4', name: 'GPT-5.4', capabilities: CAP_TEXT_VISION },
      { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', capabilities: CAP_TEXT_VISION },
      { id: 'gpt-5.4-nano', name: 'GPT-5.4 Nano', capabilities: CAP_TEXT_VISION },
      { id: 'gpt-4.1', name: 'GPT-4.1', capabilities: CAP_TEXT_VISION },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', capabilities: CAP_TEXT_VISION },
      { id: 'gpt-4o', name: 'GPT-4o', capabilities: CAP_TEXT_VISION },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', capabilities: CAP_TEXT_VISION },
    ],
    defaultModel: 'gpt-5.4-mini',
  },
  {
    id: 'mimo',
    name: '小米 MiMo (API)',
    baseURL: 'https://api.xiaomimimo.com/v1',
    models: [
      { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro', capabilities: CAP_TEXT },
      {
        id: 'mimo-v2.5-pro-ultraspeed',
        name: 'MiMo V2.5 Pro UltraSpeed',
        capabilities: CAP_TEXT,
      },
      { id: 'mimo-v2-pro', name: 'MiMo V2 Pro', capabilities: CAP_TEXT },
      {
        id: 'mimo-v2.5',
        name: 'MiMo V2.5',
        capabilities: CAP_TEXT_VISION_SPEECH_RECOGNITION,
      },
      {
        id: 'mimo-v2-omni',
        name: 'MiMo V2 Omni',
        capabilities: CAP_TEXT_VISION_SPEECH_RECOGNITION,
      },
      { id: 'mimo-v2-flash', name: 'MiMo V2 Flash', capabilities: CAP_TEXT },
      {
        id: 'mimo-v2.5-asr',
        name: 'MiMo V2.5 ASR',
        capabilities: CAP_SPEECH_RECOGNITION,
      },
      {
        id: 'mimo-v2.5-tts',
        name: 'MiMo V2.5 TTS',
        capabilities: CAP_SPEECH_SYNTHESIS,
      },
    ],
    defaultModel: 'mimo-v2-flash',
  },
  {
    id: 'mimo-token-plan',
    name: '小米 MiMo (Token Plan)',
    baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
    models: [
      { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro', capabilities: CAP_TEXT },
      {
        id: 'mimo-v2.5',
        name: 'MiMo V2.5',
        capabilities: CAP_TEXT_VISION_SPEECH_RECOGNITION,
      },
      {
        id: 'mimo-v2.5-asr',
        name: 'MiMo V2.5 ASR',
        capabilities: CAP_SPEECH_RECOGNITION,
      },
      {
        id: 'mimo-v2.5-tts',
        name: 'MiMo V2.5 TTS',
        capabilities: CAP_SPEECH_SYNTHESIS,
      },
    ],
    defaultModel: 'mimo-v2.5-pro',
  },
  {
    id: 'custom',
    name: '自定义',
    baseURL: '',
    models: [],
    defaultModel: '',
  },
] as const

export const DEFAULT_AI_PROVIDER_ID: AiProviderId = 'deepseek'

export function findAiProviderPreset(
  providerId: AiProviderId,
): AiProviderPreset | undefined {
  return AI_PROVIDER_PRESETS.find((preset) => preset.id === providerId)
}

export function findAiModelPreset(
  providerId: AiProviderId,
  modelId: string,
): AiModelPreset | undefined {
  return findAiProviderPreset(providerId)?.models.find((model) => model.id === modelId)
}

export function isKnownModel(providerId: AiProviderId, modelId: string): boolean {
  return findAiModelPreset(providerId, modelId) !== undefined
}

/**
 * 解析模型能力。
 * 内置预设优先；否则使用条目上保存的自定义能力；未知则保守视为仅文本。
 * 第三方自定义模型会剥离识别与合成。
 */
export function resolveModelCapabilities(
  providerId: AiProviderId,
  modelId: string,
  storedCapabilities?: readonly AiModelCapability[],
): readonly AiModelCapability[] {
  const preset = findAiModelPreset(providerId, modelId)
  if (preset) {
    return preset.capabilities
  }
  return normalizeCustomModelCapabilities(storedCapabilities)
}

/** 自定义 / 第三方模型：强制文本，可选视觉，不开放识别与合成 */
export function normalizeCustomModelCapabilities(
  capabilities?: readonly AiModelCapability[],
): readonly AiModelCapability[] {
  if (capabilities?.includes('vision')) {
    return CAP_TEXT_VISION
  }
  return CAP_TEXT
}

export function buildCustomModelCapabilities(
  supportsVision: boolean,
): AiModelCapability[] {
  return supportsVision ? [...CAP_TEXT_VISION] : [...CAP_TEXT]
}

export function parseStoredModelCapabilities(
  raw: unknown,
): AiModelCapability[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined
  }
  let sawKnown = false
  let supportsVision = false
  for (const item of raw) {
    if (
      item === 'text' ||
      item === 'speech' ||
      item === 'speech-recognition' ||
      item === 'speech-synthesis'
    ) {
      sawKnown = true
    } else if (item === 'vision') {
      sawKnown = true
      supportsVision = true
    }
  }
  if (!sawKnown) {
    return undefined
  }
  return buildCustomModelCapabilities(supportsVision)
}

export function modelCapabilitiesEqual(
  a: readonly AiModelCapability[] | undefined,
  b: readonly AiModelCapability[] | undefined,
): boolean {
  const left = normalizeCustomModelCapabilities(a)
  const right = normalizeCustomModelCapabilities(b)
  if (left.length !== right.length) {
    return false
  }
  return left.every((cap, index) => cap === right[index])
}

export function modelHasCapability(
  providerId: AiProviderId,
  modelId: string,
  capability: AiModelCapability,
  storedCapabilities?: readonly AiModelCapability[],
): boolean {
  return resolveModelCapabilities(providerId, modelId, storedCapabilities).includes(
    capability,
  )
}

export function formatModelCapabilityForDisplay(capability: AiModelCapability): string {
  return AI_MODEL_CAPABILITY_LABELS[capability]
}

export function preferredModelRefsEqual(
  a: PreferredModelRef | undefined,
  b: PreferredModelRef | undefined,
): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.providerEntryId === b.providerEntryId && a.modelId === b.modelId
}

export function preferredByCapabilityEqual(
  a: PreferredByCapability,
  b: PreferredByCapability,
): boolean {
  return AI_MODEL_CAPABILITIES.every((cap) =>
    preferredModelRefsEqual(a[cap], b[cap]),
  )
}

export type FlatEnabledModel = {
  providerEntryId: string
  providerIndex: number
  providerId: AiProviderId
  modelId: string
  name: string
  capabilities: readonly AiModelCapability[]
}

/** 展平所有已启用模型，并解析能力 */
export function listEnabledModels(
  providers: readonly AiProviderEntry[],
): FlatEnabledModel[] {
  const items: FlatEnabledModel[] = []
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i]
    for (const model of provider.enabledModels) {
      items.push({
        providerEntryId: provider.id,
        providerIndex: i,
        providerId: provider.providerId,
        modelId: model.modelId,
        name: model.name,
        capabilities: resolveModelCapabilities(
          provider.providerId,
          model.modelId,
          model.capabilities,
        ),
      })
    }
  }
  return items
}

export function listEnabledModelsForCapability(
  providers: readonly AiProviderEntry[],
  capability: AiModelCapability,
): FlatEnabledModel[] {
  return listEnabledModels(providers).filter((item) =>
    item.capabilities.includes(capability),
  )
}

function isPreferredRefValid(
  providers: readonly AiProviderEntry[],
  ref: PreferredModelRef | undefined,
  capability: AiModelCapability,
): ref is PreferredModelRef {
  if (!ref) return false
  const provider = providers.find((entry) => entry.id === ref.providerEntryId)
  if (!provider) return false
  const model = provider.enabledModels.find((m) => m.modelId === ref.modelId)
  if (!model) return false
  return modelHasCapability(
    provider.providerId,
    model.modelId,
    capability,
    model.capabilities,
  )
}

function firstModelForCapability(
  providers: readonly AiProviderEntry[],
  capability: AiModelCapability,
): PreferredModelRef | undefined {
  const match = listEnabledModelsForCapability(providers, capability)[0]
  if (!match) return undefined
  return {
    providerEntryId: match.providerEntryId,
    modelId: match.modelId,
  }
}

/**
 * 根据当前已启用模型，校正 / 补全各能力首选；并同步 preferredIndex 与文本首选供应商的 defaultModel。
 */
export function reconcilePreferredByCapability(
  providers: readonly AiProviderEntry[],
  existing?: PreferredByCapability,
  preferredIndexHint?: number,
): { preferredByCapability: PreferredByCapability; preferredIndex: number } {
  const preferredByCapability: PreferredByCapability = {}

  for (const capability of AI_MODEL_CAPABILITIES) {
    const kept = isPreferredRefValid(providers, existing?.[capability], capability)
      ? existing![capability]
      : undefined
    const next = kept ?? firstModelForCapability(providers, capability)
    if (next) {
      preferredByCapability[capability] = next
    }
  }

  // 若尚无文本首选，但有 preferredIndex 提示，尽量用该供应商的 defaultModel
  if (!preferredByCapability.text && providers.length > 0) {
    const hintIndex =
      preferredIndexHint !== undefined &&
      preferredIndexHint >= 0 &&
      preferredIndexHint < providers.length
        ? preferredIndexHint
        : 0
    const hinted = providers[hintIndex]
    const hintedModel =
      hinted.enabledModels.find((m) => m.modelId === hinted.defaultModel) ??
      hinted.enabledModels[0]
    if (
      hintedModel &&
      modelHasCapability(
        hinted.providerId,
        hintedModel.modelId,
        'text',
        hintedModel.capabilities,
      )
    ) {
      preferredByCapability.text = {
        providerEntryId: hinted.id,
        modelId: hintedModel.modelId,
      }
    } else {
      const fallback = firstModelForCapability(providers, 'text')
      if (fallback) preferredByCapability.text = fallback
    }
  }

  let preferredIndex = 0
  const textRef = preferredByCapability.text
  if (textRef) {
    const index = providers.findIndex((entry) => entry.id === textRef.providerEntryId)
    if (index >= 0) preferredIndex = index
  } else if (
    preferredIndexHint !== undefined &&
    preferredIndexHint >= 0 &&
    preferredIndexHint < providers.length
  ) {
    preferredIndex = preferredIndexHint
  }

  return { preferredByCapability, preferredIndex }
}

/** 将文本首选写回对应供应商的 defaultModel，便于旧路径读取 */
export function applyTextPreferredToProviders(
  providers: AiProviderEntry[],
  preferredByCapability: PreferredByCapability,
): AiProviderEntry[] {
  const textRef = preferredByCapability.text
  if (!textRef) return providers
  return providers.map((entry) => {
    if (entry.id !== textRef.providerEntryId) return entry
    if (entry.defaultModel === textRef.modelId) return entry
    if (!entry.enabledModels.some((m) => m.modelId === textRef.modelId)) {
      return entry
    }
    return { ...entry, defaultModel: textRef.modelId }
  })
}

export function resolvePreferredModelRef(
  settings: AccountSettingsV2,
  capability: AiModelCapability = 'text',
): PreferredModelRef | undefined {
  const direct = settings.preferredByCapability?.[capability]
  if (
    isPreferredRefValid(settings.providers, direct, capability)
  ) {
    return direct
  }
  return firstModelForCapability(settings.providers, capability)
}

export function resolveModelFriendlyName(
  modelId: string,
  providerId?: AiProviderId,
): string {
  if (providerId && isCustomProvider(providerId)) {
    return modelId
  }

  if (providerId) {
    const match = findAiModelPreset(providerId, modelId)
    if (match) {
      return match.name
    }
  }

  for (const preset of AI_PROVIDER_PRESETS) {
    const match = preset.models.find((model) => model.id === modelId)
    if (match) {
      return match.name
    }
  }

  return modelId
}

export function resolveProviderBaseURL(providerId: AiProviderId): string | undefined {
  return findAiProviderPreset(providerId)?.baseURL
}

export function isCustomProvider(providerId: AiProviderId): boolean {
  return providerId === 'custom'
}

export function isMimoUltraSpeedModel(modelId: string): boolean {
  return modelId.trim() === 'mimo-v2.5-pro-ultraspeed'
}

export function normalizeStoredModel(providerId: AiProviderId, model: string): string {
  const trimmed = model.trim()
  if (providerId === 'custom') {
    return trimmed
  }
  if (providerId === 'deepseek') {
    if (trimmed === 'deepseek-chat') {
      return 'deepseek-v4-flash'
    }
    if (trimmed === 'deepseek-reasoner') {
      return 'deepseek-v4-pro'
    }
  }
  const preset = findAiProviderPreset(providerId)
  if (preset && !isKnownModel(providerId, trimmed)) {
    return preset.defaultModel
  }

  return trimmed
}

export function getDefaultThinkingEnabled(_providerId: AiProviderId): boolean {
  return false
}

export function generateProviderEntryId(): string {
  return crypto.randomUUID()
}

export function buildEnabledModelsFromPreset(
  providerId: AiProviderId,
): AiModelEntry[] {
  const preset = findAiProviderPreset(providerId)
  if (!preset) {
    return []
  }
  return preset.models.map((model) => ({
    modelId: model.id,
    name: model.name,
  }))
}

/** 把预设里尚未出现在启用列表中的模型一次性补上（不删已有项） */
export function appendMissingPresetModels(
  entry: AiProviderEntry,
): AiProviderEntry {
  if (isCustomProvider(entry.providerId)) {
    return entry
  }
  const preset = findAiProviderPreset(entry.providerId)
  if (!preset || preset.models.length === 0) {
    return entry
  }
  const existing = new Set(entry.enabledModels.map((model) => model.modelId))
  const missing = preset.models.filter((model) => !existing.has(model.id))
  if (missing.length === 0) {
    return entry
  }
  return {
    ...entry,
    enabledModels: [
      ...entry.enabledModels,
      ...missing.map((model) => ({
        modelId: model.id,
        name: model.name,
      })),
    ],
  }
}

export function defaultProviderEntry(
  providerId: AiProviderId = DEFAULT_AI_PROVIDER_ID,
): AiProviderEntry {
  if (isCustomProvider(providerId)) {
    return {
      id: generateProviderEntryId(),
      providerId,
      apiKey: '',
      enabledModels: [],
      defaultModel: '',
      thinkingEnabled: false,
    }
  }

  const preset = findAiProviderPreset(providerId)
  return {
    id: generateProviderEntryId(),
    providerId,
    apiKey: '',
    enabledModels: buildEnabledModelsFromPreset(providerId),
    defaultModel: preset?.defaultModel ?? '',
    thinkingEnabled: getDefaultThinkingEnabled(providerId),
  }
}

export function isProviderEntryValid(entry: AiProviderEntry): boolean {
  const hasCredentials = Boolean(entry.apiKey.trim() && entry.defaultModel.trim())
  const hasModels = entry.enabledModels.some(
    (model) => model.modelId.trim() === entry.defaultModel.trim(),
  )
  if (!hasCredentials || !hasModels) {
    return false
  }
  if (isCustomProvider(entry.providerId)) {
    return Boolean(entry.baseURL?.trim())
  }
  return true
}

export function resolveProviderEntryBaseURL(entry: AiProviderEntry): string | undefined {
  if (entry.baseURL?.trim()) {
    return entry.baseURL.trim()
  }
  if (isCustomProvider(entry.providerId)) {
    return undefined
  }
  return resolveProviderBaseURL(entry.providerId)
}
