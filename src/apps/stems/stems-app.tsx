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
  mixStems,
  silenceRatio,
  STEM_CHANNELS,
  STEM_SILENCE_MERGE_RATIO,
  STEM_TARGET_SAMPLE_RATE,
  waveformPyramidLayout,
} from './stems-separator.ts'
import type { WaveformPyramid } from './stems-separator.ts'
import { STEM_COLORS, STEM_IDS, stemDisplayLabel } from './stems-types.ts'
import type { StemAudio, StemEngineProvider, StemId, StemProgress } from './stems-types.ts'
import {
  readStemsArchiveLayoutRanged,
  saveStemsArchive,
  stemsArchivePathFor,
  type PhonemeSegment,
  type StemAudioCodec,
} from './stems-persistence.ts'
import { enqueueAiTask } from '../../ai/ai-inference-service.ts'
import { WindowModal } from '../../window/window-modal.tsx'
import { alignSegmentsToLrc } from '../align/align-pipeline.ts'
import {
  estimateLineTimes,
  expandStarvedLineTimes,
  mapLrcLineTimes,
  MIN_LINE_WORD_MS,
} from '../align/align-line-times.ts'
import { stripLrcMarkup } from '../align/pinyin-g2p.ts'
import { buildAlignLrc, formatLrcTimestamp, looksLikeBrokenLrc } from '../align/align-lrc.ts'
import { buildLyricsSkeleton } from '../align/align-g2p.ts'
import type { AlignedUnit } from '../align/align-types.ts'
import type { HypSegment } from '../align/align-text-dtw.ts'
import type { ZipformerAlignLine, ZipformerProgress } from '../align/zipformer-worker.ts'
import type { SenseVoiceProgress } from '../align/sense-voice-worker.ts'
import { looksLikeLrc, parseLrc } from '../music/music-lyrics.ts'
import type { LyricsLine, LyricsWord } from '../music/music-lyrics.ts'
import { LyricsAnalysisDrawer } from './lyrics-analysis-drawer.tsx'
import { StemsEmpty } from './stems-empty.tsx'
import {
  alignLineByLineTimes,
  computeLineStats,
  lineWindowSec,
  patchLineIntoAlignedLrc,
  resolveLineTimes,
  type LineSource,
} from './lyrics-analysis.ts'
import { rescueLine, scoreLineUnits, shouldRescueLine } from './lyrics-line-rescue.ts'
import { planStretchParams, timeStretchAudio, type StretchPlan } from './lyrics-time-stretch.ts'
import { autoSearchLine } from './lyrics-auto-search.ts'
import { CLEAN_VERSION, cleanLyricsWithLlm, type CleanProgress } from './lyrics-llm-clean.ts'
import { computeActiveWordIndex } from '../music/music-visualizer-math.ts'
import {
  loadRecentProjects,
  pushRecentProject,
  removeRecentProject,
  saveRecentProjects,
} from './stems-recents.ts'
import type { RecentStemsProject } from './stems-recents.ts'
import type { MdxVocalProgress } from './mdx-vocal-worker.ts'
import TempoWorker from './tempo-worker.ts?worker'
import type { TempoWorkerResponse } from './tempo-worker.ts'
import StemsArchiveWorker from './stems-archive-worker.ts?worker'
import type {
  StemsArchiveWorkerRequest,
  StemsArchiveWorkerResponse,
} from './stems-archive-worker.ts'
import StemsAlignWorker from './stems-align-worker.ts?worker'
import type {
  StemsAlignWorkerRequest,
  StemsAlignWorkerResponse,
} from './stems-align-worker.ts'
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
/** 歌词对齐/峰值计算 Worker 的任务请求序号：响应按 requestId 路由回各自 Promise */
let stemsAlignReqSeq = 0

/** 波形显示：峰值 / RMS 响度包络的缩放自适应混合。
 * 每可见桶覆盖时间（毫秒）≤ MIN_MS 时纯峰值（放大看细节保留瞬态），
 * ≥ MAX_MS 时纯 RMS（全轨显示响度包络，避免被密集瞬时峰值顶成实心）；中间线性过渡。 */
const RMS_BLEND_MIN_MS = 8
const RMS_BLEND_MAX_MS = 96
/** RMS 包络显示增益：把典型 0.1~0.4 的响度放大到可读柱高，同时保留主歌/副歌起伏 */
const RMS_GAIN = 2.5

/** 歌词对齐模型：zipformer（中文）/ sense-voice（五语） */
import type { AlignModel } from './lyrics-analysis.ts'
const ALIGN_MODEL_STORAGE_KEY = 'stems-align-model'
/** 分轨压缩包音频格式选择（wav / flac；菜单勾选，localStorage 记忆） */
const ARCHIVE_CODEC_STORAGE_KEY = 'stems-archive-codec'

/** 歌词时间轴标签：由对齐结果逐字拍平（无逐字时整行一个标签） */
type LyricTag = {
  lineIndex: number
  wordIndex: number
  /** 该行标签总数（行内阶梯步长 = 轨道高 / 词数，自适应） */
  wordCount: number
  text: string
  timeSec: number
  /** 对齐失败标记（<mm:ss.xx|f> 内嵌标记解析出） */
  failed?: boolean
}

/** 歌词轨垂直布局：轨道高度、词标签高度、上下边距（阶梯整体居中不溢出） */
const LYRICS_TRACK_H = 68
const LYRICS_TAG_H = 20
const LYRICS_TRACK_PAD = 3

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
  /** 最近打开的项目历史（空态「最近打开」直接重开；localStorage 持久化） */
  const [recentProjects, setRecentProjects] = useState<RecentStemsProject[]>(() => loadRecentProjects())
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
  /** 分轨压缩包音频格式：wav（16-bit PCM）/ flac（FLAC 无损压缩），localStorage 记忆 */
  const [archiveCodec, setArchiveCodec] = useState<StemAudioCodec>(() => {
    const raw = localStorage.getItem(ARCHIVE_CODEC_STORAGE_KEY)
    return raw === 'flac' ? 'flac' : 'wav'
  })
  const changeArchiveCodec = useCallback((codec: StemAudioCodec) => {
    setArchiveCodec(codec)
    try {
      localStorage.setItem(ARCHIVE_CODEC_STORAGE_KEY, codec)
    } catch {
      // localStorage 不可用时仅会话内生效
    }
  }, [])
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
  /** 歌词对齐/峰值计算 worker（懒创建、复用、卸载时 terminate；纯函数计算不加载模型） */
  const alignWorkerRef = useRef<Worker | null>(null)
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
  /** LLM 清洗缓存：{ 输入文本, 清洗版本 }；文本未变且版本最新时跳过重复清洗 */
  const lyricsCleanRef = useRef<{ text: string; version: number } | null>(null)
  /** 在途清洗 Promise：同一文本并发请求复用，避免保存时重复清洗烧 token */
  const cleanInFlightRef = useRef<Promise<string> | null>(null)
  /** 歌词来源名（自动载入 / 手动载入的文件名，非空时展示） */
  const [lyricsSourceName, setLyricsSourceName] = useState('')
  /** 歌词对齐结果（增强 LRC；随 .stems.zip 持久化，重开恢复） */
  const [alignedLrc, setAlignedLrc] = useState('')
  const alignedLrcRef = useRef('')
  /** 人声轨音素识别结果（随 .stems.zip 持久化；换歌词时复用，跳过重新识别） */
  const phonemesRef = useRef<PhonemeSegment[] | null>(null)
  /** 当前歌词的 .lrc 行时间戳（毫秒，与歌词行一一对应）；仅会话内，随歌词导入重建 */
  const lyricsLineTimesRef = useRef<(number | undefined)[] | null>(null)
  /** 最后一次导入歌词的原始文本（含时间戳，未清洗）；编辑器保存时用于重算行时间戳 */
  const lyricsRawRef = useRef<string | null>(null)
  /** 有效的原始 .lrc 歌词文本（含行时间戳，供「普通歌词」展示真实行定位）；纯文本/手动编辑时为 null */
  const lyricsLrcRef = useRef<string | null>(null)
  /** 歌词对齐是否进行中 */
  const [alignBusy, setAlignBusy] = useState(false)
  /** 对齐进行中的阶段：清洗歌词（LLM）/ 识别 vocals / 自动补救收尾（rescue） */
  const [alignPhase, setAlignPhase] = useState<'clean' | 'recognize' | 'rescue' | null>(null)
  /** 清洗阶段流式进度：模型已输出/已思考的字数（AI 正在干活的感知） */
  const [alignCleanProgress, setAlignCleanProgress] = useState<CleanProgress | null>(null)
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
  /** 编辑草稿每行对应的 .lrc 行时间戳（毫秒；无对应为 undefined），供模态展示时间线 */
  const [lyricsDraftTimes, setLyricsDraftTimes] = useState<(number | undefined)[]>([])
  /** 歌词分析抽屉开关与双击定位到的行 */
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [analysisFocusLine, setAnalysisFocusLine] = useState<number | null>(null)
  /** 歌词分析抽屉：词条试听定时器（片段播完自动停） */
  const analysisPreviewTimerRef = useRef<number | null>(null)
  /** 歌词分析抽屉：应用撤销栈（存应用前的 alignedLrc 与行来源） */
  const analysisUndoRef = useRef<{ lrc: string; sources: LineSource[] }[]>([])
  /** 是否有可撤销的抽屉修改（驱动抽屉「撤销」按钮） */
  const [analysisCanUndo, setAnalysisCanUndo] = useState(false)
  /** 当前对齐结果每行的方案来源（与 karaokeLines 行一一对应；随 .stems.zip 持久化） */
  const [lineSources, setLineSources] = useState<LineSource[]>([])
  const lineSourcesRef = useRef<LineSource[]>([])
  /** 每行补救采用方案的识别段（与 karaokeLines 行一一对应；供追踪图展示候选真实证据） */
  const rescueSegmentsRef = useRef<(HypSegment[] | null)[] | null>(null)
  /** 每行补救的分数留痕（score=候选分、baselineScore=原行分；复盘 dump 用） */
  const rescueStatsRef = useRef<({ score?: number; baselineScore?: number } | null)[] | null>(
    null,
  )
  /** 已跑过自动补救的对齐结果快照：载入时 alignedLrc 与之相同则跳过补救
   * （歌词不变不重复跑补救）；随包持久化为 manifest.rescueAttemptedLrc */
  const rescueAttemptedRef = useRef<string | null>(null)
  /** 载入存档第一段发起的快速重对齐（Worker 内）：第二段解码完成后 await 它
   *  再决定补救/退回识别，避免首段对齐未结束就重复触发识别 */
  const loadAlignPromiseRef = useRef<Promise<void> | null>(null)
  /** 歌词抽屉试听：开 = 只播 vocals 轨（模型实际听到的）；关 = 全轨混音 */
  const [analysisPreviewVocalsOnly, setAnalysisPreviewVocalsOnly] = useState(false)
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
          tags.push({
            lineIndex,
            wordIndex,
            wordCount: words.length,
            text: word.text,
            timeSec: word.timeMs / 1000,
            failed: word.failed,
          })
        }
      } else {
        tags.push({ lineIndex, wordIndex: -1, wordCount: 1, text: line.text, timeSec: line.timeMs / 1000 })
      }
    }
    return tags
  }, [karaokeLines])
  useEffect(() => {
    lyricTagsRef.current = lyricTags
  }, [lyricTags])

  /**
   * 歌词行色带：按源头 LRC 行时间戳间隔划分（当前行 timeMs → 下一有 timeMs 行 timeMs），
   * 供歌词轨渲染交替浅色背景带，一眼看出每行对应的区间。
   * 无 timeMs 的行不产生色带、也不作终点；末行无下一行时兜底到行内最后词 + 0.8s。
   * 色带仅视觉辅助（hover 用），不拦截点击/seek。
   */
  const lyricRowBands = useMemo<{ lineIndex: number; startSec: number; endSec: number; text: string }[]>(() => {
    const timed = karaokeLines
      .map((line, lineIndex) => ({ line, lineIndex }))
      .filter((x): x is { line: LyricsLine; lineIndex: number } => x.line.timeMs !== undefined)
    const bands: { lineIndex: number; startSec: number; endSec: number; text: string }[] = []
    for (let i = 0; i < timed.length; i++) {
      const { line, lineIndex } = timed[i]
      const startSec = (line.timeMs as number) / 1000
      const next = timed[i + 1]
      let endSec = next !== undefined ? (next.line.timeMs as number) / 1000 : Number.NaN
      if (!Number.isFinite(endSec) || endSec <= startSec) {
        // 末行或无下一行：行内最后词 + 0.8s（无逐字则整行 + 1s）
        const lastWordMs = line.words && line.words.length > 0
          ? line.words[line.words.length - 1].timeMs
          : undefined
        endSec = Math.max(startSec + 1, (lastWordMs ?? startSec * 1000 + 1000) / 1000 + 0.8)
      }
      bands.push({ lineIndex, startSec, endSec, text: line.text })
    }
    return bands
  }, [karaokeLines])

  /** 歌词标签布局：leftPct/topPx 依赖 view 与 lyricTags，预计算避免每次渲染重算全量样式。
   *  非全曲视图下按可见窗口裁剪，只渲染窗口内的词（含边界余量，防贴边闪现）。 */
  const lyricTagLayouts = useMemo(() => {
    const span = LYRICS_TRACK_H - LYRICS_TAG_H - LYRICS_TRACK_PAD * 2
    const fullView = viewLen >= duration
    const marginSec = fullView ? 0 : Math.max(0.5, viewLen * 0.05)
    const lo = view.start - marginSec
    const hi = view.start + viewLen + marginSec
    const out: {
      tag: LyricTag
      index: number
      leftPct: number
      topPx: number
    }[] = []
    for (let index = 0; index < lyricTags.length; index++) {
      const tag = lyricTags[index]
      // 可见窗口裁剪：窗口外的词不渲染（全曲视图渲染全部）
      if (!fullView && (tag.timeSec < lo || tag.timeSec > hi)) continue
      const leftPct = viewLen > 0 ? ((tag.timeSec - view.start) / viewLen) * 100 : 0
      // 行内阶梯：同一行的词从高到低垂直堆叠。阶梯整体在轨道内垂直居中，
      // step 按 (轨道高 - 标签高 - 上下边距)/(词数-1) 自适应，
      // 保证最后一个词也落在轨道内、不会溢出被裁。
      const step =
        tag.wordIndex >= 0 && tag.wordCount > 1
          ? Math.min(9, span / (tag.wordCount - 1))
          : 0
      const firstTop =
        tag.wordIndex >= 0
          ? LYRICS_TRACK_PAD + (span - (tag.wordCount - 1) * step) / 2
          : (LYRICS_TRACK_H - LYRICS_TAG_H) / 2
      const topPx =
        tag.wordIndex >= 0
          ? firstTop + tag.wordIndex * step
          : (LYRICS_TRACK_H - LYRICS_TAG_H) / 2
      out.push({ tag, index, leftPct, topPx })
    }
    return out
  }, [lyricTags, view.start, viewLen, duration])

  /** 悬停的歌词行（色带 hover 高亮 + 气泡联动 + popover 原文）；null = 无悬停 */
  const [hoveredLine, setHoveredLine] = useState<number | null>(null)
  /** 行原文 popover 的 DOM 引用（fixed，坐标在 mousemove 里直写，避免高频重渲染） */
  const lyricPopoverRef = useRef<HTMLDivElement | null>(null)

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
      // 保留源音频立体声：按实际声道数取 L/R，真单声道源才复制到双声道。
      // 之前只取第 0 声道复制，等于在入口把整首歌下混成单声道，声像信息全丢。
      const left = decoded.getChannelData(0)
      const right = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : left
      const interleaved = new Float32Array(decoded.length * 2)
      for (let i = 0; i < decoded.length; i++) {
        interleaved[i * 2] = left[i]
        interleaved[i * 2 + 1] = right[i]
      }
      return { interleaved, sampleRate: decoded.sampleRate, duration: decoded.duration }
    },
    [stopPlayback],
  )

  /**
   * 把分轨结果一次性转成 AudioBuffer 缓存（含 L/R 去交错），播放时直接复用。
   * 峰值金字塔：传入 `peaks`（v3 包从 peaks.bin 读出）时直接复用，跳过全量扫描；
   * 否则在填 buffer 的同一循环里聚合桶值，避免「先填 buffer 再 buildWaveformPyramid 扫第二遍」。
   */
  const cacheStemBuffers = useCallback(
    (stems: StemAudio[], rate: number, peaks?: Map<StemId, WaveformPyramid>) => {
      const ctx = audioContextRef.current
      const buffers = new Map<StemId, AudioBuffer>()
      const target = peaks ?? new Map<StemId, WaveformPyramid>()
      // 旧版 peaks.bin 只存 min/max 无 rms：收集后统一在 Worker 里从 PCM 重建带 rms 的金字塔，
      // 避免主线程整曲重扫（长歌每轨百万级采样点，是打开历史包卡顿的来源之一）
      const rebuildQueue: { stemId: StemId; data: Float32Array }[] = []
      for (const stem of stems) {
        const data = stem.data
        const frames = Math.floor(data.length / STEM_CHANNELS)
        if (frames <= 0) {
          // 空/已损坏 PCM：不建播放缓冲与峰值表，避免 createBuffer(0) 抛异常
          continue
        }
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
          // 旧版 peaks.bin 只存 min/max 无 rms：从 PCM 重建一次带 rms 的金字塔，
          // 保证长窗口的响度包络显示与新建金字塔行为一致
          const existing = target.get(stem.stemId)
          if (existing && !existing.rms) {
            rebuildQueue.push({ stemId: stem.stemId, data })
          }
        } else {
          // 合并遍历：填 buffer 同时聚合金字塔桶值
          const min = new Float32Array(bucketCount)
          const max = new Float32Array(bucketCount)
          const ampL = new Float32Array(bucketCount)
          const ampR = new Float32Array(bucketCount)
          const sumSq = new Float32Array(bucketCount)
          const sumSqL = new Float32Array(bucketCount)
          const sumSqR = new Float32Array(bucketCount)
          const counts = new Uint32Array(bucketCount)
          for (let f = 0; f < frames; f++) {
            const l = data[f * STEM_CHANNELS]
            const r = data[f * STEM_CHANNELS + 1]
            if (left && right) {
              left[f] = l
              right[f] = r
            }
            const al = Math.abs(l)
            const ar = Math.abs(r)
            const amp = Math.max(al, ar)
            const b = Math.floor(f / bucketSamples)
            if (amp > max[b]) max[b] = amp
            const neg = -amp
            if (neg < min[b]) min[b] = neg
            if (al > ampL[b]) ampL[b] = al
            if (ar > ampR[b]) ampR[b] = ar
            sumSq[b] += amp * amp
            sumSqL[b] += al * al
            sumSqR[b] += ar * ar
            counts[b]++
          }
          const rms = new Float32Array(bucketCount)
          const rmsL = new Float32Array(bucketCount)
          const rmsR = new Float32Array(bucketCount)
          for (let b = 0; b < bucketCount; b++) {
            rms[b] = counts[b] > 0 ? Math.sqrt(sumSq[b] / counts[b]) : 0
            rmsL[b] = counts[b] > 0 ? Math.sqrt(sumSqL[b] / counts[b]) : 0
            rmsR[b] = counts[b] > 0 ? Math.sqrt(sumSqR[b] / counts[b]) : 0
          }
          if (buffer) buffers.set(stem.stemId, buffer)
          target.set(stem.stemId, { bucketSamples, bucketCount, min, max, rms, ampL, ampR, rmsL, rmsR })
        }
      }
      buffersRef.current = buffers
      peaksRef.current = target
      // 无 rms 的旧包峰值表在 Worker 里补建（PCM transferable，主线程不参与整曲重扫）
      for (const { stemId, data } of rebuildQueue) {
        void buildPeaksInWorker(data, rate, alignWorkerRef)
          .then((pyramid) => {
            const current = peaksRef.current
            if (current) current.set(stemId, pyramid)
          })
          .catch((cause) => {
            console.warn('峰值金字塔补建失败', cause)
          })
      }
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
        const writeArchive = async (codec: StemAudioCodec): Promise<void> => {
          const writer = await filesOpenStreamWrite(stemsArchivePathFor(sourcePath))
          await saveStemsArchive({
            stems,
            sourcePath,
            sourceName,
            durationSec,
            sampleRate: stemSampleRate,
            codec,
            ...(codec === 'flac'
              ? { encodeTrack: (data, rate) => encodeTrackInWorker(data, rate, archiveWorkerRef) }
              : {}),
            tempo: tempoRef.current ?? undefined,
            lyrics: lyricsRef.current.trim() ? lyricsRef.current : undefined,
            lyricsSourceName: lyricsRef.current.trim() ? lyricsSourceName || undefined : undefined,
            lyricsLrc: lyricsLrcRef.current ?? undefined,
            alignedLrc: alignedLrcRef.current || undefined,
            lineSources: lineSourcesRef.current.length > 0 ? lineSourcesRef.current : undefined,
            phonemes: phonemesRef.current ?? undefined,
            rescueAttemptedLrc: rescueAttemptedRef.current ?? undefined,
            sink: {
              write: (chunk) => writer.write(chunk),
              close: () => writer.close(),
            },
            onProgress: (saved) => setSaveProgress(saved),
          })
        }
        if (archiveCodec === 'flac') {
          try {
            await writeArchive('flac')
          } catch (cause) {
            // FLAC 编码不可用/失败 → 回退 WAV 保存并提示，避免数据丢失
            await writeArchive('wav')
            setError(
              `FLAC 无损压缩保存失败，已回退为 WAV 保存：${cause instanceof Error ? cause.message : String(cause)}`,
            )
          }
        } else {
          await writeArchive('wav')
        }
        return true
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        return false
      } finally {
        setSaveProgress(null)
      }
    },
    [sourceName, lyricsSourceName, duration, stemSampleRate, archiveCodec],
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
            label: '无损压缩（FLAC）',
            checked: archiveCodec === 'flac',
            onClick: () => changeArchiveCodec(archiveCodec === 'flac' ? 'wav' : 'flac'),
          },
          { type: 'separator' },
          {
            type: 'action',
            label:
              saveProgress !== null
                ? `保存分轨中 ${saveProgress}/${tracks?.length ?? STEM_IDS.length}…`
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
  }, [sourceName, tracks, saveProgress, loadingArchive, tempoDetecting, handleSaveArchive, archiveCodec, changeArchiveCodec])
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
    lineSourcesRef.current = []
    setLineSources([])
    // 补救候选段随对齐结果一起失效（歌词/音频已变，旧证据不适用）
    rescueSegmentsRef.current = null
    rescueStatsRef.current = null
    // 补救快照一并失效：歌词已变，旧快照不能用来跳过对新歌词的补救
    rescueAttemptedRef.current = null
    setAlignRestoredFrom(false)
    setLyricsHint(hint)
  }, [])

  /** 确保歌词经过最新版本清洗：缓存命中（文本相同 + 版本最新）直接返回；否则 LLM 清洗并写缓存。
   * 只缓存成功结果（失败回退不缓存 → 下次重试）；同一文本并发请求复用同一在途 Promise。 */
  const ensureLyricsCleaned = useCallback(
    async (
      lyricsText: string,
      onProgress?: (progress: CleanProgress) => void,
    ): Promise<string> => {
      if (!lyricsText) return lyricsText
      const cached = lyricsCleanRef.current
      if (cached && cached.text === lyricsText && cached.version === CLEAN_VERSION) {
        return cached.text
      }
      if (cleanInFlightRef.current) return cleanInFlightRef.current
      const promise = (async () => {
        const result = await cleanLyricsWithLlm(lyricsText, onProgress)
        if (result.ok) lyricsCleanRef.current = { text: lyricsText, version: CLEAN_VERSION }
        return result.text
      })()
      cleanInFlightRef.current = promise
      try {
        return await promise
      } finally {
        cleanInFlightRef.current = null
      }
  }, [])

  /**
   * 失败行自动补救收尾 pass：对整首对齐结果里红词多/被挤压的行，按行切窗依次尝试
   * Zipformer 识别 → Zipformer CTC 强制对齐两个备选方案，取匹配度最高且优于原行的
   * 替换进整首 LRC（Rap 等 SenseVoice 弱段用 Zipformer 兜底）。
   * 不依赖触发入口：现场对齐（SenseVoice/Zipformer 识别路径）、复用音素段快速重对齐、
   * 载入恢复都调用本 pass，红行不再漏救。
   * 返回新 LRC 与失败行数；失败行标 rescue-failed（保持原行），来源徽章可看出「补救过但失败」。
   * 每行只传该行窗口音频；失败行多时串行全部处理。
   */
  const runRescuePass = useCallback(
    async (
      baseLrc: string,
      audio: Float32Array,
      sampleRate: number,
      reqId: number,
      opts?: { preUnits?: number },
    ): Promise<{
      lrc: string
      failedCount: number
      improvedCount: number
      rescueSegments: (HypSegment[] | null)[]
      rescueStats: ({ score?: number; baselineScore?: number } | null)[]
    }> => {
      // 整首识别已完成的尝试单元数（alignVocals 传 1）；复用音素重对齐/载入恢复无整首识别 = 0
      const base = opts?.preUnits ?? 0
      const lines = parseLrc(baseLrc).lines
      if (lines.length === 0) {
        return {
          lrc: baseLrc,
          failedCount: 0,
          improvedCount: 0,
          rescueSegments: [],
          rescueStats: [],
        }
      }
      const stats = computeLineStats(lines)
      // 行来源副本：补救替换某行时同步更新该行来源；长度不匹配（如载入恢复）时按整首识别重建
      const sources: LineSource[] =
        lineSourcesRef.current.length === lines.length
          ? [...lineSourcesRef.current]
          : lines.map((): LineSource => `whole-recognize:${alignModel}`)
      // 行时间基准：源 LRC 映射优先（全局对齐结果的时间戳可能被挤坏），回退对齐结果自带 timeMs
      const times = resolveLineTimes(lyricsRef.current, lyricsLrcRef.current, lines)
      const rescueIndexes: number[] = []
      for (let i = 0; i < lines.length; i++) {
        if (shouldRescueLine(stats[i], lines[i])) rescueIndexes.push(i)
      }
      if (rescueIndexes.length === 0) {
        return {
          lrc: baseLrc,
          failedCount: 0,
          improvedCount: 0,
          rescueSegments: lines.map(() => null),
          rescueStats: lines.map(() => null),
        }
      }

      // 预计算每行补救的尝试配额（方案1 识别 1 + 放慢组合 rate<1 时 4 / rate=1 时 2 + 有行时间戳时 CTC 1）
      // 与拉伸计划，作为总尝试单元数：进度 = 已完成单元/总单元，单调递增不再来回跳
      const prepped: {
        lineIndex: number
        win: { startSec: number; endSec: number }
        startMs: number | undefined
        hasLineTime: boolean
        plan: StretchPlan
        quota: number
      }[] = []
      let totalUnits = base
      let failedCount = 0
      for (const lineIndex of rescueIndexes) {
        const line = lines[lineIndex]
        if (!line) continue
        const startMs = times[lineIndex]
        const fallbackSpan = stats[lineIndex]?.spanSec ?? 0.8
        // 无行时间戳时 lineWindowSec 用邻行推算窗口，不再跳过该行（手动「重识别这一行」同样不依赖行时间戳）
        const win = lineWindowSec(times, lineIndex, fallbackSpan)
        const a = Math.floor(win.startSec * sampleRate) * STEM_CHANNELS
        const b = Math.min(audio.length, Math.ceil(win.endSec * sampleRate) * STEM_CHANNELS)
        if (a >= b) {
          sources[lineIndex] = 'rescue-failed'
          failedCount += 1
          continue
        }
        const slice = audio.slice(a, b)
        const spanSec = stats[lineIndex]?.spanSec ?? win.endSec - win.startSec
        const plan = planStretchParams(line.text, spanSec, slice, sampleRate)
        const hasLineTime = startMs !== undefined && startMs >= 0
        const quota = 1 + (plan.rate >= 1 ? 2 : 4) + (hasLineTime ? 1 : 0)
        totalUnits += quota
        prepped.push({ lineIndex, win, startMs, hasLineTime, plan, quota })
      }
      // 配额前缀和：行结束后进度直接跳到该行配额位置（匹配成功的行未用配额被略过 = 快速略过）
      const prefix: number[] = [base]
      for (const p of prepped) prefix.push(prefix[prefix.length - 1] + p.quota)

      let current = baseLrc
      let improvedCount = 0
      const rescuedSegs: (HypSegment[] | null)[] = lines.map(() => null)
      const rescuedStats: ({ score?: number; baselineScore?: number } | null)[] = lines.map(() => null)
      // 已完成尝试单元数：bump 每个模型任务结束（成功/失败）推进一格；行结束补齐到配额位置
      let completed = base
      const bump = () => {
        completed += 1
        setAlignProgress({ chunk: completed, total: totalUnits })
      }
      if (prepped.length > 0) setAlignProgress({ chunk: base + 1, total: totalUnits })
      for (let pi = 0; pi < prepped.length; pi++) {
        const { lineIndex, win, startMs, hasLineTime, plan } = prepped[pi]
        if (alignReqSeqRef.current !== reqId) {
          return {
            lrc: current,
            failedCount,
            improvedCount,
            rescueSegments: rescuedSegs,
            rescueStats: rescuedStats,
          }
        }
        const line = lines[lineIndex]
        const a = Math.floor(win.startSec * sampleRate) * STEM_CHANNELS
        const b = Math.min(audio.length, Math.ceil(win.endSec * sampleRate) * STEM_CHANNELS)
        const slice = audio.slice(a, b)
        const windowLenMs = Math.max(200, Math.round((win.endSec - win.startSec) * 1000))
        try {
          const best = await rescueLine({
            lineText: line.text,
            slice,
            startSec: win.startSec,
            hasLineTime,
            // 原行作为选优基线：候选不优于原行时保持原行（rescueLine 返回 null）
            currentLine: line,
            callbacks: {
              recognize: async (audioSlice) => {
                try {
                  const { segments } = await enqueueAiTask<
                    ZipformerProgress | SenseVoiceProgress,
                    { segments: HypSegment[]; text: string }
                  >(
                    'align-zipformer',
                    { type: 'recognize', audio: audioSlice, sampleRate },
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
                  return segments.length > 0 ? { segments } : null
                } finally {
                  bump()
                }
              },
              // 方案 2：放慢自动搜索——保调放慢后 2 算法 × 2 模型重识别，取最优候选（plan 已预计算）
              autoStretchSearch: async (audioSlice) => {
                const result = await autoSearchLine({
                  lineText: line.text,
                  plan,
                  userModel: alignModel,
                  offsetSec: win.startSec,
                  currentLine: line,
                  callbacks: {
                    stretch: (rate, method) => timeStretchAudio(audioSlice, sampleRate, rate, method),
                    recognize: async (audio, model) => {
                      try {
                        const modelId = model === 'zipformer' ? 'align-zipformer' : 'align-sense-voice'
                        const { segments } = await enqueueAiTask<
                          ZipformerProgress | SenseVoiceProgress,
                          { segments: HypSegment[]; text: string }
                        >(modelId, { type: 'recognize', audio, sampleRate }, {
                          route: (msg) => {
                            if (msg.kind === 'done') {
                              return { action: 'resolve', value: { segments: msg.segments, text: msg.text } }
                            }
                            if (msg.kind === 'error') {
                              return { action: 'reject', error: new Error(msg.message) }
                            }
                            return { action: 'continue' }
                          },
                        })
                        return segments.length > 0 ? segments : null
                      } finally {
                        bump()
                      }
                    },
                    alignBySegments: (shiftedSegments, text) =>
                      alignLineByLineTimes(
                        shiftedSegments,
                        text,
                        startMs !== undefined && startMs >= 0
                          ? startMs
                          : Math.round(win.startSec * 1000),
                        times[lineIndex + 1],
                      ),
                  },
                })
                if (result.best && result.bestCombo && result.best.words && result.best.words.length > 0) {
                  return {
                    line: result.best,
                    segments: result.bestSegments ?? [],
                    model: result.bestCombo.model,
                    score: result.bestScore ?? 0,
                  }
                }
                return null
              },
              forcedAlign: async (audioSlice) => {
                try {
                  const { lines: alignedLines } = await enqueueAiTask<
                    ZipformerProgress,
                    { lines: ZipformerAlignLine[] }
                  >(
                    'align-zipformer',
                    {
                      type: 'align',
                      audio: audioSlice,
                      sampleRate,
                      lyricsLines: [line.text],
                      lineTimesMs: [0, windowLenMs],
                    },
                    {
                      route: (msg) => {
                        if (msg.kind === 'model-loading' || msg.kind === 'model-loaded') {
                          return { action: 'continue' }
                        }
                        if (msg.kind === 'progress') {
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
                  const units = alignedLines[0]?.units ?? []
                  return units.length > 0 ? units : null
                } finally {
                  bump()
                }
              },
              alignBySegments: (shiftedSegments, lineText) =>
                alignLineByLineTimes(
                  shiftedSegments,
                  lineText,
                  startMs !== undefined && startMs >= 0
                    ? startMs
                    : Math.round(win.startSec * 1000),
                  times[lineIndex + 1],
                ),
            },
          })
          // 行内全部尝试结束：进度补齐到该行配额位置（未用配额 = 匹配成功的行被快速略过）
          completed = prefix[pi + 1]
          setAlignProgress({ chunk: completed, total: totalUnits })
          if (alignReqSeqRef.current !== reqId) {
            return {
              lrc: current,
              failedCount,
              improvedCount,
              rescueSegments: rescuedSegs,
              rescueStats: rescuedStats,
            }
          }
          if (best && best.source && best.line && best.line.words && best.line.words.length > 0) {
            const next = patchLineIntoAlignedLrc(current, lineIndex, best.line.words)
            if (next !== current) {
              current = next
              // 候选仍有红词 = 部分补救：来源标注「部分成功」，避免把救回大部分的行误读为失败
              sources[lineIndex] =
                best.source === 'rescue-recognize' && scoreLineUnits(best.line) < 1
                  ? 'rescue-partial:zipformer'
                  : best.source === 'rescue-slow'
                    ? scoreLineUnits(best.line) < 1
                      ? `rescue-partial:${best.model ?? 'zipformer'}`
                      : `rescue-slow:${best.model ?? 'zipformer'}`
                    : best.source
              // 补救候选段的识别证据随行记录：追踪图据此展示该行真实识别段
              rescuedSegs[lineIndex] = best.segments ?? null
              rescuedStats[lineIndex] = { score: best.score, baselineScore: best.baselineScore }
              improvedCount += 1
            }
            // next === current：候选与原行逐字一致，保留原来源（结果无变化，不算失败）
          } else {
            // 补救失败：无候选、候选不优于原行或模型无结果，保持原行并标记可见
            sources[lineIndex] = 'rescue-failed'
            rescuedStats[lineIndex] = { baselineScore: best?.baselineScore }
            failedCount += 1
          }
        } catch {
          // 单行补救失败（模型错误/无结果）：保持原行并标记，不阻断后续行
          sources[lineIndex] = 'rescue-failed'
          failedCount += 1
        }
      }
      setAlignProgress(null)
      lineSourcesRef.current = sources
      setLineSources(sources)
      rescueSegmentsRef.current = rescuedSegs
      rescueStatsRef.current = rescuedStats
      return {
        lrc: current,
        failedCount,
        improvedCount,
        rescueSegments: rescuedSegs,
        rescueStats: rescuedStats,
      }
    },
    [alignModel],
  )

  /**
   * 复用已缓存的音素段把歌词快速对齐（纯函数文本对齐，秒级）：
   * 换歌词后不必重跑 Zipformer 识别，直接用旧识别段对齐新歌词。
   * 无音素段或对齐不出结果时返回 false（调用方回退到重新识别）。
   * opts.skipRescue：只做文本对齐不跑补救收尾（载入存档第一段调用时 vocals 尚未解码，
   * 补救统一由解码完成后的收尾 pass 执行，避免重复/空数据补救）。
   */
  const realignFromPhonemes = useCallback(
    async (lyricsText: string, opts?: { skipRescue?: boolean }): Promise<boolean> => {
      const phonemes = phonemesRef.current
      if (!phonemes || phonemes.length === 0) return false
      // 整首 DTW 对齐放进 Worker：主线程不跑百万格 DP 矩阵（打开历史包/换歌词时的卡死主因）
      let lrc = ''
      try {
        lrc = await alignSegmentsInWorker(
          phonemes,
          lyricsText,
          lyricsLineTimesRef.current ?? null,
          alignWorkerRef,
        )
      } catch (cause) {
        console.warn('后台文本对齐失败，回退主线程', cause)
        lrc = alignSegmentsToLrc(phonemes, lyricsText, lyricsLineTimesRef.current ?? undefined)
      }
      if (!lrc) return false
      alignedLrcRef.current = lrc
      setAlignedLrc(lrc)
      // 复用音素段快速重对齐 = 整首识别 + 文本对齐路径（模型按当前选中标记）
      const sources: LineSource[] = parseLrc(lrc).lines.map(
        (): LineSource => `whole-recognize:${alignModel}`,
      )
      lineSourcesRef.current = sources
      setLineSources(sources)
      setAlignRestoredFrom(false)
      setLyricsHint(null)
      if (opts?.skipRescue) return true
      // 复用音素段同样走补救收尾 pass：红词多/被挤压的行切窗用 Zipformer 识别/CTC 兜底
      const vocals = tracksRef.current?.find((t) => t.audio.stemId === 'vocals')?.audio.data
      if (vocals && vocals.length > 0) {
        const reqId = (alignReqSeqRef.current += 1)
        setAlignBusy(true)
        setAlignPhase('rescue')
        setAlignProgress(null)
        setAlignError(null)
        try {
          const rescued = await runRescuePass(lrc, vocals, stemSampleRate, reqId)
          if (alignReqSeqRef.current !== reqId) return true
          if (rescued.lrc !== lrc) {
            alignedLrcRef.current = rescued.lrc
            setAlignedLrc(rescued.lrc)
          }
          // 补救快照更新为最终结果并随包落盘：换歌词后重新对齐并补救过，
          // 下次载入同一份结果不再重复补救
          rescueAttemptedRef.current = rescued.lrc
          setLyricsHint(formatRescueSummary(rescued.improvedCount, rescued.failedCount))
          const tracksNow = tracksRef.current
          if (tracksNow) void saveCurrentStems(tracksNow.map((t) => t.audio))
        } finally {
          if (alignReqSeqRef.current === reqId) {
            setAlignBusy(false)
            setAlignPhase(null)
            setAlignProgress(null)
          }
        }
      }
      return true
    },
    [alignModel, runRescuePass, saveCurrentStems, stemSampleRate],
  )

  /**
   * 歌词对齐：对人声轨跑 CTC 识别（zipformer 中文 / SenseVoice 五语，耗时）→
   * 纯函数文本对齐（快速）生成增强 LRC，写入 alignedLrcRef/state（随 .stems.zip 持久化）。
   * 陈旧响应（重新分轨/换歌）不覆盖新结果；失败提示、不影响主流程。
   * 返回是否成功产出 LRC。
   */
  const alignVocals = useCallback(
    async (audio: Float32Array, sampleRate: number): Promise<boolean> => {
      const reqId = (alignReqSeqRef.current += 1)
      // 立即进入 busy：先 LLM 清洗（可能是旧版本歌词），再识别 vocals，
      // 避免点击对齐后 UI 无任何反馈的静默期
      setAlignBusy(true)
      setAlignPhase('clean')
      setAlignCleanProgress(null)
      setAlignProgress(null)
      setAlignError(null)
      setLyricsHint(null)
      // 对齐前确保歌词经过最新版本 LLM 清洗（文本未变但 CLEAN_VERSION 升级时自动重洗）；
      // 流式进度回传 UI，让用户看到 AI 正在输出
      const lyricsText = await ensureLyricsCleaned(lyricsRef.current, (progress) => {
        setAlignCleanProgress(progress)
      })
      if (!lyricsText.trim()) {
        setAlignBusy(false)
        setAlignPhase(null)
        setAlignCleanProgress(null)
        setLyricsHint('请先提供歌词（粘贴或载入 .lrc 歌词文件）再对齐')
        return false
      }
      // 清洗结果写回主界面：用户点对齐后立即看到干净歌词，而非旧版本残留
      if (lyricsText !== lyricsRef.current) {
        lyricsRef.current = lyricsText
        setLyrics(lyricsText)
      }
      setAlignPhase('recognize')
      setAlignCleanProgress(null)
      try {
        const modelId = alignModel === 'sense-voice' ? 'align-sense-voice' : 'align-zipformer'

        // zipformer + 有行时间戳 → CTC 强制对齐（绕开识别文本，英文行用 zipformer-ctc-en）
        if (modelId === 'align-zipformer') {
          const lineTimesRef = lyricsLineTimesRef.current
          const hasLineTimes = lineTimesRef !== null && lineTimesRef.some((t) => t !== undefined)
          if (hasLineTimes) {
            const cleanedLines = lyricsText.split('\n')
            const skeleton = buildLyricsSkeleton(lyricsText)
            // lineTimesRef 与 cleanedLines 一一对应；skeleton 过滤了空行，需对齐行序
            const timesForSkeleton: (number | undefined)[] = []
            let src = 0
            for (const rawLine of cleanedLines) {
              const t = src < lineTimesRef.length ? lineTimesRef[src] : undefined
              src += 1
              if (rawLine.trim()) timesForSkeleton.push(t)
            }
            const estimated = estimateLineTimes(timesForSkeleton)
            if (estimated.every((t) => t !== undefined)) {
              const est = estimated as number[]
              const fallbackEndMs = (audio.length / sampleRate) * 1000
              const times = expandStarvedLineTimes(
                est,
                skeleton.map((l) => l.units.length),
                fallbackEndMs,
              )
              const lastWords = Math.max(1, skeleton[skeleton.length - 1].units.length)
              const lineTimesMs = [
                ...times,
                times[times.length - 1] + lastWords * MIN_LINE_WORD_MS,
              ]
              const { lines: alignedLines } = await enqueueAiTask<
                ZipformerProgress,
                { lines: ZipformerAlignLine[] }
              >(
                modelId,
                {
                  type: 'align',
                  audio,
                  sampleRate,
                  lyricsLines: skeleton.map((l) => l.text),
                  lineTimesMs,
                },
                {
                  route: (msg) => {
                    if (msg.kind === 'model-loading' || msg.kind === 'model-loaded') {
                      return { action: 'continue' }
                    }
                    if (msg.kind === 'progress') {
                      setAlignProgress({ chunk: msg.chunk, total: msg.total })
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
              if (alignReqSeqRef.current !== reqId) return false
              // 拍平成行级 AlignedUnit，交给 buildAlignLrc 生成增强 LRC
              const units: AlignedUnit[] = []
              for (const lineUnits of alignedLines) {
                for (const u of lineUnits.units) {
                  units.push({
                    text: u.text,
                    phones: [],
                    start: u.start,
                    end: u.end,
                    failed: u.confident === false,
                  })
                }
              }
              const lrc = buildAlignLrc(units, skeleton)
              if (alignReqSeqRef.current !== reqId) return false
              if (!lrc) {
                setAlignError('对齐结果为空，请重试')
                return false
              }
              // 存单元段（symbol = 歌词原文，换歌词快速重对齐的文本匹配必然命中）
              phonemesRef.current = units.map((u) => ({
                symbol: u.text,
                start: u.start,
                end: u.end,
              }))
              alignedLrcRef.current = lrc
              setAlignedLrc(lrc)
              const ctcSources: LineSource[] = skeleton.map(() => 'whole-ctc:zipformer')
              lineSourcesRef.current = ctcSources
              setLineSources(ctcSources)
              setAlignRestoredFrom(false)
              return true
            }
          }
        }

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
              if (msg.kind === 'error') {
                return { action: 'reject', error: new Error(msg.message) }
              }
              return { action: 'reject', error: new Error('识别服务返回未知消息') }
            },
          },
        )
        if (alignReqSeqRef.current !== reqId) return false
        phonemesRef.current = segments
        const lrc = alignSegmentsToLrc(segments, lyricsText, lyricsLineTimesRef.current ?? undefined)
        if (alignReqSeqRef.current !== reqId) return false
        if (!lrc) {
          setAlignError('识别结果为空或歌词无可对齐内容，请重试')
          return false
        }
        alignedLrcRef.current = lrc
        setAlignedLrc(lrc)
        const recogSources: LineSource[] = parseLrc(lrc).lines.map(
          (): LineSource => `whole-recognize:${alignModel}`,
        )
        lineSourcesRef.current = recogSources
        setLineSources(recogSources)
        setAlignRestoredFrom(false)
        // 失败行自动补救收尾：SenseVoice 与 Zipformer 识别路径共用（Zipformer 整首 CTC 路径
        // 已提前 return，走到这里必然是识别路径）。行窗备选（识别 / CTC）与整首主路径不同，
        // 对红词多/被挤压的行可再救一次；失败行标 rescue-failed 并提示可手动修复
        const rescued = await runRescuePass(lrc, audio, sampleRate, reqId, { preUnits: 1 })
        if (alignReqSeqRef.current !== reqId) return false
        if (rescued.lrc !== lrc) {
          alignedLrcRef.current = rescued.lrc
          setAlignedLrc(rescued.lrc)
        }
        // 补救快照更新为最终结果：后续 saveCurrentStems 时随包落盘，
        // 下次载入同一份结果不再重复补救
        rescueAttemptedRef.current = rescued.lrc
        setAlignError(formatRescueSummary(rescued.improvedCount, rescued.failedCount))
        return true
      } catch (cause) {
        if (alignReqSeqRef.current !== reqId) return false
        setAlignError(cause instanceof Error ? cause.message : String(cause))
        return false
      } finally {
        if (alignReqSeqRef.current === reqId) {
          setAlignBusy(false)
          setAlignPhase(null)
          setAlignCleanProgress(null)
        }
      }
    },
    [alignModel, ensureLyricsCleaned, runRescuePass],
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

        // 人声用 MDX 结果；htdemucs 的 vocals 通道（伴奏残余）作为「其他二」。
        // 检测该残余是否近似空轨（静音块占比 ≥ STEM_SILENCE_MERGE_RATIO）：
        // 近似空轨时并入「其他一」（htdemucs 通道互补，直接求和不丢内容），否则单列 other2 保留独立控制。
        const htdemucsVocals = done.stems.find((s) => s.stemId === 'vocals')
        if (!htdemucsVocals) throw new Error('htdemucs 输出缺少 vocals 轨')
        const mergeResidual =
          silenceRatio(htdemucsVocals.data) >= STEM_SILENCE_MERGE_RATIO
        const stems: StemAudio[] = done.stems.flatMap((s) => {
          if (s.stemId === 'vocals') {
            return [{ stemId: 'vocals', data: mdx.vocals }]
          }
          if (mergeResidual && s.stemId === 'other') {
            return [{ stemId: 'other', data: mixStems(s.data, htdemucsVocals.data) }]
          }
          return [s]
        })
        if (!mergeResidual) {
          stems.push({ stemId: 'other2', data: htdemucsVocals.data })
        }
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
      loadAlignPromiseRef.current = null
      // 补救快照随文件重置（正常恢复分支会按 manifest 重新设置）
      rescueAttemptedRef.current = null
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
          manifest.stems.map(({ id }) => ({
            audio: { stemId: id, data: new Float32Array(0) },
            mute: false,
            solo: false,
            volume: 1,
          })),
        )
        setPlaying(false)
        setCurrentTime(0)
        // —— 歌词数据恢复（纯文本，不依赖解码）：与波形占位同帧完成，歌词轨不再等解码结束 ——
        // 包内原始歌词兜底：同目录 .lrc 缺失时恢复（手动粘贴歌词也能重开回来），
        // 让「对齐歌词」保持可用、编辑模态显示原文
        if (!lyricsRef.current.trim() && manifest.lyrics?.trim()) {
          lyricsRef.current = manifest.lyrics
          setLyrics(manifest.lyrics)
          setLyricsSourceName(manifest.lyricsSourceName || '来自分轨包')
        }
        // 普通歌词的原始 .lrc 文本（含行时间戳）随包恢复
        if (manifest.lyricsLrc) lyricsLrcRef.current = manifest.lyricsLrc
        // 恢复 .lrc 行时间戳：对齐依赖行窗口主导；缺失时重新对齐退化为
        // 全局文本对齐，识别断层段（如副歌和声）的词会被插值压到前一锚点附近堆叠。
        // 会话内已由同名 .lrc 自动载入建立的 lineTimes 不覆盖。
        if (lyricsLineTimesRef.current === null && manifest.lyricsLrc && lyricsRef.current.trim()) {
          lyricsLineTimesRef.current = mapLrcLineTimes(manifest.lyricsLrc, lyricsRef.current.split('\n'))
        }
        // 音素段（人声轨识别结果）随包恢复：换歌词时复用，跳过重新识别
        if (manifest.phonemes) phonemesRef.current = manifest.phonemes
        // 歌词对齐结果随包恢复；旧坏结果（歌词时间戳未剥离）跳过并提示重新对齐
        if (manifest.alignedLrc && !looksLikeBrokenLrc(manifest.alignedLrc)) {
          const restoredLrc = manifest.alignedLrc
          alignedLrcRef.current = restoredLrc
          setAlignedLrc(restoredLrc)
          // 行来源：新包有记录则恢复；旧包无记录时全部标「载入恢复」
          const lineCount = parseLrc(restoredLrc).lines.length
          const restoredSources: LineSource[] =
            manifest.lineSources && manifest.lineSources.length === lineCount
              ? manifest.lineSources
              : new Array<LineSource>(lineCount).fill('restored')
          lineSourcesRef.current = restoredSources
          setLineSources(restoredSources)
          // 补救快照恢复：本次打开已补救过同一份 alignedLrc → 跳过自动补救收尾；
          // 无快照（老包/新对齐）→ 解码完成后跑一次并落盘
          rescueAttemptedRef.current = manifest.rescueAttemptedLrc ?? null
          // 包内无补救候选段记录：清空后由解码完成后补救收尾 pass 重跑填充
          rescueSegmentsRef.current = null
          rescueStatsRef.current = null
          setAlignRestoredFrom(true)
          setLyricsHint(null)
        } else if (manifest.alignedLrc) {
          clearAlignedResult('检测到旧版损坏的对齐结果，已跳过恢复；可点击「对齐歌词」重新对齐')
        } else if (lyricsRef.current.trim()) {
          // 包内无有效歌词结果但歌词已就绪：优先复用音素段快速重对齐（秒级，纯文本），
          // 无音素段时退回重跑识别（等 vocals 解码后触发）。setTimeout 让出主线程
          // 确保波形占位/歌词占位先渲染；skipRescue：补救收尾统一由下面解码完成后的
          // 收尾 pass 执行（此时 vocals 已就绪）。promise 在首段对齐完成后 resolve，
          // 第二段解码结束后 await 它，避免首段对齐尚未结束就重复触发识别
          loadAlignPromiseRef.current = new Promise<void>((resolve) => {
            setTimeout(() => {
              // 期间换歌/重新分轨 → 丢弃（refs 可能已被新文件覆盖，重算无意义）
              if (loadArchiveSeqRef.current !== seq) {
                resolve()
                return
              }
              void realignFromPhonemes(lyricsRef.current, { skipRescue: true })
                .then((ok) => {
                  if (ok) setAlignRestoredFrom(true)
                })
                .finally(() => resolve())
            }, 0)
          })
        }
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
                const audio = await decodeTrackInWorker(
                  item.id,
                  data,
                  entry.method,
                  archiveWorkerRef,
                  item.file.endsWith('.flac') ? 'flac' : 'wav',
                )
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
            // 歌词文本/行时间/音素/对齐结果已在第一段随波形占位恢复；
            // 此处只做依赖 vocals 解码的收尾：
            // 1) 有对齐结果（恢复或第一段文本对齐）→ 对红行跑自动补救收尾（vocals 已解码）
            // 2) 无对齐结果但第一段发起了快速重对齐（无 alignedLrc 且有歌词）→
            //    首段对齐失败（无音素段）时退回重跑识别
            // 等待第一段发起的快速重对齐结束（若有），避免首段对齐未完就重复触发识别
            if (loadAlignPromiseRef.current) {
              await loadAlignPromiseRef.current
            }
            const restoredLrc = alignedLrcRef.current
            if (restoredLrc) {
              const vocals = stems.find((s) => s.stemId === 'vocals')
              if (vocals && vocals.data.length > 0) {
                // 已补救过同一份 alignedLrc：跳过自动补救（歌词未变不重复尝试）。
                // 若仍有未救回的红行（rescue-failed），给静态提示以便用户手动处理
                if (rescueAttemptedRef.current === restoredLrc) {
                  const failedCount = lineSourcesRef.current.filter((s) => s === 'rescue-failed').length
                  if (failedCount > 0) {
                    setLyricsHint(`有 ${failedCount} 行补救失败，可在歌词分析抽屉手动修复`)
                  }
                  return
                }
                void (async () => {
                  const reqId = (alignReqSeqRef.current += 1)
                  setAlignBusy(true)
                  setAlignPhase('rescue')
                  setAlignProgress(null)
                  setAlignError(null)
                  try {
                    const rescued = await runRescuePass(
                      restoredLrc,
                      vocals.data,
                      manifest.sampleRate,
                      reqId,
                    )
                    if (alignReqSeqRef.current !== reqId) return
                    // 补救快照标记最终 lrc：无论成功/部分/全败都落盘，
                    // 保证歌词不变时下次打开不再重复跑补救
                    const hadSnapshot = rescueAttemptedRef.current !== null
                    rescueAttemptedRef.current = rescued.lrc
                    if (
                      rescued.lrc !== restoredLrc ||
                      rescued.failedCount > 0 ||
                      !hadSnapshot
                    ) {
                      alignedLrcRef.current = rescued.lrc
                      setAlignedLrc(rescued.lrc)
                      void saveCurrentStems(stems)
                    }
                    setLyricsHint(formatRescueSummary(rescued.improvedCount, rescued.failedCount))
                  } finally {
                    if (alignReqSeqRef.current === reqId) {
                      setAlignBusy(false)
                      setAlignPhase(null)
                      setAlignProgress(null)
                    }
                  }
                })()
              }
            } else if (loadAlignPromiseRef.current && lyricsRef.current.trim()) {
              // 首段快速重对齐未产出结果（无音素段/对齐为空）：退回重跑识别（vocals 已解码）。
              // 仅第一段发起过快速对齐时触发；损坏 alignedLrc 分支只提示不自动识别
              const vocals = stems.find((s) => s.stemId === 'vocals')
              if (vocals) void alignVocals(vocals.data, manifest.sampleRate)
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
    [cacheStemBuffers, clearAlignedResult, detectTempoAsync, alignVocals, realignFromPhonemes, runRescuePass, saveCurrentStems, stopPlayback],
  )

  /**
   * 按绝对路径打开源文件（对话框选文件 / 最近打开历史共用）：
   * 设置源路径、清空旧状态、自动探测同名 .lrc 歌词，同目录有 .stems.zip 则直接载入分轨，
   * 否则自动开始分轨。打开成功后写入「最近打开」历史。
   */
  const openSourceByPath = useCallback(
    async (path: string, name?: string) => {
      const node = await resolveNodeByAbsolutePath(path)
      if (!node || node.kind !== 'file') return false
      const displayName = name ?? node.name
      sourcePathRef.current = node.id
      sourceAbsolutePathRef.current = path
      setSourceName(displayName)
      setTracks(null)
      setProgress(null)
      setError(null)
      setCurrentTime(0)
      // 换歌：清空歌词与旧对齐结果，随后自动探测同名 .lrc
      lyricsRef.current = ''
      setLyrics('')
      setLyricsSourceName('')
      lyricsLineTimesRef.current = null
      lyricsRawRef.current = null
      lyricsLrcRef.current = null
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
            lyricsLineTimesRef.current = mapLrcLineTimes(text, cleaned.split('\n'))
            lyricsRawRef.current = text
            lyricsLrcRef.current = text
            const lrcName = lrcPath.slice(lrcPath.lastIndexOf('/') + 1)
            setLyricsSourceName(`自动载入：${lrcName}`)
          }
        } catch (cause) {
          console.warn('自动载入歌词失败', cause)
        }
      }
      // 记录「最近打开」历史
      const project = { path, name: displayName, openedAt: Date.now() }
      setRecentProjects((prev) => {
        const next = pushRecentProject(prev, project)
        saveRecentProjects(next)
        return next
      })
      // 同目录有已保存的分轨压缩包 → 直接载入，不再推理
      const loaded = await tryLoadSavedStems(path)
      if (!loaded) handleSeparateRef.current()
      return true
    },
    [tryLoadSavedStems, clearAlignedResult],
  )

  const handlePickFile = useCallback(async () => {
    const path = await showSystemOpenDialog({
      title: '选择要分轨的音乐文件',
      acceptExtensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'],
    })
    if (!path) return
    await openSourceByPath(path)
  }, [showSystemOpenDialog, openSourceByPath])

  /** 从「最近打开」直接重开：源文件仍存在则打开，否则从历史移除并提示。 */
  const handleOpenRecent = useCallback(
    async (path: string) => {
      const node = await resolveNodeByAbsolutePath(path)
      if (!node || node.kind !== 'file') {
        setRecentProjects((prev) => {
          const next = removeRecentProject(prev, path)
          saveRecentProjects(next)
          return next
        })
        setError('文件已不存在，已从最近打开移除')
        return
      }
      await openSourceByPath(path, node.name)
    },
    [openSourceByPath],
  )

  /** 从「最近打开」移除单条（不打开文件）。 */
  const handleRemoveRecent = useCallback((path: string) => {
    setRecentProjects((prev) => {
      const next = removeRecentProject(prev, path)
      saveRecentProjects(next)
      return next
    })
  }, [])

  /** 把清洗后的歌词写入 state/ref（剪贴板与文件导入共用收尾）；lineTimes 为 .lrc 行时间戳 */
  const applyLyrics = useCallback(
    (cleaned: string, sourceName: string, lineTimes?: (number | undefined)[], lrcRaw?: string) => {
      lyricsRef.current = cleaned
      setLyrics(cleaned)
      setLyricsSourceName(sourceName)
      lyricsLineTimesRef.current = lineTimes ?? null
      // 仅在提供有效 .lrc 原始文本时更新普通歌词来源（手动编辑/纯文本不清旧值以免丢失）
      if (lrcRaw) lyricsLrcRef.current = lrcRaw
      // 后台 LLM 清洗（剥「徐/刘：」等规则洗不掉的内容），行数不变故行时间戳仍有效；
      // 清洗中给出反馈；清洗后如有音素段直接快速重对齐，否则提示重新对齐
      if (!alignedLrcRef.current) setLyricsHint('清洗歌词中…')
      void ensureLyricsCleaned(cleaned).then(async (llmCleaned) => {
        if (lyricsRef.current !== cleaned) return // 已被更新的歌词覆盖
        if (llmCleaned !== cleaned) {
          lyricsRef.current = llmCleaned
          setLyrics(llmCleaned)
          // 清洗结果文本同样视为「已按最新版本清洗」，避免对齐入口对 llmCleaned 二次调用
          lyricsCleanRef.current = { text: llmCleaned, version: CLEAN_VERSION }
        }
        if (await realignFromPhonemes(llmCleaned)) return
        if (alignedLrcRef.current) clearAlignedResult('歌词已更新，点击「对齐歌词」重新对齐')
        else setLyricsHint(null) // 无对齐结果且清洗完成：清掉「清洗歌词中…」，避免残留
      })
    },
    [clearAlignedResult, realignFromPhonemes, ensureLyricsCleaned],
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
      lyricsRawRef.current = text
      setLyricsDraftTimes(mapLrcLineTimes(text, cleaned.split('\n')))
    } catch (cause) {
      setAlignError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [showSystemOpenDialog])

  /** 打开编辑歌词模态：草稿取当前歌词，来源名继承（新导入会覆盖）；展示行时间戳时间线 */
  const openLyricsEditor = useCallback(() => {
    const draft = lyricsRef.current
    setLyricsDraft(draft)
    setLyricsDraftSource(lyricsSourceName)
    setLyricsDraftTimes(mapLrcLineTimes(lyricsRawRef.current ?? draft, draft.split('\n')))
    setLyricsEditorOpen(true)
  }, [lyricsSourceName])

  /** 从系统剪贴板导入到编辑草稿（保存时才应用） */
  const importClipboardToDraft = useCallback(async () => {
    if (navigator.clipboard?.readText) {
      try {
        const text = await navigator.clipboard.readText()
        if (text) {
          const draft = text.trim()
          setLyricsDraft(draft)
          setLyricsDraftSource('从剪贴板导入')
          lyricsRawRef.current = text
          setLyricsDraftTimes(mapLrcLineTimes(text, stripLrcMarkup(draft).trim().split('\n')))
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
      lyricsLineTimesRef.current = null
      clearAlignedResult(null)
      return
    }
    // 从草稿原始文本（含时间戳）重算行时间戳；无原始文本（手动编辑）则清空
    const rawForTimes = lyricsRawRef.current ?? lyricsDraft
    const lineTimes = mapLrcLineTimes(rawForTimes, cleaned.split('\n'))
    applyLyrics(
      cleaned,
      lyricsDraftSource || '手动编辑',
      lineTimes,
      looksLikeLrc(rawForTimes) ? rawForTimes : undefined,
    )
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

  /** 从 offset 秒开始播放全部轨；mute/solo/音量由各轨 GainNode 即时控制。
   * opts.onlyStemId：只播指定轨（歌词抽屉试听只用 vocals），此时强制该轨出声、
   * 用该轨音量、忽略 mute/solo——试听要能听到模型实际「听到」的声音。 */
  const startPlayback = useCallback(
    (startOffset: number, opts?: { onlyStemId?: StemId }) => {
      if (!tracks || !audioContextRef.current) return
      const ctx = audioContextRef.current
      const buffers = buffersRef.current
      if (!buffers) return
      stopPlayback()
      // 防止 seek 到文件末尾时 start(0, offset) 越界抛错
      const offset = Math.min(Math.max(0, startOffset), Math.max(0, duration - 0.01))
      startOffsetRef.current = offset
      startedAtRef.current = ctx.currentTime
      const only = opts?.onlyStemId
      for (const track of tracks) {
        if (only !== undefined && track.audio.stemId !== only) continue
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
      if (only !== undefined) {
        const gain = gainNodesRef.current.get(only)
        if (gain) {
          const track = tracks.find((t) => t.audio.stemId === only)
          gain.gain.value = track ? track.volume : 1
        }
      } else {
        applyGains(gainNodesRef.current, tracks)
      }
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

  // —— 歌词分析抽屉：词条试听 / 应用写回 / 撤销 ——
  /** 停止抽屉试听（片段播完 / 关闭抽屉 / 切换试听时） */
  const stopPreviewSegment = useCallback(() => {
    if (analysisPreviewTimerRef.current !== null) {
      window.clearTimeout(analysisPreviewTimerRef.current)
      analysisPreviewTimerRef.current = null
    }
    stopPlayback()
  }, [stopPlayback])

  /** 试听 [startSec, endSec)：seek 到起点开始播放，到终点自动停。
   * analysisPreviewVocalsOnly 开启时只播 vocals 轨（与识别链路同源）。 */
  const previewSegment = useCallback(
    (startSec: number, endSec: number) => {
      if (!tracks) return
      if (analysisPreviewTimerRef.current !== null) {
        window.clearTimeout(analysisPreviewTimerRef.current)
        analysisPreviewTimerRef.current = null
      }
      handleSeekInput(startSec)
      startPlayback(
        startSec,
        analysisPreviewVocalsOnly ? { onlyStemId: 'vocals' } : undefined,
      )
      const durMs = Math.max(180, Math.round((endSec - startSec) * 1000))
      analysisPreviewTimerRef.current = window.setTimeout(() => {
        analysisPreviewTimerRef.current = null
        stopPlayback()
      }, durMs)
    },
    [tracks, handleSeekInput, startPlayback, stopPlayback, analysisPreviewVocalsOnly],
  )

  /** 应用抽屉修复：只替换聚焦行逐字时间戳，写回 alignedLrc 并落盘，保留撤销。
   *  source 为该修复动作的方案来源（manual-*），替换行来源供抽屉展示。 */
  const applyAnalysisLine = useCallback(
    (focusLine: number, newWords: LyricsWord[], source: LineSource) => {
      const cur = alignedLrcRef.current
      if (!cur || newWords.length === 0) return
      const patched = patchLineIntoAlignedLrc(cur, focusLine, newWords)
      if (patched === cur) return
      analysisUndoRef.current.push({ lrc: cur, sources: [...lineSourcesRef.current] })
      setAnalysisCanUndo(true)
      alignedLrcRef.current = patched
      setAlignedLrc(patched)
      const sources = [...lineSourcesRef.current]
      if (focusLine < sources.length) {
        sources[focusLine] = source
      } else {
        // 行数不匹配（旧包无来源记录）时补齐后写入
        while (sources.length <= focusLine) sources.push('restored')
        sources[focusLine] = source
      }
      lineSourcesRef.current = sources
      setLineSources(sources)
      setAlignRestoredFrom(false)
      // 手动修复视为已处理：快照更新为新 lrc，避免下次打开自动补救覆盖用户修正
      rescueAttemptedRef.current = patched
      const tracksNow = tracksRef.current
      if (tracksNow) void saveCurrentStems(tracksNow.map((t) => t.audio))
    },
    [saveCurrentStems],
  )

  /** 撤销最近一次抽屉应用，恢复上一份 alignedLrc 与行来源并落盘 */
  const undoAnalysisLine = useCallback(() => {
    const prev = analysisUndoRef.current.pop()
    if (prev === undefined) return
    alignedLrcRef.current = prev.lrc
    setAlignedLrc(prev.lrc)
    lineSourcesRef.current = prev.sources
    setLineSources(prev.sources)
    setAnalysisCanUndo(analysisUndoRef.current.length > 0)
    const tracksNow = tracksRef.current
    if (tracksNow) void saveCurrentStems(tracksNow.map((t) => t.audio))
  }, [saveCurrentStems])

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
   *
   * 依赖必须同时含 tracks：容器随 tracks 从无到有挂载（分轨完成 / 存档载入 /
   * 换歌），而 handleWheelZoom 只随 view/duration 变化——两者不同步时监听器
   * 会漏绑（全新分轨后 effect 已跑过但 node 为 null 跳过，后续 view 不变则
   * 不再重跑），导致捏合被 document 级 ctrl+wheel 拦截、缩放完全失灵，
   * 直到缩放条改变 view 触发重绑才恢复。
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
  }, [handleWheelZoom, tracks])

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
      alignWorkerRef.current?.terminate()
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

  /** 分轨进行中（含载入已保存结果）：空态只显示进度，不显示装饰与引导 */
  const emptyBusy = isSeparating || loadingArchive

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
              {mdxProvider === 'webgpu' ? 'WebGPU · MDX' : 'WASM · MDX'}
            </span>
          )}
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
              style={{ '--stems-vol-fill': `${metronomeVolume * 100}%` } as Record<string, string>}
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
                onDblClick={(event) => {
                  // 双击歌词轨 → 定位所在行 → 打开歌词分析抽屉
                  if (lyricTags.length === 0 || karaokeLines.length === 0) return
                  const rect = event.currentTarget.getBoundingClientRect()
                  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)))
                  const sec = view.start + ratio * viewLen
                  let lineIndex = -1
                  for (let i = 0; i < karaokeLines.length; i++) {
                    const t = karaokeLines[i].timeMs
                    if (t !== undefined && t / 1000 <= sec) lineIndex = i
                  }
                  if (lineIndex < 0) lineIndex = 0
                  setAnalysisFocusLine(lineIndex)
                  setAnalysisOpen(true)
                }}
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
                    {lyricRowBands.map((band, bandIndex) => {
                      const leftPct = viewLen > 0 ? ((band.startSec - view.start) / viewLen) * 100 : 0
                      const widthPct = viewLen > 0 ? ((band.endSec - band.startSec) / viewLen) * 100 : 0
                      const hot = hoveredLine === band.lineIndex
                      return (
                        <div
                          key={band.lineIndex}
                          class={`stems__lyrics-row-band ${
                            bandIndex % 2 === 0
                              ? 'stems__lyrics-row-band--a'
                              : 'stems__lyrics-row-band--b'
                          }${hot ? ' stems__lyrics-row-band--hot' : ''}`}
                          style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 1.5)}%` }}
                          onMouseEnter={() => setHoveredLine(band.lineIndex)}
                          onMouseLeave={() => setHoveredLine(null)}
                          onMouseMove={(event) => {
                            // popover 跟随鼠标（fixed，右缘 clamp），直写 DOM 避免高频重渲染
                            const pop = lyricPopoverRef.current
                            if (!pop) return
                            const left = Math.min(event.clientX + 14, window.innerWidth - 280)
                            const top = event.clientY + 14
                            pop.style.left = `${left}px`
                            pop.style.top = `${top}px`
                          }}
                        />
                      )
                    })}
                    {lyricTagLayouts.map(({ tag, index, leftPct, topPx }) => {
                      return (
                        <span
                          key={`${tag.lineIndex}:${tag.wordIndex}:${index}`}
                          ref={(el) => registerLyricsTag(tag.lineIndex, tag.wordIndex, el)}
                          class={`stems__lyrics-tag${tag.failed ? ' stems__lyrics-tag--failed' : ''}${
                            hoveredLine !== null
                              ? tag.lineIndex === hoveredLine
                                ? ' stems__lyrics-tag--hl'
                                : ' stems__lyrics-tag--dimmed'
                              : ''
                          }`}
                          style={{ left: `${leftPct}%`, top: `${topPx}px` }}
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
              {/* 行原文 popover：fixed 容器外渲染（不受 overflow:hidden 裁剪），跟随鼠标 */}
              <div
                ref={lyricPopoverRef}
                class={`stems__lyrics-popover${hoveredLine !== null ? ' stems__lyrics-popover--on' : ''}`}
              >
                {hoveredLine !== null &&
                  karaokeLines[hoveredLine] !== undefined && (
                    <>
                      <div class="stems__lyrics-popover-time">
                        [{karaokeLines[hoveredLine].timeMs !== undefined
                          ? formatLrcTimestamp((karaokeLines[hoveredLine].timeMs as number) / 1000)
                          : '--:--.--'}]
                      </div>
                      <div class="stems__lyrics-popover-text">
                        {karaokeLines[hoveredLine].text}
                      </div>
                    </>
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
                    ? alignPhase === 'clean'
                      ? alignCleanProgress && alignCleanProgress.written > 0
                        ? `清洗歌词… 已输出 ${alignCleanProgress.written} 字`
                        : alignCleanProgress && alignCleanProgress.reasoning > 0
                          ? `清洗歌词… 思考中 ${alignCleanProgress.reasoning} 字`
                          : '清洗歌词…'
                      : alignProgress
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
              const hasOther2 = tracks.some((t) => t.audio.stemId === 'other2')
              return (
                <StemTrackRow
                  key={stemId}
                  stemId={stemId}
                  track={track}
                  label={stemDisplayLabel(stemId, hasOther2)}
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
        <StemsEmpty
          busy={emptyBusy}
          loadingArchive={loadingArchive}
          progress={separationProgress}
          gpuAvailable={gpuAvailable}
          mdxCached={mdxCached}
          modelCached={modelCached}
          recentProjects={recentProjects}
          onPickFile={() => void handlePickFile()}
          onOpenRecent={(path) => void handleOpenRecent(path)}
          onRemoveRecent={handleRemoveRecent}
        />
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
                  setLyricsDraftTimes([])
                }}
              >
                清空
              </IosButton>
            )}
          </div>
          <label for="stems-lyrics-editor-textarea">
            粘贴或编辑歌词文本（保存时自动剥离 LRC 时间戳）
          </label>
          {lyricsDraftTimes.length > 0 && (
            <div class="stems__lyrics-editor-times">
              <div class="stems__lyrics-editor-times-head">行时间戳（来自原 .lrc）</div>
              {lyricsDraft.split('\n').map((line, i) => {
                const t = lyricsDraftTimes[i]
                return (
                  <div class="stems__lyrics-editor-times-row" key={i}>
                    <span class="stems__lyrics-editor-times-stamp">
                      {t !== undefined ? formatLrcTimestamp(t / 1000) : '--:--.--'}
                    </span>
                    <span class="stems__lyrics-editor-times-text">{line.trim() || '\u00A0'}</span>
                  </div>
                )
              })}
            </div>
          )}
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
      <LyricsAnalysisDrawer
        open={analysisOpen}
        onClose={() => {
          stopPreviewSegment()
          setAnalysisOpen(false)
        }}
        focusLine={analysisFocusLine}
        karaokeLines={karaokeLines}
        lineSources={lineSources}
        lyrics={lyrics}
        lyricsLrc={lyricsLrcRef.current}
        phonemes={phonemesRef.current}
        rescueSegments={rescueSegmentsRef.current}
        rescueStats={rescueStatsRef.current}
        vocalsAudio={tracks?.find((t) => t.audio.stemId === 'vocals')?.audio.data ?? null}
        sampleRate={stemSampleRate}
        alignModel={alignModel}
        onPreview={previewSegment}
        onStopPreview={stopPreviewSegment}
        previewVocalsOnly={analysisPreviewVocalsOnly}
        onPreviewVocalsOnlyChange={setAnalysisPreviewVocalsOnly}
        onApplyLine={applyAnalysisLine}
        onUndo={undoAnalysisLine}
        canUndo={analysisCanUndo}
      />
    </div>
  )
}

/** 在 Worker 里解码单条音频压缩段（WAV/FLAC）→ Float32（Transferable 传回，不阻塞主线程）。 */
function decodeTrackInWorker(
  stemId: StemId,
  data: Uint8Array,
  method: number,
  workerRef: { current: Worker | null },
  format: 'wav' | 'flac' = 'wav',
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
      { type: 'decode-track', stemId, data: data.buffer as ArrayBuffer, method, format } satisfies StemsArchiveWorkerRequest,
      [data.buffer],
    )
  })
}

/** 在 Worker 里把 interleaved stereo Float32 编码为 FLAC 字节（WebCodecs 优先 + WASM 回退，Transferable 传回）。 */
function encodeTrackInWorker(
  data: Float32Array,
  sampleRate: number,
  workerRef: { current: Worker | null },
): Promise<Uint8Array> {
  const worker = workerRef.current ?? new StemsArchiveWorker()
  workerRef.current = worker
  return new Promise<Uint8Array>((resolve, reject) => {
    const onMessage = (event: MessageEvent<StemsArchiveWorkerResponse>): void => {
      const msg = event.data
      if (msg.type === 'flac-encoded') {
        worker.removeEventListener('message', onMessage)
        resolve(new Uint8Array(msg.data))
        return
      }
      if (msg.type === 'error') {
        worker.removeEventListener('message', onMessage)
        reject(new Error(msg.message))
        return
      }
    }
    worker.addEventListener('message', onMessage)
    // 按视图范围复制切片再 transfer，避免 detach 主线程 PCM（否则二次保存报 already detached、
    // 命中 decodeCache 后 createBuffer 0 帧崩溃）；同时规避 byteOffset ≠ 0 时 Worker 从 0 解析错位。
    const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    worker.postMessage(
      { type: 'encode-flac', stemId: 'track', data: bytes, sampleRate } satisfies StemsArchiveWorkerRequest,
      [bytes],
    )
  })
}

/** 在 Worker 里跑整首歌词 DTW 文本对齐（phonemes + 歌词 → 增强 LRC），避免主线程百万格 DP 卡死。 */
function alignSegmentsInWorker(
  phonemes: HypSegment[],
  lyricsText: string,
  lineTimes: (number | undefined)[] | null,
  workerRef: { current: Worker | null },
): Promise<string> {
  const worker = workerRef.current ?? new StemsAlignWorker()
  workerRef.current = worker
  // 每个请求独立标识：多个任务共享同一 worker，响应必须按 requestId 路由回各自 Promise，
  // 否则先返回的消息会被所有 listener 误认领（多轨峰值重建时会把同一份金字塔写给所有轨）
  const requestId = (stemsAlignReqSeq += 1)
  return new Promise<string>((resolve, reject) => {
    const onMessage = (event: MessageEvent<StemsAlignWorkerResponse>): void => {
      const msg = event.data
      if (msg.requestId !== requestId) return
      worker.removeEventListener('message', onMessage)
      if (msg.type === 'align-done') {
        resolve(msg.lrc)
        return
      }
      if (msg.type === 'error') {
        reject(new Error(msg.message))
        return
      }
    }
    worker.addEventListener('message', onMessage)
    const request: StemsAlignWorkerRequest = {
      type: 'align-text',
      requestId,
      phonemes,
      lyricsText,
      lineTimes: lineTimes ?? undefined,
    }
    worker.postMessage(request)
  })
}

/** 在 Worker 里重建整轨峰值金字塔（旧包 peaks 无 rms 时从 PCM 补建），PCM 用 Transferable 传。 */
function buildPeaksInWorker(
  data: Float32Array,
  sampleRate: number,
  workerRef: { current: Worker | null },
): Promise<WaveformPyramid> {
  const worker = workerRef.current ?? new StemsAlignWorker()
  workerRef.current = worker
  const requestId = (stemsAlignReqSeq += 1)
  return new Promise<WaveformPyramid>((resolve, reject) => {
    const onMessage = (event: MessageEvent<StemsAlignWorkerResponse>): void => {
      const msg = event.data
      if (msg.requestId !== requestId) return
      worker.removeEventListener('message', onMessage)
      if (msg.type === 'peaks-done') {
        resolve(msg.pyramid)
        return
      }
      if (msg.type === 'error') {
        reject(new Error(msg.message))
        return
      }
    }
    worker.addEventListener('message', onMessage)
    // 复制切片再 transfer，避免 detach 主线程 PCM（与 encodeTrackInWorker 同理）
    const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    worker.postMessage(
      { type: 'build-peaks', requestId, data: bytes, sampleRate } satisfies StemsAlignWorkerRequest,
      [bytes],
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

/**
 * 右声道显示色：左声道色相旋转 degrees 得到，保持饱和度/亮度与轨道色协调。
 * 双色叠加时左用轨道色、右用旋转色，左右切换一眼可辨。
 */
function channelPartnerColor(hex: string, degrees: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const r = parseInt(m[1]!.slice(0, 2), 16) / 255
  const g = parseInt(m[1]!.slice(2, 4), 16) / 255
  const b = parseInt(m[1]!.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  h = (h + degrees) % 360
  return `hsl(${h.toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%)`
}

/** 双声道波形渲染：左声道轨道色、右声道色相旋转 +120°（互补，叠加可辨）。 */
const RIGHT_CHANNEL_HUE_SHIFT = 120

type StemTrackRowProps = {
  stemId: StemId
  /** 轨道显示名（other2 合并后 other 显示「其他」） */
  label: string
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
  label,
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
      // 右声道叠加色：色相旋转，与轨道色协调且可辨
      const rightColor = channelPartnerColor(color, RIGHT_CHANNEL_HUE_SHIFT)
      // 按比例映射到画布，避免 floor(width/n)*n 小于 width 时右侧大片留空
      const gap = Math.max(1, Math.round(dpr))
      const midY = height / 2
      // 每可见桶覆盖的音频时长（毫秒）：全轨视图很大、放大细节很小，驱动峰值/RMS 混合
      const windowFrames = Math.max(1, endFrame - startFrame)
      const msPerBucket = (windowFrames / peaks.length) * (1000 / sampleRate)
      const blend =
        msPerBucket <= RMS_BLEND_MIN_MS
          ? 0
          : Math.min(1, (msPerBucket - RMS_BLEND_MIN_MS) / (RMS_BLEND_MAX_MS - RMS_BLEND_MIN_MS))
      for (let i = 0; i < peaks.length; i++) {
        const peak = peaks[i]
        const x0 = Math.floor((i / peaks.length) * width)
        const barWidth = Math.max(1, Math.floor(((i + 1) / peaks.length) * width) - x0 - gap)
        const peakAmp = Math.min(1, Math.max(Math.abs(peak.min), Math.abs(peak.max)))
        // 长窗口下 RMS 包络主导、峰值退居；短窗口（放大）保持纯峰值瞬态。
        // rms 缺失（旧数据）时退化为纯峰值，与旧版行为一致。
        const rmsAmp = peak.rms !== undefined ? Math.min(1, peak.rms * RMS_GAIN) : peakAmp
        const amp = peakAmp * (1 - blend) + rmsAmp * blend
        if (peak.ampL !== undefined && peak.ampR !== undefined) {
          // 双声道叠加：L/R 各自 peak/RMS 混合，同对称柱位叠画，左右切换时颜色随之变化
          const ampL = Math.min(1, peak.ampL) * (1 - blend) + Math.min(1, (peak.rmsL ?? peak.ampL) * RMS_GAIN) * blend
          const ampR = Math.min(1, peak.ampR) * (1 - blend) + Math.min(1, (peak.rmsR ?? peak.ampR) * RMS_GAIN) * blend
          const barL = Math.max(1, ampL * (height - 4))
          const barR = Math.max(1, ampR * (height - 4))
          ctx.fillStyle = color
          ctx.globalAlpha = 0.8
          ctx.fillRect(x0, midY - barL / 2, barWidth, barL)
          ctx.fillStyle = rightColor
          ctx.globalAlpha = 0.8
          ctx.fillRect(x0, midY - barR / 2, barWidth, barR)
        } else {
          // 旧数据（无 L/R 峰值）：降级为合并单色画法
          ctx.fillStyle = color
          ctx.globalAlpha = 0.9
          const barHeight = Math.max(1, amp * (height - 4))
          ctx.fillRect(x0, midY - barHeight / 2, barWidth, barHeight)
        }
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
        {label}
        <span
          class="stems__track-channels"
          title="波形双色：左声道 / 右声道"
          aria-label="波形双色：左声道 / 右声道"
        >
          <span class="stems__track-channel" style={{ background: STEM_COLORS[stemId] }} />
          <span
            class="stems__track-channel"
            style={{ background: channelPartnerColor(STEM_COLORS[stemId], RIGHT_CHANNEL_HUE_SHIFT) }}
          />
        </span>
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
          style={{ '--stems-vol-fill': `${track.volume * 100}%` } as Record<string, string>}
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

/** 补救收尾摘要：改善/失败行数；无任何补救动作时返回 null（调用方清除旧提示）。 */
function formatRescueSummary(improvedCount: number, failedCount: number): string | null {
  if (improvedCount <= 0 && failedCount <= 0) return null
  const bits: string[] = []
  if (improvedCount > 0) bits.push(`改善 ${improvedCount} 行`)
  if (failedCount > 0) bits.push(`失败 ${failedCount} 行`)
  const manualHint = failedCount > 0 ? '，红行可双击该行手动修复' : ''
  return `自动补救完成：${bits.join('、')}${manualHint}`
}

