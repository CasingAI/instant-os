/**
 * 歌词分析抽屉：双击歌词轨时从右侧滑入。
 * 展示行级诊断 + 问题检测（断层/挤压/括号）+ 方案对比。
 * 方案 A（当前）/ B（行时间戳主导）/ C（括号剔除）秒级纯计算；
 * 方案 D（局部重跑）对断层段切片用 SenseVoice 重新识别（秒级），不整首重跑。
 * 仅查看对比，不写回主界面。
 */

import { useCallback, useMemo, useRef, useState } from 'preact/hooks'
import { IosButton } from '../../ui/ios-button.tsx'
import { formatLrcTimestamp } from '../align/align-lrc.ts'
import type { HypSegment } from '../align/align-text-dtw.ts'
import { enqueueAiTask } from '../../ai/ai-inference-service.ts'
import type { SenseVoiceProgress } from '../align/sense-voice-worker.ts'
import type { LyricsLine } from '../music/music-lyrics.ts'
import {
  alignWithLineTimes,
  alignWithoutParens,
  computeLineStats,
  detectGaps,
  resolveLineTimes,
  sliceSegments,
  summarizeLines,
  type GapSlice,
  type LineStats,
} from './lyrics-analysis.ts'

const STEM_CHANNELS = 2

/** 聚焦行上下各展示的行数（双击所在行的上下文窗口） */
const FOCUS_CONTEXT_RADIUS = 2

export type LyricsAnalysisDrawerProps = {
  open: boolean
  onClose: () => void
  focusLine: number | null
  karaokeLines: LyricsLine[]
  lyrics: string
  lyricsLrc: string | null
  phonemes: HypSegment[] | null
  vocalsAudio: Float32Array | null
  sampleRate: number
  /** 是否有行时间戳（决定方案 B 是否有意义） */
  hasLineTimes: boolean
}

/** 迷你时间轴：在固定宽度内渲染行色带 + 红词点 + 断层块 */
function MiniTimeline({
  lines,
  lineStats,
  gaps,
  durationSec,
}: {
  lines: LyricsLine[]
  lineStats: LineStats[]
  gaps: GapSlice[]
  durationSec: number
}) {
  const dur = durationSec > 0 ? durationSec : 1
  return (
    <div class="stems__analysis-mini-timeline">
      {lineStats.map((st) => {
        if (st.timeSec === undefined || st.spanSec === undefined) return null
        const left = (st.timeSec / dur) * 100
        const width = (st.spanSec / dur) * 100
        const bad = st.failedCount > 0 || st.squeezed
        return (
          <div
            key={st.lineIndex}
            class={`stems__analysis-mini-band${bad ? ' stems__analysis-mini-band--bad' : ''}`}
            style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%` }}
            title={`[${formatLrcTimestamp(st.timeSec)}] ${st.text}`}
          />
        )
      })}
      {gaps.map((g, i) => (
        <div
          key={i}
          class="stems__analysis-mini-gap"
          style={{ left: `${(g.startSec / dur) * 100}%`, width: `${((g.endSec - g.startSec) / dur) * 100}%` }}
          title={`断层 ${formatLrcTimestamp(g.startSec)}–${formatLrcTimestamp(g.endSec)}`}
        />
      ))}
      {lines.flatMap((line, li) =>
        (line.words ?? []).map((w, wi) =>
          w.failed ? (
            <div
              key={`${li}:${wi}`}
              class="stems__analysis-mini-failed"
              style={{ left: `${(w.timeMs / 1000 / dur) * 100}%` }}
            />
          ) : null,
        ),
      )}
    </div>
  )
}

/** 方案卡片：名称 + 红词比例 + 迷你时间轴 */
function SchemeCard({
  title,
  sub,
  lines,
  lineStats,
  gaps,
  durationSec,
}: {
  title: string
  sub: string
  lines: LyricsLine[]
  lineStats: LineStats[]
  gaps: GapSlice[]
  durationSec: number
}) {
  const { totalWords, failedWords, failedRatio } = summarizeLines(lines)
  const pct = Math.round(failedRatio * 100)
  const tone = pct >= 60 ? 'stems__analysis-badge--bad' : pct >= 30 ? 'stems__analysis-badge--warn' : 'stems__analysis-badge--ok'
  return (
    <div class="stems__analysis-scheme">
      <div class="stems__analysis-scheme-head">
        <span class="stems__analysis-scheme-title">{title}</span>
        <span class={`stems__analysis-badge ${tone}`}>
          {totalWords > 0 ? `红词 ${failedWords}/${totalWords}（${pct}%）` : '无词'}
        </span>
      </div>
      <div class="stems__analysis-scheme-sub">{sub}</div>
      <MiniTimeline lines={lines} lineStats={lineStats} gaps={gaps} durationSec={durationSec} />
    </div>
  )
}

export function LyricsAnalysisDrawer(props: LyricsAnalysisDrawerProps) {
  const { open, onClose, focusLine, karaokeLines, lyrics, lyricsLrc, phonemes, vocalsAudio, sampleRate, hasLineTimes } =
    props

  // 纯函数秒级计算（方案 A 当前 / B 行时间戳主导 / C 括号剔除）
  // 真实行时间戳：优先源 LRC（mapLrcLineTimes），无则回退 karaokeLines 自带
  const lineTimes = useMemo(
    () => resolveLineTimes(lyrics, lyricsLrc, karaokeLines),
    [lyrics, lyricsLrc, karaokeLines],
  )
  const baseline = useMemo(
    () => alignWithLineTimes(phonemes ?? [], lyrics, lyricsLrc ?? '', lineTimes),
    [phonemes, lyrics, lyricsLrc, lineTimes],
  )
  const parenResult = useMemo(() => alignWithoutParens(phonemes ?? [], lyrics), [phonemes, lyrics])

  // 行级诊断（基于当前 karaokeLines）
  const lineStats = useMemo(() => computeLineStats(karaokeLines), [karaokeLines])

  // 断层检测：基于真实行时间戳区间（全局对齐结果的 timeMs 可能被挤坏，
  // 源 LRC 行时间戳才能反映真实的演唱区间）
  const gaps = useMemo(() => detectGaps(phonemes ?? [], lineTimes), [phonemes, lineTimes])

  const durationSec = useMemo(() => {
    let max = 0
    for (const l of karaokeLines) {
      if (l.timeMs !== undefined) max = Math.max(max, l.timeMs / 1000)
      for (const w of l.words ?? []) max = Math.max(max, w.timeMs / 1000)
    }
    if (phonemes && phonemes.length > 0) max = Math.max(max, phonemes[phonemes.length - 1].end)
    return max
  }, [karaokeLines, phonemes])

  // 方案 D：局部重跑
  const [rerunBusy, setRerunBusy] = useState(false)
  const [rerunError, setRerunError] = useState<string | null>(null)
  const [rerunSegments, setRerunSegments] = useState<HypSegment[] | null>(null)
  const rerunSeqRef = useRef(0)

  const handleRerun = useCallback(async () => {
    if (!vocalsAudio || sampleRate <= 0) {
      setRerunError('无人声轨音频，无法局部重跑')
      return
    }
    const slices = gaps
    if (slices.length === 0) {
      setRerunError('未检测到断层段，无需重跑')
      return
    }
    // 取所有断层切片合并为一个区间（含 0.5s 缓冲），一次识别
    const startSec = Math.max(0, slices[0].startSec - 0.5)
    const endSec = Math.max(startSec + 0.5, slices[slices.length - 1].endSec + 0.5)
    const seq = ++rerunSeqRef.current
    setRerunBusy(true)
    setRerunError(null)
    setRerunSegments(null)
    try {
      // interleaved stereo：帧索引 × 通道数
      const a = Math.floor(startSec * sampleRate) * STEM_CHANNELS
      const b = Math.min(vocalsAudio.length, Math.ceil(endSec * sampleRate) * STEM_CHANNELS)
      if (a >= b) throw new Error('断层切片为空')
      const slice = vocalsAudio.slice(a, b)
      const { segments } = await enqueueAiTask<
        SenseVoiceProgress,
        { segments: HypSegment[]; text: string }
      >(
        'align-sense-voice',
        { type: 'recognize', audio: slice, sampleRate },
        {
          route: (msg) => {
            if (msg.kind === 'model-loading' || msg.kind === 'model-loaded') {
              return { action: 'continue' }
            }
            if (msg.kind === 'progress') {
              return { action: 'continue' }
            }
            if (msg.kind === 'done') {
              return { action: 'resolve', value: { segments: msg.segments, text: msg.text } }
            }
            if (msg.kind === 'error') {
              return { action: 'reject', error: new Error(msg.message) }
            }
            return { action: 'reject', error: new Error('识别服务返回未知消息') }
          },
        },
      )
      if (seq !== rerunSeqRef.current) return
      // 合并：替换切片区间内旧段
      const merged = sliceSegments(phonemes ?? [], startSec, endSec, segments)
      setRerunSegments(merged)
    } catch (cause) {
      if (seq !== rerunSeqRef.current) return
      setRerunError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (seq === rerunSeqRef.current) setRerunBusy(false)
    }
  }, [vocalsAudio, sampleRate, gaps, phonemes])

  // 方案 D 结果（合并后重算）
  const rerunLines = useMemo(
    () => (rerunSegments ? alignWithLineTimes(rerunSegments, lyrics, lyricsLrc ?? '', lineTimes) : []),
    [rerunSegments, lyrics, lyricsLrc, lineTimes],
  )

  if (!open) return null

  return (
    <div class="stems__analysis-backdrop" onClick={onClose}>
      <div class="stems__analysis-drawer" onClick={(e) => e.stopPropagation()}>
        <div class="stems__analysis-header">
          <h3 class="stems__analysis-title">歌词分析</h3>
          <button type="button" class="stems__analysis-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>
        <div class="stems__analysis-body">
          {focusLine !== null && karaokeLines[focusLine] !== undefined && (
            <div class="stems__analysis-focus">
              <span class="stems__analysis-focus-time">
                {karaokeLines[focusLine].timeMs !== undefined
                  ? `[${formatLrcTimestamp((karaokeLines[focusLine].timeMs as number) / 1000)}]`
                  : '[--:--.--]'}
              </span>
              <span class="stems__analysis-focus-text">{karaokeLines[focusLine].text}</span>
            </div>
          )}

          <section class="stems__analysis-section">
            <h4 class="stems__analysis-section-title">该行诊断</h4>
            {focusLine === null ? (
              <p class="stems__analysis-empty">双击歌词轨的某一行以查看其诊断</p>
            ) : (
              <div class="stems__analysis-lines">
                {lineStats
                  .filter((st) => Math.abs(st.lineIndex - focusLine) <= FOCUS_CONTEXT_RADIUS)
                  .map((st) => {
                    const isFocus = st.lineIndex === focusLine
                    const badges: string[] = []
                    if (st.hasParen) badges.push('括号')
                    if (st.squeezed) badges.push('挤压')
                    if (st.failedCount > 0) badges.push(`红词 ${st.failedCount}`)
                    return (
                      <div
                        key={st.lineIndex}
                        class={`stems__analysis-line-row${
                          isFocus
                            ? ' stems__analysis-line-row--focus'
                            : ' stems__analysis-line-row--context'
                        }`}
                      >
                        <span class="stems__analysis-line-time">
                          {st.timeSec !== undefined ? formatLrcTimestamp(st.timeSec) : '--:--.--'}
                        </span>
                        <span class="stems__analysis-line-text">{st.text}</span>
                        {badges.length > 0 && (
                          <span class="stems__analysis-line-badges">
                            {badges.map((b) => (
                              <span key={b} class="stems__analysis-badge stems__analysis-badge--warn">
                                {b}
                              </span>
                            ))}
                          </span>
                        )}
                      </div>
                    )
                  })}
              </div>
            )}
          </section>

          <section class="stems__analysis-section">
            <h4 class="stems__analysis-section-title">方案对比</h4>
            <div class="stems__analysis-schemes">
              <SchemeCard
                title="A · 当前结果"
                sub="alignedLrc 现状"
                lines={karaokeLines}
                lineStats={lineStats}
                gaps={gaps}
                durationSec={durationSec}
              />
              <SchemeCard
                title="B · 行时间戳主导"
                sub={hasLineTimes && lyricsLrc ? '用 .lrc 行时间戳重算（恢复重建后路径）' : '用当前行时间戳重算'}
                lines={baseline}
                lineStats={computeLineStats(baseline)}
                gaps={gaps}
                durationSec={durationSec}
              />
              <SchemeCard
                title={`C · 括号剔除${parenResult.adlibCount > 0 ? `（${parenResult.adlibCount} 段 ad-lib）` : ''}`}
                sub="括号内容不参与对齐，主词单独对齐"
                lines={parenResult.lines}
                lineStats={computeLineStats(parenResult.lines)}
                gaps={gaps}
                durationSec={durationSec}
              />
              <div class="stems__analysis-scheme">
                <div class="stems__analysis-scheme-head">
                  <span class="stems__analysis-scheme-title">D · 断层段局部重跑</span>
                  {rerunLines.length > 0 && (
                    <span class="stems__analysis-badge stems__analysis-badge--ok">
                      已重跑 {rerunSegments?.length ?? 0} 段
                    </span>
                  )}
                </div>
                <div class="stems__analysis-scheme-sub">
                  对断层段（{gaps.length > 0 ? gaps.map((g) => `${formatLrcTimestamp(g.startSec)}–${formatLrcTimestamp(g.endSec)}`).join('、') : '无'}）
                  切片用 SenseVoice 重新识别，不整首重跑
                </div>
                <MiniTimeline
                  lines={rerunLines.length > 0 ? rerunLines : karaokeLines}
                  lineStats={rerunLines.length > 0 ? computeLineStats(rerunLines) : lineStats}
                  gaps={rerunSegments ? [] : gaps}
                  durationSec={durationSec}
                />
                {rerunError && <p class="stems__analysis-error">{rerunError}</p>}
                <div class="stems__analysis-actions">
                  <IosButton
                    size="compact"
                    tone="primary"
                    disabled={rerunBusy || gaps.length === 0 || !vocalsAudio}
                    onClick={() => void handleRerun()}
                  >
                    {rerunBusy ? '识别中…' : gaps.length > 0 ? '重跑断层段' : '无断层段'}
                  </IosButton>
                  {rerunBusy && <span class="stems__analysis-hint">SenseVoice 识别断层切片（约数秒）</span>}
                </div>
              </div>
            </div>
          </section>

          {/* 全部行诊断：次要信息，折叠展示，默认收起 */}
          <details class="stems__analysis-alllines">
            <summary class="stems__analysis-alllines-summary">
              全部行诊断（{lineStats.length} 行）
            </summary>
            <div class="stems__analysis-lines">
              {lineStats.map((st) => {
                const badges: string[] = []
                if (st.hasParen) badges.push('括号')
                if (st.squeezed) badges.push('挤压')
                if (st.failedCount > 0) badges.push(`红词 ${st.failedCount}`)
                return (
                  <div
                    key={st.lineIndex}
                    class={`stems__analysis-line-row${st.lineIndex === focusLine ? ' stems__analysis-line-row--focus' : ''}`}
                  >
                    <span class="stems__analysis-line-time">
                      {st.timeSec !== undefined ? formatLrcTimestamp(st.timeSec) : '--:--.--'}
                    </span>
                    <span class="stems__analysis-line-text">{st.text}</span>
                    {badges.length > 0 && (
                      <span class="stems__analysis-line-badges">
                        {badges.map((b) => (
                          <span key={b} class="stems__analysis-badge stems__analysis-badge--warn">
                            {b}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}
