import { supportsThinkingParam } from '../../ai/ai-thinking.ts'
import {
  findAiProviderPreset,
  type FlatEnabledModel,
} from '../../ai/ai-providers.ts'
import { formatCompactTokenCount } from '../browser/format-token-count.ts'
import { resolveModelContextWindow } from './vscode-ai-context-usage.ts'
import {
  formatVscodeAiModelRefKey,
  labelForVscodeAiModel,
  resolveVscodeAiThinkingEnabledForModelKey,
} from './vscode-ai-models.ts'
import type { VscodeAiModelOptionPrefs } from './vscode-prefs.ts'

const PRESET_BLURBS: Record<string, string> = {
  'deepseek-v4-flash': '快速响应，适合日常对话与轻量编码。',
  'deepseek-v4-pro': '更强推理，适合复杂任务与深度分析。',
  'mimo-v2.5-pro': '小米 MiMo 旗舰文本模型。',
  'mimo-v2.5-pro-ultraspeed': '极速变体，适合追求低延迟的场景。',
  'mimo-v2.5': '多模态文本模型，兼顾视觉与语音识别。',
  'mimo-v2-flash': '轻量快速的 MiMo 文本模型。',
  'mimo-v2-pro': 'MiMo V2 系列高性能文本模型。',
  'mimo-v2-omni': '全模态模型，支持文本、视觉与语音。',
  'gpt-5.5': 'OpenAI 旗舰多模态模型。',
  'gpt-5.4': 'OpenAI 高性能多模态模型。',
  'gpt-5.4-mini': '更轻量的 GPT-5.4，适合日常开发。',
  'gpt-5.4-nano': '最小体积的 GPT-5.4 变体。',
  'gpt-4.1': '长上下文多模态模型。',
  'gpt-4.1-mini': '轻量长上下文多模态模型。',
  'gpt-4o': 'OpenAI 多模态通用模型。',
  'gpt-4o-mini': '轻量多模态模型，适合快速迭代。',
}

export const MIMO_FAST_BASE_MODEL_ID = 'mimo-v2.5-pro'
export const MIMO_FAST_MODEL_ID = 'mimo-v2.5-pro-ultraspeed'

export type VscodeAiModelLabelParts = {
  primary: string
  /** 当前模型配置摘要（如深度思考），不是型号后缀 */
  secondary?: string
}

export function describeVscodeAiModel(model: FlatEnabledModel): string {
  const blurb = PRESET_BLURBS[model.modelId.trim().toLowerCase()]
  if (blurb) return blurb
  const providerName =
    findAiProviderPreset(model.providerId)?.name ?? model.providerId
  return `${providerName} 文本模型。`
}

export function formatVscodeAiModelContextLabel(
  model: Pick<FlatEnabledModel, 'modelId' | 'providerEntryId' | 'providerId'>,
): string {
  const window = resolveModelContextWindow(model.modelId, {
    providerEntryId: model.providerEntryId,
    providerId: model.providerId,
  })
  return `${formatCompactTokenCount(window)} 上下文窗口`
}

export type VscodeAiFastPair = {
  baseKey: string
  fastKey: string
}

export function resolveVscodeAiFastPair(
  model: FlatEnabledModel,
  models: readonly FlatEnabledModel[],
): VscodeAiFastPair | undefined {
  if (
    model.modelId !== MIMO_FAST_BASE_MODEL_ID &&
    model.modelId !== MIMO_FAST_MODEL_ID
  ) {
    return undefined
  }

  const base = models.find(
    (item) =>
      item.providerEntryId === model.providerEntryId &&
      item.modelId === MIMO_FAST_BASE_MODEL_ID,
  )
  const fast = models.find(
    (item) =>
      item.providerEntryId === model.providerEntryId &&
      item.modelId === MIMO_FAST_MODEL_ID,
  )
  if (!base || !fast) return undefined

  return {
    baseKey: formatVscodeAiModelRefKey({
      providerEntryId: base.providerEntryId,
      modelId: base.modelId,
    }),
    fastKey: formatVscodeAiModelRefKey({
      providerEntryId: fast.providerEntryId,
      modelId: fast.modelId,
    }),
  }
}

/** 主标题为完整型号名；次要文字为该模型当前配置（深度思考等） */
export function displayPartsForVscodeAiModel(
  model: FlatEnabledModel,
  options?: Record<string, VscodeAiModelOptionPrefs>,
): VscodeAiModelLabelParts {
  const primary = labelForVscodeAiModel(model)
  const modelKey = formatVscodeAiModelRefKey({
    providerEntryId: model.providerEntryId,
    modelId: model.modelId,
  })
  const bits: string[] = []

  if (
    supportsThinkingParam(model.providerId, model.modelId) &&
    resolveVscodeAiThinkingEnabledForModelKey(modelKey, options)
  ) {
    bits.push('深度思考')
  }

  return {
    primary,
    secondary: bits.length > 0 ? bits.join(' · ') : undefined,
  }
}
