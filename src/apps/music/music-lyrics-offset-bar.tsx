import { useEffect, useRef, useState } from 'preact/hooks'
import {
  clampLyricOffsetMs,
  formatLyricOffset,
  LYRIC_OFFSET_STEP_MS,
} from './music-lyric-offsets.ts'

type MusicLyricsOffsetBarProps = {
  offsetMs: number
  onChange: (ms: number) => void
}

/**
 * 歌词同步调节条：−0.1 / 当前值 / +0.1 / 归零。
 * 「−」= 歌词向前偏移（提前显示），「+」= 向后偏移（延后显示）。
 * 按住步进按钮连续调节；offsetMs 归零时隐藏归零按钮。
 */
export function MusicLyricsOffsetBar({ offsetMs, onChange }: MusicLyricsOffsetBarProps) {
  const [held, setHeld] = useState<1 | -1 | undefined>(undefined)
  const heldRef = useRef<1 | -1 | undefined>(undefined)
  const offsetRef = useRef(offsetMs)

  useEffect(() => {
    offsetRef.current = offsetMs
  }, [offsetMs])

  const applyStep = (direction: 1 | -1) => {
    onChange(clampLyricOffsetMs(offsetRef.current + direction * LYRIC_OFFSET_STEP_MS))
  }

  // 按住连续调节：起步进后定时重复（offsetRef 保证连按时取到最新偏移）
  useEffect(() => {
    if (held === undefined) {
      return
    }
    applyStep(held)
    const timer = window.setInterval(() => applyStep(held), 80)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held])

  useEffect(() => {
    heldRef.current = held
  }, [held])

  // 指针离开窗口或取消时停止连续调节
  useEffect(() => {
    if (held === undefined) {
      return
    }
    const stop = () => {
      if (heldRef.current !== undefined) {
        heldRef.current = undefined
        setHeld(undefined)
      }
    }
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [held])

  return (
    <div class="music__lyrics-offset">
      <span class="music__lyrics-offset-label">歌词同步</span>
      <div class="music__lyrics-offset-controls">
        <button
          type="button"
          class="music__lyrics-offset-btn"
          aria-label="歌词向前偏移 0.1 秒"
          title="向前偏移 0.1 秒"
          onPointerDown={() => setHeld(-1)}
          onPointerUp={() => setHeld(undefined)}
          onPointerLeave={() => setHeld(undefined)}
          onPointerCancel={() => setHeld(undefined)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              applyStep(-1)
            }
          }}
        >
          −0.1
        </button>
        <span
          class="music__lyrics-offset-value"
          title={offsetMs !== 0 ? '点击归零' : undefined}
          role={offsetMs !== 0 ? 'button' : undefined}
          tabIndex={offsetMs !== 0 ? 0 : undefined}
          onClick={() => {
            if (offsetMs !== 0) {
              onChange(0)
            }
          }}
          onKeyDown={(event) => {
            if (offsetMs !== 0 && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault()
              onChange(0)
            }
          }}
        >
          {formatLyricOffset(offsetMs)}
        </span>
        <button
          type="button"
          class="music__lyrics-offset-btn"
          aria-label="歌词向后偏移 0.1 秒"
          title="向后偏移 0.1 秒"
          onPointerDown={() => setHeld(1)}
          onPointerUp={() => setHeld(undefined)}
          onPointerLeave={() => setHeld(undefined)}
          onPointerCancel={() => setHeld(undefined)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              applyStep(1)
            }
          }}
        >
          +0.1
        </button>
        {offsetMs !== 0 ? (
          <button
            type="button"
            class="music__lyrics-offset-reset"
            aria-label="歌词同步归零"
            onClick={() => onChange(0)}
          >
            归零
          </button>
        ) : null}
      </div>
    </div>
  )
}
