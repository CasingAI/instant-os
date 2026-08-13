import { useEffect, useState } from 'preact/hooks'
import type { LyricsLine } from './music-lyrics.ts'
import { MusicAmbientBackdrop } from './music-ambient-backdrop.tsx'
import { MusicLyricsAmbient } from './music-lyrics-ambient.tsx'
import { MusicLyricsOffsetBar } from './music-lyrics-offset-bar.tsx'
import { MusicLyricsStage } from './music-lyrics-stage.tsx'
import { MusicSpectrumCanvas, type MusicSpectrumMode } from './music-spectrum-canvas.tsx'
import type { StemVizFeatures } from './music-stems-features.ts'
import {
  ensureStemFeatures,
  getCachedStemFeatures,
  type StemFeaturesProgress,
} from './music-stems-session.ts'
import { probeStemsSidecar } from './music-stems-resolve.ts'
import {
  MusicStemsVizCanvas,
  type MusicStemsVizMode,
} from './music-stems-viz-canvas.tsx'
import type { Impact2VocalStyle } from './music-stems-viz-impact2.ts'

type VisualizerCategory = 'music' | 'stems' | 'lyrics'
type LyricsEffect = 'karaoke' | 'ambient' | 'motion'

type SidebarItem<T extends string> = { id: T; label: string }

type MusicVisualizationViewProps = {
  /** 已解析歌词（无歌词时为 undefined，歌词可视化显示空态） */
  lines: LyricsLine[] | undefined
  currentTimeMs: number
  onSeek: (seconds: number) => void
  /** 歌词偏移（毫秒）：>0 歌词延后显示，<0 提前显示 */
  offsetMs?: number
  /** 歌词偏移变化（由「歌词可视化」内的调节条触发） */
  onLyricOffsetChange?: (ms: number) => void
  /** 当前曲目 id（分轨特征缓存键） */
  trackId?: string
  /** 当前曲目 VFS 节点 id，用于解析同名 `.stems.zip` */
  vfsRef?: string
}

function VisualizerSidebarList<T extends string>({
  ariaLabel,
  heading,
  items,
  value,
  onChange,
  nested = false,
}: {
  ariaLabel: string
  heading: string
  items: readonly SidebarItem<T>[]
  value: T
  onChange: (id: T) => void
  nested?: boolean
}) {
  return (
    <nav
      class={`music__visualizer-sidebar-group${nested ? ' music__visualizer-sidebar-group--nested' : ''}`}
      aria-label={ariaLabel}
    >
      <div class="music__visualizer-sidebar-heading">{heading}</div>
      <ul class="music__visualizer-sidebar-list" role="listbox" aria-label={ariaLabel}>
        {items.map((item) => {
          const active = item.id === value
          return (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={active}
                class={`music__visualizer-sidebar-item${active ? ' music__visualizer-sidebar-item--active' : ''}`}
                onClick={() => onChange(item.id)}
              >
                {item.label}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/**
 * 全屏可视化视图：左侧栏切换「音乐 / 分轨 / 歌词」及对应效果；
 * 分轨分类仅在探测到侧车时出现。
 */
export function MusicVisualizationView({
  lines,
  currentTimeMs,
  onSeek,
  offsetMs = 0,
  onLyricOffsetChange,
  trackId,
  vfsRef,
}: MusicVisualizationViewProps) {
  const [category, setCategory] = useState<VisualizerCategory>('music')
  const [musicEffect, setMusicEffect] = useState<MusicSpectrumMode>('bars')
  const [stemsEffect, setStemsEffect] = useState<MusicStemsVizMode>('impact')
  const [vocalStyle, setVocalStyle] = useState<Impact2VocalStyle>('beam')
  const [lyricsEffect, setLyricsEffect] = useState<LyricsEffect>('karaoke')
  const [hasStems, setHasStems] = useState(false)
  const [stemsProgress, setStemsProgress] = useState<StemFeaturesProgress>({ phase: 'idle' })
  const [stemsFeatures, setStemsFeatures] = useState<StemVizFeatures | undefined>()

  const hasLyrics = lines !== undefined && lines.length > 0

  // 切歌 / 打开时探测侧车
  useEffect(() => {
    let cancelled = false
    setHasStems(false)
    setStemsFeatures(undefined)
    setStemsProgress({ phase: 'idle' })
    setCategory((prev) => (prev === 'stems' ? 'music' : prev))
    if (!vfsRef || !trackId) {
      return () => {
        cancelled = true
      }
    }
    const cached = getCachedStemFeatures(trackId)
    if (cached) {
      setHasStems(true)
      setStemsFeatures(cached)
      setStemsProgress({ phase: 'ready' })
      return () => {
        cancelled = true
      }
    }
    void probeStemsSidecar(vfsRef).then((found) => {
      if (!cancelled) setHasStems(found)
    })
    return () => {
      cancelled = true
    }
  }, [trackId, vfsRef])

  // 侧车消失时离开分轨分类
  useEffect(() => {
    if (!hasStems && category === 'stems') {
      setCategory('music')
    }
  }, [hasStems, category])

  // 进入分轨分类时懒加载特征
  useEffect(() => {
    if (category !== 'stems' || !trackId || !vfsRef || !hasStems) return
    let cancelled = false
    const cached = getCachedStemFeatures(trackId)
    if (cached) {
      setStemsFeatures(cached)
      setStemsProgress({ phase: 'ready' })
      return
    }
    void ensureStemFeatures({
      trackId,
      vfsRef,
      onProgress: (progress) => {
        if (!cancelled) setStemsProgress(progress)
      },
    }).then((features) => {
      if (!cancelled) setStemsFeatures(features)
    })
    return () => {
      cancelled = true
    }
  }, [category, trackId, vfsRef, hasStems])

  const categoryItems: SidebarItem<VisualizerCategory>[] = [
    { id: 'music', label: '音乐' },
    ...(hasStems ? [{ id: 'stems' as const, label: '分轨' }] : []),
    { id: 'lyrics', label: '歌词' },
  ]

  const musicEffectItems: SidebarItem<MusicSpectrumMode>[] = [
    { id: 'bars', label: '柱状' },
    { id: 'wave', label: '波形' },
    { id: 'ring', label: '环形' },
  ]

  const stemsEffectItems: SidebarItem<MusicStemsVizMode>[] = [
    { id: 'impact', label: '冲击' },
    { id: 'impact2', label: '冲击2' },
    { id: 'tunnel', label: '隧道' },
    { id: 'kaleido', label: '万花筒' },
    { id: 'fluid', label: '流体' },
    { id: 'plasma', label: '伪3D' },
    { id: 'hyperspace', label: '穿梭' },
    { id: 'aurora', label: '极光' },
    { id: 'glass', label: '玻璃' },
    { id: 'orbit', label: '真3D' },
  ]

  const vocalStyleItems: SidebarItem<Impact2VocalStyle>[] = [
    { id: 'beam', label: '声柱' },
    { id: 'ribbon', label: '平滑飘带' },
    { id: 'ripple', label: '环形涟漪' },
    { id: 'fountain', label: '粒子喷泉' },
  ]

  const lyricsEffectItems: SidebarItem<LyricsEffect>[] = [
    { id: 'karaoke', label: '逐字' },
    { id: 'ambient', label: '融合' },
    { id: 'motion', label: '动画' },
  ]

  const stemsStatusText = (() => {
    switch (stemsProgress.phase) {
      case 'probing':
        return '正在查找分轨…'
      case 'loading':
        return `正在解压分轨 ${stemsProgress.loaded}/${stemsProgress.total}…`
      case 'extracting':
        return '正在提取分轨特征…'
      case 'error':
        return stemsProgress.message || '分轨文件损坏或无法读取'
      case 'missing':
        return '未找到分轨文件'
      default:
        return undefined
    }
  })()

  return (
    <div class="music__visualizer">
      <aside class="music__visualizer-sidebar">
        <VisualizerSidebarList
          ariaLabel="可视化类型"
          heading="类型"
          items={categoryItems}
          value={category}
          onChange={setCategory}
        />
        {category === 'music' ? (
          <VisualizerSidebarList
            ariaLabel="音乐效果"
            heading="效果"
            items={musicEffectItems}
            value={musicEffect}
            onChange={setMusicEffect}
          />
        ) : category === 'stems' ? (
          <>
            <VisualizerSidebarList
              ariaLabel="分轨效果"
              heading="效果"
              items={stemsEffectItems}
              value={stemsEffect}
              onChange={setStemsEffect}
            />
            {stemsEffect === 'impact2' ? (
              <VisualizerSidebarList
                ariaLabel="人声风格"
                heading="人声"
                items={vocalStyleItems}
                value={vocalStyle}
                onChange={setVocalStyle}
                nested
              />
            ) : null}
          </>
        ) : (
          <>
            <VisualizerSidebarList
              ariaLabel="歌词效果"
              heading="效果"
              items={lyricsEffectItems}
              value={lyricsEffect}
              onChange={setLyricsEffect}
            />
            {hasLyrics && onLyricOffsetChange ? (
              <div class="music__visualizer-sidebar-offset">
                <MusicLyricsOffsetBar offsetMs={offsetMs} onChange={onLyricOffsetChange} />
              </div>
            ) : null}
          </>
        )}
      </aside>

      <div class="music__visualizer-stage">
        {category === 'music' ? (
          <MusicSpectrumCanvas mode={musicEffect} />
        ) : category === 'stems' ? (
          stemsFeatures ? (
            <MusicStemsVizCanvas mode={stemsEffect} features={stemsFeatures} vocalStyle={vocalStyle} />
          ) : (
            <div class="music__empty music__stems-status">
              <span class="music__empty-note" aria-hidden="true">
                ♪
              </span>
              <p class="music__empty-title">
                {stemsProgress.phase === 'error' || stemsProgress.phase === 'missing'
                  ? '无法加载分轨'
                  : '加载分轨中'}
              </p>
              <p class="music__empty-hint">{stemsStatusText ?? '请稍候…'}</p>
            </div>
          )
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
          <MusicLyricsAmbient
            lines={lines}
            currentTimeMs={currentTimeMs}
            onSeek={onSeek}
            offsetMs={offsetMs}
          />
        ) : (
          <>
            {lyricsEffect === 'motion' ? <MusicAmbientBackdrop /> : null}
            <MusicLyricsStage
              lines={lines}
              onSeek={onSeek}
              offsetMs={offsetMs}
              variant={lyricsEffect === 'motion' ? 'motion' : 'karaoke'}
            />
          </>
        )}
      </div>
    </div>
  )
}
