import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { IosButton } from '../../ui/ios-button.tsx'
import { SegmentedControl } from '../../ui/segmented-control.tsx'
import { useSystemOpenDialog } from '../../window/system-open-dialog.tsx'
import { isModelCached, MDX_MODEL_URL } from '../../os/model-cache.ts'
import { resolveNodeByAbsolutePath, readFileBlob } from '../files/files-vfs.ts'
import { filesOpenStreamWrite, filesReadBlobRange, filesReadText } from '../files/files-api.ts'
import {
  computeWaveformPeaks,
  computeWaveformPeaksFromPyramid,
  STEM_CHANNELS,
  STEM_TARGET_SAMPLE_RATE,
  waveformPyramidLayout,
} from './stems-separator.ts'
import type { WaveformPyramid } from './stems-separator.ts'
import { STEM_COLORS, STEM_IDS, STEM_LABELS } from './stems-types.ts'
import type { StemAudio, StemEngineProvider, StemId, StemProgress } from './stems-types.ts'
import {
  readStemsArchiveLayoutRanged,
  saveStemsArchive,
  stemsArchivePathFor,
  type PhonemeSegment,
} from './stems-persistence.ts'
import { enqueueAiTask } from '../../ai/ai-inference-service.ts'
import { WindowModal } from '../../window/window-modal.tsx'
import { alignSegmentsToLrc } from '../align/align-pipeline.ts'
import { stripLrcMarkup } from '../align/pinyin-g2p.ts'
import { looksLikeBrokenLrc } from '../align/align-lrc.ts'
import type { HypSegment } from '../align/align-text-dtw.ts'
import type { ZipformerProgress } from '../align/zipformer-worker.ts'
import type { SenseVoiceProgress } from '../align/sense-voice-worker.ts'
import { parseLrc } from '../music/music-lyrics.ts'
import type { LyricsLine } from '../music/music-lyrics.ts'
import { computeActiveWordIndex } from '../music/music-visualizer-math.ts'
import type { MdxVocalProgress } from './mdx-vocal-worker.ts'
import TempoWorker from './tempo-worker.ts?worker'
import type { TempoWorkerResponse } from './tempo-worker.ts'
import StemsArchiveWorker from './stems-archive-worker.ts?worker'
import type {
  StemsArchiveWorkerRequest,
  StemsArchiveWorkerResponse,
} from './stems-archive-worker.ts'
import type { TempoInfo } from './stems-tempo.ts'
import './stems.css'

type StemTrackState = {
  audio: StemAudio
  mute: boolean
  solo: boolean

  volume: number
}

const WAVEFORM_BUCKETS = 200
/** 波形横向缩放下可见窗口的最短时长（秒） */
const MIN_VIEW_SEC = 0.5

/** 歌词对齐模型：zipformer（中文）/ sense-voice（五语） */
type AlignModel = 'zipformer' | 'sense-voice'
const ALIGN_MODEL_STORAGE_KEY = 'stems-align-model'

/** 歌词时间轴标签：由对齐结果逐字拍平（无逐字时整行一个标签） */
type LyricTag = {
  lineIndex: number
  wordIndex: number
  text: string
  timeSec: number
}

/**
 * 按当前 mute/solo/volume 把每轨增益即时写到已连接的 GainNode。
 * 有 solo 时仅 solo 轨出声（mute 优先生效）；无 solo 时 mute 轨静音。
 * 播放中切换 M/S/音量都能立刻生效，无需重启播放。
 */
function applyGains(gainNodes: Map<StemId, GainNode>, tracks: StemTrackState[] | null): void {
  if (!tracks) return
  const anySolo = tracks.some((t) => t.solo)
  for (const track of tracks) {
    const gain = gainNodes.get(track.audio.stemId)
    if (!gain) continue
    gain.gain.value = anySolo
      ? track.solo && !track.mute
        ? track.volume
        : 0
      : track.mute
        ? 0
        : track.volume
  }
}

/**
 * 在 ctx 时间线指定时刻合成一个节拍器 click：square 振荡器 + 40ms 指数衰减。
 * 每 4 拍一重音（高一个八度、响度更高），模拟强弱拍；实际响度由传入的
 * 共享 GainNode（metronomeGainRef，已设好节拍器音量）统一控制。
 * 返回 { stop }：发声前调用可取消该 click（暂停/seek/关闭声音时 flush 用）。
 */
function scheduleMetronomeClick(
  ctx: AudioContext,
  time: number,
  accent: boolean,
  gain: GainNode,
): { stop: () => void } {
  const osc = ctx.createOscillator()
  const node = ctx.createGain()
  osc.type = 'square'
  osc.frequency.value = accent ? 1760 : 1320
  const peak = accent ? 1 : 0.7
  node.gain.setValueAtTime(0, time)
  node.gain.linearRampToValueAtTime(peak, time + 0.002)
  node.gain.exponentialRampToValueAtTime(0.0001, time + 0.04)
  osc.connect(node)
  node.connect(gain)
  osc.start(time)
  osc.stop(time + 0.05)
  return {
    stop: () => {
      try {
        osc.stop()
      } catch {
        // 已停止（发声结束）或从未 start
      }
      osc.disconnect()
      node.disconnect()
    },
  }
}

export function StemsApp({ windowId }: { windowId?: string }) {
  const { activeWindowId } = useOs()
  const { showSystemOpenDialog, dialog: systemDialog } = useSystemOpenDialog()
  const [sourceName, setSourceName] = useState('')
  const [progress, setProgress] = useState<StemProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tracks, setTracks] = useState<StemTrackState[] | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  /** 分轨结果的采样率（模型固定输出 44.1kHz，播放/导出必须用它而不是源文件采样率） */
  const [stemSampleRate, setStemSampleRate] = useState(STEM_TARGET_SAMPLE_RATE)
  const [provider, setProvider] = useState<StemEngineProvider | null>(null)
  const [gpuAvailable, setGpuAvailable] = useState<boolean | null>(null)
  const [modelCached, setModelCached] = useState<boolean | null>(null)
  const [mdxCached, setMdxCached] = useState<boolean | null>(null)
  /** 正在保存分轨压缩包（当前已存轨数，null = 未在保存） */
  const [saveProgress, setSaveProgress] = useState<number | null>(null)
  /** 正在载入分轨压缩包 */
  const [loadingArchive, setLoadingArchive] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  /** 波形横向缩放：level=0 显示全曲，每 +1 可见窗口减半；start 为窗口起点（秒） */
  const [view, setView] = useState({ start: 0, level: 0 })
  /** 级联分轨流程的取消控制器：重新分轨 / 卸载时 abort 在途任务（调度器负责释放模型） */
  const separateAbortRef = useRef<AbortController | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  /** 分轨结果一次性转换并缓存的 AudioBuffer，播放时零拷贝复用（不再每次全量复制 PCM） */
  const buffersRef = useRef<Map<StemId, AudioBuffer> | null>(null)
  /** 每轨波形峰值金字塔：缩放/绘制只按桶聚合，不再逐采样遍历（避免缩放卡顿） */
  const peaksRef = useRef<Map<StemId, WaveformPyramid> | null>(null)
  /** 播放中的每轨 GainNode（mute/solo/音量即时生效） */
  const gainNodesRef = useRef<Map<StemId, GainNode>>(new Map())
  /** 后台解码序号：重新分轨/卸载时递增，使在途的后台解码结果作废（防竞态覆盖） */
  const loadArchiveSeqRef = useRef(0)
  /** 分轨压缩包解码 worker（懒创建、复用、卸载时 terminate） */
  const archiveWorkerRef = useRef<Worker | null>(null)
  /** 会话内解码缓存（仅保留最新一首，控制内存）：二次打开同一首歌跳过 Worker 解码 */
  const decodeCacheRef = useRef<{
    path: string
    createdAt: number
    byteSize: number
    stems: StemAudio[]
  } | null>(null)
  const bufferSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const startedAtRef = useRef(0)
  /** 本次播放从文件内的起始偏移（秒）：定时器回写进度必须加上它，否则 seek/恢复播放后进度条会从 0 重新数 */
  const startOffsetRef = useRef(0)
  const sourcePathRef = useRef<string | null>(null)
  /** 源文件绝对路径（保存/检测分轨压缩包用；拖入的文件为 null） */
  const sourceAbsolutePathRef = useRef<string | null>(null)
  /** 级联分轨阶段 1（MDX-NET 提人声）状态：busy / 块进度 / 实际执行后端 */
  const [mdxBusy, setMdxBusy] = useState(false)
  const [mdxProgress, setMdxProgress] = useState<{ done: number; total: number } | undefined>(undefined)
  const [mdxProvider, setMdxProvider] = useState<StemEngineProvider | null>(null)
  /** 当前阶段首个块到达时刻（performance.now() 时间线）：用于按块速率估算结束时刻 */
  const chunkPhaseStartedAtRef = useRef<number | undefined>(undefined)
  /** 预计完成时刻（performance.now() 时间线）；块之间按墙钟倒计时递减，不再重算 */
  const etaAtRef = useRef<number | undefined>(undefined)
  /** 剩余时间（毫秒）：块之间由 interval 按墙钟递减刷新 */
  const [etaRemainingMs, setEtaRemainingMs] = useState<number | undefined>(undefined)
  /** 分段节拍检测结果与状态 */
  const [tempo, setTempo] = useState<TempoInfo | null>(null)
  const [tempoDetecting, setTempoDetecting] = useState(false)
  /** 供 saveCurrentStems 无依赖读取的最新 tempo（持久化时用） */
  const tempoRef = useRef<TempoInfo | null>(null)
  /** 节拍检测 worker（懒创建、复用、卸载时 terminate） */
  const tempoWorkerRef = useRef<Worker | null>(null)
  /** 检测请求序号：陈旧响应不覆盖新结果 */
  const tempoReqSeqRef = useRef(0)

  // —— 歌词对齐 ——
  /** 歌词原文（用户粘贴/载入；随对齐流程被 stripLrcMarkup 清洗后使用） */
  const [lyrics, setLyrics] = useState('')
  const lyricsRef = useRef('')
  /** 歌词来源名（自动载入 / 手动载入的文件名，非空时展示） */
  const [lyricsSourceName, setLyricsSourceName] = useState('')
  /** 歌词对齐结果（增强 LRC；随 .stems.zip 持久化，重开恢复） */
  const [alignedLrc, setAlignedLrc] = useState('')
  const alignedLrcRef = useRef('')
  /** 人声轨音素识别结果（随 .stems.zip 持久化；换歌词时复用，跳过重新识别） */
  const phonemesRef = useRef<PhonemeSegment[] | null>(null)
  /** 歌词对齐是否进行中 */
  const [alignBusy, setAlignBusy] = useState(false)
  /** 歌词识别模型选择：zipformer（中文）/ sense-voice（五语），localStorage 记忆 */
  const [alignModel, setAlignModel] = useState<AlignModel>(() => {
    const raw = localStorage.getItem(ALIGN_MODEL_STORAGE_KEY)
    return raw === 'sense-voice' ? 'sense-voice' : 'zipformer'
  })
  const changeAlignModel = useCallback((model: AlignModel) => {
    setAlignModel(model)
    try {
      localStorage.setItem(ALIGN_MODEL_STORAGE_KEY, model)
    } catch {
      // localStorage 不可用时仅会话内生效
    }
  }, [])
  /** 歌词识别块进度 */
  const [alignProgress, setAlignProgress] = useState<{ chunk: number; total: number } | null>(null)
  /** 歌词对齐错误信息 */
  const [alignError, setAlignError] = useState<string | null>(null)
  /** 本次对齐结果是否从 .stems.zip 恢复（展示「已恢复」徽章） */
  const [alignRestoredFrom, setAlignRestoredFrom] = useState(false)
  /** 歌词提示（无歌词 / 歌词已修改需重新对齐等） */
  const [lyricsHint, setLyricsHint] = useState<string | null>(null)
  /** 歌词对齐请求序号：重新分轨/换歌时作废在途识别，防竞态覆盖 */
  const alignReqSeqRef = useRef(0)
  /** 编辑歌词模态窗口开关与草稿（保存时应用） */
  const [lyricsEditorOpen, setLyricsEditorOpen] = useState(false)
  const [lyricsDraft, setLyricsDraft] = useState('')
  /** 编辑草稿的来源名（文件/剪贴板导入时设置；保存时随歌词应用） */
  const [lyricsDraftSource, setLyricsDraftSource] = useState('')
  /** 播放中当前高亮的歌词行/词（避免每帧重复写 DOM） */
  const lyricsActiveRef = useRef({ line: -1, word: -1 })
  /** 卡拉OK歌词行（由 alignedLrc 解析；播放中 rAF 直写 DOM 高亮） */
  const lyricsLinesRef = useRef<LyricsLine[]>([])
  /** 歌词行 → 词 span DOM（逐字标签高亮用） */
  const lyricsWordRefsRef = useRef<Map<number, Map<number, HTMLSpanElement>>>(new Map())
  /** 歌词时间轴标签元数据（rAF 找当前行/词用） */
  const lyricTagsRef = useRef<LyricTag[]>([])
  /** 歌词时间轴标签容器（播放头定位用） */
  const lyricsTagsRef = useRef<HTMLDivElement | null>(null)
  /** 歌词轨播放头（与波形播放头同款，直写 left） */
  const lyricsPlayheadRef = useRef<HTMLDivElement | null>(null)
  /** 当前 tracks 的最新值（手动补对齐时读取 vocals 轨） */
  const tracksRef = useRef<StemTrackState[] | null>(null)
  /** 速度条当前段高亮/读数/播放头直写 DOM 用（仿 playheadRefsRef） */
  const tempoSegRefsRef = useRef<Map<number, HTMLDivElement>>(new Map())
  const tempoReadoutRef = useRef<HTMLSpanElement | null>(null)
  const tempoPlayheadRef = useRef<HTMLDivElement | null>(null)
  /** 节拍器脉冲目标：速度行「速度」头格 */
  const tempoNameRef = useRef<HTMLDivElement | null>(null)
  /** 节拍器脉冲目标：lane 内随拍闪烁线 */
  const beatFlashRef = useRef<HTMLDivElement | null>(null)
  const tempoLaneRef = useRef<HTMLDivElement | null>(null)
  const tracksBoxRef = useRef<HTMLDivElement | null>(null)
  /** 速度条 lane 实际像素宽度（ResizeObserver 维护）：块文字显示按像素判断，而非百分比 */
  const [tempoLaneWidthPx, setTempoLaneWidthPx] = useState(0)
  /** 节拍器开关：开启后在速度条显示节拍刻度与随拍脉冲 */
  const [metronomeOn, setMetronomeOn] = useState(false)
  /** 节拍器哒哒声开关：独立于视觉 ♪，仅播放中生效 */
  const [metronomeSoundOn, setMetronomeSoundOn] = useState(false)
  /** 节拍器哒哒声音量（0–1，默认 0.45）：经共享 GainNode 即时生效 */
  const [metronomeVolume, setMetronomeVolume] = useState(0.45)
  /** 节拍器音量最新值（lookahead 调度闭包读取用，避免 effect 依赖 volume 重建） */
  const metronomeVolumeRef = useRef(0.45)
  /** 共享音量 GainNode：所有 click 统一经过它，拖动音量即时改增益 */
  const metronomeGainRef = useRef<GainNode | null>(null)
  /** 已调度未响的 click 停用器：暂停/seek/关闭时逐个取消 */
  const metronomePendingRef = useRef<{ stop: () => void }[]>([])
  /** 调度游标（文件时间线秒）：已调度到哪个拍点，interval tick 从它继续 */
  const metronomeNextSchedRef = useRef(0)
  /** 波形拖拽中：暂停播放定时器回写，松手时才真正定位 */
  const isSeekingRef = useRef(false)
  /** 手动平移后暂时不自动跟随播放头（避免与用户「往回看」打架） */
  const suppressFollowUntilRef = useRef(0)
  /** 迷你滚动条拖拽状态 */
  const minimapDragRef = useRef<{ startX: number; startViewStart: number; onThumb: boolean } | null>(
    null,
  )
  /** 播放时钟直写 DOM 用：播放中 rAF 逐帧更新各轨播放头/时间文本，不经过 React 重渲染 */
  const playheadRefsRef = useRef<Map<StemId, HTMLDivElement>>(new Map())
  const timeLabelRef = useRef<HTMLSpanElement | null>(null)

  /** 最长缩放级别（可见窗口 ≥ MIN_VIEW_SEC；过短的歌不可缩放） */
  const maxZoomLevel =
    duration > 0 ? Math.max(0, Math.floor(Math.log2(duration / MIN_VIEW_SEC))) : 0
  /** 当前可见窗口长度（秒） */
  const viewLen =
    duration > 0
      ? Math.max(MIN_VIEW_SEC, Math.min(duration, duration / Math.pow(2, view.level)))
      : 0

  // 启动时探测 WebGPU 与两个模型的缓存状态（用于提示；实际后端以 worker 汇报为准）
  useEffect(() => {
    setGpuAvailable('gpu' in navigator)
  }, [])
  useEffect(() => {
    void isModelCached().then((cached) => setModelCached(cached))
    void isModelCached(MDX_MODEL_URL).then((cached) => setMdxCached(cached))
  }, [])

  // 维护速度条 lane 像素宽度：块文字按像素宽度判断是否显示
  useEffect(() => {
    const lane = tempoLaneRef.current
    if (!lane) return
    const update = (): void => {
      const w = lane.clientWidth
      if (w > 0) setTempoLaneWidthPx(w)
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(lane)
    return () => observer.disconnect()
  }, [tempo])

  // tracks 同步到 ref（手动补对齐时读取 vocals 轨；state 在异步流程里可能是闭包旧值）
  useEffect(() => {
    tracksRef.current = tracks
  }, [tracks])

  /** 卡拉OK歌词行：由 alignedLrc 解析（含逐字 words）；随对齐结果变化 */
  const karaokeLines = useMemo(() => (alignedLrc ? parseLrc(alignedLrc).lines : []), [alignedLrc])
  useEffect(() => {
    lyricsLinesRef.current = karaokeLines
    lyricsActiveRef.current = { line: -1, word: -1 }
  }, [karaokeLines])

  /** 歌词时间轴标签：逐字拍平成一行（无逐字的行回退整行一个标签；无时间戳行跳过） */
  const lyricTags = useMemo<LyricTag[]>(() => {
    const tags: LyricTag[] = []
    for (let lineIndex = 0; lineIndex < karaokeLines.length; lineIndex++) {
      const line = karaokeLines[lineIndex]
      if (line.timeMs === undefined) continue
      const words = line.words
      if (words && words.length > 0) {
        for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
          const word = words[wordIndex]
          tags.push({ lineIndex, wordIndex, text: word.text, timeSec: word.timeMs / 1000 })
        }
      } else {
        tags.push({ lineIndex, wordIndex: -1, text: line.text, timeSec: line.timeMs / 1000 })
      }
    }
    return tags
  }, [karaokeLines])
  useEffect(() => {
    lyricTagsRef.current = lyricTags
  }, [lyricTags])

  const handleSeparateRef = useRef<() => void>(() => {})
  /** 「重新计算节拍」中转 ref：handler 依赖 detectTempoAsync（定义晚于 menuBar），与 handleSeparateRef 同模式 */
  const handleRedetectTempoRef = useRef<() => void>(() => {})

  /** 取消所有已调度未响的节拍器 click（暂停/seek/关闭声音/重建 AudioContext 时调用） */
  const flushMetronomePending = useCallback(() => {
    const pending = metronomePendingRef.current
    metronomePendingRef.current = []
    for (const p of pending) {
      try {
        p.stop()
      } catch {
        // 节点已结束，忽略
      }
    }
  }, [])

  const stopPlayback = useCallback(() => {
    bufferSourcesRef.current.forEach((source) => {
      try {
        source.stop()
      } catch {
        // already stopped
      }
    })
    bufferSourcesRef.current = []
    gainNodesRef.current.clear()
    flushMetronomePending()
    setPlaying(false)
  }, [flushMetronomePending])

  /**
   * 解码 PCM 并重建 AudioContext（旧 context 及其上的缓存一并清理，
   * 避免每次选文件都泄漏一个 AudioContext）。
   */
  const prepareAudio = useCallback(
    async (arrayBuffer: ArrayBuffer) => {
      stopPlayback()
      if (audioContextRef.current) {
        void audioContextRef.current.close()
      }
      buffersRef.current = null
      peaksRef.current = null
      gainNodesRef.current.clear()
      const audioContext = new AudioContext()
      audioContextRef.current = audioContext
      const decoded = await audioContext.decodeAudioData(arrayBuffer)
      const channelData = decoded.getChannelData(0)
      // 转 interleaved stereo（单声道复制到双声道）
      const interleaved = new Float32Array(decoded.length * 2)
      for (let i = 0; i < decoded.length; i++) {
        const v = channelData[i]
        interleaved[i * 2] = v
        interleaved[i * 2 + 1] = v
      }
      return { interleaved, sampleRate: decoded.sampleRate, duration: decoded.duration }
    },
    [stopPlayback],
  )

  /**
   * 把 7 轨分轨结果一次性转成 AudioBuffer 缓存（含 L/R 去交错），播放时直接复用。
   * 峰值金字塔：传入 `peaks`（v3 包从 peaks.bin 读出）时直接复用，跳过全量扫描；
   * 否则在填 buffer 的同一循环里聚合桶值，避免「先填 buffer 再 buildWaveformPyramid 扫第二遍」。
   */
  const cacheStemBuffers = useCallback(
    (stems: StemAudio[], rate: number, peaks?: Map<StemId, WaveformPyramid>) => {
      const ctx = audioContextRef.current
      const buffers = new Map<StemId, AudioBuffer>()
      const target = peaks ?? new Map<StemId, WaveformPyramid>()
      for (const stem of stems) {
        const data = stem.data
        const frames = Math.floor(data.length / STEM_CHANNELS)
        const { bucketSamples, bucketCount } = waveformPyramidLayout(frames, rate)
        const buffer = ctx ? ctx.createBuffer(2, frames, rate) : null
        const left = buffer?.getChannelData(0)
        const right = buffer?.getChannelData(1)
        if (peaks) {
          // 已有峰值表：仅填 buffer（或仅跳过扫描）
          if (left && right) {
            for (let i = 0; i < frames; i++) {
              left[i] = data[i * STEM_CHANNELS]
              right[i] = data[i * STEM_CHANNELS + 1]
            }
          }
          if (buffer) buffers.set(stem.stemId, buffer)
        } else {
          // 合并遍历：填 buffer 同时聚合金字塔桶值
          const min = new Float32Array(bucketCount)
          const max = new Float32Array(bucketCount)
          for (let f = 0; f < frames; f++) {
            const l = data[f * STEM_CHANNELS]
            const r = data[f * STEM_CHANNELS + 1]
            if (left && right) {
              left[f] = l
              right[f] = r
            }
            const amp = Math.max(Math.abs(l), Math.abs(r))
            const b = Math.floor(f / bucketSamples)
            if (amp > max[b]) max[b] = amp
            const neg = -amp
            if (neg < min[b]) min[b] = neg
          }
          if (buffer) buffers.set(stem.stemId, buffer)
          target.set(stem.stemId, { bucketSamples, bucketCount, min, max })
        }
      }
      buffersRef.current = buffers
      peaksRef.current = target
    },
    [],
  )

  /**
   * 把分轨结果打包为 `<源文件名>.stems.zip` 写入源文件同目录。
   * 手动保存（handleSaveArchive）与分轨/MDX 增强完成后的自动保存共用。
   * 返回是否成功写入（无源绝对路径时返回 false，拖入的文件不自动保存）。
   */
  const saveCurrentStems = useCallback(
    async (stems: StemAudio[]): Promise<boolean> => {
      const sourcePath = sourceAbsolutePathRef.current
      if (!sourcePath) return false
      try {
        // 分轨结果各轨均被裁剪到源文件精确长度（htdemucs 拼接 / MDX 截回原长），
        // 因此用分轨数据推导时长最可靠；state 中的 duration 是异步闭包，可能仍是旧值
        // （分轨完成自动保存发生在 setDuration 之后、新渲染之前的同一次异步流程里）。
        let derivedDurationSec = 0
        for (const stem of stems) {
          const sec = stem.data.length / STEM_CHANNELS / stemSampleRate
          if (sec > derivedDurationSec) derivedDurationSec = sec
        }
        const durationSec = derivedDurationSec > 0 ? derivedDurationSec : duration
        const writer = await filesOpenStreamWrite(stemsArchivePathFor(sourcePath))
        await saveStemsArchive({
          stems,
          sourcePath,
          sourceName,
          durationSec,
          sampleRate: stemSampleRate,
          tempo: tempoRef.current ?? undefined,
          lyrics: lyricsRef.current.trim() ? lyricsRef.current : undefined,
          lyricsSourceName: lyricsRef.current.trim() ? lyricsSourceName || undefined : undefined,
          alignedLrc: alignedLrcRef.current || undefined,
          phonemes: phonemesRef.current ?? undefined,
          sink: {
            write: (chunk) => writer.write(chunk),
            close: () => writer.close(),
          },
          onProgress: (saved) => setSaveProgress(saved),
        })
        return true
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        return false
      } finally {
        setSaveProgress(null)
      }
    },
    [sourceName, lyricsSourceName, duration, stemSampleRate],
  )

  /** 手动保存分轨结果（菜单 / ⌘S）。 */
  const handleSaveArchive = useCallback(async () => {
    if (!tracks) return
    setError(null)
    setSaveProgress(0)
    await saveCurrentStems(tracks.map((t) => t.audio))
  }, [saveCurrentStems, tracks])

  // 顶栏菜单：文件 → 打开 / 重新分轨 / 保存分轨（⌘S）；编辑 → 重新计算节拍
  const menuBar = useMemo<MenuDefinition[]>(() => {
    return [
      {
        label: '文件',
        items: [
          { type: 'action', label: '打开音乐文件…', onClick: () => void handlePickFile() },
          { type: 'separator' },
          {
            type: 'action',
            label: '重新分轨',
            disabled: !sourceName,
            onClick: () => void handleSeparateRef.current(),
          },
          { type: 'separator' },
          {
            type: 'action',
            label:
              saveProgress !== null
                ? `保存分轨中 ${saveProgress}/${STEM_IDS.length}…`
                : '保存分轨',
            shortcut: '⌘S',
            disabled:
              !tracks ||
              saveProgress !== null ||
              loadingArchive ||
              !sourceName ||
              !sourceAbsolutePathRef.current,
            onClick: () => void handleSaveArchive(),
          },
        ],
      },
      {
        label: '编辑',
        items: [
          {
            type: 'action',
            label: tempoDetecting ? '计算节拍中…' : '重新计算节拍',
            disabled: !tracks || tempoDetecting || loadingArchive,
            onClick: () => handleRedetectTempoRef.current(),
          },
        ],
      },
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceName, tracks, saveProgress, loadingArchive, tempoDetecting, handleSaveArchive])
  useAppMenuBar('stems', menuBar)

  // ⌘S 保存分轨：菜单 shortcut 仅展示，实际监听与 pages/textedit 一致
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (windowId && activeWindowId !== windowId) return
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() !== 's' || event.shiftKey || event.altKey) return
      if (!tracks || saveProgress !== null || loadingArchive || !sourceName || !sourceAbsolutePathRef.current) return
      event.preventDefault()
      event.stopPropagation()
      void handleSaveArchive()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [activeWindowId, windowId, tracks, saveProgress, handleSaveArchive, sourceName])

  /**
   * 在轻量 Worker 里对鼓轨做分段节拍检测，结果写状态与 tempoRef。
   * 陈旧响应（检测期间又重新分轨）不覆盖新结果；失败返回 null、不影响主流程。
   */
  const detectTempoAsync = useCallback(
    async (drums: Float32Array, sampleRate: number): Promise<TempoInfo | null> => {
      const reqId = (tempoReqSeqRef.current += 1)
      if (!tempoWorkerRef.current) {
        tempoWorkerRef.current = new TempoWorker()
      }
      const worker = tempoWorkerRef.current
      setTempoDetecting(true)
      return new Promise<TempoInfo | null>((resolve) => {
        const onMessage = (event: MessageEvent<TempoWorkerResponse>): void => {
          const msg = event.data
          if (msg.type !== 'done' && msg.type !== 'error') return
          worker.removeEventListener('message', onMessage)
          const isCurrent = tempoReqSeqRef.current === reqId
          if (msg.type === 'done') {
            if (isCurrent) {
              setTempo(msg.tempo)
              tempoRef.current = msg.tempo
            }
          } else if (isCurrent) {
            console.warn('节拍检测失败', msg.message)
            setTempo(null)
            tempoRef.current = null
          }
          if (isCurrent) setTempoDetecting(false)
          resolve(msg.type === 'done' ? msg.tempo : null)
        }
        worker.addEventListener('message', onMessage)
        worker.postMessage({ type: 'detect', audio: drums, sampleRate })
      })
    },
    [],
  )

  /**
   * 用当前算法对鼓轨重新检测节拍，成功后自动保存存档（新 BPM/相位落盘）。
   * 手动重算入口：打开旧压缩包会直接读存档 tempo，旧算法结果不重算。
   */
  const handleRedetectTempo = useCallback(async () => {
    if (!tracks) return
    const drums = tracks.find((t) => t.audio.stemId === 'drums')
    if (!drums) return
    setError(null)
    const result = await detectTempoAsync(drums.audio.data, stemSampleRate)
    if (result) await saveCurrentStems(tracks.map((t) => t.audio))
  }, [tracks, stemSampleRate, detectTempoAsync, saveCurrentStems])

  useEffect(() => {
    handleRedetectTempoRef.current = () => void handleRedetectTempo()
  }, [handleRedetectTempo])

  /** 清除歌词对齐结果（歌词变更 / 重新分轨时调用）；hint 为清除后的提示文案 */
  const clearAlignedResult = useCallback((hint: string | null) => {
    alignedLrcRef.current = ''
    setAlignedLrc('')
    setAlignRestoredFrom(false)
    setLyricsHint(hint)
  }, [])

  /**
   * 复用已缓存的音素段把歌词快速对齐（纯函数文本对齐，秒级）：
   * 换歌词后不必重跑 Zipformer 识别，直接用旧识别段对齐新歌词。
   * 无音素段或对齐不出结果时返回 false（调用方回退到重新识别）。
   */
  const realignFromPhonemes = useCallback((lyricsText: string): boolean => {
    const phonemes = phonemesRef.current
    if (!phonemes || phonemes.length === 0) return false
    const lrc = alignSegmentsToLrc(phonemes, lyricsText)
    if (!lrc) return false
    alignedLrcRef.current = lrc
    setAlignedLrc(lrc)
    setAlignRestoredFrom(false)
    setLyricsHint(null)
    return true
  }, [])

  /**
   * 歌词对齐：对人声轨跑 CTC 识别（zipformer 中文 / SenseVoice 五语，耗时）→
   * 纯函数文本对齐（快速）生成增强 LRC，写入 alignedLrcRef/state（随 .stems.zip 持久化）。
   * 陈旧响应（重新分轨/换歌）不覆盖新结果；失败提示、不影响主流程。
   * 返回是否成功产出 LRC。
   */
  const alignVocals = useCallback(
    async (audio: Float32Array, sampleRate: number): Promise<boolean> => {
      const reqId = (alignReqSeqRef.current += 1)
      const lyricsText = lyricsRef.current
      if (!lyricsText.trim()) {
        setLyricsHint('请先提供歌词（粘贴或载入 .lrc 歌词文件）再对齐')
        return false
      }
      setAlignBusy(true)
      setAlignProgress(null)
      setAlignError(null)
      setLyricsHint(null)
      try {
        const modelId = alignModel === 'sense-voice' ? 'align-sense-voice' : 'align-zipformer'
        const { segments } = await enqueueAiTask<
          ZipformerProgress | SenseVoiceProgress,
          { segments: HypSegment[]; text: string }
        >(
          modelId,
          { type: 'recognize', audio, sampleRate },
          {
            route: (msg) => {
              if (msg.kind === 'model-loading' || msg.kind === 'model-loaded') {
                return { action: 'continue' }
              }
              if (msg.kind === 'progress') {
                setAlignProgress({ chunk: msg.chunk, total: msg.total })
                return { action: 'continue' }
              }
              if (msg.kind === 'done') {
                return { action: 'resolve', value: { segments: msg.segments, text: msg.text } }
              }
              return { action: 'reject', error: new Error(msg.message) }
            },
          },
        )
        if (alignReqSeqRef.current !== reqId) return false
        phonemesRef.current = segments
        const lrc = alignSegmentsToLrc(segments, lyricsText)
        if (alignReqSeqRef.current !== reqId) return false
        if (!lrc) {
          setAlignError('识别结果为空或歌词无可对齐内容，请重试')
          return false
        }
        alignedLrcRef.current = lrc
        setAlignedLrc(lrc)
        setAlignRestoredFrom(false)
        return true
      } catch (cause) {
        if (alignReqSeqRef.current !== reqId) return false
        setAlignError(cause instanceof Error ? cause.message : String(cause))
        return false
      } finally {
        if (alignReqSeqRef.current === reqId) setAlignBusy(false)
      }
    },
    [alignModel],
  )

  /**
   * 手动补对齐：从当前 tracks 取 vocals 轨对齐，成功后落盘。
   * 供「无歌词分轨完成 → 提供歌词 → 点击对齐歌词」流程使用。
   */
  const handleAlignLyrics = useCallback(async () => {
    const tracksNow = tracksRef.current
    if (!tracksNow) return
    const vocals = tracksNow.find((t) => t.audio.stemId === 'vocals')
    if (!vocals || vocals.audio.data.length === 0) return
    const ok = await alignVocals(vocals.audio.data, stemSampleRate)
    if (ok) void saveCurrentStems(tracksNow.map((t) => t.audio))
  }, [alignVocals, saveCurrentStems, stemSampleRate])

  /**
   * 级联分轨（默认流程），经由系统 AI 推理调度服务串行执行：
   *  阶段 1：MDX-NET 提人声 —— 人声 = 原曲 − 伴奏（专项模型，人声质量高于 htdemucs 6 轨拆分）
   *  阶段 2：把 MDX 输出的伴奏喂给 htdemucs_6s 拆成 6 轨（鼓/贝斯/其他/人声/吉他/钢琴）。
   *  最终：人声用阶段 1 的结果；htdemucs 在伴奏中提取到 vocals 通道的残余不丢弃，
   *        单独作为「其他二」轨保留 —— 全曲播放 = MDX 人声 + htdemucs 全部 6 通道，无任何频率丢失。
   *  调度器保证任意时刻只驻留一个模型：阶段 1 完成后 MDX worker 即被释放，再加载 htdemucs。
   */
  const resetChunkEtaClock = useCallback(() => {
    chunkPhaseStartedAtRef.current = undefined
    etaAtRef.current = undefined
    setEtaRemainingMs(undefined)
  }, [])

  /**
   * 收到一个进度块时，按当前阶段的完成速率估算一次「预计完成时刻」。
   * includeNextPhaseEstimate = true（阶段 1）时，额外假定阶段 2 耗时与阶段 1 推理相近并计入。
   */
  const noteChunkProgress = useCallback(
    (done: number, total: number, includeNextPhaseEstimate: boolean) => {
      if (done <= 0 || total <= 0) return
      const now = performance.now()
      if (chunkPhaseStartedAtRef.current === undefined) {
        chunkPhaseStartedAtRef.current = now
      }
      const elapsed = now - chunkPhaseStartedAtRef.current
      if (elapsed <= 0) return
      const rate = done / elapsed
      if (rate <= 0) return
      const phaseRemainingMs = Math.max(0, (total - done) / rate)
      const remainingMs = includeNextPhaseEstimate
        ? phaseRemainingMs + total / rate
        : phaseRemainingMs
      etaAtRef.current = now + remainingMs
      setEtaRemainingMs(remainingMs)
    },
    [],
  )

  const startSeparation = useCallback(
    async (interleaved: Float32Array, sourceRate: number) => {
      separateAbortRef.current?.abort()
      // 作废在途的后台分轨包解码，避免其结果覆盖本次分轨
      loadArchiveSeqRef.current += 1
      const abort = new AbortController()
      separateAbortRef.current = abort
      setError(null)
      setProgress(null)
      setProvider(null)
      setMdxProvider(null)
      setMdxBusy(true)
      setMdxProgress(undefined)
      resetChunkEtaClock()
      // 重新分轨：清空旧节拍结果，等新鼓轨检测
      setTempo(null)
      tempoRef.current = null
      // 重新分轨：旧对齐结果作废（人声轨已变），歌词输入保留
      clearAlignedResult(null)
      phonemesRef.current = null
      alignReqSeqRef.current += 1

      try {
        // —— 阶段 1：MDX 提人声 ——
        const mdx = await enqueueAiTask<
          MdxVocalProgress,
          { vocals: Float32Array; instrumental: Float32Array; sampleRate: number }
        >(
          'stems-mdx',
          { type: 'separate', audio: interleaved, sampleRate: sourceRate },
          {
            signal: abort.signal,
            route: (msg) => {
              if (msg.kind === 'model-loaded') {
                setMdxProvider(msg.provider)
                return { action: 'continue' }
              }
              if (msg.kind === 'chunk') {
                noteChunkProgress(msg.done, msg.total, true)
                setMdxProgress({ done: msg.done, total: msg.total })
                return { action: 'continue' }
              }
              if (msg.kind === 'done') {
                return {
                  action: 'resolve',
                  value: {
                    vocals: msg.vocals,
                    instrumental: msg.instrumental,
                    sampleRate: msg.sampleRate,
                  },
                }
              }
              if (msg.kind === 'error') {
                return { action: 'reject', error: new Error(msg.message) }
              }
              return { action: 'continue' }
            },
          },
        )
        if (abort.signal.aborted) return

        // —— 阶段 2：伴奏 → htdemucs 6 通道（两模型输入采样率均为 44.1kHz，无需重采样）——
        setMdxBusy(false)
        setMdxProgress(undefined)
        resetChunkEtaClock()
        setProgress({ kind: 'model-loading' })
        setProvider(null)
        const done = await enqueueAiTask<StemProgress, { stems: StemAudio[]; sampleRate: number }>(
          'stems-htdemucs',
          { type: 'separate', audio: mdx.instrumental, sampleRate: mdx.sampleRate },
          {
            signal: abort.signal,
            route: (msg) => {
              if (msg.kind === 'done') {
                return {
                  action: 'resolve',
                  value: { stems: msg.stems, sampleRate: msg.sampleRate },
                }
              }
              if (msg.kind === 'model-loaded') {
                setProvider(msg.provider)
                return { action: 'continue' }
              }
              if (msg.kind === 'error') {
                return { action: 'reject', error: new Error(msg.message) }
              }
              if (msg.kind === 'chunk') {
                noteChunkProgress(msg.index, msg.total, false)
              }
              setProgress(msg)
              return { action: 'continue' }
            },
          },
        )
        if (abort.signal.aborted) return

        // 人声用 MDX 结果；htdemucs 的 vocals 通道（伴奏残余）保留为「其他二」，不丢弃任何频率
        const htdemucsVocals = done.stems.find((s) => s.stemId === 'vocals')
        if (!htdemucsVocals) throw new Error('htdemucs 输出缺少 vocals 轨')
        const stems: StemAudio[] = done.stems.flatMap((s) =>
          s.stemId === 'vocals'
            ? [
                { stemId: 'vocals', data: mdx.vocals },
                { stemId: 'other2', data: htdemucsVocals.data },
              ]
            : [s],
        )
        setStemSampleRate(done.sampleRate)
        cacheStemBuffers(stems, done.sampleRate)
        setTracks(
          stems.map((audio) => ({
            audio,
            mute: false,
            solo: false,
            volume: 1,
          })),
        )
        setPlaying(false)
        setCurrentTime(0)
        setProgress(null)
        resetChunkEtaClock()
        // 分段节拍检测（鼓轨，轻量）：完成后带 tempo 自动保存，下次打开直接读 manifest
        const drums = stems.find((s) => s.stemId === 'drums')
        if (drums) await detectTempoAsync(drums.data, done.sampleRate)
        if (abort.signal.aborted) return
        // 歌词对齐（人声轨）：识别耗时、文本对齐极快，有歌词时随分轨一起做
        const vocals = stems.find((s) => s.stemId === 'vocals')
        if (vocals && lyricsRef.current.trim()) {
          await alignVocals(vocals.data, done.sampleRate)
        } else {
          setLyricsHint('分轨完成，未提供歌词。点击顶部「歌词」按钮粘贴或导入歌词')
        }
        if (abort.signal.aborted) return
        // 自动保存：分轨完成即落盘（有源路径时），下次打开直接载入
        void saveCurrentStems(stems)
      } catch (error) {
        if (abort.signal.aborted) return
        setMdxBusy(false)
        setMdxProgress(undefined)
        setProgress(null)
        resetChunkEtaClock()
        setError(error instanceof Error ? error.message : String(error))
      }
    },
    [
      cacheStemBuffers,
      clearAlignedResult,
      detectTempoAsync,
      noteChunkProgress,
      alignVocals,
      resetChunkEtaClock,
      saveCurrentStems,
    ],
  )

  /**
   * 打开文件时探测同目录的 `<源文件名>.stems.zip`，命中则直接载入已保存的分轨。
   * 两段式：先范围读 manifest + 峰值表出 UI（轨道/波形立即可见），
   * 后台逐轨范围读 + Worker 单轨解码填播放缓冲（不整包进内存）。
   * 压缩包缺失/损坏时返回 false，由调用方走正常分轨流程。
   */
  const tryLoadSavedStems = useCallback(
    async (sourceAbsolutePath: string): Promise<boolean> => {
      const archivePath = stemsArchivePathFor(sourceAbsolutePath)
      const archiveNode = await resolveNodeByAbsolutePath(archivePath)
      if (!archiveNode || archiveNode.kind !== 'file') return false
      setLoadingArchive(true)
      try {
        const archiveSize = archiveNode.byteSize
        const readRange = async (offset: number, length: number): Promise<Uint8Array> => {
          const blob = await filesReadBlobRange(archivePath, offset, length)
          return new Uint8Array(await blob.arrayBuffer())
        }
        const layout = await readStemsArchiveLayoutRanged(readRange, archiveSize)
        const { manifest, peaks } = layout
        const seq = ++loadArchiveSeqRef.current
        // 换新 context：旧文件的分轨缓存与播放一并清理
        stopPlayback()
        if (audioContextRef.current) {
          void audioContextRef.current.close()
        }
        buffersRef.current = null
        peaksRef.current = null
        gainNodesRef.current.clear()
        audioContextRef.current = new AudioContext()
        setDuration(manifest.durationSec)
        setView({ start: 0, level: 0 })
        setStemSampleRate(manifest.sampleRate)
        // —— 第一段：先出 UI —— 占位 tracks（空 PCM），波形由 peaksRef 直接绘制
        peaksRef.current = peaks.size > 0 ? peaks : null
        setTracks(
          STEM_IDS.map((stemId) => ({
            audio: { stemId, data: new Float32Array(0) },
            mute: false,
            solo: false,
            volume: 1,
          })),
        )
        setPlaying(false)
        setCurrentTime(0)
        // —— 第二段：后台逐轨范围读 + Worker 单轨解码（会话内缓存命中则跳过）→ 填播放缓冲 → 替换真实数据 ——
        void (async () => {
          try {
            const cached = decodeCacheRef.current
            let stems: StemAudio[]
            if (
              cached &&
              cached.path === archivePath &&
              cached.createdAt === manifest.createdAt &&
              cached.byteSize === archiveSize
            ) {
              stems = cached.stems
            } else {
              const decoded: StemAudio[] = []
              for (const item of manifest.stems) {
                const entry = layout.entries.get(item.file)
                if (!entry) throw new Error(`压缩包缺少 ${item.file}，无法载入`)
                const blob = await filesReadBlobRange(archivePath, entry.dataOffset, entry.compressedSize)
                const data = new Uint8Array(await blob.arrayBuffer())
                const audio = await decodeTrackInWorker(item.id, data, entry.method, archiveWorkerRef)
                decoded.push({ stemId: item.id, data: audio })
              }
              stems = decoded
              decodeCacheRef.current = {
                path: archivePath,
                createdAt: manifest.createdAt,
                byteSize: archiveSize,
                stems,
              }
            }
            // 期间重新分轨/换歌/卸载 → 丢弃结果
            if (loadArchiveSeqRef.current !== seq) return
            cacheStemBuffers(stems, manifest.sampleRate, peaks.size > 0 ? peaks : undefined)
            setTracks(
              stems.map((audio) => ({
                audio,
                mute: false,
                solo: false,
                volume: 1,
              })),
            )
            // 已有 tempo 直接载入；老压缩包缺失时从鼓轨补测（不自动保存，与现状一致）
            if (manifest.tempo) {
              setTempo(manifest.tempo)
              tempoRef.current = manifest.tempo
            } else {
              const drums = stems.find((s) => s.stemId === 'drums')
              if (drums) void detectTempoAsync(drums.data, manifest.sampleRate)
            }
            // 包内原始歌词兜底：同目录 .lrc 缺失时恢复（手动粘贴歌词也能重开回来），
            // 让「对齐歌词」保持可用、编辑模态显示原文
            if (!lyricsRef.current.trim() && manifest.lyrics?.trim()) {
              lyricsRef.current = manifest.lyrics
              setLyrics(manifest.lyrics)
              setLyricsSourceName(manifest.lyricsSourceName || '来自分轨包')
            }
            // 音素段（人声轨识别结果）随包恢复：换歌词时复用，跳过重新识别
            if (manifest.phonemes) phonemesRef.current = manifest.phonemes
            // 歌词对齐结果随包恢复；旧坏结果（歌词时间戳未剥离）跳过并提示重新对齐
            if (manifest.alignedLrc && !looksLikeBrokenLrc(manifest.alignedLrc)) {
              alignedLrcRef.current = manifest.alignedLrc
              setAlignedLrc(manifest.alignedLrc)
              setAlignRestoredFrom(true)
              setLyricsHint(null)
            } else if (manifest.alignedLrc) {
              clearAlignedResult('检测到旧版损坏的对齐结果，已跳过恢复；可点击「对齐歌词」重新对齐')
            } else if (lyricsRef.current.trim()) {
              // 包内无有效歌词结果但歌词已就绪：优先复用音素段快速重对齐（秒级），
              // 无音素段时退回重跑识别（vocals 已解码）
              if (!realignFromPhonemes(lyricsRef.current)) {
                const vocals = stems.find((s) => s.stemId === 'vocals')
                if (vocals) void alignVocals(vocals.data, manifest.sampleRate)
              } else {
                setAlignRestoredFrom(true)
              }
            }
          } catch (cause) {
            console.warn('后台解码分轨失败', cause)
            setError(cause instanceof Error ? cause.message : String(cause))
          } finally {
            setLoadingArchive(false)
          }
        })()
        return true
      } catch (cause) {
        console.warn('载入已保存分轨失败，走正常分轨流程', cause)
        setLoadingArchive(false)
        return false
      }
    },
    [cacheStemBuffers, clearAlignedResult, detectTempoAsync, alignVocals, realignFromPhonemes, stopPlayback],
  )

  const handlePickFile = useCallback(async () => {
    const path = await showSystemOpenDialog({
      title: '选择要分轨的音乐文件',
      acceptExtensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'],
    })
    if (!path) return
    const node = await resolveNodeByAbsolutePath(path)
    if (!node || node.kind !== 'file') return
    sourcePathRef.current = node.id
    sourceAbsolutePathRef.current = path
    setSourceName(node.name)
    setTracks(null)
    setProgress(null)
    setError(null)
    setCurrentTime(0)
    // 换歌：清空歌词与旧对齐结果，随后自动探测同名 .lrc
    lyricsRef.current = ''
    setLyrics('')
    setLyricsSourceName('')
    clearAlignedResult(null)
    phonemesRef.current = null
    alignReqSeqRef.current += 1
    const dot = path.lastIndexOf('.')
    const slash = path.lastIndexOf('/')
    const base = dot > slash ? path.slice(0, dot) : path
    const lrcPath = `${base}.lrc`
    const lrcNode = await resolveNodeByAbsolutePath(lrcPath)
    if (lrcNode && lrcNode.kind === 'file') {
      try {
        const text = await filesReadText(lrcPath)
        const cleaned = stripLrcMarkup(text).trim()
        if (cleaned) {
          lyricsRef.current = cleaned
          setLyrics(cleaned)
          const lrcName = lrcPath.slice(lrcPath.lastIndexOf('/') + 1)
          setLyricsSourceName(`自动载入：${lrcName}`)
        }
      } catch (cause) {
        console.warn('自动载入歌词失败', cause)
      }
    }
    // 同目录有已保存的分轨压缩包 → 直接载入，不再推理
    const loaded = await tryLoadSavedStems(path)
    if (!loaded) handleSeparateRef.current()
  }, [showSystemOpenDialog, tryLoadSavedStems, clearAlignedResult])

  /** 把清洗后的歌词写入 state/ref（剪贴板与文件导入共用收尾） */
  const applyLyrics = useCallback(
    (cleaned: string, sourceName: string) => {
      lyricsRef.current = cleaned
      setLyrics(cleaned)
      setLyricsSourceName(sourceName)
      // 已有音素段（识别结果）时直接复用快速重对齐，无需重跑 Zipformer
      if (realignFromPhonemes(cleaned)) return
      if (alignedLrcRef.current) clearAlignedResult('歌词已更新，点击「对齐歌词」重新对齐')
    },
    [clearAlignedResult, realignFromPhonemes],
  )

  /** 载入歌词文件（.lrc/.txt）到编辑草稿：剥离 LRC 时间戳后填入 textarea（保存时才应用） */
  const handleLoadLyricsFile = useCallback(async () => {
    const path = await showSystemOpenDialog({
      title: '选择歌词文件',
      acceptExtensions: ['lrc', 'txt'],
    })
    if (!path) return
    try {
      const text = await filesReadText(path)
      const cleaned = stripLrcMarkup(text).trim()
      if (!cleaned) {
        setLyricsHint('歌词文件中没有可用的文本内容（已自动剥离 LRC 时间戳）')
        return
      }
      const name = path.slice(path.lastIndexOf('/') + 1)
      setLyricsDraft(cleaned)
      setLyricsDraftSource(`载入：${name}`)
    } catch (cause) {
      setAlignError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [showSystemOpenDialog])

  /** 打开编辑歌词模态：草稿取当前歌词，来源名继承（新导入会覆盖） */
  const openLyricsEditor = useCallback(() => {
    setLyricsDraft(lyricsRef.current)
    setLyricsDraftSource(lyricsSourceName)
    setLyricsEditorOpen(true)
  }, [lyricsSourceName])

  /** 从系统剪贴板导入到编辑草稿（保存时才应用） */
  const importClipboardToDraft = useCallback(async () => {
    if (navigator.clipboard?.readText) {
      try {
        const text = await navigator.clipboard.readText()
        if (text) {
          setLyricsDraft(text)
          setLyricsDraftSource('从剪贴板导入')
          return
        }
      } catch {
        // 剪贴板读取被拒/失败：留给用户手动粘贴
      }
    }
    setLyricsHint('无法读取系统剪贴板，请手动粘贴歌词')
  }, [])

  /** 保存编辑草稿：清洗后应用（有音素段则秒级重对齐，否则自动跑识别），并对齐结果落盘 */
  const saveLyricsFromEditor = useCallback(() => {
    setLyricsEditorOpen(false)
    const cleaned = stripLrcMarkup(lyricsDraft).trim()
    if (!cleaned) {
      lyricsRef.current = ''
      setLyrics('')
      setLyricsSourceName('')
      clearAlignedResult(null)
      return
    }
    applyLyrics(cleaned, lyricsDraftSource || '手动编辑')
    const tracksNow = tracksRef.current
    if (!tracksNow) return
    if (alignedLrcRef.current) {
      // 已有对齐结果（含音素段快速重对齐）：直接落盘
      void saveCurrentStems(tracksNow.map((t) => t.audio))
    } else {
      // 无对齐结果：完整识别后自动落盘
      void handleAlignLyrics()
    }
  }, [lyricsDraft, lyricsDraftSource, applyLyrics, clearAlignedResult, saveCurrentStems, handleAlignLyrics])

  const handleSeparate = useCallback(async () => {
    const nodeId = sourcePathRef.current
    if (!nodeId) return
    setError(null)
    setProgress({ kind: 'model-loading' })
    try {
      const { blob } = await readFileBlob(nodeId)
      const { interleaved, sampleRate, duration } = await prepareAudio(await blob.arrayBuffer())
      setDuration(duration)
      setView({ start: 0, level: 0 })
      setTracks(null)
      startSeparation(interleaved, sampleRate)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setProgress(null)
    }
  }, [prepareAudio, startSeparation])

  useEffect(() => {
    handleSeparateRef.current = () => void handleSeparate()
  }, [handleSeparate])

  /** 从 offset 秒开始播放全部 7 轨；mute/solo/音量由各轨 GainNode 即时控制。 */
  const startPlayback = useCallback(
    (startOffset: number) => {
      if (!tracks || !audioContextRef.current) return
      const ctx = audioContextRef.current
      const buffers = buffersRef.current
      if (!buffers) return
      stopPlayback()
      // 防止 seek 到文件末尾时 start(0, offset) 越界抛错
      const offset = Math.min(Math.max(0, startOffset), Math.max(0, duration - 0.01))
      startOffsetRef.current = offset
      startedAtRef.current = ctx.currentTime
      for (const track of tracks) {
        const buffer = buffers.get(track.audio.stemId)
        if (!buffer) continue
        const source = ctx.createBufferSource()
        source.buffer = buffer
        const gain = ctx.createGain()
        source.connect(gain)
        gain.connect(ctx.destination)
        source.start(0, offset)
        bufferSourcesRef.current.push(source)
        gainNodesRef.current.set(track.audio.stemId, gain)
      }
      applyGains(gainNodesRef.current, tracks)
      setPlaying(true)
    },
    [tracks, duration, stopPlayback],
  )

  /** 从 AudioContext 时钟读当前播放位置（秒）；暂停/未播放时返回状态里已同步好的值 */
  const getPlaybackTime = useCallback(() => {
    if (!playing) return currentTime
    const elapsed = audioContextRef.current
      ? audioContextRef.current.currentTime - startedAtRef.current
      : 0
    return Math.min(startOffsetRef.current + elapsed, duration)
  }, [playing, currentTime, duration])

  /** 注册/注销歌词标签 span DOM（横向标签流逐字高亮用） */
  const registerLyricsTag = useCallback(
    (line: number, word: number, el: HTMLSpanElement | null) => {
      if (el) {
        let map = lyricsWordRefsRef.current.get(line)
        if (!map) {
          map = new Map()
          lyricsWordRefsRef.current.set(line, map)
        }
        map.set(word, el)
      } else {
        const map = lyricsWordRefsRef.current.get(line)
        if (map) map.delete(word)
      }
    },
    [],
  )

  /**
   * 歌词标签 DOM 直写：唱过的行整行点亮、当前行逐字点亮（横向时间轴卡拉OK）。
   * 只在行/词变化时动 DOM（播放中不重渲染 React）。
   */
  const updateLyricsTagsDom = useCallback((lineIdx: number, wordIdx: number) => {
    const active = lyricsActiveRef.current
    if (lineIdx === active.line && wordIdx === active.word) return
    active.line = lineIdx
    active.word = wordIdx
    for (const [li, map] of lyricsWordRefsRef.current) {
      for (const [wi, el] of map) {
        // li < lineIdx：已唱完的行全亮；li === lineIdx：按词序点亮当前字及之前
        const on = li < lineIdx || (li === lineIdx && wi <= wordIdx)
        el.classList.toggle('stems__lyrics-tag--on', on)
      }
    }
  }, [])

  /**
   * 把播放位置直接写进 DOM（各轨播放头、时间文本），不触发 React 重渲染。
   * 播放时钟（rAF 每帧）与 seek 拖拽共用，保证 60fps 丝滑且拖拽时不打架。
   * 同步驱动速度条：当前段高亮、右格 BPM 读数、lane 播放头。
   */
  const writePlaybackDom = useCallback(
    (timeSec: number) => {
      const ratio = viewLen > 0 ? (timeSec - view.start) / viewLen : 0
      const visible = ratio >= 0 && ratio <= 1
      for (const el of playheadRefsRef.current.values()) {
        el.style.opacity = visible ? '1' : '0'
        el.style.left = `${ratio * 100}%`
      }
      if (timeLabelRef.current) {
        timeLabelRef.current.textContent = `${formatTime(timeSec)} / ${formatTime(duration)}`
      }

      // 速度条：当前段高亮 + 读数 + lane 播放头
      const tempoInfo = tempoRef.current
      if (tempoInfo) {
        const seg = tempoInfo.segments.find((s) => timeSec >= s.startSec && timeSec < s.endSec)
        for (const [startSec, el] of tempoSegRefsRef.current) {
          el.classList.toggle('stems__tempo-seg--active', !!seg && startSec === seg.startSec)
        }
        if (tempoReadoutRef.current) {
          tempoReadoutRef.current.textContent =
            seg !== undefined ? `${Math.round(seg.bpm)} BPM` : `${Math.round(tempoInfo.bpm)} BPM`
        }
      }
      if (tempoPlayheadRef.current) {
        tempoPlayheadRef.current.style.left = `${ratio * 100}%`
        tempoPlayheadRef.current.style.opacity = visible ? '1' : '0'
      }

      // 歌词标签流播放头：与波形/速度播放头同位
      if (lyricsPlayheadRef.current) {
        lyricsPlayheadRef.current.style.left = `${ratio * 100}%`
        lyricsPlayheadRef.current.style.opacity = visible ? '1' : '0'
      }

      // 歌词标签流高亮：唱过的行整行点亮、当前行逐字点亮（DOM 直写）
      const lines = lyricsLinesRef.current
      const tags = lyricTagsRef.current
      if (lines.length > 0 && tags.length > 0) {
        const timeMs = timeSec * 1000
        let lineIdx = -1
        for (let i = 0; i < lines.length; i++) {
          const lineTime = lines[i].timeMs
          if (lineTime === undefined) continue
          if (lineTime <= timeMs) lineIdx = i
          else break
        }
        let wordIdx = -1
        if (lineIdx >= 0) {
          const words = lines[lineIdx].words
          if (words && words.length > 0) wordIdx = computeActiveWordIndex(words, timeMs)
        }
        updateLyricsTagsDom(lineIdx, wordIdx)
      }
    },
    [duration, viewLen, view.start, updateLyricsTagsDom],
  )

  /** 注册/注销某轨播放头 DOM：播放中由 rAF 直写位置 */
  const registerPlayhead = useCallback((stemId: StemId, el: HTMLDivElement | null) => {
    if (el) playheadRefsRef.current.set(stemId, el)
    else playheadRefsRef.current.delete(stemId)
  }, [])

  const handlePlayPause = useCallback(() => {
    if (!tracks || !audioContextRef.current) return
    if (playing) {
      // 暂停前把精确时钟位置写回状态（播放中状态只靠离散事件同步，进度全靠 rAF 直写 DOM）
      setCurrentTime(getPlaybackTime())
      stopPlayback()
      return
    }
    // 已播到末尾再按播放：跳回开头重播（避免卡在 duration-0.01 立刻又停）
    const atEnd = duration > 0 && currentTime >= duration
    if (atEnd) {
      setCurrentTime(0)
      setView((prev) => ({ ...prev, start: 0 }))
      startPlayback(0)
      return
    }
    startPlayback(currentTime)
  }, [tracks, playing, currentTime, duration, getPlaybackTime, stopPlayback, startPlayback])

  // 空格：暂停/继续（输入框与可编辑区除外；仅当前窗口为前台时响应）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (windowId && activeWindowId !== windowId) return
      if (event.key !== ' ' && event.code !== 'Space') return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return
        }
      }
      event.preventDefault()
      event.stopPropagation()
      handlePlayPause()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [activeWindowId, windowId, handlePlayPause])

  /** 拖拽波形过程中：只更新显示位置（状态 + DOM 直写），不碰音频（防止时钟与拖拽互相打架）。 */
  const handleSeekInput = useCallback(
    (offsetSec: number) => {
      const clamped = Math.max(0, Math.min(offsetSec, duration))
      setCurrentTime(clamped)
      writePlaybackDom(clamped)
    },
    [duration, writePlaybackDom],
  )

  const clampViewStart = useCallback(
    (start: number, len: number) => Math.max(0, Math.min(start, Math.max(0, duration - len))),
    [duration],
  )

  /** 设置缩放级别；anchorSec 处的时间在缩放前后保持不动（缩放锚点）。
   *  锚点不在当前窗口内时改为以窗口中心为锚（等价于先把窗口中心移到锚点）。 */
  const zoomTo = useCallback(
    (level: number, anchorSec: number) => {
      setView((prev) => {
        const clampedLevel = Math.max(0, Math.min(level, maxZoomLevel))
        const lenAt = (l: number) =>
          duration > 0
            ? Math.max(MIN_VIEW_SEC, Math.min(duration, duration / Math.pow(2, l)))
            : 0
        const prevLen = lenAt(prev.level)
        const inWindow =
          prevLen > 0 && anchorSec >= prev.start && anchorSec <= prev.start + prevLen
        const anchorRatio = inWindow ? (anchorSec - prev.start) / prevLen : 0.5
        const len = lenAt(clampedLevel)
        return { start: clampViewStart(anchorSec - anchorRatio * len, len), level: clampedLevel }
      })
    },
    [duration, maxZoomLevel, clampViewStart],
  )

  /** 平移可见窗口（秒） */
  const panBy = useCallback(
    (deltaSec: number) => {
      setView((prev) => {
        const len = duration > 0
          ? Math.max(MIN_VIEW_SEC, Math.min(duration, duration / Math.pow(2, prev.level)))
          : 0
        return { ...prev, start: clampViewStart(prev.start + deltaSec, len) }
      })
    },
    [duration, clampViewStart],
  )

  /**
   * 波形区滚轮手势分流：
   *  - Ctrl+滚轮（macOS 触控板捏合，浏览器自动带 Ctrl）→ 以指针为锚缩放
   *  - Shift+滚轮 / 横向滑动（|deltaX| > |deltaY|）→ 平移可见窗口
   *  - 其余纵向滚动 → 不拦截，交给轨列表容器滚动（触控板与鼠标滚轮一视同仁）
   * 缩放统一走捏合 / 缩放条 / ± 按钮；不按增量大小猜鼠标滚轮，否则触控板
   * 惯性滚动的增量超过阈值时，双指上下滑会被误判成缩放。
   * 必须 native + passive:false 才能 preventDefault（Preact 的 onWheel 是 passive 的）。 */
  const handleWheelZoom = useCallback(
    (event: WheelEvent, ratio: number, width: number) => {
      if (event.ctrlKey) {
        event.preventDefault()
        // 触控板捏合（Chrome/Safari 在 macOS 上表现为 ctrl+wheel）：
        // 双指张开 deltaY<0 → 放大，双指收拢 deltaY>0 → 缩小；以指针为锚
        // 系数 0.008：一次用力捏合能跨数倍窗口，太小则「滑半天只动一点」
        const factor = Math.exp(event.deltaY * 0.008)
        const newLen = Math.max(MIN_VIEW_SEC, Math.min(duration, viewLen * factor))
        zoomTo(Math.log2(duration / newLen), view.start + ratio * viewLen)
      } else if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        event.preventDefault()
        // 横向滑动/Shift+滚轮：按滑动像素占波形宽度的比例平移（dx / 宽度 × 可见窗口）
        const dx = event.shiftKey ? event.deltaY : event.deltaX
        panBy((dx / Math.max(1, width)) * viewLen)
        suppressFollowUntilRef.current = Date.now() + 1500
      }
      // 其余纵向滚动：不 preventDefault，默认滚动轨列表
    },
    [duration, viewLen, view.start, panBy, zoomTo],
  )

  /**
   * 音轨区域捏合缩放统一由 tracks 容器承接：
   * wheel 事件不再只绑在波形列（waveWrap）上，而是绑到容器，
   * 指针漂移到行间间隙 / 轨道名 / 控制按钮等任意区域时捏合依然生效。
   * ratio 以波形列（第一个 waveWrap）为横向基准，所有轨行网格列宽一致，
   * 指针 x 落在波形列范围内时锚点精确，落在列外时 clamp 到两端。
   */
  useEffect(() => {
    const node = tracksBoxRef.current
    if (!node) return
    const handler = (event: WheelEvent) => {
      const wave = node.querySelector<HTMLElement>('.stems__track-wave-wrap')
      const rect = wave ? wave.getBoundingClientRect() : node.getBoundingClientRect()
      const ratio = Math.max(
        0,
        Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)),
      )
      handleWheelZoom(event, ratio, rect.width)
    }
    node.addEventListener('wheel', handler, { passive: false })
    return () => node.removeEventListener('wheel', handler)
  }, [handleWheelZoom])

  /** 松手/键盘确认：播放中从目标位置重新播，暂停中仅保留位置。 */
  const finalizeSeek = useCallback(
    (offsetSec: number) => {
      isSeekingRef.current = false
      const clamped = Math.max(0, Math.min(offsetSec, duration))
      setCurrentTime(clamped)
      // 放大状态下，seek 到可见窗口外 → 窗口跟随到目标位置
      if (view.level > 0 && (clamped < view.start || clamped > view.start + viewLen)) {
        setView((prev) => ({
          ...prev,
          start: clampViewStart(clamped - viewLen * 0.15, viewLen),
        }))
      }
      if (playing) startPlayback(clamped)
    },
    [duration, playing, startPlayback, view, viewLen, clampViewStart],
  )

  /**
   * 播放时钟：rAF 每帧从 AudioContext 时钟算位置并直写 DOM（播放头/时间/进度条），
   * React 状态只在暂停/seek/播完等离散事件时同步 —— 播放中零重渲染，60fps 丝滑。
   */
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      if (isSeekingRef.current) return
      const elapsed = audioContextRef.current
        ? audioContextRef.current.currentTime - startedAtRef.current
        : 0
      const next = Math.min(startOffsetRef.current + elapsed, duration)
      writePlaybackDom(next)
      // 放大状态下播放头走出窗口右缘 → 窗口跟随（手动平移后 1.5s 内不打扰），播放头保持在左侧 15%
      if (
        view.level > 0 &&
        next > view.start + viewLen &&
        Date.now() > suppressFollowUntilRef.current
      ) {
        setView((prev) => ({
          ...prev,
          start: clampViewStart(next - viewLen * 0.15, viewLen),
        }))
      }
      if (next >= duration) {
        setCurrentTime(duration)
        stopPlayback()
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, duration, stopPlayback, view, viewLen, clampViewStart, writePlaybackDom])

  /**
   * 节拍器随拍脉冲：播放中 rAF 逐帧找当前段、算当前拍（最近一次落在时间轴上的拍），
   * 新的一拍到来时在 lane 内触发闪烁线（expand+fade），并让速度行「速度」头格
   * 闪一次蓝光（脉冲）。直接操作 DOM，不触发 React 重渲染。
   */
  useEffect(() => {
    const flash = beatFlashRef.current
    if (!metronomeOn || !playing || !tempo) {
      if (flash) {
        flash.style.opacity = '0'
        for (const a of flash.getAnimations()) a.cancel()
      }
      return
    }
    let raf = 0
    let lastKey: string | null = null
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const tempoInfo = tempoRef.current
      const now = getPlaybackTime()
      const seg = tempoInfo?.segments.find((s) => now >= s.startSec && now < s.endSec)
      if (!seg) return
      const interval = 60 / seg.bpm
      const phase = seg.phaseSec ?? 0
      const k = Math.max(0, Math.floor((now - seg.startSec - phase) / interval))
      const beatTime = seg.startSec + phase + k * interval
      const ratio = viewLen > 0 ? (beatTime - view.start) / viewLen : -1
      const inView = ratio >= 0 && ratio <= 1
      if (flash) {
        flash.style.left = `${ratio * 100}%`
        flash.style.opacity = inView ? '1' : '0'
      }
      const key = `${seg.startSec}:${k}`
      if (lastKey !== null && key === lastKey) return
      lastKey = key
      // 新的一拍：lane 闪烁线展开淡出
      if (flash && inView) {
        flash.animate(
          [
            { opacity: 1, transform: 'scaleX(1)' },
            { opacity: 0, transform: 'scaleX(4)' },
          ],
          { duration: 200, easing: 'ease-out', fill: 'forwards' },
        )
      }
      // 速度行「速度」头格脉冲
      const name = tempoNameRef.current
      if (name) {
        name.animate(
          [
            {
              backgroundColor: 'rgba(47, 127, 214, 0.22)',
              boxShadow: '0 0 0 2px rgba(47, 127, 214, 0.85), 0 0 16px rgba(47, 127, 214, 0.8)',
            },
            {
              backgroundColor: 'rgba(47, 127, 214, 0)',
              boxShadow: '0 0 0 0 rgba(47, 127, 214, 0), 0 0 0 rgba(47, 127, 214, 0)',
            },
          ],
          { duration: 260, easing: 'ease-out' },
        )
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      if (flash) {
        flash.style.opacity = '0'
        for (const a of flash.getAnimations()) a.cancel()
      }
    }
  }, [metronomeOn, playing, getPlaybackTime, viewLen, view.start, tempo])

  /**
   * 节拍器哒哒声 lookahead 调度器：播放中每 25ms 查看一次，把落在
   * [now, now+0.12s] 的拍点逐个调度到 AudioContext 时间线（精确对齐音乐时钟，
   * 不依赖主线程调度抖动）。tick 内检测 startedAtRef 变化（seek/重启播放）→
   * flush 已调度节点并重置游标。拍点用 seg.startSec + seg.phaseSec + k*interval，
   * 与视觉脉冲完全一致。
   */
  useEffect(() => {
    if (!metronomeSoundOn || !playing || !tempo) {
      flushMetronomePending()
      return
    }
    let lastStartedAt = startedAtRef.current
    let lastStartOffset = startOffsetRef.current
    metronomeNextSchedRef.current = Math.max(metronomeNextSchedRef.current, getPlaybackTime())
    const intervalId = window.setInterval(() => {
      const ctx = audioContextRef.current
      if (!ctx) return
      // seek/重启播放会重置 startedAtRef → 作废此前已调度节点，游标回到当前位置
      if (startedAtRef.current !== lastStartedAt || startOffsetRef.current !== lastStartOffset) {
        flushMetronomePending()
        lastStartedAt = startedAtRef.current
        lastStartOffset = startOffsetRef.current
        metronomeNextSchedRef.current = getPlaybackTime()
      }
      const now = getPlaybackTime()
      let cursor = Math.max(metronomeNextSchedRef.current, now)
      const horizon = now + 0.12
      const tempoInfo = tempoRef.current
      if (!tempoInfo) return
      // 共享音量 GainNode：懒创建，音量 slider 变化时由另一个 effect 即时改增益
      let gain = metronomeGainRef.current
      if (!gain || gain.context !== ctx) {
        gain = ctx.createGain()
        gain.gain.value = metronomeVolumeRef.current
        gain.connect(ctx.destination)
        metronomeGainRef.current = gain
      }
      while (cursor < horizon) {
        const seg = tempoInfo.segments.find((s) => cursor >= s.startSec && cursor < s.endSec)
        if (!seg) break
        const interval = 60 / seg.bpm
        const phase = seg.phaseSec ?? 0
        const k = Math.max(0, Math.ceil((cursor - seg.startSec - phase) / interval - 1e-6))
        const beatTime = seg.startSec + phase + k * interval
        if (beatTime >= seg.endSec) {
          cursor = seg.endSec
          continue
        }
        if (beatTime >= now) {
          // 文件内时间 t → ctx 时间 = startedAt + (t - startOffset)，与播放时钟一致
          const fileToCtx = startedAtRef.current + (beatTime - startOffsetRef.current)
          metronomePendingRef.current.push(
            scheduleMetronomeClick(ctx, fileToCtx, k % 4 === 0, gain),
          )
        }
        cursor = beatTime + 0.0001
      }
      metronomeNextSchedRef.current = cursor
    }, 25)
    return () => {
      window.clearInterval(intervalId)
      flushMetronomePending()
    }
  }, [metronomeSoundOn, playing, tempo, getPlaybackTime, flushMetronomePending])

  // 节拍器音量：同步到 ref（lookahead 闭包读取）并即时写共享 GainNode
  useEffect(() => {
    metronomeVolumeRef.current = metronomeVolume
    const gain = metronomeGainRef.current
    if (gain) gain.gain.value = metronomeVolume
  }, [metronomeVolume])

  useEffect(
    () => () => {
      stopPlayback()
      // 作废在途的后台分轨包解码
      loadArchiveSeqRef.current += 1
      // 作废在途歌词识别（结果不覆盖已卸载视图）
      alignReqSeqRef.current += 1
      // 取消在途分轨：调度器负责 terminate worker 并释放模型内存
      separateAbortRef.current?.abort()
      tempoWorkerRef.current?.terminate()
      archiveWorkerRef.current?.terminate()
      void audioContextRef.current?.close()
    },
    [stopPlayback],
  )

  // 拖放文件支持：把拖入的文件写入虚拟文件系统临时位置后分轨
  const handleDropFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(file.name)) {
        setError('不支持的文件类型，请选择音频文件')
        return
      }
      try {
        const { interleaved, sampleRate, duration } = await prepareAudio(await file.arrayBuffer())
        sourcePathRef.current = null
        sourceAbsolutePathRef.current = null
        setSourceName(file.name)
        setDuration(duration)
        setView({ start: 0, level: 0 })
        setTracks(null)
        setCurrentTime(0)
        // 拖入文件无持久路径：保留已粘贴歌词，但旧对齐结果作废（人声轨已变）
        clearAlignedResult(null)
        phonemesRef.current = null
        startSeparation(interleaved, sampleRate)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setProgress(null)
      }
    },
    [prepareAudio, startSeparation, clearAlignedResult],
  )

  const isSeparating =
    mdxBusy || progress?.kind === 'model-loading' || progress?.kind === 'chunk'
  const chunkEtaActive =
    (mdxBusy && mdxProgress !== undefined) || progress?.kind === 'chunk'

  // 块推理进行中时刷新剩余时间：按墙钟向预计完成时刻递减
  useEffect(() => {
    if (!chunkEtaActive || etaAtRef.current === undefined) return
    const timer = window.setInterval(() => {
      const etaAt = etaAtRef.current
      if (etaAt === undefined) return
      setEtaRemainingMs(Math.max(0, etaAt - performance.now()))
    }, 250)
    return () => window.clearInterval(timer)
  }, [chunkEtaActive])

  const separationProgress = deriveSeparationProgress({
    mdxBusy,
    mdxProgress,
    mdxCached,
    progress,
    modelCached,
    remainingMs: etaRemainingMs,
  })

  /** 有独奏轨时，其余非独奏轨被静音：视觉上与 Mute 一样置灰 */
  const anySolo = tracks?.some((t) => t.solo) ?? false

  /**
   * 节拍刻度：按各段 BPM 在可见窗口内铺出节拍线（节拍器开启时显示）。
   * 全曲视图下拍数可能上千，超过上限时按比例抽稀，避免刻度糊成一片。
   */
  const beatTicks = useMemo(() => {
    if (!tempo || viewLen <= 0) return []
    const viewEnd = view.start + viewLen
    const MAX_TICKS = 360
    let total = 0
    for (const seg of tempo.segments) {
      const interval = 60 / Math.max(1, seg.bpm)
      const segStart = Math.max(seg.startSec, view.start)
      const segEnd = Math.min(seg.endSec, viewEnd)
      if (segEnd > segStart) total += Math.ceil((segEnd - segStart) / interval) + 1
    }
    const step = Math.max(1, Math.ceil(total / MAX_TICKS))
    const ticks: number[] = []
    for (const seg of tempo.segments) {
      const interval = 60 / Math.max(1, seg.bpm)
      const segStart = Math.max(seg.startSec, view.start)
      const segEnd = Math.min(seg.endSec, viewEnd)
      if (segEnd <= segStart) continue
      const phase = seg.phaseSec ?? 0
      const first = Math.max(0, Math.ceil((segStart - seg.startSec - phase) / interval))
      for (let k = first; ; k += step) {
        const beatSec = seg.startSec + phase + k * interval
        if (beatSec >= segEnd) break
        ticks.push(((beatSec - view.start) / viewLen) * 100)
      }
    }
    return ticks
  }, [tempo, viewLen, view.start])

  return (
    <div
      class={`stems${dragOver ? ' stems--drag-over' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragOver(false)
        const file = event.dataTransfer?.files?.[0]
        if (file) void handleDropFile(file)
      }}
    >
      <header class="stems__toolbar">
        <span class="stems__brand">音乐实验室</span>
        <IosButton onClick={() => void handlePickFile()}>打开音乐文件…</IosButton>
        {sourceName && (
          <IosButton
            tone="primary"
            disabled={mdxBusy || progress?.kind === 'model-loading' || progress?.kind === 'chunk'}
            onClick={() => void handleSeparate()}
          >
            {mdxBusy && mdxProgress
              ? `人声分离 ${separationProgress.phasePercent ?? Math.round((mdxProgress.done / mdxProgress.total) * 100)}%`
              : mdxBusy
                ? '加载人声模型…'
                : progress?.kind === 'chunk'
                  ? `伴奏分轨 ${separationProgress.phasePercent ?? Math.round((progress.index / progress.total) * 100)}%`
                  : progress?.kind === 'model-loading'
                    ? '加载分轨模型…'
                    : tracks
                      ? '重新分轨'
                      : '开始分轨'}
          </IosButton>
        )}
        {sourceName && (
          <IosButton
            size="compact"
            onClick={openLyricsEditor}
            title="编辑歌词（文件或剪贴板导入）"
          >
            歌词
          </IosButton>
        )}
        <div class="stems__toolbar-right">
          {provider && (
            <span
              class={`stems__engine stems__engine--${provider}`}
              title={provider === 'webgpu' ? '伴奏分轨推理运行在 WebGPU 上' : '伴奏分轨推理回退到 WASM（多线程），速度较慢'}
            >
              <span class="stems__engine-lamp" />
              {provider === 'webgpu' ? 'WebGPU' : 'WASM'}
            </span>
          )}
          {mdxProvider && (
            <span
              class={`stems__engine stems__engine--${mdxProvider}`}
              title={mdxProvider === 'webgpu' ? 'MDX 人声分离运行在 WebGPU 上' : 'MDX 人声分离回退到 WASM（多线程），速度较慢'}
            >
              <span class="stems__engine-lamp" />
              MDX
            </span>
          )}
          {sourceName && <span class="stems__source">{sourceName}</span>}
          {error && <span class="stems__error">{error}</span>}
        </div>
      </header>

      {tracks ? (
        <div class="stems__body">
          <div class="stems__transport">
            <button
              type="button"
              class={`stems__transport-btn${playing ? ' stems__transport-btn--playing' : ''}`}
              onClick={() => void handlePlayPause()}
              aria-label={playing ? '暂停' : '播放'}
            >
              {playing ? '❚❚' : '▶'}
            </button>
            <span ref={timeLabelRef} class="stems__time">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
            <IosButton
              icon
              size="compact"
              class={`stems__metronome${metronomeOn ? ' stems__metronome--on' : ''}`}
              disabled={!tempo}
              title={
                tempo
                  ? metronomeOn
                    ? '关闭节拍器'
                    : '开启节拍器：按 BPM 在速度条显示节拍刻度与随拍脉冲'
                  : '节拍器需要先完成速度检测'
              }
              aria-label="节拍器"
              onClick={() => setMetronomeOn((on) => !on)}
            >
              ♪
            </IosButton>
            <IosButton
              icon
              size="compact"
              class={`stems__sound${metronomeSoundOn ? ' stems__sound--on' : ''}`}
              disabled={!tempo}
              title={
                tempo
                  ? metronomeSoundOn
                    ? '关闭节拍器声音'
                    : '开启节拍器声音：随拍播放哒哒声'
                  : '节拍器需要先完成速度检测'
              }
              aria-label="节拍器声音"
              onClick={() => setMetronomeSoundOn((on) => !on)}
            >
              <svg
                class="stems__sound-icon"
                viewBox="0 0 16 16"
                width="14"
                height="14"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M2 6.2v3.6h2.2l3.4 3V3.2l-3.4 3H2z" />
                <path
                  d="M10.8 5.4a3.2 3.2 0 0 1 0 5.2"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  fill="none"
                  strokeLinecap="round"
                />
                <path
                  d="M12.6 3.8a5.6 5.6 0 0 1 0 8.4"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  fill="none"
                  strokeLinecap="round"
                />
              </svg>
            </IosButton>
            <input
              type="range"
              class="stems__volume"
              min={0}
              max={1}
              step={0.01}
              value={metronomeVolume}
              disabled={!tempo}
              onChange={(event) => setMetronomeVolume(Number(event.currentTarget.value))}
              aria-label="节拍器音量"
            />
          </div>

          <div class="stems__tempo-row">
            <div ref={tempoNameRef} class="stems__track-name stems__track-name--tempo">
              <span class="stems__track-dot stems__track-dot--tempo" />
              速度
            </div>
            <div
              ref={tempoLaneRef}
              class="stems__tempo-lane"
            >
              <div class="stems__tempo-segs">
                {tempo?.segments.map((seg, index) => {
                  const left = viewLen > 0 ? ((seg.startSec - view.start) / viewLen) * 100 : 0
                  const right = viewLen > 0 ? ((seg.endSec - view.start) / viewLen) * 100 : 0
                  const width = right - left
                  const segCount = tempo?.segments.length ?? 0
                  const edgeClass =
                    index === 0
                      ? ' stems__tempo-seg--first'
                      : index === segCount - 1
                        ? ' stems__tempo-seg--last'
                        : ''
                  // 段与视口的可见子区间：文字锚定在此区间中心，保证文字永远
                  // 落在自己所属块的可见部分内（放大/平移都不离开块）
                  const visLeft = Math.max(0, left)
                  const visRight = Math.min(100, right)
                  const visWidthPx =
                    tempoLaneWidthPx > 0 && viewLen > 0
                      ? ((visRight - visLeft) / 100) * tempoLaneWidthPx
                      : 0
                  // 块完整在视口内时按像素宽度判断显示（放得下才显示，防窄块文字溢出）；
                  // 块正在滑出/滑入视口（被裁剪）时只要还有可见部分就跟随显示，
                  // 避免"块还剩一条边文字就提前消失"
                  const clipped = left < 0 || right > 100
                  const showLabel = clipped ? visWidthPx > 0 : visWidthPx >= 22
                  // 文字锚点 = 块可见区中心，转成相对 seg 的百分比（label 是 seg 子元素，
                  // 被 seg 的 overflow:hidden 裁剪，文字实体永远无法越出块边界）
                  const labelLeftInSeg = showLabel && width > 0
                    ? (((visLeft + visRight) / 2 - left) / width) * 100
                    : 50
                  return (
                    <div
                      key={seg.startSec}
                      ref={(el) => {
                        if (el) tempoSegRefsRef.current.set(seg.startSec, el)
                        else tempoSegRefsRef.current.delete(seg.startSec)
                      }}
                      class={`stems__tempo-seg${edgeClass}`}
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        background: tempoSegGradient(seg.bpm),
                      }}
                      title={`${formatTime(seg.startSec)} – ${formatTime(seg.endSec)} · ${Math.round(seg.bpm)} BPM`}
                      onClick={() => finalizeSeek(seg.startSec)}
                    >
                      {showLabel && (
                        <span
                          class="stems__tempo-seg-label"
                          style={{ left: `${labelLeftInSeg}%` }}
                        >
                          {Math.round(seg.bpm)}
                        </span>
                      )}
                    </div>
                  )
                })}
                {tempo && (() => {
                  const ratio = viewLen > 0 ? (currentTime - view.start) / viewLen : 0
                  const visible = ratio >= 0 && ratio <= 1
                  return (
                    <div
                      ref={tempoPlayheadRef}
                      class="stems__tempo-playhead"
                      style={{ left: `${ratio * 100}%`, opacity: visible ? 1 : 0 }}
                    />
                  )
                })()}
                {metronomeOn &&
                  beatTicks.map((pct, index) => (
                    <div key={index} class="stems__beat-tick" style={{ left: `${pct}%` }} />
                  ))}
                <div ref={beatFlashRef} class="stems__beat-flash" style={{ opacity: 0 }} />
              </div>
            </div>
            <div class="stems__tempo-readout">
              <span ref={tempoReadoutRef}>
                {tempoDetecting
                  ? '检测中…'
                  : tempo
                    ? `${Math.round(tempo.bpm)} BPM`
                    : '—'}
              </span>
            </div>
          </div>

          <div ref={tracksBoxRef} class="stems__tracks">
            {/* 歌词轨：整首歌逐字标签按时间戳横向排成一行，与波形共用缩放/平移/播放头 */}
            <div class="stems__track stems__track--lyrics">
              <div class="stems__track-name">
                <span class="stems__track-dot stems__track-dot--lyrics" />
                歌词
              </div>
              <div
                ref={lyricsTagsRef}
                class="stems__lyrics-tags"
                onClick={lyricTags.length === 0 ? openLyricsEditor : undefined}
                title={lyricTags.length === 0 ? '导入或编辑歌词' : undefined}
                onPointerDown={(event) => {
                  if (lyricTags.length === 0) return
                  const rect = event.currentTarget.getBoundingClientRect()
                  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)))
                  isSeekingRef.current = true
                  handleSeekInput(view.start + ratio * viewLen)
                  event.currentTarget.setPointerCapture(event.pointerId)
                }}
                onPointerMove={(event) => {
                  if (!isSeekingRef.current) return
                  const rect = event.currentTarget.getBoundingClientRect()
                  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)))
                  handleSeekInput(view.start + ratio * viewLen)
                }}
                onPointerUp={(event) => {
                  if (!isSeekingRef.current) return
                  const rect = event.currentTarget.getBoundingClientRect()
                  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)))
                  finalizeSeek(view.start + ratio * viewLen)
                }}
                onPointerCancel={(event) => {
                  if (!isSeekingRef.current) return
                  const rect = event.currentTarget.getBoundingClientRect()
                  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)))
                  finalizeSeek(view.start + ratio * viewLen)
                }}
              >
                {lyricTags.length > 0 ? (
                  <>
                    {lyricTags.map((tag, index) => {
                      const leftPct = viewLen > 0 ? ((tag.timeSec - view.start) / viewLen) * 100 : 0
                      return (
                        <span
                          key={`${tag.lineIndex}:${tag.wordIndex}:${index}`}
                          ref={(el) => registerLyricsTag(tag.lineIndex, tag.wordIndex, el)}
                          class="stems__lyrics-tag"
                          style={{ left: `${leftPct}%` }}
                          onClick={() => finalizeSeek(tag.timeSec)}
                          title={tag.text}
                        >
                          {tag.text}
                        </span>
                      )
                    })}
                    <div
                      ref={lyricsPlayheadRef}
                      class="stems__track-playhead"
                      style={{ left: 0, opacity: 0 }}
                    />
                  </>
                ) : (
                  <span class="stems__lyrics-tags-placeholder">
                    {lyrics.trim() ? '歌词已就绪，点击「对齐歌词」' : '点击此处导入歌词'}
                  </span>
                )}
              </div>
              <div class="stems__lyrics-controls">
                <SegmentedControl
                  value={alignModel}
                  onChange={changeAlignModel}
                  ariaLabel="歌词识别模型"
                  items={[
                    { id: 'zipformer', label: 'Zipformer 中文' },
                    { id: 'sense-voice', label: 'SenseVoice 五语' },
                  ]}
                  className="stems__lyrics-model-picker"
                />
                <IosButton
                  size="compact"
                  tone={alignedLrc ? undefined : 'primary'}
                  disabled={!tracks || alignBusy || isSeparating || !lyrics.trim()}
                  title={
                    tracks
                      ? alignModel === 'sense-voice'
                        ? '用 SenseVoice 识别 vocals（中英日韩粤）并逐字对齐歌词'
                        : '用 Zipformer 识别 vocals 并逐字对齐歌词'
                      : '分轨完成后即可对齐歌词'
                  }
                  onClick={() => void handleAlignLyrics()}
                >
                  {alignedLrc ? '重新对齐歌词' : '对齐歌词'}
                </IosButton>
                <span class={`stems__lyrics-status${alignError ? ' stems__lyrics-status--error' : ''}`}>
                  {alignBusy
                    ? alignProgress
                      ? `识别 ${alignProgress.chunk}/${alignProgress.total}`
                      : '加载模型…'
                    : alignError
                      ? alignError
                      : lyricsHint
                        ? lyricsHint
                        : alignRestoredFrom
                          ? '已恢复'
                          : ''}
                </span>
              </div>
            </div>
            {STEM_IDS.map((stemId) => {
              const track = tracks.find((t) => t.audio.stemId === stemId)
              if (!track) return null
              return (
                <StemTrackRow
                  key={stemId}
                  stemId={stemId}
                  track={track}
                  playheadSec={currentTime}
                  viewStart={view.start}
                  viewLen={viewLen}
                  sampleRate={stemSampleRate}
                  peakPyramid={peaksRef.current?.get(stemId)}
                  registerPlayhead={registerPlayhead}
                  onToggleMute={() => toggleTrack(setTracks, gainNodesRef.current, stemId, 'mute')}
                  onToggleSolo={() => toggleTrack(setTracks, gainNodesRef.current, stemId, 'solo')}
                  silenced={track.mute || (anySolo && !track.solo)}
                  onSeek={(ratio) => {
                    isSeekingRef.current = true
                    handleSeekInput(view.start + ratio * viewLen)
                  }}
                  onSeekEnd={(ratio) => finalizeSeek(view.start + ratio * viewLen)}
                  onVolume={(volume) => {
                    setTracks((prev) => {
                      if (!prev) return null
                      const next = prev.map((t) =>
                        t.audio.stemId === stemId ? { ...t, volume } : t,
                      )
                      applyGains(gainNodesRef.current, next)
                      return next
                    })
                  }}
                />
              )
            })}
          </div>

          {maxZoomLevel > 0 && (
            <footer class="stems__footer">
              <div class="stems__zoom">
                <IosButton
                  icon
                  size="compact"
                  class="stems__zoom-btn"
                  disabled={view.level <= 0.01}
                  onClick={() => zoomTo(view.level - 1, getPlaybackTime())}
                  title="缩小一倍（以当前播放位置为锚）"
                  aria-label="缩小"
                >
                  −
                </IosButton>
                <input
                  type="range"
                  class="stems__zoom-slider"
                  min={0}
                  max={maxZoomLevel}
                  step={0.1}
                  value={view.level}
                  onChange={(event) => zoomTo(Number(event.currentTarget.value), getPlaybackTime())}
                  title="波形缩放：可见窗口时长（以当前播放位置为锚）"
                />
                <IosButton
                  icon
                  size="compact"
                  class="stems__zoom-btn"
                  disabled={view.level >= maxZoomLevel - 0.01}
                  onClick={() => zoomTo(view.level + 1, getPlaybackTime())}
                  title="放大一倍（以当前播放位置为锚）"
                  aria-label="放大"
                >
                  +
                </IosButton>
                <span class="stems__zoom-label">{formatZoomLabel(view.level)}</span>
                {view.level > 0.01 && (
                  <IosButton
                    size="compact"
                    class="stems__zoom-fit"
                    onClick={() => setView({ start: 0, level: 0 })}
                  >
                    全曲
                  </IosButton>
                )}
              </div>
              {view.level > 0 && (
                <div
                  class="stems__minimap"
                  onPointerDown={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    const ratio = (event.clientX - rect.left) / Math.max(1, rect.width)
                    const onThumb =
                      (event.target as HTMLElement).closest('.stems__minimap-thumb') !== null
                    minimapDragRef.current = {
                      startX: event.clientX,
                      startViewStart: view.start,
                      onThumb,
                    }
                    event.currentTarget.setPointerCapture(event.pointerId)
                    if (!onThumb) {
                      // 空白处点击：窗口中心跳到该位置
                      setView((prev) => ({
                        ...prev,
                        start: clampViewStart(ratio * duration - viewLen / 2, viewLen),
                      }))
                    }
                    suppressFollowUntilRef.current = Date.now() + 1500
                  }}
                  onPointerMove={(event) => {
                    const drag = minimapDragRef.current
                    if (!drag) return
                    const rect = event.currentTarget.getBoundingClientRect()
                    const dxRatio = (event.clientX - drag.startX) / Math.max(1, rect.width)
                    setView((prev) => ({
                      ...prev,
                      start: drag.onThumb
                        ? clampViewStart(drag.startViewStart + dxRatio * duration, viewLen)
                        : clampViewStart(prev.start + dxRatio * duration, viewLen),
                    }))
                  }}
                  onPointerUp={() => {
                    minimapDragRef.current = null
                  }}
                  onPointerCancel={() => {
                    minimapDragRef.current = null
                  }}
                >
                  <div
                    class="stems__minimap-thumb"
                    style={{
                      left: `${(view.start / duration) * 100}%`,
                      width: `${(viewLen / duration) * 100}%`,
                    }}
                  />
                </div>
              )}
              <span class="stems__zoom-range">
                {formatTime(view.start)} – {formatTime(Math.min(duration, view.start + viewLen))}
              </span>
            </footer>
          )}
        </div>
      ) : (
        <div class="stems__empty">
          <div class="stems__empty-badge" aria-hidden="true">
            <span class="stems__empty-badge-ring" />
            <span class="stems__empty-badge-core" />
          </div>
          <p class="stems__empty-title">打开或拖入一个音乐文件，然后点击「开始分轨」。</p>
          <p class="stems__empty-hint">
            分轨会把人声、鼓、贝斯、其他一、其他二、吉他、钢琴分离为 7 条独立音轨，可逐轨试听与调节。
          </p>
          {loadingArchive && (
            <p class="stems__empty-hint">检测到已保存的分轨结果，正在载入…</p>
          )}
          {isSeparating && (
            <div class="stems__progress-card">
              <p class="stems__progress-phase">{separationProgress.phaseLabel}</p>
              <div
                class="stems__progress-bar-wrap"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={separationProgress.overallPercent}
              >
                <div
                  class={`stems__progress-bar${separationProgress.overallPercent === undefined ? ' stems__progress-bar--indeterminate' : ''}`}
                  style={
                    separationProgress.overallPercent !== undefined
                      ? { width: `${separationProgress.overallPercent}%` }
                      : undefined
                  }
                />
              </div>
              <div class="stems__progress-meta">
                <span>
                  {separationProgress.overallPercent !== undefined
                    ? `总进度 ${separationProgress.overallPercent}%`
                    : '准备中…'}
                  {separationProgress.chunkLabel ? ` · ${separationProgress.chunkLabel}` : ''}
                </span>
                <span>
                  {separationProgress.remainingMs !== undefined
                    ? `约 ${formatDurationMs(separationProgress.remainingMs)} 后 · ${formatEtaClock(separationProgress.remainingMs)} 结束`
                    : separationProgress.phasePercent !== undefined
                      ? '正在估算剩余时间…'
                      : '模型加载中…'}
                </span>
              </div>
            </div>
          )}
          {!progress && !mdxBusy && gpuAvailable === true && (
            <p class="stems__empty-hint">已检测到 WebGPU，分轨将优先使用 GPU 加速。</p>
          )}
          {!progress && !mdxBusy && gpuAvailable === false && (
            <p class="stems__empty-hint">
              未检测到 WebGPU，分轨将使用 WASM 模式（较慢）；建议在 Chrome 中开启硬件加速。
            </p>
          )}
          {!progress && !mdxBusy && (mdxCached === false || modelCached === false) && (
            <p class="stems__empty-hint">
              提示：分轨所需模型尚未完全缓存（人声分离模型约 67MB，分轨模型约 285MB），首次分轨需下载；可在 设置 → 存储 → 模型缓存 中提前缓存。
            </p>
          )}
        </div>
      )}
      {systemDialog}
      <WindowModal
        open={lyricsEditorOpen}
        title="编辑歌词"
        onClose={() => setLyricsEditorOpen(false)}
        actions={[
          {
            key: 'cancel',
            label: '取消',
            tone: 'secondary',
            onClick: () => setLyricsEditorOpen(false),
          },
          {
            key: 'confirm',
            label: '保存歌词',
            tone: 'primary',
            onClick: () => {
              saveLyricsFromEditor()
            },
          },
        ]}
      >
        <div class="stems__clipboard-field">
          <div class="stems__lyrics-editor-tools">
            <IosButton size="compact" onClick={() => void handleLoadLyricsFile()}>
              从文件导入…
            </IosButton>
            <IosButton size="compact" onClick={() => void importClipboardToDraft()}>
              从剪贴板导入…
            </IosButton>
            {lyricsDraft.trim() && (
              <IosButton
                size="compact"
                onClick={() => {
                  setLyricsDraft('')
                  setLyricsDraftSource('')
                }}
              >
                清空
              </IosButton>
            )}
          </div>
          <label for="stems-lyrics-editor-textarea">
            粘贴或编辑歌词文本（保存时自动剥离 LRC 时间戳）
          </label>
          <textarea
            id="stems-lyrics-editor-textarea"
            class="stems__clipboard-textarea"
            rows={10}
            value={lyricsDraft}
            placeholder="在这里粘贴或编辑歌词…"
            autoFocus
            onInput={(event) => setLyricsDraft(event.currentTarget.value)}
          />
        </div>
      </WindowModal>
    </div>
  )
}

/** 在 Worker 里解码单条 WAV 压缩段 → Float32（Transferable 传回，不阻塞主线程）。 */
function decodeTrackInWorker(
  stemId: StemId,
  data: Uint8Array,
  method: number,
  workerRef: { current: Worker | null },
): Promise<Float32Array> {
  const worker = workerRef.current ?? new StemsArchiveWorker()
  workerRef.current = worker
  return new Promise<Float32Array>((resolve, reject) => {
    const onMessage = (event: MessageEvent<StemsArchiveWorkerResponse>): void => {
      const msg = event.data
      if (msg.type === 'track-done' && msg.stemId === stemId) {
        worker.removeEventListener('message', onMessage)
        resolve(msg.data)
        return
      }
      if (msg.type === 'error') {
        worker.removeEventListener('message', onMessage)
        reject(new Error(msg.message))
        return
      }
    }
    worker.addEventListener('message', onMessage)
    worker.postMessage(
      { type: 'decode-track', stemId, data: data.buffer as ArrayBuffer, method } satisfies StemsArchiveWorkerRequest,
      [data.buffer],
    )
  })
}

function toggleTrack(
  setTracks: (updater: (prev: StemTrackState[] | null) => StemTrackState[] | null) => void,
  gainNodes: Map<StemId, GainNode>,
  stemId: StemId,
  mode: 'mute' | 'solo',
): void {
  setTracks((prev) => {
    if (!prev) return null
    const next = prev.map((t) => {
      if (t.audio.stemId !== stemId) return t
      return mode === 'mute' ? { ...t, mute: !t.mute } : { ...t, solo: !t.solo }
    })
    applyGains(gainNodes, next)
    return next
  })
}

type StemTrackRowProps = {
  stemId: StemId
  track: StemTrackState
  /** 播放进度（秒），用于播放头位置 */
  playheadSec: number
  /** 可见窗口起点（秒）与长度（秒）：全曲时为 0 与总时长 */
  viewStart: number
  viewLen: number
  /** 波形数据采样率（分轨结果固定 44.1kHz） */
  sampleRate: number
  /** 本轨峰值金字塔：绘制时按桶聚合，任意缩放级别都只 O(窗口毫秒数)；未提供时回退直接计算 */
  peakPyramid: WaveformPyramid | undefined
  /** 注册/注销本轨播放头 DOM：播放中由 rAF 直写位置，不经过 React 重渲染 */
  registerPlayhead: (stemId: StemId, el: HTMLDivElement | null) => void
  onToggleMute: () => void
  onToggleSolo: () => void
  /** 该轨当前实际被静音（mute 或 solo 下非独奏轨）：视觉上置灰 */
  silenced: boolean
  /** 波形上拖拽/点击 seek：ratio ∈ [0,1] 是窗口内比例，播放中不立即重启，松手由 onSeekEnd 定位 */
  onSeek: (ratio: number) => void
  onSeekEnd: (ratio: number) => void
  onVolume: (volume: number) => void
}

function StemTrackRow({
  stemId,
  track,
  playheadSec,
  viewStart,
  viewLen,
  sampleRate,
  peakPyramid,
  registerPlayhead,
  onToggleMute,
  onToggleSolo,
  silenced,
  onSeek,
  onSeekEnd,
  onVolume,
}: StemTrackRowProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const waveWrapRef = useRef<HTMLDivElement | null>(null)

  // 波形只在数据/可见窗口/尺寸变化时重画；播放头用 overlay div 单独定位，不随播放进度重画
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const width = canvas.clientWidth * dpr
      const height = canvas.clientHeight * dpr
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      ctx.clearRect(0, 0, width, height)
      // 可见窗口的峰值：放大时按窗口切帧并提高桶数，才能看清细节
      const startFrame = Math.floor(viewStart * sampleRate)
      const endFrame = Math.floor((viewStart + viewLen) * sampleRate)
      const buckets = Math.max(WAVEFORM_BUCKETS, Math.ceil(canvas.clientWidth / 2))
      // 优先按金字塔按桶聚合（缩放/绘制 O(窗口毫秒数)，全曲视图不再逐采样遍历）
      const peaks = peakPyramid
        ? computeWaveformPeaksFromPyramid(peakPyramid, buckets, startFrame, endFrame)
        : computeWaveformPeaks(track.audio.data, buckets, startFrame, endFrame)
      const color = STEM_COLORS[stemId]
      // 按比例映射到画布，避免 floor(width/n)*n 小于 width 时右侧大片留空
      const gap = Math.max(1, Math.round(dpr))
      ctx.fillStyle = color
      ctx.globalAlpha = 0.9
      const midY = height / 2
      for (let i = 0; i < peaks.length; i++) {
        const peak = peaks[i]
        const x0 = Math.floor((i / peaks.length) * width)
        const x1 = Math.floor(((i + 1) / peaks.length) * width)
        const amp = Math.min(1, Math.max(Math.abs(peak.min), Math.abs(peak.max)))
        const barHeight = Math.max(1, amp * (height - 4))
        ctx.fillRect(x0, midY - barHeight / 2, Math.max(1, x1 - x0 - gap), barHeight)
      }
      ctx.globalAlpha = 1
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [track.audio.data, peakPyramid, viewStart, viewLen, sampleRate, stemId])

  // 播放头始终跟随 currentTime：暂停时点击/拖拽也能在波形上看到定位
  const playheadRatio = viewLen > 0 ? (playheadSec - viewStart) / viewLen : -1
  const playheadVisible = playheadRatio >= 0 && playheadRatio <= 1

  // 波形点击/拖拽 seek：按下即定位显示，松手（或取消）才真正定位
  const seekDraggingRef = useRef(false)
  const seekRatioFromEvent = (event: preact.JSX.TargetedPointerEvent<HTMLDivElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)))
  }
  const handleSeekPointerDown = (event: preact.JSX.TargetedPointerEvent<HTMLDivElement>) => {
    seekDraggingRef.current = true
    onSeek(seekRatioFromEvent(event))
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const handleSeekPointerMove = (event: preact.JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (!seekDraggingRef.current) return
    onSeek(seekRatioFromEvent(event))
  }
  const handleSeekPointerEnd = (event: preact.JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (!seekDraggingRef.current) return
    seekDraggingRef.current = false
    onSeekEnd(seekRatioFromEvent(event))
  }

  return (
    <div
      class={`stems__track${silenced ? ' stems__track--silenced' : ''}${track.solo ? ' stems__track--solo' : ''}`}
      style={{ '--stem-color': STEM_COLORS[stemId] } as preact.JSX.CSSProperties}
    >
      <div class="stems__track-name">
        <span class="stems__track-dot" style={{ background: STEM_COLORS[stemId] }} />
        {STEM_LABELS[stemId]}
      </div>
      <div
        ref={waveWrapRef}
        class="stems__track-wave-wrap"
        onPointerDown={handleSeekPointerDown}
        onPointerMove={handleSeekPointerMove}
        onPointerUp={handleSeekPointerEnd}
        onPointerCancel={handleSeekPointerEnd}
      >
        <canvas ref={canvasRef} class="stems__track-wave" />
        {/* 播放头常驻 DOM：播放中 rAF 直写位置与显隐（不重渲染），暂停时回落到 React 状态样式 */}
        <div
          ref={(el) => registerPlayhead(stemId, el)}
          class="stems__track-playhead"
          style={{ left: `${playheadRatio * 100}%`, opacity: playheadVisible ? 1 : 0 }}
        />
      </div>
      <div class="stems__track-controls">
        <div class="stems__track-chips">
          <IosButton
            icon
            size="compact"
            class={`stems__chip${track.mute ? ' stems__chip--mute-on' : ''}`}
            onClick={onToggleMute}
            title="静音"
            aria-label="静音"
          >
            M
          </IosButton>
          <IosButton
            icon
            size="compact"
            class={`stems__chip${track.solo ? ' stems__chip--solo-on' : ''}`}
            onClick={onToggleSolo}
            title="独奏"
            aria-label="独奏"
          >
            S
          </IosButton>
        </div>
        <input
          type="range"
          class="stems__volume"
          min={0}
          max={1}
          step={0.01}
          value={track.volume}
          onChange={(event) => onVolume(Number(event.currentTarget.value))}
          title="音量"
          aria-label="音量"
        />
      </div>
    </div>
  )
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

/** 缩放读数：低倍率用百分比，≥100× 改写成「256×」以免底部栏撑破 */
function formatZoomLabel(level: number): string {
  const factor = Math.pow(2, level)
  if (factor >= 100) return `${Math.round(factor)}×`
  return `${Math.round(factor * 100)}%`
}

function formatDurationMs(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** 预估结束时刻（本地时钟，如 15:42）。 */
function formatEtaClock(remainingMs: number): string {
  const end = new Date(Date.now() + Math.max(0, remainingMs))
  return `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`
}

type SeparationProgressView = {
  phaseLabel: string
  chunkLabel?: string
  phasePercent?: number
  overallPercent?: number
  remainingMs?: number
}

/**
 * 两阶段级联分轨进度：人声分离与伴奏分轨各占总进度一半。
 * 剩余时间来自 noteChunkProgress 估算的预计完成时刻（块之间按墙钟递减）。
 */
function deriveSeparationProgress(input: {
  mdxBusy: boolean
  mdxProgress?: { done: number; total: number }
  mdxCached: boolean | null
  progress: StemProgress | null
  modelCached: boolean | null
  remainingMs?: number
}): SeparationProgressView {
  const { mdxBusy, mdxProgress, mdxCached, progress, modelCached, remainingMs } = input

  if (mdxBusy) {
    if (!mdxProgress || mdxProgress.total <= 0) {
      return {
        phaseLabel:
          mdxCached === false
            ? '正在下载人声分离模型（首次约 67MB）…'
            : '正在加载人声分离模型…',
      }
    }
    const phaseFraction = mdxProgress.done / mdxProgress.total
    const phasePercent = Math.min(100, Math.round(phaseFraction * 100))
    const overallPercent = Math.min(99, Math.round(phaseFraction * 50))
    return {
      phaseLabel: '正在分离人声…',
      chunkLabel: `第 ${mdxProgress.done}/${mdxProgress.total} 块 · 本阶段 ${phasePercent}%`,
      phasePercent,
      overallPercent,
      remainingMs,
    }
  }

  if (progress?.kind === 'model-loading') {
    return {
      phaseLabel:
        modelCached === false
          ? '正在下载分轨模型（首次约 285MB）…'
          : '正在加载分轨模型…',
      overallPercent: 50,
    }
  }

  if (progress?.kind === 'chunk' && progress.total > 0) {
    const phaseFraction = progress.index / progress.total
    const phasePercent = Math.min(100, Math.round(phaseFraction * 100))
    const overallPercent = Math.min(100, Math.round(50 + phaseFraction * 50))
    return {
      phaseLabel: '正在拆分伴奏…',
      chunkLabel: `第 ${progress.index}/${progress.total} 块 · 本阶段 ${phasePercent}%`,
      phasePercent,
      overallPercent,
      remainingMs,
    }
  }

  return { phaseLabel: '正在准备分轨…' }
}

/** BPM 分桶 → 速度条色块 class（颜色编码快慢）。 */
/**
 * BPM → 连续渐变背景色：60→200 BPM 从蓝(210°) 渐变到红(0°) 色相，
 * 每个 BPM 值都有唯一颜色，相邻不同速度段不会被归入同色。
 */
function tempoSegGradient(bpm: number): string {
  const MIN = 60
  const MAX = 200
  const clamped = Math.max(MIN, Math.min(MAX, bpm))
  // 色相线性映射：210（蓝）→ 0（红）
  const hue = 210 - ((clamped - MIN) / (MAX - MIN)) * 210
  const top = `hsl(${hue} 62% 62%)`
  const bottom = `hsl(${Math.max(0, hue - 18)} 60% 45%)`
  return `linear-gradient(180deg, ${top} 0%, ${bottom} 100%)`
}

