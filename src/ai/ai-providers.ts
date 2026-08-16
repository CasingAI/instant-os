import {
  getModelPricing,
  loadModelPricingCache,
  pricingCacheKey,
  type ModelPricingEntry,
} from './ai-model-pricing-cache.ts'
import { getOpenRouterPricing } from './openrouter-pricing-cache.ts'
import { INSTANT_FREE_PROVIDER_BASE_URL } from './instant-free-gateway.ts'

/** 本地词表族（与 /assets/tokenizers 目录对应） */
export const AI_TOKENIZER_FAMILIES = [
  'deepseek-v4',
  'deepseek-v3',
  'mimo',
  'mimo-v2-flash',
  'mimo-v2.5',
  'kimi',
  'glm-5',
  'glm-4',
  'qwen3',
  'qwen2.5',
  'minimax-m2',
  'minimax-m3',
] as const
export type AiTokenizerFamily = (typeof AI_TOKENIZER_FAMILIES)[number]

export const AI_TOKENIZER_FAMILY_LABELS: Record<AiTokenizerFamily, string> = {
  'deepseek-v4': 'DeepSeek V4',
  'deepseek-v3': 'DeepSeek V3 / R1',
  mimo: 'MiMo（通用）',
  'mimo-v2-flash': 'MiMo V2 Flash',
  'mimo-v2.5': 'MiMo V2.5',
  kimi: 'Kimi / Moonshot',
  'glm-5': 'GLM 5.x（含 5.2）',
  'glm-4': 'GLM 4.x',
  qwen3: 'Qwen3 / 3.5 / 3.6 / 3.7',
  'qwen2.5': 'Qwen2.5',
  'minimax-m2': 'MiniMax M2 系列',
  'minimax-m3': 'MiniMax M3',
}

export function isAiTokenizerFamily(value: string): value is AiTokenizerFamily {
  return (AI_TOKENIZER_FAMILIES as readonly string[]).includes(value)
}

/** OpenAI / 兼容端 reasoning_effort 档位全集（含 DeepSeek max） */
export const AI_REASONING_EFFORT_PRESETS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const
export type AiReasoningEffort = (typeof AI_REASONING_EFFORT_PRESETS)[number]

export function isAiReasoningEffort(value: unknown): value is AiReasoningEffort {
  return (
    typeof value === 'string' &&
    (AI_REASONING_EFFORT_PRESETS as readonly string[]).includes(value)
  )
}

/** DeepSeek V4：开启思考后仅 high / max */
export const REASONING_EFFORTS_DEEPSEEK_V4 = [
  'high',
  'max',
] as const satisfies readonly AiReasoningEffort[]

/** OpenAI GPT-5.4 系 */
export const REASONING_EFFORTS_OPENAI_GPT54 = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly AiReasoningEffort[]

/** 较完整的 OpenAI 档位（含 minimal） */
export const REASONING_EFFORTS_OPENAI_FULL = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly AiReasoningEffort[]

/** GLM 5.x */
export const REASONING_EFFORTS_GLM = [
  'high',
  'max',
] as const satisfies readonly AiReasoningEffort[]

/** 仅开/关思考、无深度档位 */
export const REASONING_EFFORTS_BINARY = [] as const satisfies readonly AiReasoningEffort[]

/** Kimi / MiniMax / Doubao 等常见三档 */
export const REASONING_EFFORTS_LOW_MED_HIGH = [
  'low',
  'medium',
  'high',
] as const satisfies readonly AiReasoningEffort[]

const CW_128K = 128_000
const CW_200K = 200_000
const CW_256K = 256_000
const CW_400K = 400_000
const CW_1M = 1_000_000
const CW_1050K = 1_050_000

export type AiProviderId =
  | 'openai'
  | 'deepseek'
  | 'mimo'
  | 'mimo-token-plan'
  | 'ark-coding-plan'
  | 'ark-agent-plan'
  | 'opencode-go'
  | 'opencode-zen'
  | 'instant-free'
  | 'custom'

/**
 * 模型供应商页的分类（按序展示为页签）：基座 / 副基座 / 图像识别 / 语音识别 / 语音合成。
 * 「副基座」是基座的副本分类：复用基座模型清单，首选与排序独立记录。
 */
export const AI_MODEL_CAPABILITIES = [
  'text',
  'text-secondary',
  'vision',
  'speech-recognition',
  'speech-synthesis',
] as const
export type AiModelCapability = (typeof AI_MODEL_CAPABILITIES)[number]

export const AI_MODEL_CAPABILITY_LABELS: Record<AiModelCapability, string> = {
  text: '基座',
  'text-secondary': '副基座',
  vision: '图像识别',
  'speech-recognition': '语音识别',
  'speech-synthesis': '语音合成',
}

/**
 * 模型自身可标注的能力（能力标签、编辑表单使用）。
 * 「副基座」只是列表分类，不会作为模型的能力标注出现。
 */
export const AI_MODEL_OWNED_CAPABILITIES = [
  'text',
  'vision',
  'speech-recognition',
  'speech-synthesis',
] as const

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
  /** 免费模型（无 key 也可访问）；用于 OpenCode Zen 等混合免费/付费端点 */
  free?: boolean
  /**
   * 内置的静态定价快照（作为无网络时的兜底）；
   * 远端定价由 ai-model-pricing-cache 按 `providerId:modelId` 单独缓存并优先取用。
   */
  pricing?: {
    inputPricePerMillion: number
    outputPricePerMillion: number
    currency: 'USD' | 'CNY'
  }
  /** 官方/厂商文档中的上下文窗口（token）；auto 模式优先用此值 */
  contextWindow?: number
  /**
   * 开启思考时支持的 reasoning_effort 档位。
   * - 省略：按「仅开/关」处理（不展示虚假全量档位）
   * - `[]`：仅开/关
   * - 非空：仅展示列出的档位
   */
  reasoningEfforts?: readonly AiReasoningEffort[]
}

export type AiProviderPreset = {
  id: AiProviderId
  name: string
  baseURL: string
  models: readonly AiModelPreset[]
  defaultModel: string
}

// --- V2 multi-provider types ---

/** 手动填写的美元单价（每百万 token） */
export type AiManualPricing = {
  inputPricePerMillion: number
  /** 缓存命中的输入单价 */
  cachedInputPricePerMillion: number
  outputPricePerMillion: number
  currency: 'USD'
}

/** 绑定到 OpenRouter 某模型 + Provider 通道的定价 */
export type AiOpenRouterPricingRef = {
  modelId: string
  providerTag: string
}

/** 上下文窗口配置模式；缺省视为 auto */
export type AiContextWindowMode = 'auto' | 'manual'

/** 未匹配定价源、或匹配源无上下文时的自动回落 */
export const DEFAULT_MODEL_CONTEXT_WINDOW = 128_000

export type AiModelEntry = {
  modelId: string
  name: string
  /**
   * 用户自定义模型的能力标注。内置预设模型可不写，运行时从预设解析。
   * 第三方自定义模型仅允许 text / vision；识别与合成暂不开放。
   */
  capabilities?: AiModelCapability[]
  /**
   * 定价别名：使用哪个 PriceToken 缓存键 `${providerId}:${modelId}` 的单价。
   * 与 manualPricing / openRouterPricing 互斥。
   */
  pricingModelKey?: string
  /** 手动单价；与 pricingModelKey / openRouterPricing 互斥。 */
  manualPricing?: AiManualPricing
  /** OpenRouter 绑定；与 pricingModelKey / manualPricing 互斥。 */
  openRouterPricing?: AiOpenRouterPricingRef
  /** 词表族覆盖；用于 VS Code 等本地 token 预估。未设时按 modelId 推断。 */
  tokenizerFamily?: AiTokenizerFamily
  /** 上下文窗口模式；缺省 auto */
  contextWindowMode?: AiContextWindowMode
  /** 手动上下文窗口（token）；仅 manual 时有意义 */
  contextWindow?: number
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
  /** 是否经代理服务器（WebView 后端 Worker）访问该供应商 */
  useProxy: boolean
}

/** 某能力下的首选模型指针（供应商条目 id + 模型 id） */
export type PreferredModelRef = {
  providerEntryId: string
  modelId: string
}

/** 按分类分别记录首选模型；缺省项表示该分类暂无可用首选 */
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
  /** 基座 / 副基座 / 图像识别 / 语音识别 / 语音合成各自的首选模型 */
  preferredByCapability: PreferredByCapability
  /**
   * 预设模型清单同步版本。低于 CURRENT 时，加载会把缺失的内置模型一次性补进 enabledModels。
   */
  presetSyncRevision?: number
}

/** 预设模型同步版本：上调后，下次加载会为各供应商补全新增的内置模型 */
export const CURRENT_PRESET_SYNC_REVISION = 2

export const AI_PROVIDER_PRESETS: readonly AiProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    models: [
      {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
        reasoningEfforts: REASONING_EFFORTS_DEEPSEEK_V4,
      },
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
        reasoningEfforts: REASONING_EFFORTS_DEEPSEEK_V4,
      },
    ],
    defaultModel: 'deepseek-v4-flash',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    models: [
      {
        id: 'gpt-5.5',
        name: 'GPT-5.5',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_1050K,
        reasoningEfforts: REASONING_EFFORTS_OPENAI_FULL,
      },
      {
        id: 'gpt-5.4',
        name: 'GPT-5.4',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_1050K,
        reasoningEfforts: REASONING_EFFORTS_OPENAI_GPT54,
      },
      {
        id: 'gpt-5.4-mini',
        name: 'GPT-5.4 Mini',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_400K,
        reasoningEfforts: REASONING_EFFORTS_OPENAI_GPT54,
      },
      {
        id: 'gpt-5.4-nano',
        name: 'GPT-5.4 Nano',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_128K,
        reasoningEfforts: REASONING_EFFORTS_OPENAI_GPT54,
      },
      {
        id: 'gpt-4.1',
        name: 'GPT-4.1',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_1M,
        reasoningEfforts: REASONING_EFFORTS_BINARY,
      },
      {
        id: 'gpt-4.1-mini',
        name: 'GPT-4.1 Mini',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_1M,
        reasoningEfforts: REASONING_EFFORTS_BINARY,
      },
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_128K,
        reasoningEfforts: REASONING_EFFORTS_BINARY,
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_128K,
        reasoningEfforts: REASONING_EFFORTS_BINARY,
      },
    ],
    defaultModel: 'gpt-5.4-mini',
  },
  {
    id: 'mimo',
    name: '小米 MiMo (API)',
    baseURL: 'https://api.xiaomimimo.com/v1',
    models: [
      {
        id: 'mimo-v2.5-pro',
        name: 'MiMo V2.5 Pro',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
        reasoningEfforts: REASONING_EFFORTS_BINARY,
      },
      {
        id: 'mimo-v2.5-pro-ultraspeed',
        name: 'MiMo V2.5 Pro UltraSpeed',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
        reasoningEfforts: REASONING_EFFORTS_BINARY,
      },
      {
        id: 'mimo-v2-pro',
        name: 'MiMo V2 Pro',
        capabilities: CAP_TEXT,
        contextWindow: CW_256K,
        reasoningEfforts: REASONING_EFFORTS_BINARY,
      },
      {
        id: 'mimo-v2.5',
        name: 'MiMo V2.5',
        capabilities: CAP_TEXT_VISION_SPEECH_RECOGNITION,
        contextWindow: CW_1M,
        reasoningEfforts: REASONING_EFFORTS_BINARY,
      },
      {
        id: 'mimo-v2-omni',
        name: 'MiMo V2 Omni',
        capabilities: CAP_TEXT_VISION_SPEECH_RECOGNITION,
        contextWindow: CW_256K,
        reasoningEfforts: REASONING_EFFORTS_BINARY,
      },
      {
        id: 'mimo-v2-flash',
        name: 'MiMo V2 Flash',
        capabilities: CAP_TEXT,
        contextWindow: CW_256K,
        reasoningEfforts: REASONING_EFFORTS_BINARY,
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
    defaultModel: 'mimo-v2-flash',
  },
  {
    id: 'mimo-token-plan',
    name: '小米 MiMo (Token Plan)',
    baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
    models: [
      {
        id: 'mimo-v2.5-pro',
        name: 'MiMo V2.5 Pro',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
        reasoningEfforts: REASONING_EFFORTS_BINARY,
      },
      {
        id: 'mimo-v2.5',
        name: 'MiMo V2.5',
        capabilities: CAP_TEXT_VISION_SPEECH_RECOGNITION,
        contextWindow: CW_1M,
        reasoningEfforts: REASONING_EFFORTS_BINARY,
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
    id: 'ark-coding-plan',
    name: '火山方舟 (Coding Plan)',
    baseURL: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    models: [
      {
        id: 'ark-code-latest',
        name: 'Ark Code Latest（路由）',
        capabilities: CAP_TEXT,
        contextWindow: CW_256K,
        reasoningEfforts: REASONING_EFFORTS_LOW_MED_HIGH,
      },
      {
        id: 'doubao-seed-2.0-mini',
        name: 'Doubao Seed 2.0 Mini',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
        reasoningEfforts: REASONING_EFFORTS_LOW_MED_HIGH,
      },
      {
        id: 'doubao-seed-2.0-lite',
        name: 'Doubao Seed 2.0 Lite',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_256K,
        reasoningEfforts: REASONING_EFFORTS_LOW_MED_HIGH,
      },
      {
        id: 'doubao-seed-2.0-code',
        name: 'Doubao Seed 2.0 Code',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_256K,
        reasoningEfforts: REASONING_EFFORTS_LOW_MED_HIGH,
      },
      {
        id: 'doubao-seed-2.0-pro',
        name: 'Doubao Seed 2.0 Pro',
        capabilities: CAP_TEXT,
        contextWindow: CW_256K,
        reasoningEfforts: REASONING_EFFORTS_LOW_MED_HIGH,
      },
      {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
        reasoningEfforts: REASONING_EFFORTS_DEEPSEEK_V4,
      },
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
        reasoningEfforts: REASONING_EFFORTS_DEEPSEEK_V4,
      },
      {
        id: 'deepseek-v3.2',
        name: 'DeepSeek V3.2',
        capabilities: CAP_TEXT,
        contextWindow: CW_128K,
        reasoningEfforts: REASONING_EFFORTS_BINARY,
      },
      {
        id: 'glm-5.2',
        name: 'GLM 5.2',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
        reasoningEfforts: REASONING_EFFORTS_GLM,
      },
      {
        id: 'kimi-k2.6',
        name: 'Kimi K2.6',
        capabilities: CAP_TEXT,
        contextWindow: CW_256K,
        reasoningEfforts: REASONING_EFFORTS_LOW_MED_HIGH,
      },
      {
        id: 'kimi-k2.7-code',
        name: 'Kimi K2.7 Code',
        capabilities: CAP_TEXT,
        contextWindow: CW_256K,
        reasoningEfforts: REASONING_EFFORTS_LOW_MED_HIGH,
      },
      {
        id: 'minimax-m2.7',
        name: 'MiniMax M2.7',
        capabilities: CAP_TEXT,
        contextWindow: CW_200K,
        reasoningEfforts: REASONING_EFFORTS_BINARY,
      },
      {
        id: 'minimax-m3',
        name: 'MiniMax M3',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
        reasoningEfforts: REASONING_EFFORTS_BINARY,
      },
    ],
    defaultModel: 'ark-code-latest',
  },
  {
    id: 'ark-agent-plan',
    name: '火山方舟 (Agent Plan)',
    baseURL: 'https://ark.cn-beijing.volces.com/api/plan/v3',
    models: [
      {
        id: 'ark-code-latest',
        name: 'Ark Code Latest（路由）',
        capabilities: CAP_TEXT,
        contextWindow: CW_256K,
        reasoningEfforts: REASONING_EFFORTS_LOW_MED_HIGH,
      },
      {
        id: 'doubao-seed-2.0-mini',
        name: 'Doubao Seed 2.0 Mini',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
        reasoningEfforts: REASONING_EFFORTS_LOW_MED_HIGH,
      },
      {
        id: 'doubao-seed-2.0-lite',
        name: 'Doubao Seed 2.0 Lite',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_256K,
        reasoningEfforts: REASONING_EFFORTS_LOW_MED_HIGH,
      },
      {
        id: 'doubao-seed-2.0-code',
        name: 'Doubao Seed 2.0 Code',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_256K,
        reasoningEfforts: REASONING_EFFORTS_LOW_MED_HIGH,
      },
      {
        id: 'doubao-seed-2.0-pro',
        name: 'Doubao Seed 2.0 Pro',
        capabilities: CAP_TEXT,
        contextWindow: CW_256K,
        reasoningEfforts: REASONING_EFFORTS_LOW_MED_HIGH,
      },
      {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
        reasoningEfforts: REASONING_EFFORTS_DEEPSEEK_V4,
      },
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
        reasoningEfforts: REASONING_EFFORTS_DEEPSEEK_V4,
      },
      {
        id: 'deepseek-v3.2',
        name: 'DeepSeek V3.2',
        capabilities: CAP_TEXT,
        contextWindow: CW_128K,
        reasoningEfforts: REASONING_EFFORTS_BINARY,
      },
      {
        id: 'glm-5.2',
        name: 'GLM 5.2',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
        reasoningEfforts: REASONING_EFFORTS_GLM,
      },
      {
        id: 'kimi-k2.6',
        name: 'Kimi K2.6',
        capabilities: CAP_TEXT,
        contextWindow: CW_256K,
        reasoningEfforts: REASONING_EFFORTS_LOW_MED_HIGH,
      },
      {
        id: 'kimi-k2.7-code',
        name: 'Kimi K2.7 Code',
        capabilities: CAP_TEXT,
        contextWindow: CW_256K,
        reasoningEfforts: REASONING_EFFORTS_LOW_MED_HIGH,
      },
      {
        id: 'kimi-k3',
        name: 'Kimi K3',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
        reasoningEfforts: REASONING_EFFORTS_LOW_MED_HIGH,
      },
      {
        id: 'minimax-m2.7',
        name: 'MiniMax M2.7',
        capabilities: CAP_TEXT,
        contextWindow: CW_200K,
        reasoningEfforts: REASONING_EFFORTS_BINARY,
      },
      {
        id: 'minimax-m3',
        name: 'MiniMax M3',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
        reasoningEfforts: REASONING_EFFORTS_BINARY,
      },
      {
        id: 'doubao-seed-asr-2.0',
        name: 'Doubao Seed ASR 2.0',
        capabilities: CAP_SPEECH_RECOGNITION,
      },
      {
        id: 'doubao-seed-tts-2.0',
        name: 'Doubao Seed TTS 2.0',
        capabilities: CAP_SPEECH_SYNTHESIS,
      },
    ],
    defaultModel: 'ark-code-latest',
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    // OpenAI 兼容 chat/completions；Anthropic / Responses 端点模型暂未接入
    baseURL: 'https://opencode.ai/zen/go/v1',
    models: [
      {
        id: 'minimax-m3',
        name: 'MiniMax M3',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
      },
      {
        id: 'minimax-m2.7',
        name: 'MiniMax M2.7',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
      },
      {
        id: 'minimax-m2.5',
        name: 'MiniMax M2.5',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
      },
      {
        id: 'kimi-k3',
        name: 'Kimi K3',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
        pricing: {
          inputPricePerMillion: 3,
          outputPricePerMillion: 15,
          currency: 'USD',
        },
      },
      {
        id: 'kimi-k2.7-code',
        name: 'Kimi K2.7 Code',
        capabilities: CAP_TEXT,
        contextWindow: CW_256K,
        pricing: {
          inputPricePerMillion: 0.95,
          outputPricePerMillion: 4,
          currency: 'USD',
        },
      },
      {
        id: 'kimi-k2.6',
        name: 'Kimi K2.6',
        capabilities: CAP_TEXT,
        contextWindow: CW_256K,
        pricing: {
          inputPricePerMillion: 0.95,
          outputPricePerMillion: 4,
          currency: 'USD',
        },
      },
      {
        id: 'kimi-k2.5',
        name: 'Kimi K2.5',
        capabilities: CAP_TEXT,
        contextWindow: CW_256K,
      },
      {
        id: 'glm-5.2',
        name: 'GLM 5.2',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
        pricing: {
          inputPricePerMillion: 1.4,
          outputPricePerMillion: 4.4,
          currency: 'USD',
        },
      },
      {
        id: 'glm-5.3',
        name: 'GLM 5.3',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
      },
      {
        id: 'glm-5.1',
        name: 'GLM 5.1',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
        pricing: {
          inputPricePerMillion: 1.4,
          outputPricePerMillion: 4.4,
          currency: 'USD',
        },
      },
      {
        id: 'glm-5',
        name: 'GLM 5',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
      },
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
        pricing: {
          inputPricePerMillion: 0.435,
          outputPricePerMillion: 0.87,
          currency: 'USD',
        },
      },
      {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
        pricing: {
          inputPricePerMillion: 0.14,
          outputPricePerMillion: 0.28,
          currency: 'USD',
        },
      },
      {
        id: 'qwen3.7-max',
        name: 'Qwen3.7 Max',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
      },
      {
        id: 'qwen3.8-max',
        name: 'Qwen3.8 Max',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
      },
      {
        id: 'qwen3.7-plus',
        name: 'Qwen3.7 Plus',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
      },
      {
        id: 'qwen3.6-plus',
        name: 'Qwen3.6 Plus',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
      },
      {
        id: 'qwen3.5-plus',
        name: 'Qwen3.5 Plus',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
      },
      {
        id: 'mimo-v2-pro',
        name: 'MiMo V2 Pro',
        capabilities: CAP_TEXT,
      },
      {
        id: 'mimo-v2-omni',
        name: 'MiMo V2 Omni',
        capabilities: CAP_TEXT,
      },
      {
        id: 'mimo-v2.5-pro',
        name: 'MiMo V2.5 Pro',
        capabilities: CAP_TEXT,
        pricing: {
          inputPricePerMillion: 0.435,
          outputPricePerMillion: 0.87,
          currency: 'USD',
        },
      },
      {
        id: 'mimo-v2.5',
        name: 'MiMo V2.5',
        capabilities: CAP_TEXT,
        pricing: {
          inputPricePerMillion: 0.14,
          outputPricePerMillion: 0.28,
          currency: 'USD',
        },
      },
      {
        id: 'hy3',
        name: 'Hy3',
        capabilities: CAP_TEXT,
        pricing: {
          inputPricePerMillion: 0.14,
          outputPricePerMillion: 0.58,
          currency: 'USD',
        },
      },
      {
        id: 'hy3-preview',
        name: 'Hy3 Preview',
        capabilities: CAP_TEXT,
      },
      {
        id: 'gpt-5.6-luna',
        name: 'GPT 5.6 Luna',
        capabilities: CAP_TEXT_VISION,
      },
      {
        id: 'grok-4.5',
        name: 'Grok 4.5',
        capabilities: CAP_TEXT_VISION,
        pricing: {
          inputPricePerMillion: 2,
          outputPricePerMillion: 6,
          currency: 'USD',
        },
      },
    ],
    defaultModel: 'mimo-v2.5',
  },
  {
    id: 'opencode-zen',
    name: 'OpenCode Zen',
    // OpenAI 兼容 chat/completions；Zen 端点同时含免费（free: true，无需 key）与付费模型
    baseURL: 'https://opencode.ai/zen/v1',
    models: [
      {
        id: 'claude-fable-5',
        name: 'Claude Fable 5',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_200K,
      },
      {
        id: 'claude-opus-5',
        name: 'Claude Opus 5',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_200K,
      },
      {
        id: 'claude-opus-4-8',
        name: 'Claude Opus 4 8',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_200K,
      },
      {
        id: 'claude-opus-4-7',
        name: 'Claude Opus 4 7',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_200K,
      },
      {
        id: 'claude-opus-4-6',
        name: 'Claude Opus 4 6',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_200K,
      },
      {
        id: 'claude-opus-4-5',
        name: 'Claude Opus 4 5',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_200K,
      },
      {
        id: 'claude-sonnet-5',
        name: 'Claude Sonnet 5',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_200K,
      },
      {
        id: 'claude-sonnet-4-6',
        name: 'Claude Sonnet 4 6',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_200K,
      },
      {
        id: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4 5',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_200K,
      },
      {
        id: 'claude-sonnet-4',
        name: 'Claude Sonnet 4',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_200K,
      },
      {
        id: 'claude-haiku-4-5',
        name: 'Claude Haiku 4 5',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_200K,
      },
      {
        id: 'gemini-3.6-flash',
        name: 'Gemini 3.6 Flash',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_1M,
      },
      {
        id: 'gemini-3.7-flash',
        name: 'Gemini 3.7 Flash',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_1M,
      },
      {
        id: 'gemini-3.5-flash-lite',
        name: 'Gemini 3.5 Flash Lite',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_1M,
      },
      {
        id: 'gemini-3.5-flash',
        name: 'Gemini 3.5 Flash',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_1M,
      },
      {
        id: 'gemini-3.1-pro',
        name: 'Gemini 3.1 Pro',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_1M,
      },
      {
        id: 'gemini-3-flash',
        name: 'Gemini 3 Flash',
        capabilities: CAP_TEXT_VISION,
        contextWindow: CW_1M,
      },
      {
        id: 'gpt-5.6-sol',
        name: 'GPT 5.6 Sol',
        capabilities: CAP_TEXT_VISION,
      },
      {
        id: 'gpt-5.6-terra',
        name: 'GPT 5.6 Terra',
        capabilities: CAP_TEXT_VISION,
      },
      {
        id: 'gpt-5.6-luna',
        name: 'GPT 5.6 Luna',
        capabilities: CAP_TEXT_VISION,
      },
      {
        id: 'gpt-5.5',
        name: 'GPT 5.5',
        capabilities: CAP_TEXT_VISION,
      },
      {
        id: 'gpt-5.5-pro',
        name: 'GPT 5.5 Pro',
        capabilities: CAP_TEXT_VISION,
      },
      {
        id: 'gpt-5.4',
        name: 'GPT 5.4',
        capabilities: CAP_TEXT_VISION,
      },
      {
        id: 'gpt-5.4-pro',
        name: 'GPT 5.4 Pro',
        capabilities: CAP_TEXT_VISION,
      },
      {
        id: 'gpt-5.4-mini',
        name: 'GPT 5.4 Mini',
        capabilities: CAP_TEXT_VISION,
      },
      {
        id: 'gpt-5.4-nano',
        name: 'GPT 5.4 Nano',
        capabilities: CAP_TEXT_VISION,
      },
      {
        id: 'gpt-5.3-codex-spark',
        name: 'GPT 5.3 Codex Spark',
        capabilities: CAP_TEXT_VISION,
      },
      {
        id: 'gpt-5.3-codex',
        name: 'GPT 5.3 Codex',
        capabilities: CAP_TEXT_VISION,
      },
      {
        id: 'gpt-5.2',
        name: 'GPT 5.2',
        capabilities: CAP_TEXT_VISION,
      },
      {
        id: 'gpt-5.2-codex',
        name: 'GPT 5.2 Codex',
        capabilities: CAP_TEXT_VISION,
      },
      {
        id: 'gpt-5.1',
        name: 'GPT 5.1',
        capabilities: CAP_TEXT_VISION,
      },
      {
        id: 'gpt-5.1-codex-max',
        name: 'GPT 5.1 Codex Max',
        capabilities: CAP_TEXT_VISION,
      },
      {
        id: 'gpt-5.1-codex',
        name: 'GPT 5.1 Codex',
        capabilities: CAP_TEXT_VISION,
      },
      {
        id: 'gpt-5.1-codex-mini',
        name: 'GPT 5.1 Codex Mini',
        capabilities: CAP_TEXT_VISION,
      },
      {
        id: 'gpt-5',
        name: 'GPT 5',
        capabilities: CAP_TEXT_VISION,
      },
      {
        id: 'gpt-5-codex',
        name: 'GPT 5 Codex',
        capabilities: CAP_TEXT_VISION,
      },
      {
        id: 'gpt-5-nano',
        name: 'GPT 5 Nano',
        capabilities: CAP_TEXT_VISION,
      },
      {
        id: 'grok-build-0.1',
        name: 'Grok Build 0.1',
        capabilities: CAP_TEXT_VISION,
      },
      {
        id: 'grok-4.6',
        name: 'Grok 4.6',
        capabilities: CAP_TEXT_VISION,
      },
      {
        id: 'grok-4.5',
        name: 'Grok 4.5',
        capabilities: CAP_TEXT_VISION,
      },
      {
        id: 'muse-spark-1.2',
        name: 'Muse Spark 1.2',
        capabilities: CAP_TEXT,
      },
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
      },
      {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
      },
      {
        id: 'glm-5.2',
        name: 'GLM 5.2',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
      },
      {
        id: 'glm-5.1',
        name: 'GLM 5.1',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
      },
      {
        id: 'glm-5',
        name: 'GLM 5',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
      },
      {
        id: 'minimax-m3',
        name: 'MiniMax M3',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
      },
      {
        id: 'minimax-m2.7',
        name: 'MiniMax M2.7',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
      },
      {
        id: 'minimax-m2.5',
        name: 'MiniMax M2.5',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
      },
      {
        id: 'kimi-k3',
        name: 'Kimi K3',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
      },
      {
        id: 'kimi-k2.7-code',
        name: 'Kimi K2.7 Code',
        capabilities: CAP_TEXT,
        contextWindow: CW_256K,
      },
      {
        id: 'kimi-k2.6',
        name: 'Kimi K2.6',
        capabilities: CAP_TEXT,
        contextWindow: CW_256K,
      },
      {
        id: 'kimi-k2.5',
        name: 'Kimi K2.5',
        capabilities: CAP_TEXT,
        contextWindow: CW_256K,
      },
      {
        id: 'qwen3.6-plus',
        name: 'Qwen3.6 Plus',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
      },
      {
        id: 'qwen3.5-plus',
        name: 'Qwen3.5 Plus',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
      },
      {
        id: 'big-pickle',
        name: 'Big Pickle',
        capabilities: CAP_TEXT,
        free: true,
      },
      {
        id: 'deepseek-v4-flash-free',
        name: 'DeepSeek V4 Flash Free',
        capabilities: CAP_TEXT,
        contextWindow: CW_1M,
        free: true,
      },
      {
        id: 'mimo-v2.5-free',
        name: 'MiMo V2.5 Free',
        capabilities: CAP_TEXT,
        free: true,
      },
      {
        id: 'hy3-free',
        name: 'Hy3 Free',
        capabilities: CAP_TEXT,
        free: true,
      },
      {
        id: 'nemotron-3-ultra-free',
        name: 'Nemotron 3 Ultra Free',
        capabilities: CAP_TEXT,
        free: true,
      },
      {
        id: 'nemotron-3.5-lightning-free',
        name: 'Nemotron 3.5 Lightning Free',
        capabilities: CAP_TEXT,
        free: true,
      },
      {
        id: 'laguna-s-2.1-free',
        name: 'Laguna S 2.1 Free',
        capabilities: CAP_TEXT,
        free: true,
      },
    ],
    defaultModel: 'big-pickle',
  },
  {
    id: 'instant-free',
    name: 'Instant 免费额度',
    // 经 PoW 网关转发到 OpenCode Go；POST 前客户端完成 Proof-of-Work，网关用自己的 key 转发。
    // auto 为网关对外暴露的多候选模型名：按 routes 顺序转发，首选失败自动降级。
    baseURL: INSTANT_FREE_PROVIDER_BASE_URL,
    models: [
      {
        id: 'auto',
        name: 'Auto 自动优选',
        capabilities: CAP_TEXT,
        contextWindow: CW_128K,
      },
    ],
    defaultModel: 'auto',
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

/**
 * 解析模型定价：优先远端缓存（背景刷新写入），否则回退到预设内置快照。
 * 都缺失时返回 undefined。
 */
export function resolveModelPricing(
  providerId: AiProviderId,
  modelId: string,
): ModelPricingEntry | undefined {
  const cached = getModelPricing(providerId, modelId)
  if (cached) {
    return cached
  }
  return findAiModelPreset(providerId, modelId)?.pricing
}

/** 解析定价缓存键 `provider:modelId` 对应的单价 */
export function resolvePricingByModelKey(
  pricingModelKey: string | undefined,
): ModelPricingEntry | undefined {
  if (!pricingModelKey) return undefined
  const separator = pricingModelKey.indexOf(':')
  if (separator <= 0) return undefined
  const providerId = pricingModelKey.slice(0, separator)
  const modelId = pricingModelKey.slice(separator + 1)
  if (!providerId || !modelId) return undefined
  const cached = getModelPricing(providerId, modelId)
  if (cached) return cached
  if (isBuiltinProviderId(providerId)) {
    return findAiModelPreset(providerId, modelId)?.pricing
  }
  return undefined
}

/** 自定义模型条目：手动价 → OpenRouter 缓存 → PriceToken 别名 → 自身 id */
export function resolveModelEntryPricing(
  providerId: AiProviderId,
  entry: Pick<
    AiModelEntry,
    'modelId' | 'pricingModelKey' | 'manualPricing' | 'openRouterPricing'
  >,
): ModelPricingEntry | undefined {
  if (entry.manualPricing) {
    return {
      inputPricePerMillion: entry.manualPricing.inputPricePerMillion,
      outputPricePerMillion: entry.manualPricing.outputPricePerMillion,
      currency: entry.manualPricing.currency,
    }
  }
  if (entry.openRouterPricing) {
    const cached = getOpenRouterPricing(
      entry.openRouterPricing.modelId,
      entry.openRouterPricing.providerTag,
    )
    if (cached) {
      return {
        inputPricePerMillion: cached.inputPricePerMillion,
        outputPricePerMillion: cached.outputPricePerMillion,
        currency: cached.currency,
      }
    }
  }
  return (
    resolvePricingByModelKey(entry.pricingModelKey) ??
    resolveModelPricing(providerId, entry.modelId)
  )
}

export function parseStoredManualPricing(value: unknown): AiManualPricing | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const input = record.inputPricePerMillion
  const output = record.outputPricePerMillion
  if (
    typeof input !== 'number' ||
    !Number.isFinite(input) ||
    input < 0 ||
    typeof output !== 'number' ||
    !Number.isFinite(output) ||
    output < 0
  ) {
    return undefined
  }
  const cached = record.cachedInputPricePerMillion
  const cachedInputPricePerMillion =
    typeof cached === 'number' && Number.isFinite(cached) && cached >= 0
      ? cached
      : 0
  return {
    inputPricePerMillion: input,
    cachedInputPricePerMillion,
    outputPricePerMillion: output,
    currency: 'USD',
  }
}

export function parseStoredOpenRouterPricing(
  value: unknown,
): AiOpenRouterPricingRef | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const modelId = typeof record.modelId === 'string' ? record.modelId.trim() : ''
  const providerTag =
    typeof record.providerTag === 'string' ? record.providerTag.trim() : ''
  if (!modelId || !providerTag) return undefined
  return { modelId, providerTag }
}

/**
 * 为 modelId 自动匹配定价键：先本供应商精确命中，再按 modelId 在缓存/预设中兜底。
 */
export function matchPricingModelKey(
  providerId: AiProviderId,
  modelId: string,
): string | undefined {
  const trimmed = modelId.trim()
  if (!trimmed) return undefined
  if (resolveModelPricing(providerId, trimmed)) {
    return pricingCacheKey(providerId, trimmed)
  }

  const cache = loadModelPricingCache()
  const suffix = `:${trimmed}`
  for (const key of Object.keys(cache.prices)) {
    if (key.endsWith(suffix)) return key
  }

  for (const preset of AI_PROVIDER_PRESETS) {
    if (preset.id === 'custom') continue
    if (preset.models.some((model) => model.id === trimmed)) {
      return pricingCacheKey(preset.id, trimmed)
    }
  }
  return undefined
}

export type PricingModelOption = {
  key: string
  providerId: string
  modelId: string
  label: string
}

function pricingProviderLabel(providerId: string): string {
  return (
    AI_PROVIDER_PRESETS.find((item) => item.id === providerId)?.name ?? providerId
  )
}

/**
 * 可选定价模型列表：只包含定价缓存里真正有单价的条目。
 * 不把「无价格的内置预设」混进来，避免把供应商名里的 (API) 误看成定价。
 */
export function listPricingModelOptions(): PricingModelOption[] {
  const options: PricingModelOption[] = []
  const cache = loadModelPricingCache()

  for (const key of Object.keys(cache.prices)) {
    const separator = key.indexOf(':')
    if (separator <= 0) continue
    const providerId = key.slice(0, separator)
    const modelId = key.slice(separator + 1)
    if (!providerId || !modelId) continue

    const knownName = isBuiltinProviderId(providerId)
      ? findAiModelPreset(providerId, modelId)?.name
      : undefined
    const modelName = knownName ?? modelId
    options.push({
      key,
      providerId,
      modelId,
      label: `${modelName} · ${pricingProviderLabel(providerId)}`,
    })
  }

  return options.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
}

/** 从账户设置中按 modelId 反查定价（同名时优先已配置 pricingModelKey 的条目） */
export function resolvePricingForLoggedModel(
  modelId: string | undefined,
  providers: readonly AiProviderEntry[],
): ModelPricingEntry | undefined {
  if (!modelId) return undefined
  let fallback: ModelPricingEntry | undefined
  for (const provider of providers) {
    for (const model of provider.enabledModels) {
      if (model.modelId !== modelId) continue
      const pricing = resolveModelEntryPricing(provider.providerId, model)
      if (!pricing) continue
      if (model.pricingModelKey) return pricing
      fallback ??= pricing
    }
  }
  if (fallback) return fallback

  for (const preset of AI_PROVIDER_PRESETS) {
    if (preset.id === 'custom') continue
    const pricing = resolveModelPricing(preset.id, modelId)
    if (pricing) return pricing
  }
  return undefined
}

export function parseStoredTokenizerFamily(
  value: unknown,
): AiTokenizerFamily | undefined {
  return typeof value === 'string' && isAiTokenizerFamily(value) ? value : undefined
}

export function parseStoredPricingModelKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.indexOf(':') <= 0) return undefined
  return trimmed
}

export function parseStoredContextWindowMode(
  value: unknown,
): AiContextWindowMode | undefined {
  return value === 'auto' || value === 'manual' ? value : undefined
}

export function parseStoredContextWindow(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const tokens = Math.floor(value)
  if (tokens < 1) return undefined
  return tokens
}

function positiveContextWindow(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const tokens = Math.floor(value)
  return tokens >= 1 ? tokens : undefined
}

/**
 * 解析模型上下文窗口：手动值 → OpenRouter/PriceToken 匹配源 → 内置预设 → 默认 128K。
 */
export function resolveModelEntryContextWindow(
  providerId: AiProviderId,
  entry: Pick<
    AiModelEntry,
    | 'modelId'
    | 'pricingModelKey'
    | 'manualPricing'
    | 'openRouterPricing'
    | 'contextWindowMode'
    | 'contextWindow'
  >,
): number {
  const mode = entry.contextWindowMode === 'manual' ? 'manual' : 'auto'
  if (mode === 'manual') {
    const manual = positiveContextWindow(entry.contextWindow)
    if (manual !== undefined) return manual
  }

  if (entry.openRouterPricing) {
    const cached = getOpenRouterPricing(
      entry.openRouterPricing.modelId,
      entry.openRouterPricing.providerTag,
    )
    const fromOpenRouter = positiveContextWindow(cached?.contextLength)
    if (fromOpenRouter !== undefined) return fromOpenRouter
  }

  if (entry.pricingModelKey) {
    const fromKey = resolvePricingByModelKey(entry.pricingModelKey)
    const fromPriceToken = positiveContextWindow(fromKey?.contextWindow)
    if (fromPriceToken !== undefined) return fromPriceToken
  }

  const fromPreset = positiveContextWindow(
    findAiModelPreset(providerId, entry.modelId)?.contextWindow,
  )
  if (fromPreset !== undefined) return fromPreset

  return DEFAULT_MODEL_CONTEXT_WINDOW
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

/**
 * 查询分类时归一到模型能力：「副基座」分类复用基座（text）模型清单。
 * 模型自身的能力标注不受影响（见 AI_MODEL_OWNED_CAPABILITIES）。
 */
function normalizeQueryCapability(capability: AiModelCapability): AiModelCapability {
  return capability === 'text-secondary' ? 'text' : capability
}

export function modelHasCapability(
  providerId: AiProviderId,
  modelId: string,
  capability: AiModelCapability,
  storedCapabilities?: readonly AiModelCapability[],
): boolean {
  return resolveModelCapabilities(providerId, modelId, storedCapabilities).includes(
    normalizeQueryCapability(capability),
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
  const required = normalizeQueryCapability(capability)
  return listEnabledModels(providers).filter((item) =>
    item.capabilities.includes(required),
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
    // 副基座在基座确定后再单独处理，缺省时与基座保持相同
    if (capability === 'text-secondary') continue
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

  // 副基座：已有有效首选则保留；否则与基座对齐
  const keptSecondary = isPreferredRefValid(
    providers,
    existing?.['text-secondary'],
    'text-secondary',
  )
    ? existing!['text-secondary']
    : undefined
  const secondary =
    keptSecondary ??
    preferredByCapability.text ??
    firstModelForCapability(providers, 'text-secondary')
  if (secondary) {
    preferredByCapability['text-secondary'] = secondary
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

/** 火山方舟 Coding / Agent Plan 订阅入口 */
export function isArkPlanProvider(providerId: AiProviderId | undefined): boolean {
  return providerId === 'ark-coding-plan' || providerId === 'ark-agent-plan'
}

/** OpenCode Go 订阅入口（托管 Zen/Go API） */
export function isOpencodeGoProvider(providerId: AiProviderId | undefined): boolean {
  return providerId === 'opencode-go'
}

/** OpenCode Zen 订阅入口（托管 Zen API，含免费模型） */
export function isOpencodeZenProvider(providerId: AiProviderId | undefined): boolean {
  return providerId === 'opencode-zen'
}

/** Instant 免费额度网关 Provider（经 PoW 代理，无需用户自带 key） */
export function isInstantFreeProvider(providerId: AiProviderId | undefined): boolean {
  return providerId === 'instant-free'
}

/** 内置供应商（非 custom）；用于定价键解析等 */
export function isBuiltinProviderId(
  providerId: string,
): providerId is Exclude<AiProviderId, 'custom'> {
  return (
    providerId === 'openai' ||
    providerId === 'deepseek' ||
    providerId === 'mimo' ||
    providerId === 'mimo-token-plan' ||
    providerId === 'ark-coding-plan' ||
    providerId === 'ark-agent-plan' ||
    providerId === 'opencode-go' ||
    providerId === 'opencode-zen' ||
    providerId === 'instant-free'
  )
}

/** 必须经代理访问的供应商（浏览器直连会因 CORS / 网络策略失败） */
export function providerRequiresProxy(providerId: AiProviderId | undefined): boolean {
  return (
    isArkPlanProvider(providerId) ||
    isOpencodeGoProvider(providerId) ||
    isOpencodeZenProvider(providerId)
  )
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
      useProxy: false,
    }
  }

  const preset = findAiProviderPreset(providerId)
  return {
    id: generateProviderEntryId(),
    providerId,
    // 免费额度网关不需要真实 key（占位值用于通过「已配置」校验）；
    // OpenCode Zen 免费模型无需 key，用户可自行填写
    apiKey: isInstantFreeProvider(providerId) ? 'instant-free' : '',
    enabledModels: buildEnabledModelsFromPreset(providerId),
    defaultModel: preset?.defaultModel ?? '',
    thinkingEnabled: getDefaultThinkingEnabled(providerId),
    useProxy: providerRequiresProxy(providerId),
  }
}

export function isProviderEntryValid(entry: AiProviderEntry): boolean {
  // 免费额度网关免 key；OpenCode Zen 免费模型无需 key（填了 key 可解锁付费模型），其余字段照常校验
  const keyOptional =
    isInstantFreeProvider(entry.providerId) || isOpencodeZenProvider(entry.providerId)
  const hasCredentials =
    keyOptional || Boolean(entry.apiKey.trim() && entry.defaultModel.trim())
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
