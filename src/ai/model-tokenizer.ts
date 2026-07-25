import { Tokenizer } from '@huggingface/tokenizers'
import {
  AI_TOKENIZER_FAMILIES,
  type AiTokenizerFamily,
} from './ai-providers.ts'

export type TokenizerFamily = AiTokenizerFamily
export { AI_TOKENIZER_FAMILIES as TOKENIZER_FAMILIES }

const TOKENIZER_ASSET_BASE = '/assets/tokenizers'

const cache = new Map<TokenizerFamily, Tokenizer>()
const inflight = new Map<TokenizerFamily, Promise<Tokenizer | undefined>>()

export function isTokenizerFamily(value: string): value is TokenizerFamily {
  return (AI_TOKENIZER_FAMILIES as readonly string[]).includes(value)
}

/** 规范化 modelId：小写、去 provider 前缀、去 :thinking / [1m] 等后缀 */
export function normalizeModelId(model: string | undefined): string {
  let id = model?.trim().toLowerCase() ?? ''
  if (!id) {
    return ''
  }
  const slash = id.lastIndexOf('/')
  if (slash >= 0) {
    id = id.slice(slash + 1)
  }
  const colon = id.indexOf(':')
  if (colon >= 0) {
    id = id.slice(0, colon)
  }
  id = id.replace(/\[[^\]]*\]/g, '')
  return id.trim()
}

function families(...names: TokenizerFamily[]): TokenizerFamily[] {
  return names.filter((name) => isTokenizerFamily(name))
}

/** 模型 ID → 候选词表目录（按优先级） */
export function resolveTokenizerFamilyCandidates(
  model: string | undefined,
): TokenizerFamily[] {
  const id = normalizeModelId(model)
  if (!id) {
    return []
  }

  // DeepSeek V4
  if (
    id.startsWith('deepseek-v4') ||
    id === 'deepseek-chat' ||
    id === 'deepseek-reasoner'
  ) {
    return families('deepseek-v4')
  }

  // DeepSeek V3 / R1（排除 Llama distill）
  if (id.includes('distill-llama')) {
    return []
  }
  if (
    id.startsWith('deepseek-v3') ||
    id.startsWith('deepseek-chat-v3') ||
    id.startsWith('deepseek-r1')
  ) {
    return families('deepseek-v3', 'deepseek-v4')
  }

  // MiMo V2.5
  if (id.startsWith('mimo-v2.5') || id.startsWith('mimo-v2-5')) {
    return families('mimo-v2.5', 'mimo')
  }

  // MiMo V2 Flash / Pro / Omni
  if (
    id.startsWith('mimo-v2') ||
    id.startsWith('mimo-') ||
    id.startsWith('xiaomi/mimo')
  ) {
    return families('mimo-v2-flash', 'mimo')
  }

  // Kimi / Moonshot
  if (
    id.startsWith('kimi-') ||
    id === 'kimi-latest' ||
    id.startsWith('moonshot-v1-')
  ) {
    return families('kimi')
  }

  // GLM 5.x（含 5.2 旗舰、5V-Turbo）
  if (id.startsWith('glm-5')) {
    return families('glm-5', 'glm-4')
  }

  // GLM 4.x
  if (id.startsWith('glm-4') || id.startsWith('glm4') || id.startsWith('chatglm')) {
    return families('glm-4', 'glm-5')
  }

  // Qwen3 / 3.5 / 3.6 / 3.7
  if (
    id.startsWith('qwen3') ||
    id.startsWith('qwen-3')
  ) {
    return families('qwen3', 'qwen2.5')
  }

  // Qwen2.5 / qwen-plus
  if (
    id.startsWith('qwen2.5') ||
    id.startsWith('qwen-2.5') ||
    id.startsWith('qwen-plus')
  ) {
    return families('qwen2.5', 'qwen3')
  }

  // MiniMax（M3 与 M2 词表不同，先匹配更具体的）
  if (id.startsWith('minimax-m3')) {
    return families('minimax-m3', 'minimax-m2')
  }
  if (id.startsWith('minimax')) {
    return families('minimax-m2', 'minimax-m3')
  }

  return []
}

/** 覆盖优先，否则按 modelId 推断 */
export function resolveTokenizerFamily(
  model: string | undefined,
  override?: TokenizerFamily,
): TokenizerFamily | undefined {
  if (override) return override
  return resolveTokenizerFamilyCandidates(model)[0]
}

async function fetchJson(url: string): Promise<object | undefined> {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      return undefined
    }
    return (await response.json()) as object
  } catch {
    return undefined
  }
}

async function loadFamily(family: TokenizerFamily): Promise<Tokenizer | undefined> {
  const cached = cache.get(family)
  if (cached) {
    return cached
  }

  const pending = inflight.get(family)
  if (pending) {
    return pending
  }

  const promise = (async () => {
    const base = `${TOKENIZER_ASSET_BASE}/${family}`
    const [tokenizerJson, tokenizerConfig] = await Promise.all([
      fetchJson(`${base}/tokenizer.json`),
      fetchJson(`${base}/tokenizer_config.json`),
    ])
    if (!tokenizerJson) {
      return undefined
    }
    try {
      const tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig ?? {})
      cache.set(family, tokenizer)
      return tokenizer
    } catch {
      return undefined
    }
  })().finally(() => {
    inflight.delete(family)
  })

  inflight.set(family, promise)
  return promise
}

/**
 * 按需加载当前模型对应的本地词表（同源 /assets/tokenizers，不访问外网）。
 * 流式生成开始前应 await，以便随后的同步估算走精确计数。
 */
export async function prepareTokenEstimation(
  model?: string,
  tokenizerFamily?: TokenizerFamily,
): Promise<void> {
  const override = tokenizerFamily
  if (override) {
    await loadFamily(override)
    return
  }
  const candidates = resolveTokenizerFamilyCandidates(model)
  for (const family of candidates) {
    const tokenizer = await loadFamily(family)
    if (tokenizer) {
      return
    }
  }
}

function getReadyTokenizer(
  model?: string,
  tokenizerFamily?: TokenizerFamily,
): Tokenizer | undefined {
  if (tokenizerFamily) {
    return cache.get(tokenizerFamily)
  }
  for (const family of resolveTokenizerFamilyCandidates(model)) {
    const tokenizer = cache.get(family)
    if (tokenizer) {
      return tokenizer
    }
  }
  return undefined
}

/** 该模型本地词表是否已加载可用（用于区分精确计数 vs 字符粗估） */
export function isModelTokenizerReady(
  model?: string,
  tokenizerFamily?: TokenizerFamily,
): boolean {
  return getReadyTokenizer(model, tokenizerFamily) !== undefined
}

/**
 * 若该模型词表已 hydrate，返回本地 encode 得到的 token 数；否则 undefined（交给字符粗估）。
 */
export function countTokensWithModelTokenizer(
  text: string,
  model?: string,
  tokenizerFamily?: TokenizerFamily,
): number | undefined {
  if (!text) {
    return 0
  }
  const tokenizer = getReadyTokenizer(model, tokenizerFamily)
  if (!tokenizer) {
    return undefined
  }
  try {
    const encoded = tokenizer.encode(text, { add_special_tokens: false })
    return encoded.ids.length
  } catch {
    return undefined
  }
}

/** 调试：当前已加载的词表族 */
export function getLoadedTokenizerFamilies(): TokenizerFamily[] {
  return [...cache.keys()]
}
