/**
 * 分轨结果持久化：把 7 条分轨打包成单个压缩包（`<源文件名>.stems.zip`），
 * 放在源文件同目录（侧车文件，同歌词 `.lrc` 的模式），下次打开同一首歌时自动载入。
 *
 * 打包用 fflate 的流式 Zip：Float32 → 16-bit PCM 按块转换，压缩输出分块写
 * 入注入的 sink（VFS 流式写），全程不产生整包大数组。
 * WAV 与峰值表条目用 STORE（不压缩）：PCM16 几乎压不动，deflate 只浪费 CPU；
 * 仅 `stems.json`（体积小、可压缩）用 DEFLATE。
 * 解包同样流式：逐条目解压，单条 WAV 暂存内存后直接解码为 Float32。
 */

import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough, inflateSync } from 'fflate'
import { buildWaveformPyramid, STEM_CHANNELS, encodeWavHeader } from './stems-separator.ts'
import type { WaveformPyramid } from './stems-separator.ts'
import { STEM_IDS } from './stems-types.ts'
import type { StemAudio, StemId } from './stems-types.ts'
import type { TempoInfo } from './stems-tempo.ts'

export const STEMS_ARCHIVE_EXTENSION = '.stems.zip'
export const STEMS_MANIFEST_ENTRY = 'stems.json'
/** 压缩包内波形峰值表条目（7 轨金字塔的二进制拼接；v3 引入）。 */
export const STEMS_PEAKS_ENTRY = 'peaks.bin'
/** v2：分轨产物从 6 轨扩展为 7 轨（新增 other2「其他二」）。
 * v3：WAV 改 STORE 不压缩，新增 peaks.bin 波形峰值表（加载跳过全量扫描）。
 * 解析兼容 v2（无 peaks.bin 时加载端回退重算）。 */
export const STEMS_MANIFEST_VERSION = 3
const STEMS_MANIFEST_VERSION_LEGACY = 2

/** 分轨压缩包内单条 WAV 的文件名（用稳定 id，与显示标签解耦）。 */
export function stemWavEntryName(stemId: StemId): string {
  return `${stemId}.wav`
}

/** 压缩包内全部条目的文件名（manifest + 7 条 WAV + 峰值表）。 */
export function stemsArchiveEntryNames(): string[] {
  return [STEMS_MANIFEST_ENTRY, STEMS_PEAKS_ENTRY, ...STEM_IDS.map((id) => stemWavEntryName(id))]
}

/** 必需条目（manifest + 7 条 WAV）；peaks.bin 可选（v2 旧包无）。 */
export function stemsArchiveRequiredEntryNames(): string[] {
  return [STEMS_MANIFEST_ENTRY, ...STEM_IDS.map((id) => stemWavEntryName(id))]
}

/** 音素识别结果：识别出的一个 token 段（symbol 为解码后的可读文本）。 */
export type PhonemeSegment = {
  symbol: string
  start: number
  end: number
}

export type StemsManifest = {
  version: typeof STEMS_MANIFEST_VERSION
  /** 源文件绝对路径（信息用；载入时仅软校验） */
  sourcePath: string
  sourceName: string
  durationSec: number
  /** 分轨结果采样率（模型固定 44.1kHz） */
  sampleRate: number
  createdAt: number
  stems: { id: StemId; file: string }[]
  /** 分段节拍检测结果（可选；老归档无此字段） */
  tempo?: TempoInfo
  /** 原始歌词（清洗后文本，可选；供重开包/换设备时恢复，不再依赖同目录 .lrc） */
  lyrics?: string
  /** 歌词来源名（可选；自动载入/手动粘贴来源，仅供展示） */
  lyricsSourceName?: string
  /** 歌词对齐结果（增强 LRC，可选；老归档无此字段） */
  alignedLrc?: string
  /** 人声轨音素识别结果（可选；供换歌词时复用，跳过重新识别） */
  phonemes?: PhonemeSegment[]
}

/** 校验 tempo 字段形状；不合法返回 undefined（按缺失处理）。 */
function normalizeTempo(raw: unknown): TempoInfo | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const obj = raw as { bpm?: unknown; segments?: unknown }
  if (typeof obj.bpm !== 'number' || !Number.isFinite(obj.bpm)) return undefined
  if (!Array.isArray(obj.segments)) return undefined
  const segments: TempoInfo['segments'] = []
  for (const item of obj.segments) {
    if (typeof item !== 'object' || item === null) return undefined
    const seg = item as { startSec?: unknown; endSec?: unknown; bpm?: unknown; phaseSec?: unknown }
    if (
      typeof seg.startSec !== 'number' ||
      typeof seg.endSec !== 'number' ||
      typeof seg.bpm !== 'number' ||
      !Number.isFinite(seg.startSec) ||
      !Number.isFinite(seg.endSec) ||
      !Number.isFinite(seg.bpm)
    ) {
      return undefined
    }
    // 旧存档无 phaseSec 字段：兜底 0（拍点从段起点硬数，行为同旧版本）
    segments.push({
      startSec: seg.startSec,
      endSec: seg.endSec,
      bpm: seg.bpm,
      phaseSec:
        typeof seg.phaseSec === 'number' && Number.isFinite(seg.phaseSec) ? seg.phaseSec : 0,
    })
  }
  return { bpm: obj.bpm, segments }
}

/** 校验 phonemes 字段形状；不合法返回 undefined（按缺失处理）。 */
function normalizePhonemes(raw: unknown): PhonemeSegment[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const phonemes: PhonemeSegment[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return undefined
    const seg = item as { symbol?: unknown; start?: unknown; end?: unknown }
    if (
      typeof seg.symbol !== 'string' ||
      typeof seg.start !== 'number' ||
      typeof seg.end !== 'number' ||
      !Number.isFinite(seg.start) ||
      !Number.isFinite(seg.end)
    ) {
      return undefined
    }
    phonemes.push({ symbol: seg.symbol, start: seg.start, end: seg.end })
  }
  return phonemes
}

/**
 * 分轨压缩包侧车路径：`/user/Musics/song.mp3` → `/user/Musics/song.stems.zip`。
 * 无扩展名时直接追加后缀。
 */
export function stemsArchivePathFor(sourceAbsolutePath: string): string {
  const slash = sourceAbsolutePath.lastIndexOf('/')
  const dot = sourceAbsolutePath.lastIndexOf('.')
  const base = dot > slash ? sourceAbsolutePath.slice(0, dot) : sourceAbsolutePath
  return base + STEMS_ARCHIVE_EXTENSION
}

export function buildStemsManifest(meta: {
  sourcePath: string
  sourceName: string
  durationSec: number
  sampleRate: number
  createdAt?: number
  tempo?: TempoInfo
  lyrics?: string
  lyricsSourceName?: string
  alignedLrc?: string
  phonemes?: PhonemeSegment[]
}): StemsManifest {
  const manifest: StemsManifest = {
    version: STEMS_MANIFEST_VERSION,
    sourcePath: meta.sourcePath,
    sourceName: meta.sourceName,
    durationSec: meta.durationSec,
    sampleRate: meta.sampleRate,
    createdAt: meta.createdAt ?? Date.now(),
    stems: STEM_IDS.map((id) => ({ id, file: stemWavEntryName(id) })),
  }
  if (meta.tempo) manifest.tempo = meta.tempo
  if (meta.lyrics?.trim()) {
    manifest.lyrics = meta.lyrics
    if (meta.lyricsSourceName) manifest.lyricsSourceName = meta.lyricsSourceName
  }
  if (meta.alignedLrc) manifest.alignedLrc = meta.alignedLrc
  if (meta.phonemes?.length) manifest.phonemes = meta.phonemes
  return manifest
}

/** 解析并校验 stems.json 内容；不合法返回 null。兼容 v2（无 peaks.bin）与 v3。 */
export function parseStemsManifest(json: string): StemsManifest | null {
  try {
    const raw = JSON.parse(json) as Partial<StemsManifest>
    if (raw.version !== STEMS_MANIFEST_VERSION && raw.version !== STEMS_MANIFEST_VERSION_LEGACY) {
      return null
    }
    if (typeof raw.sourcePath !== 'string') return null
    if (typeof raw.sampleRate !== 'number' || typeof raw.durationSec !== 'number') return null
    if (!Array.isArray(raw.stems) || raw.stems.length !== STEM_IDS.length) return null
    for (const item of raw.stems) {
      if (!STEM_IDS.includes(item.id)) return null
      if (item.file !== stemWavEntryName(item.id)) return null
    }
    const manifest = raw as StemsManifest
    if (raw.tempo !== undefined) {
      const tempo = normalizeTempo(raw.tempo)
      if (!tempo) return null
      manifest.tempo = tempo
    }
    // lyrics / lyricsSourceName 非字符串（老包无此字段）时按缺失处理，不整体拒绝
    if (raw.lyrics !== undefined && typeof raw.lyrics !== 'string') {
      delete manifest.lyrics
    }
    if (raw.lyricsSourceName !== undefined && typeof raw.lyricsSourceName !== 'string') {
      delete manifest.lyricsSourceName
    }
    // alignedLrc 非字符串（老包无此字段）时按缺失处理，不整体拒绝
    if (raw.alignedLrc !== undefined && typeof raw.alignedLrc !== 'string') {
      delete manifest.alignedLrc
    }
    // phonemes 非合法数组（老包无此字段）时按缺失处理，不整体拒绝
    if (raw.phonemes !== undefined) {
      const phonemes = normalizePhonemes(raw.phonemes)
      if (!phonemes) delete manifest.phonemes
      else manifest.phonemes = phonemes
    }
    return manifest
  } catch {
    return null
  }
}

/** 每个 PCM 转换块的帧数（块 ≈ 2 MiB，控制峰值内存）。 */
const WAV_CHUNK_FRAMES = 1 << 19

/**
 * 把 interleaved stereo Float32 的 [startFrame, endFrame) 帧转为
 * 16-bit 小端 PCM 字节（不含 WAV 头），与 encodeWav 的 data 段逐字节一致。
 */
export function convertToPcm16(
  data: Float32Array,
  startFrame: number,
  endFrame: number,
): Uint8Array {
  const frames = endFrame - startFrame
  const bytes = new Uint8Array(frames * STEM_CHANNELS * 2)
  const view = new DataView(bytes.buffer)
  let offset = 0
  for (let i = startFrame; i < endFrame; i++) {
    const l = Math.max(-1, Math.min(1, data[i * STEM_CHANNELS]))
    view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true)
    offset += 2
    const r = Math.max(-1, Math.min(1, data[i * STEM_CHANNELS + 1]))
    view.setInt16(offset, r < 0 ? r * 0x8000 : r * 0x7fff, true)
    offset += 2
  }
  return bytes
}

/** 单条 WAV 的完整字节（头 + 全部 PCM），与 encodeWav 输出一致（测试用/复用）。 */
export function encodeStemWavBytes(data: Float32Array, sampleRate: number): Uint8Array {
  const frames = Math.floor(data.length / STEM_CHANNELS)
  const header = new Uint8Array(encodeWavHeader(frames, sampleRate))
  const bytes = new Uint8Array(header.length + frames * STEM_CHANNELS * 2)
  bytes.set(header)
  let offset = header.length
  for (let f = 0; f < frames; f += WAV_CHUNK_FRAMES) {
    const chunk = convertToPcm16(data, f, Math.min(frames, f + WAV_CHUNK_FRAMES))
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

/** 16-bit 小端 PCM WAV 字节 → interleaved stereo Float32（我们写的标准 44 字节头）。 */
export function decodeStemWavBytes(bytes: Uint8Array): Float32Array {
  const pcmBytes = bytes.byteLength - 44
  const sampleCount = pcmBytes / 2
  const data = new Float32Array(sampleCount)
  // 对齐时用 Int16Array 视图批量读（比逐采样 DataView.getInt16 快）；
  // 非对齐（zip STORE 条目 subarray 起点任意）时回退 DataView
  if ((bytes.byteOffset + 44) % 2 === 0) {
    const view = new Int16Array(bytes.buffer, bytes.byteOffset + 44, sampleCount)
    for (let i = 0; i < sampleCount; i++) {
      const s = view[i]
      data[i] = s < 0 ? s / 0x8000 : s / 0x7fff
    }
  } else {
    const view = new DataView(bytes.buffer, bytes.byteOffset + 44, pcmBytes)
    for (let i = 0; i < sampleCount; i++) {
      const s = view.getInt16(i * 2, true)
      data[i] = s < 0 ? s / 0x8000 : s / 0x7fff
    }
  }
  return data
}

/**
 * 把 7 轨波形峰值金字塔序列化为 `peaks.bin` 字节（按 STEM_IDS 顺序）：
 * 每轨 = uint32 bucketSamples + uint32 bucketCount + float32[bucketCount] min + float32[bucketCount] max。
 * 峰值表相对 PCM 极小（~1ms/桶，4 分钟歌每轨约 1MB），STORE 写入无需压缩。
 */
export function serializeWaveformPeaks(
  stems: StemAudio[],
  sampleRate: number,
): Uint8Array {
  let totalBytes = 0
  const pyramids: WaveformPyramid[] = stems.map((stem) => buildWaveformPyramid(stem.data, sampleRate))
  for (const p of pyramids) totalBytes += 8 + p.bucketCount * 4 * 2
  const out = new Uint8Array(totalBytes)
  const view = new DataView(out.buffer)
  let offset = 0
  for (const p of pyramids) {
    view.setUint32(offset, p.bucketSamples, true)
    offset += 4
    view.setUint32(offset, p.bucketCount, true)
    offset += 4
    new Float32Array(out.buffer, out.byteOffset + offset, p.bucketCount).set(p.min)
    offset += p.bucketCount * 4
    new Float32Array(out.buffer, out.byteOffset + offset, p.bucketCount).set(p.max)
    offset += p.bucketCount * 4
  }
  return out
}

/** 反序列化 `peaks.bin` → 各轨金字塔（零拷贝视图）。损坏/不完整时返回空 Map。 */
export function deserializeWaveformPeaks(bytes: Uint8Array): Map<StemId, WaveformPyramid> {
  const peaks = new Map<StemId, WaveformPyramid>()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 0
  for (const stemId of STEM_IDS) {
    if (offset + 8 > bytes.byteLength) break
    const bucketSamples = view.getUint32(offset, true)
    offset += 4
    const bucketCount = view.getUint32(offset, true)
    offset += 4
    if (bucketCount === 0 || offset + bucketCount * 8 > bytes.byteLength) break
    const min = new Float32Array(bytes.buffer, bytes.byteOffset + offset, bucketCount)
    offset += bucketCount * 4
    const max = new Float32Array(bytes.buffer, bytes.byteOffset + offset, bucketCount)
    offset += bucketCount * 4
    peaks.set(stemId, { bucketSamples, bucketCount, min, max })
  }
  return peaks
}

/** 保存时的输出目标（由调用方注入；浏览器端接 VFS 流式写）。 */
export type ArchiveSink = {
  write(chunk: Uint8Array): void | Promise<void>
  close(): void | Promise<unknown>
  abort?(): void | Promise<unknown>
}

export type SaveStemsOptions = {
  stems: StemAudio[]
  sourcePath: string
  sourceName: string
  durationSec: number
  sampleRate: number
  sink: ArchiveSink
  /** 分段节拍检测结果（可选；检测完成/载入时带上） */
  tempo?: TempoInfo
  /** 原始歌词（清洗后文本，可选；随包保存供重开恢复） */
  lyrics?: string
  /** 歌词来源名（可选，仅供展示） */
  lyricsSourceName?: string
  /** 歌词对齐结果（增强 LRC，可选） */
  alignedLrc?: string
  /** 人声轨音素识别结果（可选；供换歌词复用，跳过重新识别） */
  phonemes?: PhonemeSegment[]
  /** 完成进度（已存轨数 / 总轨数） */
  onProgress?: (saved: number, total: number) => void
}

const EMPTY_CHUNK = new Uint8Array(0)

/**
 * 流式打包 manifest + 峰值表 + 7 条 WAV 为 zip，写入 sink。
 * 每 push 一块输入后立即排空压缩输出（串行 await 写入），峰值内存 ≈ 单块大小。
 */
export async function saveStemsArchive(options: SaveStemsOptions): Promise<void> {
  const {
    stems,
    sourcePath,
    sourceName,
    durationSec,
    sampleRate,
    sink,
    tempo,
    lyrics,
    lyricsSourceName,
    alignedLrc,
    phonemes,
    onProgress,
  } = options
  const manifest = buildStemsManifest({
    sourcePath,
    sourceName,
    durationSec,
    sampleRate,
    tempo,
    lyrics,
    lyricsSourceName,
    alignedLrc,
    phonemes,
  })

  const zipOutput: Uint8Array[] = []
  let zipError: unknown = null
  const zip = new Zip((err, chunk) => {
    if (err) {
      zipError = err
      return
    }
    if (chunk.length > 0) zipOutput.push(chunk)
  })

  const drain = async (): Promise<void> => {
    while (zipOutput.length > 0) {
      const chunk = zipOutput.shift()
      if (chunk) await sink.write(chunk)
    }
    if (zipError) throw zipError
  }

  const pushEntry = async (
    entry: ZipDeflate | ZipPassThrough,
    chunks: Iterable<Uint8Array>,
  ): Promise<void> => {
    zip.add(entry)
    for (const chunk of chunks) {
      entry.push(chunk, false)
      await drain()
    }
    entry.push(EMPTY_CHUNK, true)
    await drain()
  }

  try {
    await pushEntry(new ZipDeflate(STEMS_MANIFEST_ENTRY), [
      new TextEncoder().encode(JSON.stringify(manifest)),
    ])
    // 峰值表紧跟 manifest：加载端快路径只读这两个条目就先出 UI/波形（见 readStemsArchiveLayout）
    await pushEntry(new ZipPassThrough(STEMS_PEAKS_ENTRY), [
      serializeWaveformPeaks(stems, sampleRate),
    ])
    let saved = 0
    for (const stem of stems) {
      const frames = Math.floor(stem.data.length / STEM_CHANNELS)
      const chunks = (function* generateWavChunks(): Generator<Uint8Array> {
        yield new Uint8Array(encodeWavHeader(frames, sampleRate))
        for (let f = 0; f < frames; f += WAV_CHUNK_FRAMES) {
          yield convertToPcm16(stem.data, f, Math.min(frames, f + WAV_CHUNK_FRAMES))
        }
      })()
      // WAV 用 STORE（不压缩）：PCM16 不可压缩，跳过 deflate 省 CPU
      await pushEntry(new ZipPassThrough(stemWavEntryName(stem.stemId)), chunks)
      saved += 1
      onProgress?.(saved, stems.length)
    }
    zip.end()
    await drain()
    await sink.close()
  } catch (cause) {
    if (sink.abort) {
      try {
        await sink.abort()
      } catch {
        // 忽略回滚失败
      }
    }
    throw cause
  }
}

export type LoadedStems = {
  manifest: StemsManifest
  stems: StemAudio[]
  /** 各轨波形峰值金字塔（v3 包从 peaks.bin 读出；v2 旧包为空 Map） */
  peaks: Map<StemId, WaveformPyramid>
}

/** 读 blob 的分块大小（4 MiB）。 */
const READ_CHUNK_BYTES = 4 << 20

/**
 * 流式解包：逐条目解压（单条暂存内存），返回 manifest + 7 轨 Float32 + 峰值表。
 * manifest 缺失/损坏、缺轨或条目与 manifest 不一致时抛错。
 * 进度只统计必需条目（manifest + 7 WAV），peaks.bin 不计入（v2 旧包无此条目）。
 */
export async function loadStemsArchive(
  blob: Blob,
  onProgress?: (loaded: number, total: number) => void,
): Promise<LoadedStems> {
  const entries = new Map<string, Uint8Array>()
  const requiredNames = stemsArchiveRequiredEntryNames()
  const totalEntries = requiredNames.length
  const unzip = new Unzip((file) => {    const chunks: Uint8Array[] = []
    let size = 0
    file.ondata = (err, chunk, final) => {
      if (err) return
      if (chunk.length > 0) {
        chunks.push(chunk)
        size += chunk.length
      }
      if (final) {
        const merged = new Uint8Array(size)
        let offset = 0
        for (const c of chunks) {
          merged.set(c, offset)
          offset += c.length
        }
        entries.set(file.name, merged)
        let loaded = 0
        for (const name of requiredNames) if (entries.has(name)) loaded += 1
        onProgress?.(loaded, totalEntries)
      }
    }
    // 必须调用 start() 才开始解压该条目（fflate 流式 Unzip 的要求）
    file.start()
  })
  // 注册 deflate 解码器（Unzip 默认只认识未压缩条目）
  unzip.register(UnzipInflate)

  try {
    const total = Math.max(1, Math.ceil(blob.size / READ_CHUNK_BYTES))
    for (let i = 0; i < total; i++) {
      const slice = blob.slice(i * READ_CHUNK_BYTES, (i + 1) * READ_CHUNK_BYTES)
      const bytes = new Uint8Array(await slice.arrayBuffer())
      unzip.push(bytes, i === total - 1)
    }
  } catch (cause) {
    throw new Error(`压缩包读取失败：${cause instanceof Error ? cause.message : String(cause)}`)
  }

  const manifestBytes = entries.get(STEMS_MANIFEST_ENTRY)
  if (!manifestBytes) throw new Error('压缩包缺少 stems.json，无法载入')
  const manifest = parseStemsManifest(new TextDecoder().decode(manifestBytes))
  if (!manifest) throw new Error('stems.json 内容无效')

  const stems: StemAudio[] = []
  for (const item of manifest.stems) {
    const bytes = entries.get(item.file)
    if (!bytes) throw new Error(`压缩包缺少 ${item.file}，无法载入`)
    stems.push({ stemId: item.id, data: decodeStemWavBytes(bytes) })
  }
  const peaksBytes = entries.get(STEMS_PEAKS_ENTRY)
  const peaks = peaksBytes ? deserializeWaveformPeaks(peaksBytes) : new Map<StemId, WaveformPyramid>()
  return { manifest, stems, peaks }
}

/** 压缩包内单条目的定位信息（zip 中央目录记录；STORE 条目数据即原始字节）。 */
export type ZipEntryLayout = {
  method: number
  compressedSize: number
  uncompressedSize: number
  dataOffset: number
}

/**
 * 从 zip 字节解析中央目录 → 各条目定位。用于「先出 UI」快路径：
 * STORE 条目（WAV / peaks.bin）可直接 subarray 取字节，无需 fflate 流式解包。
 */
export function parseZipEntries(bytes: Uint8Array): Map<string, ZipEntryLayout> {
  const eocd = scanZipEocd(bytes)
  if (!eocd) return new Map<string, ZipEntryLayout>()
  return readZipEntriesFromDirectory(bytes, eocd.cdOffset, eocd.count)
}

/** 在 zip 字节内倒序扫描 EOCD（0x06054b50，位于末尾 22+65535 字节内），返回中央目录偏移与条目数。 */
function scanZipEocd(bytes: Uint8Array): { cdOffset: number; count: number } | undefined {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const searchStart = Math.max(0, bytes.byteLength - 22 - 65535)
  for (let i = bytes.byteLength - 22; i >= searchStart; i--) {
    if (data.getUint32(i, true) === 0x06054b50) {
      return { cdOffset: data.getUint32(i + 16, true), count: data.getUint16(i + 10, true) }
    }
  }
  return undefined
}

/** 从已定位的中央目录起点逐条解析条目（cdOffset 相对 bytes 数组起点）。 */
function readZipEntriesFromDirectory(
  bytes: Uint8Array,
  cdOffset: number,
  count: number,
): Map<string, ZipEntryLayout> {
  const layout = new Map<string, ZipEntryLayout>()
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder()
  let offset = cdOffset
  for (let n = 0; n < count; n++) {
    if (data.getUint32(offset, true) !== 0x02014b50) break
    const method = data.getUint16(offset + 10, true)
    const compressedSize = data.getUint32(offset + 20, true)
    const uncompressedSize = data.getUint32(offset + 24, true)
    const nameLength = data.getUint16(offset + 28, true)
    const extraLength = data.getUint16(offset + 30, true)
    const commentLength = data.getUint16(offset + 32, true)
    const localHeaderOffset = data.getUint32(offset + 42, true)
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    // 本地文件头：30 + 文件名长 + 扩展长 之后才是数据
    const dataOffset = localHeaderOffset + 30 + nameLength + extraLength
    layout.set(name, { method, compressedSize, uncompressedSize, dataOffset })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return layout
}

export type StemsArchiveLayout = {
  manifest: StemsManifest
  /** 各轨波形峰值金字塔（v2 旧包为空 Map） */
  peaks: Map<StemId, WaveformPyramid>
  /** 全部条目定位（WAV 供后台解码） */
  entries: Map<string, ZipEntryLayout>
}

/**
 * 快路径读取：只取 manifest + peaks.bin（zip 目录定位 + 按需 inflate/取字节），
 * 不解压 WAV——供「先出 UI、后台逐轨解码」两段式加载的第一段。
 */
export function readStemsArchiveLayout(bytes: Uint8Array): StemsArchiveLayout {
  const entries = parseZipEntries(bytes)
  const manifestLayout = entries.get(STEMS_MANIFEST_ENTRY)
  if (!manifestLayout) throw new Error('压缩包缺少 stems.json，无法载入')
  const manifestData = inflateSync(
    bytes.subarray(manifestLayout.dataOffset, manifestLayout.dataOffset + manifestLayout.compressedSize),
  )
  const manifest = parseStemsManifest(new TextDecoder().decode(manifestData))
  if (!manifest) throw new Error('stems.json 内容无效')
  const peaksLayout = entries.get(STEMS_PEAKS_ENTRY)
  const peaks = peaksLayout
    ? deserializeWaveformPeaks(
        // subarray 起点可能非 4 字节对齐（Float32Array 视图要求），复制对齐
        bytes
          .subarray(peaksLayout.dataOffset, peaksLayout.dataOffset + peaksLayout.compressedSize)
          .slice(),
      )
    : new Map<StemId, WaveformPyramid>()
  return { manifest, peaks, entries }
}

/** 按布局取单条 WAV 数据并解码为 interleaved Float32（STORE 零拷贝；DEFLATE 兼容 v2 旧包）。 */
export function decodeStemFromLayout(bytes: Uint8Array, layout: ZipEntryLayout): Float32Array {
  let data = bytes.subarray(layout.dataOffset, layout.dataOffset + layout.compressedSize)
  if (layout.method === 8) data = inflateSync(data)
  return decodeStemWavBytes(data)
}

/** 按 [offset, length) 范围读文件字节（由调用方接入 VFS 范围读；挂载卷/本地卷均可）。 */
export type ZipReadRange = (offset: number, length: number) => Promise<Uint8Array>

/**
 * 范围读版分轨包布局：只读文件尾部（EOCD + 中央目录）定位条目，
 * 再按需读 manifest / peaks.bin（STORE 条目直接取字节、manifest DEFLATE inflate）。
 * 返回的 `readStemBytes(stemId)` 闭包按单条 WAV 区间范围读并解码，
 * 供「先出 UI、后台逐轨范围读解码」两段式加载（不整包进内存）。
 */
export type StemsArchiveLayoutRanged = {
  manifest: StemsManifest
  /** 各轨波形峰值金字塔（v2 旧包为空 Map） */
  peaks: Map<StemId, WaveformPyramid>
  /** 全部条目定位（WAV 供后台逐轨范围读） */
  entries: Map<string, ZipEntryLayout>
  /** 按轨范围读压缩段并解码为 interleaved Float32（v2 DEFLATE 条目 inflate 兼容） */
  readStemBytes: (stemId: StemId) => Promise<Float32Array>
}

/** 范围读快路径的尾部窗口（EOCD + 中央目录；stems 包条目少，目录 < 2KiB，64KiB 足够）。 */
const ZIP_TAIL_READ_BYTES = 64 * 1024

export async function readStemsArchiveLayoutRanged(
  readRange: ZipReadRange,
  totalBytes: number,
): Promise<StemsArchiveLayoutRanged> {
  // 读尾部窗口定位 EOCD / 中央目录
  let regionOffset = Math.max(0, totalBytes - ZIP_TAIL_READ_BYTES)
  let regionLen = totalBytes - regionOffset
  let region = await readRange(regionOffset, regionLen)

  let eocd = scanZipEocd(region)
  if (!eocd) {
    // 尾部窗口未命中（极小包 / 结构异常）：整包兜底
    regionOffset = 0
    regionLen = totalBytes
    region = await readRange(0, totalBytes)
    eocd = scanZipEocd(region)
  }
  if (!eocd) throw new Error('压缩包格式无效')
  if (eocd.cdOffset < regionOffset) {
    // 中央目录起点在尾部窗口外（罕见超大目录）：按需扩读目录段
    regionOffset = eocd.cdOffset
    regionLen = totalBytes - eocd.cdOffset
    region = await readRange(regionOffset, regionLen)
    const again = scanZipEocd(region)
    if (!again) throw new Error('压缩包格式无效')
    eocd = again
  }
  const entries = readZipEntriesFromDirectory(region, eocd.cdOffset - regionOffset, eocd.count)

  const manifestLayout = entries.get(STEMS_MANIFEST_ENTRY)
  if (!manifestLayout) throw new Error('压缩包缺少 stems.json，无法载入')
  const manifestBytes = await readRange(manifestLayout.dataOffset, manifestLayout.compressedSize)
  const manifest = parseStemsManifest(new TextDecoder().decode(inflateSync(manifestBytes)))
  if (!manifest) throw new Error('stems.json 内容无效')

  const peaksLayout = entries.get(STEMS_PEAKS_ENTRY)
  const peaks = peaksLayout
    ? // 复制对齐（readRange 来源的视图 byteOffset 可能非 4 字节，Float32Array 视图要求对齐）
      deserializeWaveformPeaks((await readRange(peaksLayout.dataOffset, peaksLayout.compressedSize)).slice())
    : new Map<StemId, WaveformPyramid>()

  const readStemBytes = async (stemId: StemId): Promise<Float32Array> => {
    const layout = entries.get(stemWavEntryName(stemId))
    if (!layout) throw new Error(`压缩包缺少 ${stemWavEntryName(stemId)}，无法载入`)
    const data = await readRange(layout.dataOffset, layout.compressedSize)
    if (layout.method === 8) return decodeStemWavBytes(inflateSync(data))
    return decodeStemWavBytes(data)
  }

  return { manifest, peaks, entries, readStemBytes }
}
