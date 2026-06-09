import { EMOJI_PREVIEW_GLYPHS } from './emoji-preview-glyphs.ts'

/** Sample lines for settings mixed-text emoji preview. */
export const EMOJI_MIXED_PREVIEW_LINES = [
  { before: '你好 ', emoji: EMOJI_PREVIEW_GLYPHS[0], after: ' 欢迎使用' },
  { before: '派对 ', emoji: EMOJI_PREVIEW_GLYPHS[1], after: ' 已开始' },
  { before: '邮件 ', emoji: EMOJI_PREVIEW_GLYPHS[2], after: ' 已送达' },
  { before: '打开 ', emoji: EMOJI_PREVIEW_GLYPHS[3], after: ' 浏览器' },
  { before: '进入 ', emoji: EMOJI_PREVIEW_GLYPHS[4], after: ' 设置' },
] as const
