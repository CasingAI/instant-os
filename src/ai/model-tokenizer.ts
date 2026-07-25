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

/** 模型 ID → 候选词表目录（按优先级；共享 mimo/ 作为回退） */
export function resolveTokenizerFamilyCandidates(model: string | undefined): TokenizerFamily[] {
  const id = model?.trim().toLowerCase()
  if (!id) {
    return []
  }

  if (id.startsWith('deepseek-v4') || id === 'deepseek-chat' || id === 'deepseek-reasoner') {
    return ['deepseek-v4']
  }

  if (id.startsWith('mimo-v2.5') || id.startsWith('mimo-v2-5')) {
    return ['mimo-v2.5', 'mimo']
  }

  if (id.startsWith('mimo-v2') || id.startsWith('mimo-')) {
    return ['mimo-v2-flash', 'mimo']
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
    const tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig ?? {})
    cache.set(family, tokenizer)
    return tokenizer
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
