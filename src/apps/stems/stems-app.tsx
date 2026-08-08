import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useSystemOpenDialog } from '../../window/system-open-dialog.tsx'
import { isModelCached } from '../../os/model-cache.ts'
import { resolveNodeByAbsolutePath, readFileBlob } from '../files/files-vfs.ts'
import { filesOpenStreamWrite, filesReadBlob } from '../files/files-api.ts'
import { computeWaveformPeaks, encodeWav, STEM_TARGET_SAMPLE_RATE } from './stems-separator.ts'
import { STEM_COLORS, STEM_IDS, STEM_LABELS } from './stems-types.ts'
import type { StemAudio, StemEngineProvider, StemId, StemProgress } from './stems-types.ts'
import { loadStemsArchive, saveStemsArchive, stemsArchivePathFor } from './stems-persistence.ts'
import StemsWorker from './stems-worker.ts?worker'
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
  const workerRef = useRef<Worker | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  /** 分轨结果一次性转换并缓存的 AudioBuffer，播放时零拷贝复用（不再每次全量复制 PCM） */
  const buffersRef = useRef<Map<StemId, AudioBuffer> | null>(null)
  /** 播放中的每轨 GainNode（mute/solo/音量即时生效） */
  const gainNodesRef = useRef<Map<StemId, GainNode>>(new Map())
  const bufferSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const startedAtRef = useRef(0)
  /** 本次播放从文件内的起始偏移（秒）：定时器回写进度必须加上它，否则 seek/恢复播放后进度条会从 0 重新数 */
  const startOffsetRef = useRef(0)
  const sourcePathRef = useRef<string | null>(null)
  /** 源文件绝对路径（保存/检测分轨压缩包用；拖入的文件为 null） */
  const sourceAbsolutePathRef = useRef<string | null>(null)
  /** 进度条/波形拖拽中：暂停播放定时器回写，松手时才真正定位 */
  const isSeekingRef = useRef(false)
  /** 手动平移后暂时不自动跟随播放头（避免与用户「往回看」打架） */
  const suppressFollowUntilRef = useRef(0)
  /** 迷你滚动条拖拽状态 */
  const minimapDragRef = useRef<{ startX: number; startViewStart: number; onThumb: boolean } | null>(
    null,
  )

  /** 最长缩放级别（可见窗口 ≥ MIN_VIEW_SEC；过短的歌不可缩放） */
  const maxZoomLevel =
    duration > 0 ? Math.max(0, Math.floor(Math.log2(duration / MIN_VIEW_SEC))) : 0
  /** 当前可见窗口长度（秒） */
  const viewLen =
    duration > 0
      ? Math.max(MIN_VIEW_SEC, Math.min(duration, duration / Math.pow(2, view.level)))
      : 0

  // 启动时探测 WebGPU 与模型缓存（用于提示；实际后端以 worker 汇报为准）
  useEffect(() => {
    setGpuAvailable('gpu' in navigator)
  }, [])
  useEffect(() => {
    void isModelCached().then((cached) => setModelCached(cached))
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

  /** 把 6 轨分轨结果一次性转成 AudioBuffer 缓存（含 L/R 去交错），播放时直接复用。 */
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
  }, [])

  /** 启动 worker 分轨（打开文件与拖放文件共用）。 */
  const startSeparation = useCallback(
    (interleaved: Float32Array, sourceRate: number) => {
      setError(null)
      setProgress({ kind: 'model-loading' })
      setProvider(null)
      setLoadedFromArchive(null)
      workerRef.current?.terminate()
      const worker = new StemsWorker()
      workerRef.current = worker
      worker.onmessage = (event: MessageEvent<StemProgress>) => {
        const msg = event.data
        setProgress(msg)
        if (msg.kind === 'done') {
          setStemSampleRate(msg.sampleRate)
          cacheStemBuffers(msg.stems, msg.sampleRate)
          setTracks(
            msg.stems.map((audio) => ({
              audio,
              mute: false,
              solo: false,
              volume: 1,
            })),
          )
          setPlaying(false)
          setCurrentTime(0)
        } else if (msg.kind === 'model-loaded') {
          setProvider(msg.provider)
        } else if (msg.kind === 'error') {
          setError(msg.message)
        }
      }
      worker.postMessage({ type: 'separate', audio: interleaved, sampleRate: sourceRate })
    },
    [cacheStemBuffers],
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
        return true
      } catch (cause) {
        console.warn('载入已保存分轨失败，走正常分轨流程', cause)
        return false
      } finally {
        setLoadingArchive(false)
      }
    },
    [cacheStemBuffers, stopPlayback],
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

  /** 从 offset 秒开始播放全部 6 轨；mute/solo/音量由各轨 GainNode 即时控制。 */
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

  const handlePlayPause = useCallback(() => {
    if (!tracks || !audioContextRef.current) return
    if (playing) {
      stopPlayback()
      return
    }
    startPlayback(currentTime)
  }, [tracks, playing, currentTime, stopPlayback, startPlayback])

  /** 拖拽进度条过程中：只更新显示位置，不碰音频（防止定时器与拖拽互相打架）。 */
  const handleSeekInput = useCallback(
    (offsetSec: number) => {
      setCurrentTime(Math.max(0, Math.min(offsetSec, duration)))
    },
    [duration],
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

  /** 波形区滚轮：滚轮=以指针为锚缩放，Shift+滚轮/横向滑动=平移。
   * 必须 native + passive:false 才能 preventDefault（Preact 的 onWheel 是 passive 的）。 */
  const handleWheelZoom = useCallback(
    (event: WheelEvent, ratio: number) => {
      event.preventDefault()
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        const dx = event.shiftKey ? event.deltaY : event.deltaX
        panBy((dx * viewLen) / 8)
        suppressFollowUntilRef.current = Date.now() + 1500
      } else if (duration > 0) {
        // 触控板捏合在 Chrome 中表现为 ctrl+wheel；以指针位置为锚
        const factor = event.ctrlKey ? Math.exp(-event.deltaY * 0.002) : event.deltaY < 0 ? 1.25 : 0.8
        const newLen = Math.max(MIN_VIEW_SEC, Math.min(duration, viewLen * factor))
        zoomTo(Math.log2(duration / newLen), view.start + ratio * viewLen)
      }
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

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      if (isSeekingRef.current) return
      const elapsed = audioContextRef.current
        ? audioContextRef.current.currentTime - startedAtRef.current
        : 0
      const next = Math.min(startOffsetRef.current + elapsed, duration)
      setCurrentTime(next)
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
        stopPlayback()
      }
    }, 100)
    return () => window.clearInterval(timer)
  }, [playing, duration, stopPlayback, view, viewLen, clampViewStart])

  useEffect(
    () => () => {
      stopPlayback()
      workerRef.current?.terminate()
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

  // 导出全部 6 轨（逐个下载，轨间让出主线程避免界面冻结）
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

  /**
   * 保存分轨结果：打包为单个 `<源文件名>.stems.zip` 写入源文件同目录，
   * 之后打开同一首歌时自动检测并载入，无需重新推理。
   */
  const handleSaveArchive = useCallback(async () => {
    const sourcePath = sourceAbsolutePathRef.current
    if (!sourcePath || !tracks) return
    setError(null)
    setSaveProgress(0)
    try {
      const writer = await filesOpenStreamWrite(stemsArchivePathFor(sourcePath))
      await saveStemsArchive({
        stems: tracks.map((t) => t.audio),
        sourcePath,
        sourceName,
        durationSec: duration,
        sampleRate: stemSampleRate,
        sink: {
          write: (chunk) => writer.write(chunk),
          close: () => writer.close(),
        },
        onProgress: (saved) => setSaveProgress(saved),
      })
      setLoadedFromArchive(Date.now())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaveProgress(null)
    }
  }, [tracks, sourceName, duration, stemSampleRate])

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
        <button type="button" class="stems__btn" onClick={() => void handlePickFile()}>
          打开音乐文件…
        </button>
        {sourceName && (
          <button
            type="button"
            class="stems__btn stems__btn--primary"
            disabled={progress?.kind === 'model-loading' || progress?.kind === 'chunk'}
            onClick={() => void handleSeparate()}
          >
            {progress?.kind === 'chunk'
              ? `分轨中 ${progress.index}/${progress.total}`
              : progress?.kind === 'model-loading'
                ? '加载模型…'
                : tracks
                  ? '重新分轨'
                  : '开始分轨'}
          </button>
        )}
        <div class="stems__toolbar-right">
          {provider && (
            <span
              class={`stems__engine stems__engine--${provider}`}
              title={provider === 'webgpu' ? '分轨推理运行在 WebGPU 上' : '分轨推理回退到 WASM（多线程），速度较慢'}
            >
              {provider === 'webgpu' ? '⚡ WebGPU 加速' : '🐢 WASM 回退'}
            </span>
          )}
          {sourceName && <span class="stems__source">{sourceName}</span>}
          {error && <span class="stems__error">{error}</span>}
        </div>
      </header>

      {tracks ? (
        <div class="stems__body">
          <div class="stems__transport">
            <button type="button" class="stems__transport-btn" onClick={() => void handlePlayPause()}>
              {playing ? '⏸' : '▶'}
            </button>
            <span class="stems__time">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
            <div class="stems__seek">
              <input
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
                📂 已载入保存的分轨
              </span>
            )}
            <button
              type="button"
              class="stems__btn"
              disabled={saveProgress !== null || !sourceAbsolutePathRef.current}
              title={
                sourceAbsolutePathRef.current
                  ? '保存分轨结果到源文件同目录（xxx.stems.zip），下次打开自动载入'
                  : '拖入的文件无法保存，请通过「打开音乐文件…」选择歌曲后再分轨'
              }
              onClick={() => void handleSaveArchive()}
            >
              {saveProgress !== null ? `保存中 ${saveProgress}/${STEM_IDS.length}` : '💾 保存分轨'}
            </button>
            <button
              type="button"
              class="stems__btn"
              disabled={exporting}
              onClick={() => void handleExportAll()}
              title="导出全部 6 轨为 WAV"
            >
              {exporting ? '导出中…' : '导出全部'}
            </button>
          </div>

          {maxZoomLevel > 0 && (
            <div class="stems__zoombar">
              <button
                type="button"
                class="stems__zoom-btn"
                disabled={view.level <= 0.01}
                onClick={() => zoomTo(view.level - 1, currentTime)}
                title="缩小一倍（以当前播放位置为锚）"
              >
                −
              </button>
              <input
                type="range"
                class="stems__zoom-slider"
                min={0}
                max={maxZoomLevel}
                step={0.1}
                value={view.level}
                onChange={(event) => zoomTo(Number(event.currentTarget.value), currentTime)}
                title="波形缩放：可见窗口时长（以当前播放位置为锚）"
              />
              <button
                type="button"
                class="stems__zoom-btn"
                disabled={view.level >= maxZoomLevel - 0.01}
                onClick={() => zoomTo(view.level + 1, currentTime)}
                title="放大一倍（以当前播放位置为锚）"
              >
                +
              </button>
              <span class="stems__zoom-label">{Math.round(Math.pow(2, view.level) * 100)}%</span>
              <span class="stems__zoom-range">
                {formatTime(view.start)} – {formatTime(Math.min(duration, view.start + viewLen))}
              </span>
              {view.level > 0.01 && (
                <button
                  type="button"
                  class="stems__btn stems__zoom-reset"
                  onClick={() => setView({ start: 0, level: 0 })}
                >
                  适配全曲
                </button>
              )}
            </div>
          )}

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
                  onWheelZoom={handleWheelZoom}
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

          {view.level > 0 && (
            <div
              class="stems__minimap"
              onPointerDown={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                const ratio = (event.clientX - rect.left) / Math.max(1, rect.width)
                const onThumb =
                  (event.target as HTMLElement).closest('.stems__minimap-thumb') !== null
                minimapDragRef.current = { startX: event.clientX, startViewStart: view.start, onThumb }
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
        </div>
      ) : (
        <div class="stems__empty">
          <div class="stems__empty-icon">🎛️</div>
          <p>打开或拖入一个音乐文件，然后点击「开始分轨」。</p>
          <p class="stems__empty-hint">
            分轨会把人声、鼓、贝斯、其他、吉他、钢琴分离为 6 条独立音轨，可逐轨试听与调节。
          </p>
          {loadingArchive && (
            <p class="stems__empty-hint">检测到已保存的分轨结果，正在载入…</p>
          )}
          {progress?.kind === 'model-loading' && (
            <p class="stems__empty-hint">
              {modelCached === false
                ? '正在下载分轨模型（首次约 285MB，可在 设置 → 存储 → 模型缓存 预缓存，之后秒开）…'
                : '正在加载分轨模型…'}
            </p>
          )}
          {progress?.kind === 'chunk' && (
            <p class="stems__empty-hint">
              正在推理… {Math.round((progress.index / progress.total) * 100)}%（第 {progress.index}/{progress.total} 块）
            </p>
          )}
          {!progress && gpuAvailable === true && (
            <p class="stems__empty-hint">已检测到 WebGPU，分轨将优先使用 GPU 加速。</p>
          )}
          {!progress && gpuAvailable === false && (
            <p class="stems__empty-hint">
              未检测到 WebGPU，分轨将使用 WASM 模式（较慢）；建议在 Chrome 中开启硬件加速。
            </p>
          )}
          {!progress && modelCached === false && (
            <p class="stems__empty-hint">
              提示：模型尚未缓存，首次分轨需下载约 285MB；可在 设置 → 存储 → 模型缓存 中提前缓存。
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
  /** 波形区滚轮缩放/平移（ratio 为指针在波形内的横向比例） */
  onWheelZoom: (event: WheelEvent, ratio: number) => void
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
  onWheelZoom,
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
      const peaks = computeWaveformPeaks(track.audio.data, buckets, startFrame, endFrame)
      const color = STEM_COLORS[stemId]
      const barWidth = Math.max(1, Math.floor(width / peaks.length))
      ctx.fillStyle = color
      ctx.globalAlpha = 0.9
      peaks.forEach((peak, i) => {
        const x = i * barWidth
        const midY = height / 2
        const amp = Math.min(1, Math.max(Math.abs(peak.min), Math.abs(peak.max)))
        const barHeight = Math.max(1, amp * (height - 4))
        ctx.fillRect(x, midY - barHeight / 2, barWidth - 1, barHeight)
      })
      ctx.globalAlpha = 1
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [track.audio.data, viewStart, viewLen, sampleRate, stemId])

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
      onWheelZoom(event, ratio)
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
        {playheadVisible && (
          <div class="stems__track-playhead" style={{ left: `${playheadRatio * 100}%` }} />
        )}
      </div>
      <div class="stems__track-controls">
        <button
          type="button"
          class={`stems__chip${track.mute ? ' stems__chip--active' : ''}`}
          onClick={onToggleMute}
          title="静音"
        >
          M
        </button>
        <button
          type="button"
          class={`stems__chip${track.solo ? ' stems__chip--active' : ''}`}
          onClick={onToggleSolo}
          title="独奏"
        >
          S
        </button>
        <button type="button" class="stems__chip stems__chip--export" onClick={onExport} title="导出 WAV">
          ⭳
        </button>
        <input
          type="range"
          class="stems__volume"
          min={0}
          max={1}
          step={0.01}
          value={track.volume}
          onChange={(event) => onVolume(Number(event.currentTarget.value))}
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
