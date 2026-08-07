import type { LyricsLine } from './music-lyrics.ts'
import { MusicAmbientBackdrop } from './music-ambient-backdrop.tsx'
import { MusicLyricsView } from './music-lyrics-view.tsx'

type MusicLyricsAmbientProps = {
  lines: LyricsLine[]
  currentTimeMs: number
  onSeek: (seconds: number) => void
}

/**
 * 歌词 + 背景融合：随频段能量呼吸的光斑粒子背景上叠加滚动歌词（逐字高亮）。
 * 根节点绝对定位铺满父级（父级需 position:relative + 确定尺寸）。
 */
export function MusicLyricsAmbient({ lines, currentTimeMs, onSeek }: MusicLyricsAmbientProps) {
  return (
    <div class="music__lyrics-ambient">
      <MusicAmbientBackdrop />
      <MusicLyricsView lines={lines} currentTimeMs={currentTimeMs} onSeek={onSeek} karaoke />
    </div>
  )
}
