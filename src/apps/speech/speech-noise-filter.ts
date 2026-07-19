/**
 * 语音对话误触发过滤：敲击/噪声易被 ASR 幻觉成「嗯啊」「好啊」。
 * 在送 LLM 之前用时长 + 瞬态能量 + 语气词文本综合判定。
 */

import type { VadUtterance } from './speech-vad-session.ts'

/** 去标点空白后的纯语气词 / 无实义短应答 */
const FILLER_TEXT_RE =
  /^(嗯+|啊+|呃+|哦+|噢+|唔+|嘿+|哈+|唉+|欸+|诶+|呀+|呢+|吧+|哇+|咦+|嗯啊+|啊哈+|呵呵+|哈哈+|嗯哼+|哦哦+|啊啊+|嗯嗯+|好啊*|好好*|对对*|是是*|好的?|行|嗯哼|ok|okay|mhm|uh|um|ah|oh)$/i

export type NoiseFilterReason =
  | 'transient-knock'
  | 'short-filler'
  | 'thin-speech'

export type NoiseFilterResult =
  | { drop: false }
  | { drop: true; reason: NoiseFilterReason; detail: string }

function normalizeUtteranceText(text: string): string {
  return text
    .trim()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。！？、,.!?;；：:…·\-—_"'“”‘’（）()【】[\]]/g, '')
    .toLowerCase()
}

function isFillerText(text: string): boolean {
  const normalized = normalizeUtteranceText(text)
  if (!normalized) return true
  return FILLER_TEXT_RE.test(normalized)
}

/**
 * 是否应丢弃本句、不送 LLM。
 * - 敲桌类：短时长 + 高尖峰比 + 有效有声很短
 * - 语气词：短句 + 文本像嗯啊/好啊
 */
export function shouldDropNoiseUtterance(
  wav: VadUtterance,
  text: string,
): NoiseFilterResult {
  const durationMs = wav.durationMs
  const crest = wav.crestFactor ?? 0
  const activeMs = wav.activeSpeechMs ?? durationMs
  const peak = wav.peakRms ?? 0
  const mean = wav.meanRms ?? 0
  const filler = isFillerText(text)
  const normalized = normalizeUtteranceText(text)

  // 敲击 / 瞬态冲击：能量尖、有效有声极短
  const looksTransient =
    durationMs <= 1200 &&
    crest >= 4.2 &&
    activeMs <= 320 &&
    peak >= 0.04 &&
    mean > 0 &&
    peak / Math.max(mean, 1e-6) >= 4

  if (looksTransient) {
    return {
      drop: true,
      reason: 'transient-knock',
      detail: `duration=${durationMs}ms active=${Math.round(activeMs)}ms crest=${crest.toFixed(1)} peak=${peak.toFixed(3)}`,
    }
  }

  // 短时长 + 语气词 / 1～2 字无实义
  if (durationMs <= 950 && filler) {
    return {
      drop: true,
      reason: 'short-filler',
      detail: `duration=${durationMs}ms text=${JSON.stringify(text)}`,
    }
  }

  // 墙钟时长尚可，但真正超阈值的有声占比极低（冲击后拖静音）
  if (
    durationMs <= 1400 &&
    activeMs <= 280 &&
    crest >= 3.5 &&
    (filler || normalized.length <= 2)
  ) {
    return {
      drop: true,
      reason: 'thin-speech',
      detail: `duration=${durationMs}ms active=${Math.round(activeMs)}ms crest=${crest.toFixed(1)} text=${JSON.stringify(text)}`,
    }
  }

  return { drop: false }
}
