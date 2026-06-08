import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'
import type { TokenUsageSnapshot } from '../browser/browser-token-usage.ts'

export type NewsTokenUsageRecord = {
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  articleGenCount: number
  commentGenCount: number
  replyGenCount: number
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.newsTokenUsage

const EMPTY_RECORD: NewsTokenUsageRecord = {
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalTokens: 0,
  articleGenCount: 0,
  commentGenCount: 0,
  replyGenCount: 0,
}

export function loadNewsTokenUsage(): NewsTokenUsageRecord {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return { ...EMPTY_RECORD }
    }
    const parsed = JSON.parse(raw) as NewsTokenUsageRecord
    return {
      totalPromptTokens: parsed.totalPromptTokens ?? 0,
      totalCompletionTokens: parsed.totalCompletionTokens ?? 0,
      totalTokens: parsed.totalTokens ?? 0,
      articleGenCount: parsed.articleGenCount ?? 0,
      commentGenCount: parsed.commentGenCount ?? 0,
      replyGenCount: parsed.replyGenCount ?? 0,
    }
  } catch {
    return { ...EMPTY_RECORD }
  }
}

export function saveNewsTokenUsage(record: NewsTokenUsageRecord): boolean {
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(record))
}

export type NewsTokenUsageKind = 'article' | 'comment' | 'reply'

export function recordNewsTokenUsage(
  kind: NewsTokenUsageKind,
  usage: TokenUsageSnapshot,
): NewsTokenUsageRecord {
  const record = loadNewsTokenUsage()
  record.totalPromptTokens += usage.promptTokens
  record.totalCompletionTokens += usage.completionTokens
  record.totalTokens += usage.totalTokens
  if (kind === 'article') {
    record.articleGenCount += 1
  } else if (kind === 'comment') {
    record.commentGenCount += 1
  } else {
    record.replyGenCount += 1
  }
  saveNewsTokenUsage(record)
  return record
}

export function clearNewsTokenUsage(): void {
  saveNewsTokenUsage({ ...EMPTY_RECORD })
}
