/**
 * 分轨结果持久化：把 6 条分轨打包成单个压缩包（`<源文件名>.stems.zip`），
 * 放在源文件同目录（侧车文件，同歌词 `.lrc` 的模式），下次打开同一首歌时自动载入。
 *
 * 打包用 fflate 的流式 Zip：Float32 → 16-bit PCM 按块转换，压缩输出分块写
 * 入注入的 sink（VFS 流式写），全程不产生整包大数组。
 * 解包同样流式：逐条目解压，单条 WAV 暂存内存后直接解码为 Float32。
 */

import { Unzip, UnzipInflate, Zip, ZipDeflate } from 'fflate'
import { STEM_CHANNELS, encodeWavHeader } from './stems-separator.ts'
import { STEM_IDS } from './stems-types.ts'
import type { StemAudio, StemId } from './stems-types.ts'

export const STEMS_ARCHIVE_EXTENSION = '.stems.zip'
export const STEMS_MANIFEST_ENTRY = 'stems.json'
export const STEMS_MANIFEST_VERSION = 1

/** 分轨压缩包内单条 WAV 的文件名（用稳定 id，与显示标签解耦）。 */
export function stemWavEntryName(stemId: StemId): string {
  return `${stemId}.wav`
}

/** 压缩包内全部条目的文件名（manifest + 6 条 WAV）。 */
export function stemsArchiveEntryNames(): string[] {
  return [STEMS_MANIFEST_ENTRY, ...STEM_IDS.map((id) => stemWavEntryName(id))]
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
}): StemsManifest {
  return {
    version: STEMS_MANIFEST_VERSION,
    sourcePath: meta.sourcePath,
    sourceName: meta.sourceName,
    durationSec: meta.durationSec,
    sampleRate: meta.sampleRate,
    createdAt: meta.createdAt ?? Date.now(),
    stems: STEM_IDS.map((id) => ({ id, file: stemWavEntryName(id) })),
  }
}

/** 解析并校验 stems.json 内容；不合法返回 null。 */
export function parseStemsManifest(json: string): StemsManifest | null {
  try {
    const raw = JSON.parse(json) as Partial<StemsManifest>
    if (raw.version !== STEMS_MANIFEST_VERSION) return null
    if (typeof raw.sourcePath !== 'string') return null
    if (typeof raw.sampleRate !== 'number' || typeof raw.durationSec !== 'number') return null
    if (!Array.isArray(raw.stems) || raw.stems.length !== STEM_IDS.length) return null
    for (const item of raw.stems) {
      if (!STEM_IDS.includes(item.id)) return null
      if (item.file !== stemWavEntryName(item.id)) return null
    }
    return raw as StemsManifest
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
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const frames = (bytes.byteLength - 44) / (STEM_CHANNELS * 2)
  const data = new Float32Array(frames * STEM_CHANNELS)
  let offset = 44
  for (let i = 0; i < data.length; i++) {
    const s = view.getInt16(offset, true)
    data[i] = s < 0 ? s / 0x8000 : s / 0x7fff
    offset += 2
  }
  return data
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
  /** 完成进度（已存轨数 / 总轨数） */
  onProgress?: (saved: number, total: number) => void
}

const EMPTY_CHUNK = new Uint8Array(0)

/**
 * 流式打包 6 轨 + manifest 为 zip，写入 sink。
 * 每 push 一块输入后立即排空压缩输出（串行 await 写入），峰值内存 ≈ 单块大小。
 */
export async function saveStemsArchive(options: SaveStemsOptions): Promise<void> {
  const { stems, sourcePath, sourceName, durationSec, sampleRate, sink, onProgress } = options
  const manifest = buildStemsManifest({ sourcePath, sourceName, durationSec, sampleRate })

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

  const pushEntry = async (entry: ZipDeflate, chunks: Iterable<Uint8Array>): Promise<void> => {
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
    let saved = 0
    for (const stem of stems) {
      const frames = Math.floor(stem.data.length / STEM_CHANNELS)
      const chunks = (function* generateWavChunks(): Generator<Uint8Array> {
        yield new Uint8Array(encodeWavHeader(frames, sampleRate))
        for (let f = 0; f < frames; f += WAV_CHUNK_FRAMES) {
          yield convertToPcm16(stem.data, f, Math.min(frames, f + WAV_CHUNK_FRAMES))
        }
      })()
      await pushEntry(new ZipDeflate(stemWavEntryName(stem.stemId)), chunks)
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
}

/** 读 blob 的分块大小（4 MiB）。 */
const READ_CHUNK_BYTES = 4 << 20

/**
 * 流式解包：逐条目解压（单条暂存内存），返回 manifest + 6 轨 Float32。
 * manifest 缺失/损坏、缺轨或条目与 manifest 不一致时抛错。
 */
export async function loadStemsArchive(
  blob: Blob,
  onProgress?: (loaded: number, total: number) => void,
): Promise<LoadedStems> {
  const entries = new Map<string, Uint8Array>()
  const totalEntries = stemsArchiveEntryNames().length
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
        onProgress?.(entries.size, totalEntries)
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
  return { manifest, stems }
}
