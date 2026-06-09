/** Sample glyphs for vertical offset calibration only (settings → 垂直偏移校正). */
export const EMOJI_CALIBRATION_GLYPHS = ['🎆', '🟥', '🎱', '🎲', '🌸'] as const

export type EmojiCalibrationGlyph = (typeof EMOJI_CALIBRATION_GLYPHS)[number]
