/**
 * 双轨对齐视图（整窗全屏）：上轨歌词逐字、下轨音素段，共享同一时间轴。
 * 同字同色 + 双向 hover 高亮表达「音素 ↔ 歌词的字」的对应关系；
 * 图下方附逐字 → 音素明细表。
 */
import { Fragment } from 'preact'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { IosButton } from '../../ui/ios-button.tsx'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import type { AlignedPhone } from './phoneme-types.ts'
import {
  assignPhonesToChars,
  buildCharPhoneRows,
  charColorIndex,
  parseAlignLrcTimeline,
  type CharSegment,
  type CharTimeline,
  type PhoneCharAssignment,
} from './phoneme-align-view.ts'

/** 可见窗口最短时长（秒）：再放大就看不清逐字块了 */
const MIN_VIEW_SEC = 1.5

type HoverTarget =
  | { kind: 'char'; lineIndex: number; charIndex: number }
  | { kind: 'phone'; phoneIndex: number }

export function PhonemeAlignView({
  phones,
  lrcText,
  duration,
  sourceName,
  onClose,
}: {
  phones: AlignedPhone[]
  lrcText: string
  duration: number | null
  sourceName?: string
  onClose: () => void
}) {
  const parsed = useMemo(
    () => parseAlignLrcTimeline(lrcText, duration ?? undefined),
    [lrcText, duration],
  )
  const { timeline, durationSec, hasWordTimestamps } = parsed
  const assignments = useMemo(
    () => assignPhonesToChars(phones, parsed.timeline),
    [phones, parsed.timeline],
  )
  const charRows = useMemo(
    () => buildCharPhoneRows(assignments, parsed.timeline),
    [assignments, parsed.timeline],
  )
  /** 字 → 音素清单查询表（tooltip 用） */
  const charPhonesByKey = useMemo(() => {
    const map = new Map<string, { pinyin: string; symbol: string }[]>()
    for (const row of charRows) {
      map.set(`${row.lineIndex}:${row.charIndex}`, row.phones)
    }
    return map
  }, [charRows])

  // —— 横向缩放：level 0 = 适配容器宽度，每 +1 可见窗口减半（参照 stems 波形缩放）——
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [level, setLevel] = useState(0)
  const [fitPxPerSec, setFitPxPerSec] = useState(24)
  const maxZoomLevel =
    durationSec > 0 ? Math.max(0, Math.floor(Math.log2(durationSec / MIN_VIEW_SEC))) : 0
  const safeLevel = Math.min(level, maxZoomLevel)
  const viewLen =
    durationSec > 0
      ? Math.max(MIN_VIEW_SEC, Math.min(durationSec, durationSec / Math.pow(2, safeLevel)))
      : 0
  const pxPerSec = fitPxPerSec * Math.pow(2, safeLevel)
  const contentWidth = durationSec * pxPerSec

  // 容器宽度变化 → 重算「适配宽度」基准
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => {
      const width = el.clientWidth
      if (width > 0 && durationSec > 0) {
        setFitPxPerSec((prev) => {
          const next = Math.max(16, width / durationSec)
          return Math.abs(next - prev) > 0.5 ? next : prev
        })
      }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [durationSec])

  /** 缩放到 nextLevel，锚定 anchorClientX 处的时间在缩放前后不动 */
  const zoomAt = useCallback(
    (nextLevel: number, anchorClientX: number) => {
      const el = scrollRef.current
      if (!el || durationSec <= 0) return
      const rect = el.getBoundingClientRect()
      const pointerX = el.scrollLeft + (anchorClientX - rect.left)
      const anchorSec = Math.max(0, pointerX / pxPerSec)
      const clamped = Math.max(0, Math.min(nextLevel, maxZoomLevel))
      if (clamped === safeLevel) return
      setLevel(clamped)
      // 等渲染出新宽度后再把锚点像素还原（React 不接管 scrollLeft，旧值仍可读）
      requestAnimationFrame(() => {
        const newPx = fitPxPerSec * Math.pow(2, clamped)
        el.scrollLeft = anchorSec * newPx - (pointerX - el.scrollLeft)
      })
    },
    [durationSec, fitPxPerSec, maxZoomLevel, pxPerSec, safeLevel],
  )

  const zoomButtons = useCallback(
    (delta: number) => {
      const el = scrollRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      zoomAt(safeLevel + delta, rect.left + rect.width / 2)
    },
    [safeLevel, zoomAt],
  )

  /** 回到适配宽度（level 0 + 滚动归零） */
  const fitAll = useCallback(() => {
    const el = scrollRef.current
    setLevel(0)
    requestAnimationFrame(() => {
      if (el) el.scrollLeft = 0
    })
  }, [])

  // 滚轮：捏合/滚轮=以指针为锚缩放，Shift+滚轮=平移，横滑=原生滚动（必须非 passive 才能 preventDefault）
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const handler = (event: WheelEvent) => {
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      if (event.ctrlKey) {
        event.preventDefault()
        const factor = Math.exp(event.deltaY * 0.008)
        const newLen = Math.max(MIN_VIEW_SEC, Math.min(durationSec, viewLen * factor))
        zoomAt(Math.log2(durationSec / newLen), event.clientX)
      } else if (event.shiftKey) {
        event.preventDefault()
        el.scrollLeft += event.deltaY
      } else if (horizontal) {
        // 原生 overflow-x 滚动已处理横滑
      } else if (durationSec > 0) {
        event.preventDefault()
        const factor = event.deltaY < 0 ? 1.25 : 0.8
        const newLen = Math.max(MIN_VIEW_SEC, Math.min(durationSec, viewLen * factor))
        zoomAt(Math.log2(durationSec / newLen), event.clientX)
      }
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [durationSec, viewLen, zoomAt])

  // —— hover 联动：悬停字 ↔ 悬停音素互相高亮 ——
  const [hover, setHover] = useState<HoverTarget | null>(null)
  const charHover = useCallback((lineIndex: number, charIndex: number) => {
    setHover({ kind: 'char', lineIndex, charIndex })
  }, [])
  const phoneHover = useCallback((phoneIndex: number) => {
    setHover({ kind: 'phone', phoneIndex })
  }, [])
  const clearHover = useCallback(() => setHover(null), [])

  const isCharActive = useCallback(
    (lineIndex: number, charIndex: number) => {
      if (!hover) return false
      if (hover.kind === 'char') return hover.lineIndex === lineIndex && hover.charIndex === charIndex
      const a = assignments[hover.phoneIndex]
      return a !== undefined && a.lineIndex === lineIndex && a.charIndex === charIndex
    },
    [assignments, hover],
  )
  const isPhoneActive = useCallback(
    (phoneIndex: number) => {
      if (!hover) return false
      if (hover.kind === 'phone') return hover.phoneIndex === phoneIndex
      const a = assignments[phoneIndex]
      return a !== undefined && a.lineIndex === hover.lineIndex && a.charIndex === hover.charIndex
    },
    [assignments, hover],
  )

  // —— 时间标尺刻度：间距 ≥ 64px 的「整齐」步长 ——
  const tickStep = useMemo(() => {
    if (durationSec <= 0) return 1
    const target = 64 / Math.max(1, pxPerSec)
    const steps = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]
    return steps.find((s) => s >= target) ?? steps[steps.length - 1]
  }, [durationSec, pxPerSec])
  const ticks = useMemo(() => {
    const out: number[] = []
    for (let t = 0; t <= durationSec + 1e-6; t += tickStep) out.push(t)
    return out
  }, [durationSec, tickStep])
  const fmtTick = (sec: number) => {
    if (sec < 1) return `${Math.round(sec * 1000)}ms`
    if (sec >= 60) {
      const m = Math.floor(sec / 60)
      const s = Math.floor(sec % 60)
      return `${m}:${String(s).padStart(2, '0')}`
    }
    return Number.isInteger(sec) ? `${sec}s` : `${sec.toFixed(1)}s`
  }

  const unmappedCount = assignments.filter((a) => a.lineIndex < 0 || a.charIndex < 0).length
  const phoneTitle = (a: PhoneCharAssignment) => {
    const where =
      a.lineIndex < 0
        ? '行外（句首/句尾静音）'
        : a.charIndex < 0
          ? `第${a.lineIndex + 1}行 · 字间间隙`
          : `第${a.lineIndex + 1}行 · 第${a.charIndex + 1}字「${a.char}」`
    return `${a.pinyin} [${a.phone.symbol}]\n${a.phone.start.toFixed(2)}–${a.phone.end.toFixed(2)}s\n→ ${where}`
  }
  const charTitle = (line: CharTimeline, seg: CharSegment, c: number) => {
    const phones = charPhonesByKey.get(`${line.lineIndex}:${c}`) ?? []
    const phoneText =
      phones.length > 0
        ? phones.map((p) => `${p.pinyin} ${p.symbol}`).join(' ')
        : '（无音素）'
    return `${line.lineText}\n第${line.lineIndex + 1}行 · 第${c + 1}字 · ${seg.start.toFixed(2)}–${seg.end.toFixed(2)}s\n音素：${phoneText}`
  }

  const unmapped =
    unmappedCount > 0
      ? ` · ${unmappedCount} 个音素未对应具体字（间隙/静音）`
      : ''

  return (
    <div class="phoneme-av">
      {/* 顶栏 */}
      <header class="phoneme-av__toolbar">
        <IosNavBackButton iconSize={14} label="返回" onClick={onClose} />
        <span class="phoneme-av__title">对齐视图</span>
        {sourceName && (
          <span class="phoneme-av__source" title={sourceName}>
            {sourceName}
          </span>
        )}
        <div class="phoneme-av__toolbar-right">
          {timeline.length > 0 && (
            <span class="phoneme-av__stats">
              {timeline.length} 行 · {charRows.length} 字 · {assignments.length} 音素 ·{' '}
              {durationSec.toFixed(1)}s
            </span>
          )}
        </div>
      </header>

      {timeline.length === 0 ? (
        <div class="phoneme-av__empty">
          <p>没有解析到带时间戳的歌词行</p>
          <p class="phoneme-av__empty-hint">
            对齐结果需为 LRC 格式：含 [mm:ss.xx] 行时间戳，或 &lt;mm:ss.xx&gt;字 逐字时间戳
          </p>
        </div>
      ) : (
        <div class="phoneme-av__body">
          <div class="phoneme-av__zoombar">
            <IosButton size="compact" onClick={() => zoomButtons(-1)} disabled={safeLevel <= 0}>
              −
            </IosButton>
            <IosButton
              size="compact"
              onClick={() => zoomButtons(1)}
              disabled={safeLevel >= maxZoomLevel}
            >
              ＋
            </IosButton>
            <IosButton size="compact" onClick={fitAll} disabled={safeLevel === 0}>
              适配宽度
            </IosButton>
            <span class="phoneme-av__zoom-label">
              {viewLen.toFixed(1)}s 可见 · 缩放 {Math.round(Math.pow(2, safeLevel) * 100)}%
            </span>
          </div>

          {!hasWordTimestamps && (
            <div class="phoneme-av__notice">
              该 LRC 没有逐字时间戳（&lt;mm:ss.xx&gt;字），音素按整行对应显示
            </div>
          )}

          {/* 双轨画布：同一时间轴，上歌词下音素 */}
          <div class="phoneme-av__canvas">
            <div class="phoneme-av__scroll" ref={scrollRef}>
              <div class="phoneme-av__content" style={{ width: `${contentWidth}px` }}>
                {/* 垂直网格线（主刻度） */}
                {ticks.map((t) => (
                  <div
                    key={t}
                    class="phoneme-av__gridline"
                    style={{ left: `${t * pxPerSec}px` }}
                  />
                ))}

                {/* 时间标尺 */}
                <div class="phoneme-av__ruler">
                  {ticks.map((t) => (
                    <span
                      key={t}
                      class="phoneme-av__tick"
                      style={{ left: `${t * pxPerSec}px` }}
                    >
                      {fmtTick(t)}
                    </span>
                  ))}
                </div>

                {/* 上轨：歌词逐字 */}
                <div class="phoneme-av__lane phoneme-av__lane--lyrics">
                  <span class="phoneme-av__lane-label">歌词</span>
                  {timeline.map((line) => (
                    <Fragment key={line.lineIndex}>
                      <div
                        class={`phoneme-av__line-band${line.lineIndex % 2 === 1 ? ' phoneme-av__line-band--alt' : ''}`}
                        style={{
                          left: `${line.start * pxPerSec}px`,
                          width: `${Math.max(2, (line.end - line.start) * pxPerSec)}px`,
                        }}
                      />
                      {(line.chars ?? [
                        { char: line.lineText, start: line.start, end: line.end },
                      ]).map((seg, c) => {
                        const color = charColorIndex(line.lineIndex, c)
                        return (
                          <div
                            key={c}
                            class={`phoneme-av__char phoneme-av__char--c${color}${
                              isCharActive(line.lineIndex, c)
                                ? ' phoneme-av__char--hl'
                                : hover
                                  ? ' phoneme-av__char--dim'
                                  : ''
                            }`}
                            style={{
                              left: `${seg.start * pxPerSec}px`,
                              width: `${Math.max(14, (seg.end - seg.start) * pxPerSec)}px`,
                            }}
                            title={charTitle(line, seg, c)}
                            onMouseEnter={() => charHover(line.lineIndex, c)}
                            onMouseLeave={clearHover}
                          >
                            {seg.char}
                          </div>
                        )
                      })}
                    </Fragment>
                  ))}
                </div>

                {/* 下轨：音素段（同字同色） */}
                <div class="phoneme-av__lane phoneme-av__lane--phones">
                  <span class="phoneme-av__lane-label">音素</span>
                  {assignments.map((a, i) => {
                    const mapped = a.lineIndex >= 0 && a.charIndex >= 0
                    const color = mapped ? charColorIndex(a.lineIndex, a.charIndex) : -1
                    return (
                      <div
                        key={i}
                        class={`phoneme-av__phone${
                          mapped
                            ? ` phoneme-av__char--c${color}`
                            : ' phoneme-av__phone--gap'
                        }${isPhoneActive(i) ? ' phoneme-av__phone--hl' : hover ? ' phoneme-av__phone--dim' : ''}`}
                        style={{
                          left: `${a.phone.start * pxPerSec}px`,
                          width: `${Math.max(12, (a.phone.end - a.phone.start) * pxPerSec)}px`,
                        }}
                        title={phoneTitle(a)}
                        onMouseEnter={() => phoneHover(i)}
                        onMouseLeave={clearHover}
                      >
                        <span class="phoneme-av__phone-py">{a.pinyin}</span>
                        <span class="phoneme-av__phone-ipa">{a.phone.symbol}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* 逐字 → 音素明细表 */}
          <div class="phoneme-av__detail">
            <div class="phoneme-av__detail-head">
              <span>逐字 → 音素明细</span>
              <span class="phoneme-av__detail-meta">
                {charRows.length} 字 · {assignments.length} 音素{unmapped}
              </span>
            </div>
            <div class="phoneme-av__detail-body">
              {charRows.map((row, i) => {
                const isLineStart = i === 0 || charRows[i - 1].lineIndex !== row.lineIndex
                return (
                  <Fragment key={i}>
                    {isLineStart && (
                      <div class="phoneme-av__detail-linehead">
                        第{row.lineIndex + 1}行 · {row.lineText}
                      </div>
                    )}
                    <div class="phoneme-av__detail-row">
                      <span
                        class={`phoneme-av__detail-char phoneme-av__char--c${charColorIndex(
                          row.lineIndex,
                          row.charIndex,
                        )}${isCharActive(row.lineIndex, row.charIndex) ? ' phoneme-av__char--hl' : ''}${hover ? ' phoneme-av__detail-char--muted' : ''}`}
                        title={charTitle(parsed.timeline[row.lineIndex], {
                          char: row.char,
                          start: row.charStart,
                          end: row.charEnd,
                        }, row.charIndex)}
                        onMouseEnter={() => charHover(row.lineIndex, row.charIndex)}
                        onMouseLeave={clearHover}
                      >
                        {row.char}
                      </span>
                      <span class="phoneme-av__detail-phones">
                        {row.phones.length === 0 ? (
                          <span class="phoneme-av__detail-none">（无音素）</span>
                        ) : (
                          row.phones.map((p, j) => (
                            <span key={j} class="phoneme-av__detail-phone">
                              {p.pinyin} <em>{p.symbol}</em>{' '}
                              <span class="phoneme-av__detail-phone-time">
                                {p.start.toFixed(2)}–{p.end.toFixed(2)}s
                              </span>
                            </span>
                          ))
                        )}
                      </span>
                    </div>
                  </Fragment>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
