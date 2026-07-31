import {
  listSupportedReasoningEfforts,
  modelSupportsReasoningEffortPicker,
  supportsThinkingParam,
} from '../../ai/ai-thinking.ts'
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
import {
  VSCODE_AI_CONTEXT_WINDOW_PRESETS,
  type VscodeAiContextWindowPref,
  type VscodeAiModelOptionPrefs,
  type VscodeAiThinkingEffortPref,
} from './vscode-prefs.ts'

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
  'ark-code-latest': '方舟控制台路由模型，可按开通情况自动切换。',
  'doubao-seed-2.0-mini': '豆包 Seed 轻量型号，适合快速对话。',
  'doubao-seed-2.0-lite': '豆包 Seed 轻量多模态，兼顾视觉理解。',
  'doubao-seed-2.0-code': '豆包 Seed 编程主力，适合代码生成与重构。',
  'doubao-seed-2.0-pro': '豆包 Seed 旗舰文本型号。',
  'deepseek-v3.2': 'DeepSeek V3.2，性价比通用编码模型。',
  'glm-5.2': '智谱 GLM 5.2，适合复杂推理与工程任务。',
  'kimi-k2.6': 'Kimi K2.6，长上下文与前端表现力较强。',
  'kimi-k2.7-code': 'Kimi K2.7 Code，面向编程场景。',
  'kimi-k3': 'Kimi K3（Agent Plan，常需 Medium 及以上）。',
  'minimax-m2.7': 'MiniMax M2.7，工具调用与生产力场景。',
  'minimax-m3': 'MiniMax M3，更大上下文旗舰型号。',
  'doubao-seed-asr-2.0': '豆包流式语音识别 2.0（Agent Plan）。',
  'doubao-seed-tts-2.0': '豆包语音合成 2.0（Agent Plan）。',
}

export const MIMO_FAST_BASE_MODEL_ID = 'mimo-v2.5-pro'
export const MIMO_FAST_MODEL_ID = 'mimo-v2.5-pro-ultraspeed'

export type VscodeAiModelLabelParts = {
  primary: string
  /** 当前模型配置摘要片段（思考、64K 等），同行展示 */
  configBits?: string[]
}

/** 钥匙串/定价链路解析的系统上下文长度（忽略 VS Code 本地覆盖） */
export function resolveVscodeAiSystemContextWindow(
  model: Pick<FlatEnabledModel, 'modelId' | 'providerEntryId' | 'providerId'>,
): number {
  return resolveModelContextWindow(model.modelId, {
    providerEntryId: model.providerEntryId,
    providerId: model.providerId,
  })
}

/** 编辑气泡披露行 / 选项列表用的档位短文案 */
export function formatVscodeAiContextWindowPrefLabel(
  pref: VscodeAiContextWindowPref,
): string {
  if (pref === 'system') return '系统'
  return formatCompactTokenCount(pref)
}

export function listVscodeAiContextWindowPrefOptions(
  systemTokens: number,
): ReadonlyArray<{ value: VscodeAiContextWindowPref; label: string }> {
  return [
    {
      value: 'system',
      label: `使用系统值（${formatCompactTokenCount(systemTokens)}）`,
    },
    ...VSCODE_AI_CONTEXT_WINDOW_PRESETS.map((value) => ({
      value,
      label: formatCompactTokenCount(value),
    })),
  ]
}

const THINKING_EFFORT_LABELS: Record<VscodeAiThinkingEffortPref, string> = {
  default: '默认',
  none: '无',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大',
}

export function formatVscodeAiThinkingEffortPrefLabel(
  pref: VscodeAiThinkingEffortPref,
): string {
  return THINKING_EFFORT_LABELS[pref]
}

export function listVscodeAiThinkingEffortPrefOptions(
  providerId?: FlatEnabledModel['providerId'],
  modelId?: string,
): ReadonlyArray<{
  value: VscodeAiThinkingEffortPref
  label: string
}> {
  const supported = listSupportedReasoningEfforts(providerId, modelId)
  const efforts =
    supported === null
      ? (['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const)
      : supported
  return [
    { value: 'default', label: '默认' },
    ...efforts.map((value) => ({
      value: value as VscodeAiThinkingEffortPref,
      label: THINKING_EFFORT_LABELS[value as VscodeAiThinkingEffortPref],
    })),
  ]
}

/** 当前模型是否应展示「思考深度」行 */
export function shouldShowVscodeAiThinkingEffortPicker(
  providerId?: FlatEnabledModel['providerId'],
  modelId?: string,
): boolean {
  return modelSupportsReasoningEffortPicker(providerId, modelId)
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
  options?: Record<string, VscodeAiModelOptionPrefs>,
): string {
  const modelKey = formatVscodeAiModelRefKey({
    providerEntryId: model.providerEntryId,
    modelId: model.modelId,
  })
  const window = resolveModelContextWindow(model.modelId, {
    providerEntryId: model.providerEntryId,
    providerId: model.providerId,
    modelKey,
    aiModelOptions: options,
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

/** 主标题为完整型号名；configBits 为思考/上下文等激活摘要 */
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
    bits.push('思考')
    const effort = options?.[modelKey]?.thinkingEffort
    if (
      effort &&
      effort !== 'default' &&
      shouldShowVscodeAiThinkingEffortPicker(model.providerId, model.modelId)
    ) {
      bits.push(formatVscodeAiThinkingEffortPrefLabel(effort))
    }
  }

  const contextPref = options?.[modelKey]?.contextWindow
  if (typeof contextPref === 'number') {
    bits.push(formatCompactTokenCount(contextPref))
  }

  return {
    primary,
    configBits: bits.length > 0 ? bits : undefined,
  }
}
