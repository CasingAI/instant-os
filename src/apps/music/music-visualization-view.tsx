import { useState } from 'preact/hooks'
import { SegmentedControl } from '../../ui/segmented-control.tsx'
import type { LyricsLine } from './music-lyrics.ts'
import { MusicAmbientBackdrop } from './music-ambient-backdrop.tsx'
import { MusicLyricsAmbient } from './music-lyrics-ambient.tsx'
import { MusicLyricsStage } from './music-lyrics-stage.tsx'
import { MusicSpectrumCanvas, type MusicSpectrumMode } from './music-spectrum-canvas.tsx'

type VisualizerCategory = 'music' | 'lyrics'
type LyricsEffect = 'karaoke' | 'ambient' | 'motion'

type MusicVisualizationViewProps = {
  /** 已解析歌词（无歌词时为 undefined，歌词可视化显示空态） */
  lines: LyricsLine[] | undefined
  currentTimeMs: number
  onSeek: (seconds: number) => void
}

/**
 * 全屏可视化视图：SegmentedControl 切换「音乐可视化 / 歌词可视化」两大套，
 * 每套内部再切换具体效果。底部播放器由外层保留。
 */
export function MusicVisualizationView({
  lines,
  currentTimeMs,
  onSeek,
}: MusicVisualizationViewProps) {
  const [category, setCategory] = useState<VisualizerCategory>('music')
  const [musicEffect, setMusicEffect] = useState<MusicSpectrumMode>('bars')
  const [lyricsEffect, setLyricsEffect] = useState<LyricsEffect>('karaoke')

  const hasLyrics = lines !== undefined && lines.length > 0

  return (
    <>
      <div class="music__visualizer-controls">
        <SegmentedControl
          value={category}
          items={[
            { id: 'music', label: '音乐可视化' },
            { id: 'lyrics', label: '歌词可视化' },
          ]}
          onChange={setCategory}
          ariaLabel="可视化类型"
        />
        {category === 'music' ? (
          <SegmentedControl
            value={musicEffect}
            items={[
              { id: 'bars', label: '柱状' },
              { id: 'wave', label: '波形' },
              { id: 'ring', label: '环形' },
            ]}
            onChange={setMusicEffect}
            ariaLabel="音乐效果"
          />
        ) : (
          <SegmentedControl
            value={lyricsEffect}
            items={[
              { id: 'karaoke', label: '逐字' },
              { id: 'ambient', label: '融合' },
              { id: 'motion', label: '动画' },
            ]}
            onChange={setLyricsEffect}
            ariaLabel="歌词效果"
          />
        )}
      </div>

      <div class="music__visualizer-stage">
        {category === 'music' ? (
          <MusicSpectrumCanvas mode={musicEffect} />
        ) : !hasLyrics ? (
          <div class="music__empty">
            <span class="music__empty-note" aria-hidden="true">
              ♪
            </span>
            <p class="music__empty-title">没有歌词</p>
            <p class="music__empty-hint">
              在「音乐」文件夹里放一个与歌曲同名的 .lrc 文件即可显示歌词可视化。
            </p>
          </div>
        ) : lyricsEffect === 'ambient' ? (
          <MusicLyricsAmbient lines={lines} currentTimeMs={currentTimeMs} onSeek={onSeek} />
        ) : (
          <>
            {lyricsEffect === 'motion' ? <MusicAmbientBackdrop /> : null}
            <MusicLyricsStage
              lines={lines}
              onSeek={onSeek}
              variant={lyricsEffect === 'motion' ? 'motion' : 'karaoke'}
            />
          </>
        )}
      </div>
    </>
  )
}
