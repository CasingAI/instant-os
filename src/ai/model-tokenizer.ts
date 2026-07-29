import {
  countTokensInWorker,
  getReadyTokenizerFamilies,
  isTokenizerFamilyReady,
  loadTokenizerFamilyInWorker,
} from './model-tokenizer-client.ts'
import {
  resolveTokenizerFamilyCandidates,
  type TokenizerFamily,
} from './model-tokenizer-resolve.ts'

export type { TokenizerFamily } from './model-tokenizer-resolve.ts'
export {
  isTokenizerFamily,
  normalizeModelId,
  resolveTokenizerFamily,
  resolveTokenizerFamilyCandidates,
  TOKENIZER_FAMILIES,
} from './model-tokenizer-resolve.ts'

function resolveReadyFamily(
  model?: string,
  tokenizerFamily?: TokenizerFamily,
): TokenizerFamily | undefined {
  if (tokenizerFamily) {
    return isTokenizerFamilyReady(tokenizerFamily) ? tokenizerFamily : undefined
  }
  for (const family of resolveTokenizerFamilyCandidates(model)) {
    if (isTokenizerFamilyReady(family)) {
      return family
    }
  }
  return undefined
}

/**
 * 按需在 Worker 中加载当前模型对应的本地词表（同源 /assets/tokenizers，不访问外网）。
 * 流式生成开始前应 await，以便随后的异步估算走精确计数。
 */
export async function prepareTokenEstimation(
  model?: string,
  tokenizerFamily?: TokenizerFamily,
): Promise<void> {
  if (tokenizerFamily) {
    await loadTokenizerFamilyInWorker(tokenizerFamily)
    return
  }
  const candidates = resolveTokenizerFamilyCandidates(model)
  for (const family of candidates) {
    const ok = await loadTokenizerFamilyInWorker(family)
    if (ok) {
      return
    }
  }
}

/** 该模型本地词表是否已在 Worker 中加载可用 */
export function isModelTokenizerReady(
  model?: string,
  tokenizerFamily?: TokenizerFamily,
): boolean {
  return resolveReadyFamily(model, tokenizerFamily) !== undefined
}

/**
 * 在 Worker 中 encode；词表未就绪或 Worker 失败时返回 undefined（交给字符粗估）。
 * 主线程永不执行 HF Tokenizer。
 */
export async function countTokensWithModelTokenizer(
  text: string,
  model?: string,
  tokenizerFamily?: TokenizerFamily,
): Promise<number | undefined> {
  if (!text) {
    return 0
  }
  const counts = await countTokensBatchWithModelTokenizer(
    [text],
    model,
    tokenizerFamily,
  )
  return counts?.[0]
}

/** 批量分词（一次 Worker round-trip） */
export async function countTokensBatchWithModelTokenizer(
  texts: string[],
  model?: string,
  tokenizerFamily?: TokenizerFamily,
): Promise<number[] | undefined> {
  if (texts.length === 0) {
    return []
  }

  let family = resolveReadyFamily(model, tokenizerFamily)
  if (!family) {
    if (tokenizerFamily) {
      const ok = await loadTokenizerFamilyInWorker(tokenizerFamily)
      if (!ok) return undefined
      family = tokenizerFamily
    } else {
      for (const candidate of resolveTokenizerFamilyCandidates(model)) {
        const ok = await loadTokenizerFamilyInWorker(candidate)
        if (ok) {
          family = candidate
          break
        }
      }
    }
  }
  if (!family) {
    return undefined
  }

  return countTokensInWorker(family, texts)
}

/** 调试：当前 Worker 已标记 ready 的词表族 */
export function getLoadedTokenizerFamilies(): TokenizerFamily[] {
  return getReadyTokenizerFamilies()
}
