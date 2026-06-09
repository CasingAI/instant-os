import { EMOJI_PREVIEW_GLYPHS } from './emoji-preview-glyphs.ts'

/** Sample lines for settings mixed-text emoji preview. */
export const EMOJI_MIXED_PREVIEW_LINES = [
  { before: '跨年 ', emoji: EMOJI_PREVIEW_GLYPHS[0], after: ' 烟花表演' },
  { before: '派对 ', emoji: EMOJI_PREVIEW_GLYPHS[1], after: ' 已开始' },
  { before: '来一局 ', emoji: EMOJI_PREVIEW_GLYPHS[2], after: ' 台球' },
  { before: '拆开 ', emoji: EMOJI_PREVIEW_GLYPHS[3], after: ' 礼物盒' },
  { before: '掷出 ', emoji: EMOJI_PREVIEW_GLYPHS[4], after: ' 幸运点' },
] as const
