import type { LyricsLine } from './music-lyrics.ts'
import { MusicAmbientBackdrop } from './music-ambient-backdrop.tsx'
import { MusicLyricsView } from './music-lyrics-view.tsx'

type MusicLyricsAmbientProps = {
  lines: LyricsLine[]
  currentTimeMs: number
  onSeek: (seconds: number) => void
  /** 歌词偏移（毫秒）：>0 歌词延后显示，<0 提前显示 */
  offsetMs?: number
  /** 播放总时长（毫秒）；纯文本歌词（无行时间戳）按进度估算当前行时使用 */
  durationMs?: number
}

/**
 * 歌词 + 背景融合：随频段能量呼吸的光斑粒子背景上叠加滚动歌词（逐字高亮）。
 * 根节点绝对定位铺满父级（父级需 position:relative + 确定尺寸）。
 */
export function MusicLyricsAmbient({
  lines,
  currentTimeMs,
  onSeek,
  offsetMs = 0,
  durationMs,
}: MusicLyricsAmbientProps) {
  return (
    <div class="music__lyrics-ambient">
      <MusicAmbientBackdrop />
      <MusicLyricsView
        lines={lines}
        currentTimeMs={currentTimeMs}
        onSeek={onSeek}
        karaoke
        offsetMs={offsetMs}
        durationMs={durationMs}
      />
    </div>
  )
}
