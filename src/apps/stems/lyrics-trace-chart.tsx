/**
 * 歌词行级时间连线图：把 TraceChart 画成「识别段层 + 词层 + 移动线」。
 *
 * 坐标：字块 left 相对绘图区（标签列右侧）；SVG 覆盖整行，x 要再加标签列宽度。
 * 字块按文本收成芯片，时长另画细条；芯片重叠则分轨道，避免叠字。
 */

import { useEffect, useRef, useState } from 'preact/hooks'
import { formatLrcTimestamp } from '../align/align-lrc.ts'
import {
  computeTraceViewSec,
  layoutTraceItems,
  TRACE_LABEL_W,
  TRACE_MIN_PX_PER_SEC,
  type TraceChart,
  type TraceLaidOut,
  type TraceLayoutItem,
} from './lyrics-trace.ts'

const LANE_H = 26
const CHIP_H = 18
const CHIP_TOP = 3

function useContentWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const style = getComputedStyle(el)
      const pad = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      setWidth(Math.max(0, el.clientWidth - pad))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

function chipClass(b: TraceLaidOut, kind: 'hyp' | 'word'): string {
  const bits = ['stems__trace-chip']
  if (kind === 'hyp') {
    bits.push('stems__trace-chip--hyp')
    if (!b.matched) bits.push('stems__trace-chip--orphan')
  } else {
    bits.push('stems__trace-chip--word')
    if (b.interpolated) bits.push('stems__trace-chip--interp')
    if (b.failed) bits.push('stems__trace-chip--failed')
  }
  return bits.join(' ')
}

function barClass(b: TraceLaidOut, kind: 'hyp' | 'word'): string {
  const bits = ['stems__trace-dur']
  if (kind === 'hyp') bits.push(b.matched ? 'stems__trace-dur--hyp' : 'stems__trace-dur--orphan')
  else if (b.interpolated || b.failed) bits.push('stems__trace-dur--interp')
  else bits.push('stems__trace-dur--word')
  return bits.join(' ')
}

type RowLayout = {
  key: string
  label: string
  kind: 'hyp' | 'word'
  top: number
  height: number
  blocks: TraceLaidOut[]
  moveFrom?: number[]
}

export function LyricsTraceChart({
  chart,
  onPreview,
}: {
  chart: TraceChart
  onPreview: (startSec: number, endSec: number) => void
}) {
  const [ref, width] = useContentWidth()
  const view = computeTraceViewSec(chart)
  const span = Math.max(0.001, view.endSec - view.startSec)
  const plotAvail = Math.max(0, width - TRACE_LABEL_W)
  const pxPerSec = Math.max(TRACE_MIN_PX_PER_SEC, plotAvail / span)
  const plotW = span * pxPerSec
  const innerW = TRACE_LABEL_W + plotW

  const hypLaid = layoutTraceItems(
    chart.hypBlocks.map((b) => ({
      key: `h${b.hypIndex}`,
      text: b.text,
      startSec: b.startSec,
      endSec: b.endSec,
      refIndex: b.refIndex,
      positionRefIndex: b.positionRefIndex,
      matched: b.refIndex >= 0,
    })),
    view.startSec,
    pxPerSec,
    plotW,
  )

  const rows: RowLayout[] = []
  let cursorY = 0
  rows.push({
    key: 'hyp',
    label: chart.hypLabel ?? '模型听到的',
    kind: 'hyp',
    top: cursorY,
    height: hypLaid.laneCount * LANE_H,
    blocks: hypLaid.blocks,
  })
  cursorY += rows[0].height

  for (const layer of chart.layers) {
    const items: TraceLayoutItem[] = layer.words.map((w, k) => ({
      key: `${layer.key}${k}`,
      text: w.text,
      startSec: w.startSec,
      endSec: w.endSec,
      refIndex: w.refIndex,
      interpolated: w.interpolated,
      failed: w.failed,
      endFallback: w.endFallback,
    }))
    const laid = layoutTraceItems(items, view.startSec, pxPerSec, plotW)
    rows.push({
      key: layer.key,
      label: layer.label,
      kind: 'word',
      top: cursorY,
      height: laid.laneCount * LANE_H,
      blocks: laid.blocks,
      moveFrom: layer.moveFrom,
    })
    cursorY += laid.laneCount * LANE_H
  }

  const totalH = Math.max(LANE_H, cursorY)
  const svgX = (plotX: number) => TRACE_LABEL_W + plotX
  const chipY = (row: RowLayout, b: TraceLaidOut) => row.top + b.lane * LANE_H + CHIP_TOP

  const links: {
    x1: number
    y1: number
    x2: number
    y2: number
    kind: 'match' | 'pos' | 'move'
  }[] = []
  const hypRow = rows[0]
  const firstWordRow = rows[1]
  if (hypRow && firstWordRow) {
    const usedHyp = new Set<string>()
    for (const w of firstWordRow.blocks) {
      if (w.refIndex === undefined || w.refIndex < 0) continue
      const hb = hypRow.blocks.find((h) => h.refIndex === w.refIndex && !usedHyp.has(h.key))
      if (!hb) continue
      usedHyp.add(hb.key)
      links.push({
        x1: svgX(hb.cx),
        y1: chipY(hypRow, hb) + CHIP_H,
        x2: svgX(w.cx),
        y2: chipY(firstWordRow, w),
        kind: 'match',
      })
    }
    // 位置锚点：没对上内容但按位置钉时间的识别块（虚线连到对应字）
    for (const hb of hypRow.blocks) {
      if (hb.positionRefIndex === undefined || hb.positionRefIndex < 0) continue
      const w = firstWordRow.blocks.find(
        (b) => Number(b.key.slice(firstWordRow.key.length)) === hb.positionRefIndex,
      )
      if (!w) continue
      links.push({
        x1: svgX(hb.cx),
        y1: chipY(hypRow, hb) + CHIP_H,
        x2: svgX(w.cx),
        y2: chipY(firstWordRow, w),
        kind: 'pos',
      })
    }
  }

  for (let ri = 2; ri < rows.length; ri++) {
    const row = rows[ri]
    const prev = rows[ri - 1]
    if (!row.moveFrom || !prev) continue
    const prevByKey = new Map(prev.blocks.map((b) => [b.key, b]))
    for (const w of row.blocks) {
      const srcIdx = Number(w.key.slice(row.key.length))
      if (!Number.isFinite(srcIdx)) continue
      const fi = row.moveFrom[srcIdx]
      if (fi === undefined || fi < 0) continue
      const a = prevByKey.get(`${prev.key}${fi}`)
      if (!a) continue
      if (Math.abs(a.startSec - w.startSec) < 0.03) continue
      links.push({
        x1: svgX(a.cx),
        y1: chipY(prev, a) + CHIP_H,
        x2: svgX(w.cx),
        y2: chipY(row, w),
        kind: 'move',
      })
    }
  }

  const bandLeft = Math.max(0, (chart.windowSec.startSec - view.startSec) * pxPerSec)
  const bandRight = Math.min(plotW, (chart.windowSec.endSec - view.startSec) * pxPerSec)
  const showBand =
    bandRight - bandLeft > 4 &&
    (view.startSec < chart.windowSec.startSec - 0.02 || view.endSec > chart.windowSec.endSec + 0.02)

  return (
    <div class="stems__trace" ref={ref}>
      <div class="stems__trace-inner" style={{ width: `${Math.max(width, innerW)}px` }}>
        <div class="stems__trace-axis" style={{ paddingLeft: `${TRACE_LABEL_W}px` }}>
          <span>{formatLrcTimestamp(view.startSec)}</span>
          <span>{formatLrcTimestamp(view.endSec)}</span>
        </div>
        <div class="stems__trace-rows" style={{ height: `${totalH}px` }}>
          {showBand && (
            <div
              class="stems__trace-band"
              style={{
                left: `${TRACE_LABEL_W + bandLeft}px`,
                width: `${Math.max(0, bandRight - bandLeft)}px`,
              }}
              title="这一行的切片窗口"
            />
          )}

          {rows.map((row) => (
            <div
              key={row.key}
              class="stems__trace-row"
              style={{ height: `${row.height}px`, top: `${row.top}px` }}
            >
              <span class="stems__trace-label" style={{ width: `${TRACE_LABEL_W}px` }}>
                {row.label}
              </span>
              <div class="stems__trace-blocks" style={{ width: `${plotW}px` }}>
                {row.key === 'hyp' && row.blocks.length === 0 && (
                  <span class="stems__trace-nohyp">这一行窗口内没有识别段</span>
                )}
                {row.blocks.map((b) => {
                  const hitLeft = Math.min(b.left, b.barLeft)
                  const hitRight = Math.max(b.left + b.width, b.barLeft + b.barWidth)
                  return (
                    <button
                      type="button"
                      key={b.key}
                      class="stems__trace-hit"
                      style={{
                        left: `${hitLeft}px`,
                        width: `${Math.max(1, hitRight - hitLeft)}px`,
                        top: `${b.lane * LANE_H}px`,
                        height: `${LANE_H}px`,
                      }}
                      onClick={() => onPreview(b.startSec, b.endSec)}
                      title={`${b.text} ${formatLrcTimestamp(b.startSec)}–${formatLrcTimestamp(b.endSec)}${
                        row.kind === 'hyp' && !b.matched
                          ? b.positionRefIndex !== undefined && b.positionRefIndex >= 0
                            ? '（位置对上，内容未对上）'
                            : '（没对上任何词）'
                          : b.failed
                            ? '（无识别证据，插值兜底）'
                            : b.endFallback
                              ? '（end 为显示兜底，非识别边界）'
                              : ''
                      }`}
                    >
                      <span
                        class={barClass(b, row.kind)}
                        style={{
                          left: `${b.barLeft - hitLeft}px`,
                          width: `${b.barWidth}px`,
                        }}
                      />
                      <span
                        class={chipClass(b, row.kind)}
                        style={{
                          left: `${b.left - hitLeft}px`,
                          width: `${b.width}px`,
                        }}
                      >
                        {b.text}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          {width > 0 && links.length > 0 && (
            <svg
              class="stems__trace-links"
              width={innerW}
              height={totalH}
              viewBox={`0 0 ${innerW} ${totalH}`}
            >
              {links.map((l, i) => (
                <line
                  key={i}
                  x1={l.x1}
                  y1={l.y1}
                  x2={l.x2}
                  y2={l.y2}
                  fill="none"
                  class={
                    l.kind === 'match'
                      ? 'stems__trace-link--match'
                      : l.kind === 'pos'
                        ? 'stems__trace-link--pos'
                        : 'stems__trace-link--move'
                  }
                />
              ))}
            </svg>
          )}
        </div>
      </div>
    </div>
  )
}
