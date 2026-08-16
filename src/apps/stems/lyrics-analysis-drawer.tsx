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
import { IosSwitch } from '../../ui/ios-switch.tsx'
import { SegmentedControl } from '../../ui/segmented-control.tsx'
import { formatLrcTimestamp, isPunctuationOnly } from '../align/align-lrc.ts'
import type { HypSegment } from '../align/align-text-dtw.ts'
import type { AlignedUnit } from '../align/align-types.ts'
import { enqueueAiTask } from '../../ai/ai-inference-service.ts'
import type { SenseVoiceProgress } from '../align/sense-voice-worker.ts'
import type { ZipformerAlignLine, ZipformerProgress } from '../align/zipformer-worker.ts'
import type { LyricsLine, LyricsWord } from '../music/music-lyrics.ts'
import { clampStretchRate, timeStretchAudio, type StretchMethod } from './lyrics-time-stretch.ts'
import {
  alignLineByLineTimes,
  alignLineFree,
  alignLineWithoutParens,
  buildLineFromUnits,
  computeLineStats,
  describeLineIssue,
  lineSourceLabel,
  lineWindowSec,
  MANUAL_ACTION_LABELS,
  resolveLineTimes,
  splitLineParens,
  spreadLineToWindow,
  type AlignModel,
  type LineSource,
  type ManualActionKey,
} from './lyrics-analysis.ts'
import {
  buildCtcTrace,
  buildFocusTrace,
  buildGlobalTrace,
  buildLineMappedTrace,
  buildSpreadTrace,
  formatChartDump,
  formatLineTraceDump,
  wordsToTraceWords,
  type TraceChart,
} from './lyrics-trace.ts'
import { LyricsTraceChart } from './lyrics-trace-chart.tsx'

const STEM_CHANNELS = 2

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const el = document.createElement('textarea')
      el.value = text
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(el)
      return ok
    } catch {
      return false
    }
  }
}

/** 歌词识别模型（与主界面一致；定义在 lyrics-analysis，drawer 引用同一来源） */
export type { AlignModel } from './lyrics-analysis.ts'

export type LyricsAnalysisDrawerProps = {
  open: boolean
  onClose: () => void
  focusLine: number | null
  karaokeLines: LyricsLine[]
  /** 每行对齐结果的方案来源（与 karaokeLines 行一一对应；展示当前行用了哪个方案） */
  lineSources: LineSource[]
  lyrics: string
  lyricsLrc: string | null
  phonemes: HypSegment[] | null
  /** 每行补救采用方案的识别段（与 karaokeLines 行一一对应；null 表示该行未被补救采用） */
  rescueSegments: (HypSegment[] | null)[] | null
  /** 每行补救的分数留痕（score=候选分、baselineScore=原行分；复盘 dump 用） */
  rescueStats: ({ score?: number; baselineScore?: number } | null)[] | null
  vocalsAudio: Float32Array | null
  sampleRate: number
  /** 主界面当前歌词识别模型（重识别动作跟随它） */
  alignModel: AlignModel
  /** 试听音频片段 [startSec, endSec) */
  onPreview: (startSec: number, endSec: number) => void
  /** 停止试听（关闭抽屉/切换试听时） */
  onStopPreview: () => void
  /** 试听只播 vocals 轨（模型实际听到的）；关 = 全轨混音 */
  previewVocalsOnly: boolean
  onPreviewVocalsOnlyChange: (checked: boolean) => void
  /** 把某行的新逐字时间戳写回主界面并落盘；source 为该修复动作的方案来源 */
  onApplyLine: (focusLine: number, newWords: LyricsWord[], source: LineSource) => void
  /** 撤销上一次应用 */
  onUndo: () => void
  canUndo: boolean
}

/** 修复动作标识（与 lyrics-analysis 的 ManualActionKey 单一来源一致） */
type ActionKey = ManualActionKey

/** 修复动作中文名（来自 lyrics-analysis 的 MANUAL_ACTION_LABELS，单一来源） */
const ACTION_LABELS: Record<ActionKey, string> = MANUAL_ACTION_LABELS

/** 预览结果：某动作产出的新词条 + 对应的时间连线图 */
type PreviewState = {
  key: ActionKey
  line: LyricsLine | null
  note: string
  trace: TraceChart | null
}

export function LyricsAnalysisDrawer(props: LyricsAnalysisDrawerProps) {
  const {
    open,
    onClose,
    focusLine,
    karaokeLines,
    lineSources,
    lyrics,
    lyricsLrc,
    phonemes,
    rescueSegments,
    rescueStats,
    vocalsAudio,
    sampleRate,
    alignModel,
    onPreview,
    onStopPreview,
    previewVocalsOnly,
    onPreviewVocalsOnlyChange,
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

  // 聚焦行的行区间起止（秒）：与按行时间戳动作一致（末行 +1s 兜底）
  const focusRowSpan = useMemo(() => {
    if (focusLine === null) return null
    const start = lineTimes[focusLine] ?? focusLineObj?.timeMs
    if (start === undefined) return null
    const startSec = start / 1000
    const endSec =
      lineTimes[focusLine + 1] !== undefined
        ? (lineTimes[focusLine + 1] as number) / 1000
        : startSec + 1
    return { startSec, endSec }
  }, [focusLine, lineTimes, focusLineObj])

  // 聚焦行的时间连线图：管线重跑（引擎当时怎么做）+（若被改过）当前结果层
  const focusTrace = useMemo(() => {
    if (focusLine === null || !focusLineObj || focusRowSpan === null || focusWindow === null) {
      return null
    }
    return buildFocusTrace(
      phonemes,
      focusLineObj.text,
      focusRowSpan.startSec,
      focusRowSpan.endSec,
      focusWindow,
      focusLineObj.words,
      rescueSegments?.[focusLine] ?? null,
    )
  }, [focusLine, focusLineObj, focusRowSpan, focusWindow, phonemes, rescueSegments])

  // 聚焦行真锚点比例（来自追踪首层：标点不算词；refIndex>=0 = 真匹配到识别）
  const focusAnchors = useMemo(() => {
    const layer = focusTrace?.layers[0]
    if (!layer) return undefined
    const words = layer.words.filter((w) => !isPunctuationOnly(w.text))
    if (words.length === 0) return undefined
    return {
      matched: words.filter((w) => w.refIndex >= 0).length,
      total: words.length,
    }
  }, [focusTrace])

  // 预览 / 异步状态
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [appliedKey, setAppliedKey] = useState<string | null>(null)
  const [asyncBusy, setAsyncBusy] = useState<ActionKey | null>(null)
  const [asyncError, setAsyncError] = useState<string | null>(null)
  const [asyncProgress, setAsyncProgress] = useState<{ chunk: number; total: number } | null>(null)
  const [asyncText, setAsyncText] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [previewCopyState, setPreviewCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [recognizedCopyState, setRecognizedCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [allLinesCopyState, setAllLinesCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const asyncSeqRef = useRef(0)

  // 放慢重识别实验参数：跨聚焦行保留，不随行切换重置
  const [stretchRate, setStretchRate] = useState(0.7)
  const [stretchMethod, setStretchMethod] = useState<StretchMethod>('wsola')
  const [stretchModel, setStretchModel] = useState<AlignModel>(alignModel)

  // 切换聚焦行/关闭时清空预览与在途任务状态
  useEffect(() => {
    setPreview(null)
    setAppliedKey(null)
    setAsyncBusy(null)
    setAsyncError(null)
    setAsyncProgress(null)
    setAsyncText(null)
    setCopyState('idle')
    setPreviewCopyState('idle')
    setRecognizedCopyState('idle')
    setAllLinesCopyState('idle')
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
    const trace = buildSpreadTrace(
      phonemes ?? [],
      focusWindow,
      focusLineObj.words ?? [],
      line.words ?? [],
    )
    setPreview({
      key: 'spread',
      line,
      note: `按行区间 ${formatLrcTimestamp(focusWindow.startSec)}–${formatLrcTimestamp(focusWindow.endSec)} 均匀摊开（插值词保持红词）`,
      trace,
    })
  }, [focusLineObj, focusWindow, phonemes])

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
    const trace = buildLineMappedTrace(
      phonemes ?? [],
      focusLineObj.text,
      startMs / 1000,
      (lineTimes[focusLine + 1] ?? startMs) / 1000,
      focusWindow,
    )
    setPreview({
      key: 'line-times',
      line,
      note: '用窗口内识别段 + 该行行区间重新对齐',
      trace,
    })
  }, [focusLine, focusLineObj, lineTimes, phonemes, focusWindow])

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
    const windowSegs = (phonemes ?? []).filter(
      (s) => s.end >= focusWindow.startSec && s.start <= focusWindow.endSec,
    )
    const trace = buildGlobalTrace(windowSegs, splitLineParens(focusLineObj.text).mainText, focusWindow)
    setPreview({
      key: 'paren',
      line: mainLine,
      note:
        adlibTexts.length > 0
          ? `括号 ad-lib 不参与对齐：${adlibTexts.join(' / ')}`
          : '此行无括号，主词直接对齐',
      trace,
    })
  }, [focusLineObj, focusWindow, phonemes])

  const handleFree = useCallback(() => {
    if (!focusLineObj || focusWindow === null || focusTimeSec === undefined) return
    setAppliedKey(null)
    setAsyncError(null)
    const center = focusTimeSec + (focusWindow.endSec - focusWindow.startSec) / 2
    const line = alignLineFree(phonemes ?? [], focusLineObj.text, center)
    const windowSegs = (phonemes ?? []).filter(
      (s) => s.end >= center - 8 && s.start <= center + 8,
    )
    const trace = buildGlobalTrace(windowSegs, focusLineObj.text, focusWindow)
    setPreview({
      key: 'free',
      line,
      note: '不锁行区间，用邻近识别段自由匹配（行时间戳不可靠时用）',
      trace,
    })
  }, [focusLineObj, focusWindow, focusTimeSec, phonemes])

  // —— 异步动作：切行窗口识别 ——
  const runRecognize = useCallback(
    async (key: 'rerun-line' | 'zip-rerun', model: AlignModel) => {
      if (!vocalsAudio || sampleRate <= 0 || focusLine === null || focusWindow === null) return
      const lineText = karaokeLines[focusLine]?.text
      if (!lineText) return
      // 手动「Zipformer 识别这一行」命中补救缓存段时直接复用（跳过模型调用）；
      // 缓存段在 runRescuePass 已偏移回全局轴，可直接对齐
      const cached = key === 'zip-rerun' ? (rescueSegments?.[focusLine] ?? null) : null
      const a = Math.floor(focusWindow.startSec * sampleRate) * STEM_CHANNELS
      const b = Math.min(vocalsAudio.length, Math.ceil(focusWindow.endSec * sampleRate) * STEM_CHANNELS)
      if (a >= b && !(cached && cached.length > 0)) {
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
        let shifted: HypSegment[]
        if (cached && cached.length > 0) {
          shifted = cached
          setAsyncText('（复用补救识别段，跳过模型调用）')
        } else {
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
          shifted = segments.map((s) => ({ ...s, start: s.start + offset, end: s.end + offset }))
        }
        const startMs = lineTimes[focusLine] ?? Math.round(focusWindow.startSec * 1000)
        const line = alignLineByLineTimes(shifted, lineText, startMs, lineTimes[focusLine + 1])
        const trace = buildLineMappedTrace(
          shifted,
          lineText,
          startMs / 1000,
          (lineTimes[focusLine + 1] ?? startMs) / 1000,
          focusWindow,
        )
        setPreview({
          key,
          line,
          note:
            cached && cached.length > 0
              ? `复用补救识别段（跳过模型调用）：用候选段重新对齐行窗 ${formatLrcTimestamp(focusWindow.startSec)}–${formatLrcTimestamp(focusWindow.endSec)}`
              : `${model === 'zipformer' ? 'Zipformer' : 'SenseVoice'} 识别行窗口 ${formatLrcTimestamp(focusWindow.startSec)}–${formatLrcTimestamp(focusWindow.endSec)}：锚点保持识别时间，未匹配字在锚点间插值；没对上内容的识别块按其位置钉时间（标红）`,
          trace,
        })
      } catch (cause) {
        if (seq !== asyncSeqRef.current) return
        setAsyncError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (seq === asyncSeqRef.current) setAsyncBusy(null)
      }
    },
    [vocalsAudio, sampleRate, focusLine, focusWindow, karaokeLines, lineTimes, rescueSegments],
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
      const trace = buildCtcTrace(
        phonemes ?? [],
        focusWindow,
        wordsToTraceWords(line?.words ?? [], focusWindow.endSec),
      )
      setPreview({
        key: 'ctc-align',
        line,
        note: `Zipformer CTC 强制对齐（${mode}模型），绕开识别文本直接 Viterbi`,
        trace,
      })
    } catch (cause) {
      if (seq !== asyncSeqRef.current) return
      setAsyncError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (seq === asyncSeqRef.current) setAsyncBusy(null)
    }
  }, [vocalsAudio, sampleRate, focusLine, focusWindow, karaokeLines, lineTimes, phonemes])

  // —— 异步动作：放慢后重识别这一行 ——
  // 先保调放慢（rate<1，WSOLA / Phase Vocoder 二选一），把快嘴拉回模型训练分布，
  // 再用所选模型识别；识别段时间戳从放慢轴映射回原轴（× rate）再加窗口偏移回全局轴。
  const handleSlowRecognize = useCallback(async () => {
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
    const rate = clampStretchRate(stretchRate)
    const stretched = timeStretchAudio(slice, sampleRate, rate, stretchMethod)
    const seq = ++asyncSeqRef.current
    setAsyncBusy('slow-recognize')
    setAsyncError(null)
    setAsyncProgress(null)
    setAsyncText(null)
    setAppliedKey(null)
    setPreview(null)
    try {
      const modelId = stretchModel === 'zipformer' ? 'align-zipformer' : 'align-sense-voice'
      const { segments, text } = await enqueueAiTask<
        ZipformerProgress | SenseVoiceProgress,
        { segments: HypSegment[]; text: string }
      >(
        modelId,
        { type: 'recognize', audio: stretched, sampleRate },
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
      // 放慢轴时间戳 → 原轴（× rate）→ 全局轴（+ 窗口起点）
      const offset = focusWindow.startSec
      const shifted = segments.map((s) => ({
        ...s,
        start: s.start * rate + offset,
        end: s.end * rate + offset,
      }))
      const startMs = lineTimes[focusLine] ?? Math.round(focusWindow.startSec * 1000)
      const line = alignLineByLineTimes(shifted, lineText, startMs, lineTimes[focusLine + 1])
      const trace = buildLineMappedTrace(
        shifted,
        lineText,
        startMs / 1000,
        (lineTimes[focusLine + 1] ?? startMs) / 1000,
        focusWindow,
      )
      setPreview({
        key: 'slow-recognize',
        line,
        note: `${stretchMethod === 'wsola' ? 'WSOLA' : 'Phase Vocoder'} 放慢 ${Math.round(rate * 100)}% 后用 ${stretchModel === 'zipformer' ? 'Zipformer' : 'SenseVoice'} 重识别（时间戳已映射回原轴）`,
        trace,
      })
    } catch (cause) {
      if (seq !== asyncSeqRef.current) return
      setAsyncError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (seq === asyncSeqRef.current) setAsyncBusy(null)
    }
  }, [vocalsAudio, sampleRate, focusLine, focusWindow, karaokeLines, lineTimes, stretchRate, stretchMethod, stretchModel])

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

/** 复盘行文案：原行分 → 补救分（来源徽章已展示方案，这里只补分数与结论） */
function rescueReviewNote(
  source: LineSource | undefined,
  stats: { score?: number; baselineScore?: number } | null,
): string | undefined {
  if (!stats) return undefined
  const fmt = (v: number | undefined): string => (v === undefined ? '--' : v.toFixed(2))
  const scheme = source?.split(':')[0]
  if (scheme === 'rescue-failed') {
    return `原行分 ${fmt(stats.baselineScore)}，候选未优于原行或模型无结果 → 保持原行`
  }
  if (scheme === 'rescue-recognize' || scheme === 'rescue-ctc' || scheme === 'rescue-partial') {
    const conclusion =
      scheme === 'rescue-partial'
        ? '（部分成功，仍有红词）'
        : scheme === 'rescue-recognize'
          ? '（方案1 识别）'
          : '（方案2 CTC）'
    return `原行分 ${fmt(stats.baselineScore)} → 补救分 ${fmt(stats.score)}${conclusion}`
  }
  return undefined
}

  const copyLineDump = useCallback(() => {
    if (focusLine === null || !focusLineObj || !focusTrace || !focusStats) return
    const nextLine = karaokeLines[focusLine + 1]
    const text = formatLineTraceDump({
      lineIndex: focusLine,
      lineText: focusLineObj.text,
      nextLineText: nextLine?.text,
      diagnosis: describeLineIssue(
        focusStats,
        focusAnchors,
        focusLine !== null ? lineSources[focusLine] : undefined,
      ),
      rescueNote: rescueReviewNote(
        lineSources[focusLine],
        rescueStats?.[focusLine] ?? null,
      ),
      lineStartSec: focusRowSpan?.startSec,
      lineEndSec: focusRowSpan?.endSec,
      currentWords: focusLineObj.words,
      chart: focusTrace,
      previewTitle: preview ? ACTION_LABELS[preview.key] : undefined,
      previewNote: preview?.note,
      previewChart: preview?.trace ?? undefined,
    })
    void copyText(text).then((ok) => {
      setCopyState(ok ? 'copied' : 'failed')
      window.setTimeout(() => setCopyState('idle'), 1600)
    })
  }, [focusLine, focusLineObj, focusTrace, focusAnchors, focusStats, karaokeLines, focusRowSpan, preview, lineSources, rescueStats])

  /** 复制当前修复预览的追踪数据（动作名 + note + 预览图 dump） */
  const copyPreviewDump = useCallback(() => {
    if (!preview?.trace) return
    const lines = [`修复预览（${ACTION_LABELS[preview.key]}）`]
    if (preview.note) lines.push(preview.note)
    lines.push('')
    lines.push(formatChartDump(preview.trace))
    const text = `${lines.join('\n')}\n`
    void copyText(text).then((ok) => {
      setPreviewCopyState(ok ? 'copied' : 'failed')
      window.setTimeout(() => setPreviewCopyState('idle'), 1600)
    })
  }, [preview])

  /** 复制异步重识别的「模型识别到」文本 */
  const copyRecognizedDump = useCallback(() => {
    if (!asyncText) return
    const text = `模型识别到：${asyncText}\n`
    void copyText(text).then((ok) => {
      setRecognizedCopyState(ok ? 'copied' : 'failed')
      window.setTimeout(() => setRecognizedCopyState('idle'), 1600)
    })
  }, [asyncText])

  /** 复制全部行诊断摘要（时间 + 文本 + 徽章） */
  const copyAllLinesDump = useCallback(() => {
    if (lineStats.length === 0) return
    const rows = lineStats.map((st) => {
      const badges: string[] = []
      if (st.hasParen) badges.push('括号')
      if (st.squeezed) badges.push('挤压')
      if (st.failedCount > 0) badges.push(`红词 ${st.failedCount}`)
      const time = st.timeSec !== undefined ? `[${formatLrcTimestamp(st.timeSec)}]` : '[--:--.--]'
      const badgeStr = badges.length > 0 ? `  ${badges.join('，')}` : ''
      return `#${st.lineIndex + 1}  ${time}  ${st.text}${badgeStr}`
    })
    const text = `全部行诊断（${lineStats.length} 行）\n${rows.join('\n')}\n`
    void copyText(text).then((ok) => {
      setAllLinesCopyState(ok ? 'copied' : 'failed')
      window.setTimeout(() => setAllLinesCopyState('idle'), 1600)
    })
  }, [lineStats])

  const applyPreview = useCallback(() => {
    if (preview?.line?.words && preview.line.words.length > 0 && focusLine !== null) {
      // rerun-line 跟随当前主模型；slow-recognize 带所选实验模型；其余动作恒为 Zipformer
      const source: LineSource =
        preview.key === 'rerun-line'
          ? `manual-rerun-line:${alignModel}`
          : preview.key === 'slow-recognize'
            ? `manual-slow-recognize:${stretchModel}`
            : `manual-${preview.key}`
      onApplyLine(focusLine, preview.line.words, source)
      setAppliedKey(preview.key)
    }
  }, [preview, focusLine, onApplyLine, alignModel, stretchModel])

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
                {focusLine !== null && (
                  <span class="stems__analysis-badge stems__analysis-badge--source">
                    {lineSourceLabel(lineSources[focusLine])}
                  </span>
                )}
                <span class="stems__analysis-focus-text">{focusLineObj.text}</span>
                <IosButton size="compact" onClick={playWholeLine} disabled={!focusLineObj}>
                  播整行
                </IosButton>
                <IosButton size="compact" onClick={copyLineDump} disabled={!focusTrace}>
                  {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制这一行'}
                </IosButton>
              </div>
              <label class="stems__analysis-vocals-only">
                <span>试听只播人声（模型听到的）</span>
                <IosSwitch
                  checked={previewVocalsOnly}
                  onChange={onPreviewVocalsOnlyChange}
                  label="试听只播人声"
                />
              </label>
              <p class="stems__analysis-diagnosis">
                {describeLineIssue(
                  focusStats,
                  focusAnchors,
                  focusLine !== null ? lineSources[focusLine] : undefined,
                )}
              </p>
              {focusTrace && <LyricsTraceChart chart={focusTrace} onPreview={onPreview} />}
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

          {/* 放慢重识别（实验）：先保调放慢再识别，对照快嘴 rap 的语速分布外问题 */}
          <section class="stems__analysis-section">
            <h4 class="stems__analysis-section-title">放慢重识别（实验）</h4>
            <div class="stems__analysis-stretch-params">
              <div class="stems__analysis-stretch-row">
                <span class="stems__analysis-stretch-label">速度</span>
                <SegmentedControl
                  value={String(stretchRate)}
                  items={[0.5, 0.6, 0.7, 0.8, 0.9].map((r) => ({
                    id: String(r),
                    label: `${Math.round(r * 100)}%`,
                  }))}
                  onChange={(id) => setStretchRate(Number(id))}
                  ariaLabel="放慢速度"
                />
              </div>
              <div class="stems__analysis-stretch-row">
                <span class="stems__analysis-stretch-label">算法</span>
                <SegmentedControl
                  value={stretchMethod}
                  items={[
                    { id: 'wsola' as const, label: 'WSOLA' },
                    { id: 'phase-vocoder' as const, label: 'Phase Vocoder' },
                  ]}
                  onChange={setStretchMethod}
                  ariaLabel="放慢算法"
                />
              </div>
              <div class="stems__analysis-stretch-row">
                <span class="stems__analysis-stretch-label">模型</span>
                <SegmentedControl
                  value={stretchModel}
                  items={[
                    { id: 'sense-voice' as const, label: 'SenseVoice' },
                    { id: 'zipformer' as const, label: 'Zipformer' },
                  ]}
                  onChange={setStretchModel}
                  ariaLabel="识别模型"
                />
              </div>
            </div>
            <div class="stems__analysis-actions">
              <IosButton
                tone="primary"
                disabled={busy || !vocalsAudio || focusLineObj === undefined}
                onClick={() => void handleSlowRecognize()}
              >
                {asyncBusy === 'slow-recognize'
                  ? asyncProgress
                    ? `${Math.round((asyncProgress.chunk / asyncProgress.total) * 100)}%`
                    : '处理中…'
                  : '放慢并重识别'}
              </IosButton>
            </div>
            <p class="stems__analysis-stretch-hint">
              先保调放慢（音高不变）再识别：快嘴语速超出模型训练分布，放慢后拉回分布内；时间戳自动映射回原轴。放慢只用于识别，试听仍是原速。
            </p>
          </section>

          {/* 识别文本（异步动作完成时展示模型听到了什么） */}
          {asyncText && (
            <div class="stems__analysis-recognized">
              <div class="stems__analysis-recognized-head">
                <span class="stems__analysis-recognized-label">模型识别到：</span>
                <IosButton size="compact" onClick={copyRecognizedDump}>
                  {recognizedCopyState === 'copied' ? '已复制' : recognizedCopyState === 'failed' ? '复制失败' : '复制识别'}
                </IosButton>
              </div>
              <div class="stems__analysis-recognized-text">{asyncText}</div>
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
                  <div class="stems__analysis-preview-actions">
                    {preview.line && (
                      <BadgeFromLine line={preview.line} />
                    )}
                    <IosButton size="compact" onClick={copyPreviewDump} disabled={!preview.trace}>
                      {previewCopyState === 'copied' ? '已复制' : previewCopyState === 'failed' ? '复制失败' : '复制预览'}
                    </IosButton>
                  </div>
                </div>
                {preview.line ? (
                  <>
                    {preview.trace && <LyricsTraceChart chart={preview.trace} onPreview={onPreview} />}
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
              <span>全部行诊断（{lineStats.length} 行）</span>
              <IosButton
                size="compact"
                onClick={(event) => {
                  event.stopPropagation()
                  event.preventDefault()
                  copyAllLinesDump()
                }}
              >
                {allLinesCopyState === 'copied' ? '已复制' : allLinesCopyState === 'failed' ? '复制失败' : '复制诊断'}
              </IosButton>
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
