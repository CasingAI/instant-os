/**
 * SenseVoice 词表解码（SentencePiece BPE）。
 *
 * SenseVoice 用 SentencePiece 词表（tokens.txt），与 zipformer 的字节 BPE 完全不同：
 *   - `▁` 前缀 = 词边界（英文/韩文等空格语言）；拉丁子词（`s`/`ing`/`ed`）是词的续写
 *   - 中文汉字/日文假名逐字成 token（无 `▁`），各自独立成段
 *   - 词表还含特殊标记 `<unk>/<s>/</s>` 与 `<|zh|>`、`<|HAPPY|>`、`<|Speech|>` 等
 *     语言/情感/事件标签，一律跳过
 *
 * 时间戳：模型每块输出前 4 帧是 lang/emotion/event 标记，语音帧从第 4 帧起算；
 *   time = baseSec + (ctcFrame - 4) * frameShiftSec，其中 frameShiftSec = 0.01 * lfr_window_shift。
 *
 * 纯函数，可 node --experimental-strip-types 单测。
 */

/** CTC 解码出的一个 token（token id + 输出帧号） */
export type SenseVoiceCtcToken = {
  token: number
  frame: number
}

/** 一个带时间的词段（symbol 为拼好的可读文本） */
export type SenseVoiceSegment = {
  symbol: string
  start: number
  end: number
}

/** 是否 SenseVoice 特殊标记（blank/句界/语言·情感·事件标签等），不进入识别文本 */
export function isSenseVoiceSpecial(text: string): boolean {
  if (text === '<unk>' || text === '<s>' || text === '</s>') return true
  return /^<\|.*\|>$/.test(text)
}

/** CTC 帧 → 秒：跳过前 4 帧特殊标记（与 sherpa-onnx ConvertSenseVoiceResult 一致） */
export function senseVoiceFrameTime(
  frame: number,
  frameShiftSec: number,
  baseSec = 0,
): number {
  return baseSec + (frame - 4) * frameShiftSec
}

/** 是否为拉丁子词/数字/撇号等「可拼词」字符（英文续写判定） */
function isLatinPiece(piece: string): boolean {
  return /^[A-Za-z0-9'\u00C0-\u024F.\-]+$/.test(piece)
}

/** 拉丁续写允许的最大空隙（秒）：超过则视为新词，避免把中间空白的唱段拼成超长垃圾 token。 */
export const LATIN_MERGE_GAP_SEC = 0.15
/** 单个拉丁段最长时长（秒）：连续无 ▁ 的子词也截断，避免 2 秒以上的巨型英文 token。 */
export const LATIN_MAX_SEG_SEC = 0.8

/**
 * 把带时间的 token 单元拼成词段：
 *  - `▁` 前缀 → 新段（剥离 ▁）
 *  - 拉丁子词续写活跃的拉丁段（如 `▁thi`+`s` → `this`）
 *  - 其余（中文逐字、日文假名、韩文单字、标点）各自成段
 * 跳过全部特殊标记。
 */
export function groupSenseVoiceUnits(
  units: { text: string; start: number; end: number }[],
): SenseVoiceSegment[] {
  type Cur = { pieces: string[]; latin: boolean; start: number; end: number }
  const out: SenseVoiceSegment[] = []
  let cur: Cur | null = null

  const close = (c: Cur): void => {
    const symbol = c.pieces.join('')
    if (symbol.trim()) out.push({ symbol, start: c.start, end: c.end })
  }

  for (const u of units) {
    const t = u.text
    if (!t || isSenseVoiceSpecial(t)) continue
    const wordStart = t.startsWith('▁')
    const piece = t.replace(/^▁+/, '')
    if (!piece) continue
    const latin = isLatinPiece(piece)

    const canMergeLatin =
      cur !== null &&
      cur.latin &&
      latin &&
      !wordStart &&
      u.start - cur.end <= LATIN_MERGE_GAP_SEC &&
      u.end - cur.start <= LATIN_MAX_SEG_SEC
    if (wordStart || !cur || !canMergeLatin) {
      if (cur) close(cur)
      cur = { pieces: [piece], latin, start: u.start, end: u.end }
    } else {
      cur.pieces.push(piece)
      cur.end = u.end
    }
  }
  if (cur) close(cur)
  return out
}

/**
 * 完整解码：CTC token 序列 → 词段。
 * 每 token 时间 = senseVoiceFrameTime(frame, frameShiftSec, baseSec)。
 */
export function decodeSenseVoiceBpe(
  ctcTokens: SenseVoiceCtcToken[],
  vocab: string[],
  frameShiftSec: number,
  baseSec = 0,
): SenseVoiceSegment[] {
  const units = ctcTokens
    .map(({ token, frame }) => {
      const text = vocab[token]
      if (!text) return null
      const start = senseVoiceFrameTime(frame, frameShiftSec, baseSec)
      return { text, start, end: start + frameShiftSec }
    })
    .filter((u): u is { text: string; start: number; end: number } => u !== null)
  return groupSenseVoiceUnits(units)
}
