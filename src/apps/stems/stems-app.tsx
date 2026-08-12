import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { IosButton } from '../../ui/ios-button.tsx'
import { useSystemOpenDialog } from '../../window/system-open-dialog.tsx'
import { isModelCached, MDX_MODEL_URL } from '../../os/model-cache.ts'
import { resolveNodeByAbsolutePath, readFileBlob } from '../files/files-vfs.ts'
import { filesOpenStreamWrite, filesReadBlob } from '../files/files-api.ts'
import {
  buildWaveformPyramid,
  computeWaveformPeaks,
  computeWaveformPeaksFromPyramid,
  encodeWav,
  STEM_TARGET_SAMPLE_RATE,
} from './stems-separator.ts'
import type { WaveformPyramid } from './stems-separator.ts'
import { STEM_COLORS, STEM_IDS, STEM_LABELS } from './stems-types.ts'
import type { StemAudio, StemEngineProvider, StemId, StemProgress } from './stems-types.ts'
import { loadStemsArchive, saveStemsArchive, stemsArchivePathFor } from './stems-persistence.ts'
import { enqueueAiTask } from '../../ai/ai-inference-service.ts'
import type { MdxVocalProgress } from './mdx-vocal-worker.ts'
import TempoWorker from './tempo-worker.ts?worker'
import type { TempoWorkerResponse } from './tempo-worker.ts'
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

export function StemsApp() {
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
  const [exporting, setExporting] = useState(false)
  /** 正在保存分轨压缩包（当前已存轨数，null = 未在保存） */
  const [saveProgress, setSaveProgress] = useState<number | null>(null)
  /** 已载入保存的分轨压缩包的保存时间（null = 未载入） */
  const [loadedFromArchive, setLoadedFromArchive] = useState<number | null>(null)
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
  /** 速度条当前段高亮/读数/播放头直写 DOM 用（仿 playheadRefsRef） */
  const tempoSegRefsRef = useRef<Map<number, HTMLDivElement>>(new Map())
  const tempoReadoutRef = useRef<HTMLSpanElement | null>(null)
  const tempoPlayheadRef = useRef<HTMLDivElement | null>(null)
  /** 进度条/波形拖拽中：暂停播放定时器回写，松手时才真正定位 */
  const isSeekingRef = useRef(false)
  /** 手动平移后暂时不自动跟随播放头（避免与用户「往回看」打架） */
  const suppressFollowUntilRef = useRef(0)
  /** 迷你滚动条拖拽状态 */
  const minimapDragRef = useRef<{ startX: number; startViewStart: number; onThumb: boolean } | null>(
    null,
  )
  /** 播放时钟直写 DOM 用：播放中 rAF 逐帧更新各轨播放头/时间文本/进度条，不经过 React 重渲染 */
  const playheadRefsRef = useRef<Map<StemId, HTMLDivElement>>(new Map())
  const timeLabelRef = useRef<HTMLSpanElement | null>(null)
  const seekInputRef = useRef<HTMLInputElement | null>(null)

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
        ],
      },
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceName])
  useAppMenuBar('stems', menuBar)

  const handleSeparateRef = useRef<() => void>(() => {})

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
    setPlaying(false)
  }, [])

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

  /** 把 7 轨分轨结果一次性转成 AudioBuffer 缓存（含 L/R 去交错），播放时直接复用。 */
  const cacheStemBuffers = useCallback((stems: StemAudio[], rate: number) => {
    const ctx = audioContextRef.current
    const buffers = new Map<StemId, AudioBuffer>()
    if (ctx) {
      for (const stem of stems) {
        const frames = stem.data.length / 2
        const buffer = ctx.createBuffer(2, frames, rate)
        const left = buffer.getChannelData(0)
        const right = buffer.getChannelData(1)
        for (let i = 0; i < frames; i++) {
          left[i] = stem.data[i * 2]
          right[i] = stem.data[i * 2 + 1]
        }
        buffers.set(stem.stemId, buffer)
      }
    }
    buffersRef.current = buffers
    // 同时建好每轨峰值金字塔：一次遍历，之后任意窗口的波形绘制都只按桶聚合
    const peaks = new Map<StemId, WaveformPyramid>()
    for (const stem of stems) peaks.set(stem.stemId, buildWaveformPyramid(stem.data, rate))
    peaksRef.current = peaks
  }, [])

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
        const writer = await filesOpenStreamWrite(stemsArchivePathFor(sourcePath))
        await saveStemsArchive({
          stems,
          sourcePath,
          sourceName,
          durationSec: duration,
          sampleRate: stemSampleRate,
          tempo: tempoRef.current ?? undefined,
          sink: {
            write: (chunk) => writer.write(chunk),
            close: () => writer.close(),
          },
          onProgress: (saved) => setSaveProgress(saved),
        })
        setLoadedFromArchive(Date.now())
        return true
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        return false
      } finally {
        setSaveProgress(null)
      }
    },
    [sourceName, duration, stemSampleRate],
  )

  /** 手动保存分轨结果（菜单/按钮）。 */
  const handleSaveArchive = useCallback(async () => {
    if (!tracks) return
    setError(null)
    setSaveProgress(0)
    await saveCurrentStems(tracks.map((t) => t.audio))
  }, [saveCurrentStems, tracks])

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
      const abort = new AbortController()
      separateAbortRef.current = abort
      setError(null)
      setProgress(null)
      setProvider(null)
      setMdxProvider(null)
      setLoadedFromArchive(null)
      setMdxBusy(true)
      setMdxProgress(undefined)
      resetChunkEtaClock()
      // 重新分轨：清空旧节拍结果，等新鼓轨检测
      setTempo(null)
      tempoRef.current = null

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
    [cacheStemBuffers, detectTempoAsync, noteChunkProgress, resetChunkEtaClock, saveCurrentStems],
  )

  /**
   * 打开文件时探测同目录的 `<源文件名>.stems.zip`，命中则直接载入已保存的分轨。
   * 压缩包缺失/损坏时返回 false，由调用方走正常分轨流程。
   */
  const tryLoadSavedStems = useCallback(
    async (sourceAbsolutePath: string): Promise<boolean> => {
      const archivePath = stemsArchivePathFor(sourceAbsolutePath)
      const archiveNode = await resolveNodeByAbsolutePath(archivePath)
      if (!archiveNode || archiveNode.kind !== 'file') return false
      setLoadingArchive(true)
      try {
        const blob = await filesReadBlob(archivePath)
        const { manifest, stems } = await loadStemsArchive(blob)
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
        cacheStemBuffers(stems, manifest.sampleRate)
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
        setLoadedFromArchive(manifest.createdAt)
        // 已有 tempo 直接载入；老压缩包缺失时从鼓轨补测（不自动保存，与现状一致）
        if (manifest.tempo) {
          setTempo(manifest.tempo)
          tempoRef.current = manifest.tempo
        } else {
          const drums = stems.find((s) => s.stemId === 'drums')
          if (drums) void detectTempoAsync(drums.data, manifest.sampleRate)
        }
        return true
      } catch (cause) {
        console.warn('载入已保存分轨失败，走正常分轨流程', cause)
        return false
      } finally {
        setLoadingArchive(false)
      }
    },
    [cacheStemBuffers, detectTempoAsync, stopPlayback],
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
    setLoadedFromArchive(null)
    // 同目录有已保存的分轨压缩包 → 直接载入，不再推理
    const loaded = await tryLoadSavedStems(path)
    if (!loaded) handleSeparateRef.current()
  }, [showSystemOpenDialog, tryLoadSavedStems])

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

  /**
   * 把播放位置直接写进 DOM（各轨播放头、时间文本、进度条），不触发 React 重渲染。
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
      const input = seekInputRef.current
      if (input) input.value = String(Math.round(timeSec * 100))

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
    },
    [duration, viewLen, view.start],
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
    startPlayback(currentTime)
  }, [tracks, playing, currentTime, getPlaybackTime, stopPlayback, startPlayback])

  /** 拖拽进度条/波形过程中：只更新显示位置（状态 + DOM 直写），不碰音频（防止时钟与拖拽互相打架）。 */
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

  /** 松手/键盘确认：播放中从目标位置重新播，暂停中仅保留位置。 */
  const finalizeSeek = useCallback(
    (offsetSec: number) => {
      isSeekingRef.current = false
      const clamped = Math.max(0, Math.min(offsetSec, duration))
      setCurrentTime(clamped)
      // 放大状态下，总进度条 seek 到可见窗口外 → 窗口跟随到目标位置
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

  useEffect(
    () => () => {
      stopPlayback()
      // 取消在途分轨：调度器负责 terminate worker 并释放模型内存
      separateAbortRef.current?.abort()
      tempoWorkerRef.current?.terminate()
      void audioContextRef.current?.close()
    },
    [stopPlayback],
  )

  // 导出单轨为 WAV 下载（WAV 头必须写分轨结果的实际采样率）
  const handleExportStem = useCallback(
    (stemId: StemId) => {
      const track = tracks?.find((t) => t.audio.stemId === stemId)
      if (!track) return
      const stemLabel = STEM_LABELS[stemId]
      const wav = encodeWav(track.audio.data, stemSampleRate)
      downloadWav(wav, `${sourceName || 'track'}-${stemLabel}.wav`)
    },
    [tracks, stemSampleRate, sourceName],
  )

  // 导出全部 7 轨（逐个下载，轨间让出主线程避免界面冻结）
  const handleExportAll = useCallback(async () => {
    if (!tracks) return
    setExporting(true)
    try {
      for (const track of tracks) {
        const wav = encodeWav(track.audio.data, stemSampleRate)
        downloadWav(wav, `${sourceName || 'track'}-${STEM_LABELS[track.audio.stemId]}.wav`)
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    } finally {
      setExporting(false)
    }
  }, [tracks, stemSampleRate, sourceName])

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
        setLoadedFromArchive(null)
        startSeparation(interleaved, sampleRate)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setProgress(null)
      }
    },
    [prepareAudio, startSeparation],
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
            <div class="stems__seek">
              <input
                ref={seekInputRef}
                type="range"
                min={0}
                max={Math.max(1, Math.round(duration * 100))}
                value={Math.round(currentTime * 100)}
                onPointerDown={() => {
                  isSeekingRef.current = true
                }}
                onChange={(event) => handleSeekInput(Number(event.currentTarget.value) / 100)}
                onPointerUp={(event) => finalizeSeek(Number(event.currentTarget.value) / 100)}
                onKeyDown={() => {
                  // 键盘拖拽（方向键）同样抑制定时器回写，避免与 onChange 打架
                  isSeekingRef.current = true
                }}
                onKeyUp={(event) => finalizeSeek(Number(event.currentTarget.value) / 100)}
                onBlur={(event) => {
                  // 键盘拖拽中焦点移走（如 Tab）会丢失 keyup：此时补一次定位
                  if (isSeekingRef.current) finalizeSeek(Number(event.currentTarget.value) / 100)
                }}
              />
            </div>
            {loadedFromArchive !== null && (
              <span
                class="stems__loaded"
                title={`已载入 ${new Date(loadedFromArchive).toLocaleString()} 保存的分轨结果`}
              >
                <span class="stems__loaded-lamp" />
                已载入分轨
              </span>
            )}
            <IosButton
              size="compact"
              disabled={saveProgress !== null || !sourceAbsolutePathRef.current}
              title={
                sourceAbsolutePathRef.current
                  ? '保存分轨结果到源文件同目录（xxx.stems.zip），下次打开自动载入'
                  : '拖入的文件无法保存，请通过「打开音乐文件…」选择歌曲后再分轨'
              }
              onClick={() => void handleSaveArchive()}
            >
              {saveProgress !== null ? `保存中 ${saveProgress}/${STEM_IDS.length}` : '保存分轨'}
            </IosButton>
            <IosButton
              size="compact"
              disabled={exporting}
              onClick={() => void handleExportAll()}
              title="导出全部 7 轨为 WAV"
            >
              {exporting ? '导出中…' : '导出全部'}
            </IosButton>
          </div>

          {/* 速度条：分段色块 = 段长、颜色 = BPM 快慢、段内数字；点击跳段 */}
          <div class="stems__tempo-row">
            <div class="stems__track-name">
              <span class="stems__track-dot stems__track-dot--tempo" />
              速度
            </div>
            <div class="stems__tempo-lane">
              {tempo?.segments.map((seg) => {
                const left = viewLen > 0 ? ((seg.startSec - view.start) / viewLen) * 100 : 0
                const width = viewLen > 0 ? ((seg.endSec - seg.startSec) / viewLen) * 100 : 0
                return (
                  <div
                    key={seg.startSec}
                    ref={(el) => {
                      if (el) tempoSegRefsRef.current.set(seg.startSec, el)
                      else tempoSegRefsRef.current.delete(seg.startSec)
                    }}
                    class={`stems__tempo-seg ${tempoBucketClass(seg.bpm)}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`${formatTime(seg.startSec)} – ${formatTime(seg.endSec)} · ${Math.round(seg.bpm)} BPM`}
                    onClick={() => finalizeSeek(seg.startSec)}
                  >
                    {width > 6 && Math.round(seg.bpm)}
                  </div>
                )
              })}
              {tempo && (
                <div
                  ref={tempoPlayheadRef}
                  class="stems__tempo-playhead"
                  style={{ left: `${(viewLen > 0 ? (currentTime - view.start) / viewLen : 0) * 100}%`, opacity: 0 }}
                />
              )}
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

          <div class="stems__tracks">
            {STEM_IDS.map((stemId) => {
              const track = tracks.find((t) => t.audio.stemId === stemId)
              if (!track) return null
              return (
                <StemTrackRow
                  key={stemId}
                  stemId={stemId}
                  track={track}
                  playing={playing}
                  playheadSec={currentTime}
                  viewStart={view.start}
                  viewLen={viewLen}
                  sampleRate={stemSampleRate}
                  peakPyramid={peaksRef.current?.get(stemId)}
                  onWheelZoom={handleWheelZoom}
                  registerPlayhead={registerPlayhead}
                  onToggleMute={() => toggleTrack(setTracks, gainNodesRef.current, stemId, 'mute')}
                  onToggleSolo={() => toggleTrack(setTracks, gainNodesRef.current, stemId, 'solo')}
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
                  onExport={() => handleExportStem(stemId)}
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
    </div>
  )
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
  /** 播放中为 true（控制播放头 overlay 显示） */
  playing: boolean
  /** 播放进度（秒），用于播放头位置 */
  playheadSec: number
  /** 可见窗口起点（秒）与长度（秒）：全曲时为 0 与总时长 */
  viewStart: number
  viewLen: number
  /** 波形数据采样率（分轨结果固定 44.1kHz） */
  sampleRate: number
  /** 本轨峰值金字塔：绘制时按桶聚合，任意缩放级别都只 O(窗口毫秒数)；未提供时回退直接计算 */
  peakPyramid: WaveformPyramid | undefined
  /** 波形区滚轮缩放/平移（ratio 为指针在波形内的横向比例，width 为波形宽度 px） */
  onWheelZoom: (event: WheelEvent, ratio: number, width: number) => void
  /** 注册/注销本轨播放头 DOM：播放中由 rAF 直写位置，不经过 React 重渲染 */
  registerPlayhead: (stemId: StemId, el: HTMLDivElement | null) => void
  onToggleMute: () => void
  onToggleSolo: () => void
  /** 波形上拖拽/点击 seek：ratio ∈ [0,1] 是窗口内比例，播放中不立即重启，松手由 onSeekEnd 定位 */
  onSeek: (ratio: number) => void
  onSeekEnd: (ratio: number) => void
  onVolume: (volume: number) => void
  onExport: () => void
}

function StemTrackRow({
  stemId,
  track,
  playing,
  playheadSec,
  viewStart,
  viewLen,
  sampleRate,
  peakPyramid,
  onWheelZoom,
  registerPlayhead,
  onToggleMute,
  onToggleSolo,
  onSeek,
  onSeekEnd,
  onVolume,
  onExport,
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

  const playheadRatio =
    playing && viewLen > 0 ? (playheadSec - viewStart) / viewLen : -1
  const playheadVisible = playheadRatio >= 0 && playheadRatio <= 1

  // 滚轮缩放/平移：必须 native + passive:false 才能 preventDefault
  useEffect(() => {
    const node = waveWrapRef.current
    if (!node) return
    const handler = (event: WheelEvent) => {
      const rect = node.getBoundingClientRect()
      const ratio = Math.max(
        0,
        Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)),
      )
      onWheelZoom(event, ratio, rect.width)
    }
    node.addEventListener('wheel', handler, { passive: false })
    return () => node.removeEventListener('wheel', handler)
  }, [onWheelZoom])

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
      class={`stems__track${track.mute ? ' stems__track--muted' : ''}${track.solo ? ' stems__track--solo' : ''}`}
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
        <IosButton icon size="compact" class="stems__chip" onClick={onExport} title="导出 WAV" aria-label="导出">
          ↓
        </IosButton>
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
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
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
function tempoBucketClass(bpm: number): string {
  if (bpm < 95) return 'stems__tempo-seg--slow'
  if (bpm <= 120) return 'stems__tempo-seg--mid'
  if (bpm <= 150) return 'stems__tempo-seg--fast'
  return 'stems__tempo-seg--very-fast'
}

function downloadWav(buffer: ArrayBuffer, fileName: string): void {
  const blob = new Blob([buffer], { type: 'audio/wav' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
