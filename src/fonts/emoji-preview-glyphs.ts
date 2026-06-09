/**
 * Sample glyphs for emoji settings preview (应用图标 + 文字混排).
 */
export const EMOJI_PREVIEW_GLYPHS = ['🎆', '🎉', '🎱', '🎁', '🎲'] as const

export type EmojiPreviewGlyph = (typeof EMOJI_PREVIEW_GLYPHS)[number]
