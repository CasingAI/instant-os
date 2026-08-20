/** 音乐 App 可播放 / 可导入的音频后缀 */
export const MUSIC_AUDIO_EXTENSIONS = [
  'mp3',
  'wav',
  'flac',
  'm4a',
  'aac',
  'ogg',
  'opus',
  'aiff',
  'aif',
] as const

export function isAudioExtension(extension: string | undefined): boolean {
  return extension !== undefined && (MUSIC_AUDIO_EXTENSIONS as readonly string[]).includes(extension)
}

/** 歌词文件后缀（目前仅 LRC） */
export const MUSIC_LYRICS_EXTENSIONS = ['lrc'] as const

export function isLyricsExtension(extension: string | undefined): boolean {
  return (
    extension !== undefined && (MUSIC_LYRICS_EXTENSIONS as readonly string[]).includes(extension)
  )
}

/**
 * 从文件名解析标题与艺人：去扩展名，若含「 - 」按「艺人 - 标题」拆分。
 * 纯函数，便于单测。
 */
export function parseMusicFileName(
  fileName: string,
): { title: string; artist?: string; extension: string } {
  const dot = fileName.lastIndexOf('.')
  const base = dot > 0 ? fileName.slice(0, dot) : fileName
  const extension = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''

  const trimmed = base.trim()
  // 分隔符：两侧有空格的连字符（A - B），或连续双连字符（A--B）；
  // 避免把「no-extension」这类单连字符文件名误拆
  const parts = trimmed
    .split(/\s+[-–—]\s+|[-–—]{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length >= 2) {
    return { title: parts.slice(1).join(' - '), artist: parts[0], extension }
  }
  return { title: trimmed, extension }
}

export function formatTrackDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '--:--'
  }
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${rest.toString().padStart(2, '0')}`
}
