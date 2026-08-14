/**
 * 歌词分析抽屉：双击歌词轨某一行时从右侧滑入，只服务这一行。
 *
 * 流程：一句话诊断 → 当前行词条可点听 → 选一个修复动作 →
 * 预览新词条（同样可点听）→ 应用到主界面 / 撤销。
 *
 * 修复动作分两类：
 *  - 即时（纯函数秒出）：摊开、按行时间戳重算、括号剔除、不锁行窗口；
 *  - 异步（切这一行窗口跑模型）：重识别这一行（主界面当前模型）、
 *    Zipformer 识别这一行、Zipformer CTC 强制对齐这一行。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { IosButton } from '../../ui/ios-button.tsx'
import { formatLrcTimestamp } from '../align/align-lrc.ts'
import type { HypSegment } from '../align/align-text-dtw.ts'
import type { AlignedUnit } from '../align/align-types.ts'
import { enqueueAiTask } from '../../ai/ai-inference-service.ts'
import type { SenseVoiceProgress } from '../align/sense-voice-worker.ts'
import type { ZipformerAlignLine, ZipformerProgress } from '../align/zipformer-worker.ts'
import type { LyricsLine, LyricsWord } from '../music/music-lyrics.ts'
import {
  alignLineByLineTimes,
  alignLineFree,
  alignLineWithoutParens,
  buildLineFromUnits,
  computeLineStats,
  describeLineIssue,
  lineWindowSec,
  resolveLineTimes,
  spreadLineToWindow,
} from './lyrics-analysis.ts'

const STEM_CHANNELS = 2

/** 歌词识别模型（与主界面一致） */
export type AlignModel = 'zipformer' | 'sense-voice'

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
  /** 主界面当前歌词识别模型（重识别动作跟随它） */
  alignModel: AlignModel
  /** 试听音频片段 [startSec, endSec) */
  onPreview: (startSec: number, endSec: number) => void
  /** 停止试听（关闭抽屉/切换试听时） */
  onStopPreview: () => void
  /** 把某行的新逐字时间戳写回主界面并落盘 */
  onApplyLine: (focusLine: number, newWords: LyricsWord[]) => void
  /** 撤销上一次应用 */
  onUndo: () => void
  canUndo: boolean
}

/** 修复动作标识 */
type ActionKey = 'spread' | 'line-times' | 'paren' | 'free' | 'rerun-line' | 'zip-rerun' | 'ctc-align'

const ACTION_LABELS: Record<ActionKey, string> = {
  spread: '摊开到行区间',
  'line-times': '按行时间戳重算',
  paren: '括号不参与',
  free: '不锁行窗口',
  'rerun-line': '重识别这一行',
  'zip-rerun': 'Zipformer 识别这一行',
  'ctc-align': 'Zipformer CTC 强制对齐',
}

/** 预览结果：某动作产出的新词条 */
type PreviewState = {
  key: ActionKey
  line: LyricsLine | null
  note: string
}

/** 可点听词条：每个词一个 chip，点击播人声到下一词（或词尾+0.5s） */
function WordChips({
  line,
  onPreview,
}: {
  line: LyricsLine
  onPreview: (startSec: number, endSec: number) => void
}) {
  const words = line.words ?? []
  if (words.length === 0) {
    return <p class="stems__analysis-empty">该行无逐字时间戳，无法逐词试听</p>
  }
  return (
    <div class="stems__analysis-words">
      {words.map((w, i) => {
        const next = words[i + 1]
        const endSec = next ? next.timeMs / 1000 : w.timeMs / 1000 + 0.5
        return (
          <button
            type="button"
            key={i}
            class={`stems__analysis-word${w.failed ? ' stems__analysis-word--failed' : ''}`}
            onClick={() => onPreview(w.timeMs / 1000, endSec)}
            title={`试听 ${formatLrcTimestamp(w.timeMs / 1000)}–${formatLrcTimestamp(endSec)}`}
          >
            {w.text.trim()}
          </button>
        )
      })}
    </div>
  )
}

export function LyricsAnalysisDrawer(props: LyricsAnalysisDrawerProps) {
  const {
    open,
    onClose,
    focusLine,
    karaokeLines,
    lyrics,
    lyricsLrc,
    phonemes,
    vocalsAudio,
    sampleRate,
    alignModel,
    onPreview,
    onStopPreview,
    onApplyLine,
    onUndo,
    canUndo,
  } = props

  // 真实行时间戳：优先源 LRC，回退 karaokeLines 自带（全局对齐结果可能被挤坏）
  const lineTimes = useMemo(
    () => resolveLineTimes(lyrics, lyricsLrc, karaokeLines),
    [lyrics, lyricsLrc, karaokeLines],
  )
  const lineStats = useMemo(() => computeLineStats(karaokeLines), [karaokeLines])

  const focusLineObj = focusLine !== null ? karaokeLines[focusLine] : undefined
  const focusStats = focusLine !== null ? lineStats[focusLine] : undefined
  const focusTimeSec =
    focusLineObj?.timeMs !== undefined ? focusLineObj.timeMs / 1000 : undefined

  // 行音频切片窗口（异步动作与部分即时动作用）
  const focusWindow = useMemo(
    () =>
      focusLine !== null
        ? lineWindowSec(lineTimes, focusLine, focusStats?.spanSec ?? 0.8)
        : null,
    [lineTimes, focusLine, focusStats],
  )

  // 预览 / 异步状态
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [appliedKey, setAppliedKey] = useState<string | null>(null)
  const [asyncBusy, setAsyncBusy] = useState<ActionKey | null>(null)
  const [asyncError, setAsyncError] = useState<string | null>(null)
  const [asyncProgress, setAsyncProgress] = useState<{ chunk: number; total: number } | null>(null)
  const [asyncText, setAsyncText] = useState<string | null>(null)
  const asyncSeqRef = useRef(0)

  // 切换聚焦行/关闭时清空预览与在途任务状态
  useEffect(() => {
    setPreview(null)
    setAppliedKey(null)
    setAsyncBusy(null)
    setAsyncError(null)
    setAsyncProgress(null)
    setAsyncText(null)
    asyncSeqRef.current += 1
  }, [focusLine, open])

  const stopPreviewCb = useCallback(() => {
    onStopPreview()
  }, [onStopPreview])

  // —— 即时动作 ——
  const handleSpread = useCallback(() => {
    if (!focusLineObj || focusWindow === null) return
    setAppliedKey(null)
    const line = spreadLineToWindow(focusLineObj, focusWindow.startSec, focusWindow.endSec)
    setPreview({
      key: 'spread',
      line,
      note: `按行区间 ${formatLrcTimestamp(focusWindow.startSec)}–${formatLrcTimestamp(focusWindow.endSec)} 均匀摊开，清红`,
    })
  }, [focusLineObj, focusWindow])

  const handleLineTimes = useCallback(() => {
    if (!focusLineObj || focusWindow === null || focusLine === null) return
    const startMs = lineTimes[focusLine] ?? focusLineObj.timeMs
    if (startMs === undefined) {
      setAsyncError('该行无行时间戳，无法按行时间戳重算')
      return
    }
    setAppliedKey(null)
    setAsyncError(null)
    const line = alignLineByLineTimes(
      phonemes ?? [],
      focusLineObj.text,
      startMs,
      lineTimes[focusLine + 1],
    )
    setPreview({
      key: 'line-times',
      line,
      note: '用窗口内识别段 + 该行行区间重新对齐',
    })
  }, [focusLine, focusLineObj, lineTimes, phonemes])

  const handleParen = useCallback(() => {
    if (!focusLineObj || focusWindow === null) return
    setAppliedKey(null)
    setAsyncError(null)
    const { mainLine, adlibTexts } = alignLineWithoutParens(
      phonemes ?? [],
      focusLineObj.text,
      focusWindow.startSec,
      focusWindow.endSec,
    )
    setPreview({
      key: 'paren',
      line: mainLine,
      note:
        adlibTexts.length > 0
          ? `括号 ad-lib 不参与对齐：${adlibTexts.join(' / ')}`
          : '此行无括号，主词直接对齐',
    })
  }, [focusLineObj, focusWindow, phonemes])

  const handleFree = useCallback(() => {
    if (!focusLineObj || focusWindow === null || focusTimeSec === undefined) return
    setAppliedKey(null)
    setAsyncError(null)
    const center = focusTimeSec + (focusWindow.endSec - focusWindow.startSec) / 2
    const line = alignLineFree(phonemes ?? [], focusLineObj.text, center)
    setPreview({
      key: 'free',
      line,
      note: '不锁行区间，用邻近识别段自由匹配（行时间戳不可靠时用）',
    })
  }, [focusLineObj, focusWindow, focusTimeSec, phonemes])

  // —— 异步动作：切行窗口识别 ——
  const runRecognize = useCallback(
    async (key: 'rerun-line' | 'zip-rerun', model: AlignModel) => {
      if (!vocalsAudio || sampleRate <= 0 || focusLine === null || focusWindow === null) return
      const lineText = karaokeLines[focusLine]?.text
      if (!lineText) return
      const a = Math.floor(focusWindow.startSec * sampleRate) * STEM_CHANNELS
      const b = Math.min(vocalsAudio.length, Math.ceil(focusWindow.endSec * sampleRate) * STEM_CHANNELS)
      if (a >= b) {
        setAsyncError('行窗口切片为空，无法识别')
        return
      }
      const slice = vocalsAudio.slice(a, b)
      const seq = ++asyncSeqRef.current
      setAsyncBusy(key)
      setAsyncError(null)
      setAsyncProgress(null)
      setAsyncText(null)
      setAppliedKey(null)
      setPreview(null)
      try {
        const modelId = model === 'zipformer' ? 'align-zipformer' : 'align-sense-voice'
        const { segments, text } = await enqueueAiTask<
          ZipformerProgress | SenseVoiceProgress,
          { segments: HypSegment[]; text: string }
        >(
          modelId,
          { type: 'recognize', audio: slice, sampleRate },
          {
            route: (msg) => {
              if (msg.kind === 'model-loading' || msg.kind === 'model-loaded') {
                return { action: 'continue' }
              }
              if (msg.kind === 'progress') {
                setAsyncProgress({ chunk: msg.chunk, total: msg.total })
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
        if (seq !== asyncSeqRef.current) return
        setAsyncText(text)
        // worker 返回的段时间是相对切片起点的，需偏移回全局时间轴
        const offset = focusWindow.startSec
        const shifted = segments.map((s) => ({ ...s, start: s.start + offset, end: s.end + offset }))
        const startMs = lineTimes[focusLine] ?? Math.round(focusWindow.startSec * 1000)
        const line = alignLineByLineTimes(shifted, lineText, startMs, lineTimes[focusLine + 1])
        setPreview({
          key,
          line,
          note: `${model === 'zipformer' ? 'Zipformer' : 'SenseVoice'} 识别行窗口 ${formatLrcTimestamp(focusWindow.startSec)}–${formatLrcTimestamp(focusWindow.endSec)} 后按行时间戳对齐`,
        })
      } catch (cause) {
        if (seq !== asyncSeqRef.current) return
        setAsyncError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (seq === asyncSeqRef.current) setAsyncBusy(null)
      }
    },
    [vocalsAudio, sampleRate, focusLine, focusWindow, karaokeLines, lineTimes],
  )

  const handleRerunLine = useCallback(
    () => void runRecognize('rerun-line', alignModel),
    [runRecognize, alignModel],
  )
  const handleZipRerun = useCallback(() => void runRecognize('zip-rerun', 'zipformer'), [runRecognize])

  // —— 异步动作：Zipformer CTC 强制对齐这一行 ——
  const handleCtcAlign = useCallback(async () => {
    if (!vocalsAudio || sampleRate <= 0 || focusLine === null || focusWindow === null) return
    const lineText = karaokeLines[focusLine]?.text
    if (!lineText) return
    const tStart = lineTimes[focusLine]
    if (tStart === undefined) {
      setAsyncError('该行无行时间戳，无法 CTC 强制对齐')
      return
    }
    const a = Math.floor(focusWindow.startSec * sampleRate) * STEM_CHANNELS
    const b = Math.min(vocalsAudio.length, Math.ceil(focusWindow.endSec * sampleRate) * STEM_CHANNELS)
    if (a >= b) {
      setAsyncError('行窗口切片为空，无法对齐')
      return
    }
    const slice = vocalsAudio.slice(a, b)
    // audio 已是行窗口切片（局部坐标），行时间戳需相对切片起点
    const windowLenMs = Math.max(200, Math.round((focusWindow.endSec - focusWindow.startSec) * 1000))
    const seq = ++asyncSeqRef.current
    setAsyncBusy('ctc-align')
    setAsyncError(null)
    setAsyncProgress(null)
    setAsyncText(null)
    setAppliedKey(null)
    setPreview(null)
    try {
      const { lines } = await enqueueAiTask<ZipformerProgress, { lines: ZipformerAlignLine[] }>(
        'align-zipformer',
        {
          type: 'align',
          audio: slice,
          sampleRate,
          lyricsLines: [lineText],
          lineTimesMs: [0, windowLenMs],
        },
        {
          route: (msg) => {
            if (msg.kind === 'model-loading' || msg.kind === 'model-loaded') {
              return { action: 'continue' }
            }
            if (msg.kind === 'progress') {
              setAsyncProgress({ chunk: msg.chunk, total: msg.total })
              return { action: 'continue' }
            }
            if (msg.kind === 'align-done') {
              return { action: 'resolve', value: { lines: msg.lines } }
            }
            if (msg.kind === 'error') {
              return { action: 'reject', error: new Error(msg.message) }
            }
            return { action: 'reject', error: new Error('对齐服务返回未知消息') }
          },
        },
      )
      if (seq !== asyncSeqRef.current) return
      // worker 返回的单元时间是相对切片起点的，偏移回全局时间轴
      const offset = focusWindow.startSec
      const units: AlignedUnit[] = (lines[0]?.units ?? []).map((u) => ({
        text: u.text,
        phones: [],
        start: u.start + offset,
        end: u.end + offset,
        failed: u.confident === false,
      }))
      const line = buildLineFromUnits(units)
      const mode = /[A-Za-z0-9]/.test(lineText) ? '英文' : '中文'
      setPreview({
        key: 'ctc-align',
        line,
        note: `Zipformer CTC 强制对齐（${mode}模型），绕开识别文本直接 Viterbi`,
      })
    } catch (cause) {
      if (seq !== asyncSeqRef.current) return
      setAsyncError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (seq === asyncSeqRef.current) setAsyncBusy(null)
    }
  }, [vocalsAudio, sampleRate, focusLine, focusWindow, karaokeLines, lineTimes])

  // 试听整行（当前行）
  const playWholeLine = useCallback(() => {
    if (!focusLineObj) return
    const words = focusLineObj.words
    if (words && words.length > 0) {
      onPreview(words[0].timeMs / 1000, (words[words.length - 1].timeMs + 500) / 1000)
    } else if (focusTimeSec !== undefined) {
      onPreview(focusTimeSec, focusTimeSec + 1)
    }
  }, [focusLineObj, focusTimeSec, onPreview])

  const applyPreview = useCallback(() => {
    if (preview?.line?.words && preview.line.words.length > 0 && focusLine !== null) {
      onApplyLine(focusLine, preview.line.words)
      setAppliedKey(preview.key)
    }
  }, [preview, focusLine, onApplyLine])

  if (!open) return null

  const busy = asyncBusy !== null
  const baseDisabled = focusLineObj === undefined || focusTimeSec === undefined || busy
  const lineStartMs =
    focusLine !== null ? (lineTimes[focusLine] ?? focusLineObj?.timeMs) : undefined
  const hasLineTime = lineStartMs !== undefined && lineStartMs > 0

  return (
    <div class="stems__analysis-backdrop" onClick={() => { stopPreviewCb(); onClose() }}>
      <div class="stems__analysis-drawer" onClick={(e) => e.stopPropagation()}>
        <div class="stems__analysis-header">
          <h3 class="stems__analysis-title">修这一行</h3>
          <button
            type="button"
            class="stems__analysis-close"
            aria-label="关闭"
            onClick={() => { stopPreviewCb(); onClose() }}
          >
            ×
          </button>
        </div>
        <div class="stems__analysis-body">
          {/* 聚焦行 + 诊断 + 试听 */}
          {focusLineObj !== undefined && focusStats !== undefined ? (
            <div class="stems__analysis-focus">
              <div class="stems__analysis-focus-top">
                <span class="stems__analysis-focus-time">
                  {focusTimeSec !== undefined ? `[${formatLrcTimestamp(focusTimeSec)}]` : '[--:--.--]'}
                </span>
                <span class="stems__analysis-focus-text">{focusLineObj.text}</span>
                <IosButton size="compact" onClick={playWholeLine} disabled={!focusLineObj}>
                  播整行
                </IosButton>
              </div>
              <p class="stems__analysis-diagnosis">{describeLineIssue(focusStats)}</p>
              <WordChips line={focusLineObj} onPreview={onPreview} />
            </div>
          ) : (
            <p class="stems__analysis-empty">双击歌词轨的某一行以修复其对齐</p>
          )}

          {/* 修复动作 */}
          <section class="stems__analysis-section">
            <h4 class="stems__analysis-section-title">修复动作</h4>
            <div class="stems__analysis-actions-list">
              {/* 即时 */}
              <ActionRow
                label={ACTION_LABELS.spread}
                desc="把行内词均匀摊到行区间，不清识别模型——先让词散开、立刻能听"
                active={false}
                disabled={baseDisabled}
                onClick={handleSpread}
              />
              <ActionRow
                label={ACTION_LABELS['line-times']}
                desc="用窗口内识别段 + 该行行区间重新对齐（旧方案 B 的行级版）"
                active={false}
                disabled={baseDisabled || !hasLineTime}
                onClick={handleLineTimes}
              />
              <ActionRow
                label={ACTION_LABELS.paren}
                desc="括号 ad-lib 不参与对齐，主词单独对齐"
                active={false}
                disabled={baseDisabled || !focusStats?.hasParen}
                onClick={handleParen}
              />
              <ActionRow
                label={ACTION_LABELS.free}
                desc="不锁行区间，用邻近识别段自由匹配（行时间戳不准时用）"
                active={false}
                disabled={baseDisabled}
                onClick={handleFree}
              />
              {/* 异步 */}
              <ActionRow
                label={ACTION_LABELS['rerun-line']}
                desc={`切行窗口用 ${alignModel === 'sense-voice' ? 'SenseVoice（当前）' : 'Zipformer（当前）'} 重新识别`}
                active={asyncBusy === 'rerun-line'}
                progress={asyncBusy === 'rerun-line' ? asyncProgress : null}
                disabled={busy || !vocalsAudio || focusLineObj === undefined}
                onClick={handleRerunLine}
              />
              <ActionRow
                label={ACTION_LABELS['zip-rerun']}
                desc="切行窗口用 Zipformer 重新识别（与当前模型对照）"
                active={asyncBusy === 'zip-rerun'}
                progress={asyncBusy === 'zip-rerun' ? asyncProgress : null}
                disabled={busy || !vocalsAudio || focusLineObj === undefined}
                onClick={handleZipRerun}
              />
              <ActionRow
                label={ACTION_LABELS['ctc-align']}
                desc="Zipformer CTC 强制对齐：绕开识别文本，行窗内 Viterbi（SenseVoice 无此路径）"
                active={asyncBusy === 'ctc-align'}
                progress={asyncBusy === 'ctc-align' ? asyncProgress : null}
                disabled={busy || !vocalsAudio || focusLineObj === undefined || !hasLineTime}
                onClick={() => void handleCtcAlign()}
              />
            </div>
          </section>

          {/* 识别文本（异步动作完成时展示模型听到了什么） */}
          {asyncText && (
            <div class="stems__analysis-recognized">
              <span class="stems__analysis-recognized-label">模型识别到：</span>
              {asyncText}
            </div>
          )}
          {asyncError && <p class="stems__analysis-error">{asyncError}</p>}

          {/* 预览 + 应用/撤销 */}
          {preview && (
            <section class="stems__analysis-section">
              <h4 class="stems__analysis-section-title">修复预览</h4>
              <div class="stems__analysis-preview">
                <div class="stems__analysis-preview-head">
                  <span class="stems__analysis-preview-title">
                    {ACTION_LABELS[preview.key]}
                  </span>
                  {preview.line && (
                    <BadgeFromLine line={preview.line} />
                  )}
                </div>
                {preview.line ? (
                  <>
                    <WordChips line={preview.line} onPreview={onPreview} />
                    <p class="stems__analysis-preview-note">{preview.note}</p>
                    <div class="stems__analysis-actions">
                      <IosButton
                        size="compact"
                        tone="primary"
                        disabled={!preview.line.words || preview.line.words.length === 0 || appliedKey === preview.key}
                        onClick={applyPreview}
                      >
                        {appliedKey === preview.key ? '已应用' : '应用到主界面'}
                      </IosButton>
                      <IosButton
                        size="compact"
                        tone="danger"
                        disabled={!canUndo}
                        onClick={() => {
                          onUndo()
                          setAppliedKey(null)
                        }}
                      >
                        撤销
                      </IosButton>
                    </div>
                  </>
                ) : (
                  <p class="stems__analysis-empty">{preview.note}</p>
                )}
              </div>
            </section>
          )}

          {/* 全部行诊断：次要信息，折叠展示 */}
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

/** 一条修复动作行：名称 + 说明 + 按钮（异步带进度） */
function ActionRow({
  label,
  desc,
  active,
  disabled,
  progress,
  onClick,
}: {
  label: string
  desc: string
  /** 该动作是否为当前正在执行的异步任务（只有它显示进度） */
  active: boolean
  disabled: boolean
  progress?: { chunk: number; total: number } | null
  onClick: () => void
}) {
  return (
    <div class={`stems__analysis-action${disabled ? ' stems__analysis-action--disabled' : ''}`}>
      <div class="stems__analysis-action-head">
        <span class="stems__analysis-action-title">{label}</span>
        <div class="stems__analysis-action-control">
          {active && progress ? (
            <span class="stems__analysis-action-progress">
              {progress.chunk}/{progress.total}
            </span>
          ) : null}
          <IosButton size="compact" tone={disabled ? 'secondary' : 'primary'} disabled={disabled} onClick={onClick}>
            {active ? (progress ? `${Math.round((progress.chunk / progress.total) * 100)}%` : '处理中…') : '修复'}
          </IosButton>
        </div>
      </div>
      <p class="stems__analysis-action-desc">{desc}</p>
    </div>
  )
}

/** 预览行的红词徽章（比当前行红词数） */
function BadgeFromLine({ line }: { line: LyricsLine }) {
  const words = line.words ?? []
  const failed = words.filter((w) => w.failed).length
  if (words.length === 0) return null
  const tone =
    failed === 0
      ? 'stems__analysis-badge--ok'
      : failed / words.length >= 0.5
        ? 'stems__analysis-badge--bad'
        : 'stems__analysis-badge--warn'
  return (
    <span class={`stems__analysis-badge ${tone}`}>
      红词 {failed}/{words.length}
    </span>
  )
}
