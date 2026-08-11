import { useEffect, useRef, useState } from 'preact/hooks'
import { getMusicCurrentTimeMs } from './music-player.ts'
import { computeActiveWordIndex, wordFill } from './music-visualizer-math.ts'
import type { LyricsLine } from './music-lyrics.ts'

export type MusicLyricsStageVariant = 'karaoke' | 'motion'

type MusicLyricsStageProps = {
  lines: LyricsLine[]
  onSeek: (seconds: number) => void
  /** 歌词偏移（毫秒）：>0 歌词延后显示，<0 提前显示；显示时间 = 播放时间 - offsetMs */
  offsetMs?: number
  /** karaoke：纯净逐字渐变；motion：额外带词弹跳与行入场动画 */
  variant?: MusicLyricsStageVariant
}

/** 当前行词元素的缓存（rAF 每帧直接改 CSS 变量，不触发重渲） */
type WordCache = {
  lineIndex: number
  els: HTMLSpanElement[]
  words: readonly { timeMs: number }[]
  endMs: number
  lastWordIndex: number
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

/** 当前行之后第一个带时间戳的行起点（作为本行填充的结束时间） */
function nextTimedLineMs(lines: readonly LyricsLine[], index: number): number | undefined {
  for (let i = index + 1; i < lines.length; i += 1) {
    const timeMs = lines[i].timeMs
    if (timeMs !== undefined) {
      return timeMs
    }
  }
  return undefined
}

/**
 * 全屏歌词舞台：当前行居中大字号，逐字渐变填充（background-clip: text），
 * 上下文行小字淡出，行切换平滑滑动。rAF 读播放器高分辨率进度，
 * 行切换走 state、词填充走 DOM CSS 变量，避免每帧重渲整列。
 */
export function MusicLyricsStage({
  lines,
  onSeek,
  offsetMs = 0,
  variant = 'karaoke',
}: MusicLyricsStageProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const lineElsRef = useRef<(HTMLDivElement | null)[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const activeIndexRef = useRef(-1)
  const wordCacheRef = useRef<WordCache | undefined>(undefined)

  // 主循环：行切换 → setState；词填充 → 直接写 CSS 变量
  useEffect(() => {
    let rafId = 0
    const tick = () => {
      rafId = requestAnimationFrame(tick)
      const timeMs = getMusicCurrentTimeMs() - offsetMs
      const lineIndex = lineIndexForTime(lines, timeMs)
      if (lineIndex !== activeIndexRef.current) {
        activeIndexRef.current = lineIndex
        setActiveIndex(lineIndex)
      }
      const cache = wordCacheRef.current
      if (!cache || cache.lineIndex !== lineIndex || cache.els.length !== cache.words.length) {
        return
      }
      const wordIndex = computeActiveWordIndex(cache.words, timeMs)
      if (wordIndex !== cache.lastWordIndex) {
        // 词序前进：此前的词标记唱完（--on，motion 变体触发弹跳）；
        // 回退（seek 回来）：之后的词清除标记与填充
        const from = Math.min(cache.lastWordIndex, wordIndex)
        const to = Math.max(cache.lastWordIndex, wordIndex)
        for (let i = Math.max(0, from); i <= to && i < cache.els.length; i += 1) {
          const el = cache.els[i]
          if (i < wordIndex) {
            el.classList.add('music__stage-word--on')
            el.style.removeProperty('--fill')
          } else {
            el.classList.remove('music__stage-word--on')
            el.style.setProperty('--fill', '0%')
          }
        }
        cache.lastWordIndex = wordIndex
      }
      if (wordIndex >= 0) {
        const el = cache.els[wordIndex]
        const fill = wordFill(cache.words, wordIndex, timeMs, cache.endMs)
        el.style.setProperty('--fill', `${(fill * 100).toFixed(1)}%`)
      }
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [lines, offsetMs])

  // 行切换后重建词缓存（等渲染完成后查询 DOM）
  useEffect(() => {
    wordCacheRef.current = undefined
    if (activeIndex < 0) {
      return
    }
    const lineEl = lineElsRef.current[activeIndex]
    const line = lines[activeIndex]
    if (!lineEl || !line) {
      return
    }
    const els = Array.from(lineEl.querySelectorAll<HTMLSpanElement>('[data-word]'))
    const words =
      line.words && line.words.length > 0 ? line.words : [{ timeMs: line.timeMs ?? 0 }]
    const endMs = nextTimedLineMs(lines, activeIndex) ?? words[words.length - 1].timeMs + 2500
    wordCacheRef.current = { lineIndex: activeIndex, els, words, endMs, lastWordIndex: -1 }
  }, [activeIndex, lines])

  // 当前行垂直居中：量出轨道内行偏移后 translateY（CSS transition 负责平滑）
  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }
    const update = () => {
      const track = trackRef.current
      if (!track) {
        return
      }
      const lineEl = activeIndex >= 0 ? lineElsRef.current[activeIndex] : undefined
      const center = lineEl ? lineEl.offsetTop + lineEl.offsetHeight / 2 : 0
      track.style.transform = `translateY(${Math.round(host.clientHeight / 2 - center)}px)`
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [activeIndex, lines])

  return (
    <div ref={hostRef} class={`music__stage music__stage--${variant}`}>
      <div ref={trackRef} class="music__stage-lines">
        {lines.map((line, index) => {
          const isActive = index === activeIndex
          const distance = activeIndex < 0 ? -1 : Math.abs(index - activeIndex)
          const classes = [
            'music__stage-line',
            isActive ? 'music__stage-line--active' : undefined,
            !isActive && activeIndex >= 0 && index < activeIndex
              ? 'music__stage-line--sung'
              : undefined,
            distance === 1 ? 'music__stage-line--near' : undefined,
            distance >= 3 ? 'music__stage-line--far' : undefined,
          ]
            .filter(Boolean)
            .join(' ')
          const words = isActive && line.words && line.words.length > 0 ? line.words : undefined
          return (
            <div
              key={index}
              ref={(el: HTMLDivElement | null) => {
                lineElsRef.current[index] = el
              }}
              class={classes}
              onClick={() => {
                if (line.timeMs !== undefined) {
                  onSeek(line.timeMs / 1000)
                }
              }}
            >
              {words ? (
                words.map((word, wordIndex) => (
                  <span key={wordIndex} data-word class="music__stage-word">
                    {word.text}
                  </span>
                ))
              ) : isActive ? (
                <span data-word class="music__stage-word music__stage-word--line">
                  {line.text || ' '}
                </span>
              ) : (
                line.text || ' '
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
