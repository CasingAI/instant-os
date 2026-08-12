/**
 * 歌词对齐 2（align）的核心类型。
 * 音素段复用 stems/phoneme-types；对齐链路自有 G2P 单元与带时间戳单元。
 */

import type { AlignedPhone } from '../stems/phoneme-types.ts'

export type { AlignedPhone }

/** G2P 输出：歌词一个字/词 → 其 IPA 音素序列 */
export type G2pUnit = {
  /** 字（中文）或词（英文等）原文 */
  text: string
  /** IPA 音素序列（与 wav2vec2 vocab 对齐） */
  phones: string[]
}

/** 对齐后带时间戳的单元（秒） */
export type AlignedUnit = G2pUnit & {
  start: number
  end: number
}

/** 一行歌词对应的 G2P 单元序列（按行切分，便于生成增强 LRC） */
export type G2pLine = {
  /** 行原文（trim 后） */
  text: string
  units: G2pUnit[]
}
