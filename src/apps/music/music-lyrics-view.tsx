import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { getMusicCurrentTimeMs } from './music-player.ts'
import { computeActiveWordIndex } from './music-visualizer-math.ts'
import type { LyricsLine } from './music-lyrics.ts'

const ROW_HEIGHT = 30
/** 上下留白钳制上限：宿主尺寸异常（如父级无确定高度）时防止无限增长 */
const MAX_PAD_Y = 4096

type MusicLyricsViewProps = {
  lines: LyricsLine[]
  /** 当前播放时间（毫秒），驱动高亮与滚动 */
  currentTimeMs: number
  onSeek: (seconds: number) => void
  /** 歌词偏移（毫秒）：>0 歌词延后显示，<0 提前显示；显示时间 = 播放时间 - offsetMs */
  offsetMs?: number
  /** 逐字卡拉OK高亮：当前行按 words 时间戳逐字变色；无 words 的行退化为整行高亮 */
  karaoke?: boolean
}

type KaraokeState = {
  lineIndex: number
  wordIndex: number
}

function lineIndexForTime(lines: readonly LyricsLine[], timeMs: number): number {
  let index = -1
  for (let i = 0; i < lines.length; i += 1) {
    const lineTime = lines[i].timeMs
    if (lineTime === undefined) {
      continue
    }
    if (lineTime <= timeMs) {
      index = i
    } else {
      break
    }
  }
  return index
}

/**
 * 滚动歌词列表：当前行居中高亮、自动平滑滚动，点击任意行跳转播放。
 * karaoke 开启时用 rAF + 播放器高分辨率进度驱动逐字变色（只在行/词变化时重绘）。
 * 尺寸契约：宿主需有确定高度（flex:1 + min-height:0 或 absolute inset:0），
 * 否则内部留白会随内容高度正反馈增长。
 */
export function MusicLyricsView({
  lines,
  currentTimeMs,
  onSeek,
  offsetMs = 0,
  karaoke = false,
}: MusicLyricsViewProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const lastIndexRef = useRef(-1)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [karaokeState, setKaraokeState] = useState<KaraokeState | undefined>(undefined)

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) {
      return
    }
    const update = () => setViewportHeight(el.clientHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const propCurrentIndex = useMemo(
    () => lineIndexForTime(lines, currentTimeMs - offsetMs),
    [lines, currentTimeMs, offsetMs],
  )
  const currentIndex = karaoke ? (karaokeState?.lineIndex ?? propCurrentIndex) : propCurrentIndex
  const activeWordIndex = karaoke ? (karaokeState?.wordIndex ?? -1) : -1

  // 卡拉OK：rAF 高分辨率驱动，仅在行/词变化时更新 state（避免每帧重渲整列）
  useEffect(() => {
    if (!karaoke) {
      setKaraokeState(undefined)
      return
    }
    let rafId = 0
    let lastLine = -1
    let lastWord = -1
    const tick = () => {
      rafId = requestAnimationFrame(tick)
      const timeMs = getMusicCurrentTimeMs() - offsetMs
      const lineIndex = lineIndexForTime(lines, timeMs)
      const words = lineIndex >= 0 ? lines[lineIndex]?.words : undefined
      const wordIndex = words && words.length > 0 ? computeActiveWordIndex(words, timeMs) : -1
      if (lineIndex !== lastLine || wordIndex !== lastWord) {
        lastLine = lineIndex
        lastWord = wordIndex
        setKaraokeState({ lineIndex, wordIndex })
      }
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [karaoke, lines, offsetMs])

  const padY =
    viewportHeight > 0
      ? Math.min(MAX_PAD_Y, Math.max(0, Math.floor((viewportHeight - ROW_HEIGHT) / 2)))
      : 60

  useEffect(() => {
    const el = scrollerRef.current
    if (!el || currentIndex < 0 || currentIndex === lastIndexRef.current) {
      return
    }
    lastIndexRef.current = currentIndex
    el.scrollTo({ top: Math.max(0, currentIndex * ROW_HEIGHT), behavior: 'smooth' })
  }, [currentIndex])

  return (
    <div ref={scrollerRef} class="music__lyrics-scroller">
      <div style={{ height: `${padY}px` }} aria-hidden="true" />
      {lines.map((line, index) => {
        const isActive = index === currentIndex
        const words = karaoke && isActive && line.words && line.words.length > 0 ? line.words : undefined
        const classes = [
          'music__lyrics-line',
          isActive ? 'music__lyrics-line--active' : undefined,
          words ? 'music__lyrics-line--karaoke' : undefined,
        ]
          .filter(Boolean)
          .join(' ')
        return (
          <div
            key={index}
            class={classes}
            onClick={() => {
              if (line.timeMs !== undefined) {
                onSeek(line.timeMs / 1000)
              }
            }}
          >
            {words ? (
              words.map((word, wordIndex) => (
                <span
                  key={wordIndex}
                  class={
                    wordIndex <= activeWordIndex
                      ? 'music__lyrics-word music__lyrics-word--on'
                      : 'music__lyrics-word'
                  }
                >
                  {word.text}
                </span>
              ))
            ) : (
              (line.text || ' ')
            )}
          </div>
        )
      })}
      <div style={{ height: `${padY}px` }} aria-hidden="true" />
    </div>
  )
}
