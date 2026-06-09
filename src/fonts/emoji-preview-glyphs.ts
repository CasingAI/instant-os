/** Shared sample glyphs for emoji settings preview and offset measurement. */
export const EMOJI_PREVIEW_GLYPHS = ['😀', '🎉', '📧', '🌐', '⚙️'] as const

export type EmojiPreviewGlyph = (typeof EMOJI_PREVIEW_GLYPHS)[number]
