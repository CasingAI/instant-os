import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { LyricsLine } from './music-lyrics.ts'

const ROW_HEIGHT = 30

type MusicLyricsViewProps = {
  lines: LyricsLine[]
  /** 当前播放时间（毫秒），驱动高亮与滚动 */
  currentTimeMs: number
  onSeek: (seconds: number) => void
}

/**
 * 整屏歌词视图：当前行居中高亮、自动平滑滚动，点击任意行跳转播放。
 */
export function MusicLyricsView({ lines, currentTimeMs, onSeek }: MusicLyricsViewProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const lastIndexRef = useRef(-1)
  const [viewportHeight, setViewportHeight] = useState(0)

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

  const currentIndex = useMemo(() => {
    let index = -1
    for (let i = 0; i < lines.length; i += 1) {
      const timeMs = lines[i].timeMs
      if (timeMs === undefined) {
        continue
      }
      if (timeMs <= currentTimeMs) {
        index = i
      } else {
        break
      }
    }
    return index
  }, [lines, currentTimeMs])

  const padY = viewportHeight > 0 ? Math.max(0, Math.floor((viewportHeight - ROW_HEIGHT) / 2)) : 60

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
      {lines.map((line, index) => (
        <div
          key={index}
          class={
            index === currentIndex
              ? 'music__lyrics-line music__lyrics-line--active'
              : 'music__lyrics-line'
          }
          onClick={() => {
            if (line.timeMs !== undefined) {
              onSeek(line.timeMs / 1000)
            }
          }}
        >
          {line.text || '\u00A0'}
        </div>
      ))}
      <div style={{ height: `${padY}px` }} aria-hidden="true" />
    </div>
  )
}
