/**
 * FLAC 无损编解码封装。
 *
 * 编码路径：WebCodecs（Chromium `AudioEncoder` codec 'flac'）优先，失败/不支持时回退 WASM libflacjs；
 * 解码路径：统一用 @wasm-audio-decoders/flac（libFLAC WASM，成熟可靠），
 * 保证任意浏览器都能打开已保存的包，同时天然 round-trip 验证 WebCodecs 产物。
 *
 * 说明：libflacjs 的解码器对 16-bit 数据存在字节去重 hack（__fix_write_buffer），
 * 在含大量 0x00/0xFF 字节的 PCM 上会越界崩溃，故解码不采用 libflacjs；
 * 其 Encoder 不经过该路径，仅用作编码回退。
 *
 * libflacjs WASM 仅在 worker / 首次需要时加载：
 * 动态 import glue + `?url` wasm 静态资源；libflacjs 支持通过 `globalThis.FLAC_SCRIPT_LOCATION`
 * （按文件名映射）指定 wasm 位置，在 glue 模块执行前设置即可生效（见 dist/libflac.wasm.js）。
 * 测试可通过注入 loader 换 asm.js 变体。
 */
import { md5 } from '@noble/hashes/legacy.js'
import { FLACDecoder } from '@wasm-audio-decoders/flac'
import type libFactory from 'libflacjs'

export type FlacLib = libFactory.Flac
export type FlacLibLoader = () => FlacLib | Promise<FlacLib>

/** WebCodecs FLAC 配置支持检测结果缓存（worker 内单例）。 */
let webCodecsSupported: boolean | undefined

/** WebCodecs FLAC 编码产物校验状态：首次编码小段数据用解码验证，避免跨实现不匹配写出坏文件。 */
let webCodecsVerified = false

/** 把 interleaved stereo Float32 量化为 16-bit PCM 字节（与 WAV encode 一致），供 MD5 计算。 */
function pcm16Bytes(data: Float32Array): Uint8Array {
  const bytes = new Uint8Array(data.length * 2)
  const view = new DataView(bytes.buffer)
  let offset = 0
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }
  return bytes
}

// —— WASM libflacjs 加载（仅编码用） ——

let wasmLibPromise: Promise<FlacLib> | null = null

function waitReady(Flac: FlacLib): Promise<void> {
  if (Flac.isReady()) return Promise.resolve()
  return new Promise((resolve) => {
    Flac.on('ready', () => resolve())
  })
}

/** 浏览器 worker 加载 libflacjs WASM（glue + wasm 均走 vite 静态资源）。 */
export async function loadFlacLibWasm(): Promise<FlacLib> {
  if (wasmLibPromise) return wasmLibPromise
  wasmLibPromise = (async () => {
    const { default: wasmUrl } = await import('libflacjs/dist/libflac.wasm.wasm?url')
    // libflacjs 优先从 global.FLAC_SCRIPT_LOCATION（对象按文件名映射）取 wasm 路径
    ;(globalThis as Record<string, unknown>).FLAC_SCRIPT_LOCATION = {
      'libflac.wasm.wasm': wasmUrl,
    }
    const mod = (await import('libflacjs/dist/libflac.wasm.js')) as unknown as {
      default?: FlacLib
      [key: string]: unknown
    }
    // UMD 可能挂到 default（CJS 转换）或作为具名导出（浏览器全局分支）
    const Flac = (mod.default ?? mod) as unknown as FlacLib
    if (!Flac || typeof Flac.isReady !== 'function') throw new Error('libflacjs 初始化失败')
    await waitReady(Flac)
    return Flac
  })()
  return wasmLibPromise
}

// —— WASM 编码（libflacjs 原生 API 自封装） ——

/** 每块 PCM 帧数（控制峰值内存：块 ≈ 2 MiB，与 WAV 转换一致）。 */
const FLAC_CHUNK_FRAMES = 1 << 19

/**
 * libflacjs WASM 实例上暴露的原生编码 API（绕过 lib/ 下的 Node CJS 封装，
 * 后者内部 require() 无法在浏览器 worker 中运行）。
 */
type FlacEncoderNative = {
  create_libflac_encoder(
    sampleRate: number,
    channels: number,
    bitsPerSample: number,
    compression: number,
    totalSamples?: number,
    verify?: boolean,
  ): number
  init_encoder_stream(
    encoder: number,
    writeCallback: (data: Uint8Array, numberOfBytes: number, samples: number, currentFrame: number) => boolean | void,
    metadataCallback?: (metadata: unknown) => void,
  ): number
  FLAC__stream_encoder_process_interleaved(encoder: number, buffer: Int32Array, numberOfSamples: number): boolean
  FLAC__stream_encoder_finish(encoder: number): boolean
  FLAC__stream_encoder_delete(encoder: number): void
}

/** 轻量 FLAC 编码器：收集 write 回调块、process/finish/delete 均直连原生 API。 */
class FlacEncoder {
  private readonly flac: FlacLib & FlacEncoderNative
  private readonly id: number
  private chunks: Uint8Array[] = []

  constructor(flac: FlacLib & FlacEncoderNative, options: { sampleRate: number; compression: number }) {
    this.flac = flac
    this.id = flac.create_libflac_encoder(options.sampleRate, 2, 16, options.compression, undefined, false)
    if (this.id === 0) throw new Error('FLAC 编码器创建失败')
    const state = flac.init_encoder_stream(this.id, (data) => {
      this.chunks.push(data.slice())
    })
    if (state !== 0) {
      flac.FLAC__stream_encoder_delete(this.id)
      throw new Error(`FLAC 编码器初始化失败（状态 ${state}）`)
    }
  }

  /** 送入 interleaved int32 PCM（16-bit 值右对齐），numFrames 为帧数。 */
  encode(pcm: Int32Array, numFrames: number): boolean {
    return this.flac.FLAC__stream_encoder_process_interleaved(this.id, pcm, numFrames)
  }

  /** 结束编码并返回完整 FLAC 字节。 */
  finish(): Uint8Array {
    this.flac.FLAC__stream_encoder_finish(this.id)
    let total = 0
    for (const c of this.chunks) total += c.length
    const out = new Uint8Array(total)
    let offset = 0
    for (const c of this.chunks) {
      out.set(c, offset)
      offset += c.length
    }
    return out
  }

  destroy(): void {
    this.flac.FLAC__stream_encoder_delete(this.id)
    this.chunks.length = 0
  }
}

/** 用 libflacjs WASM 把 interleaved stereo Float32 编码为完整 FLAC 字节（16-bit）。 */
export async function encodeFlacWasm(
  data: Float32Array,
  sampleRate: number,
  loader: FlacLibLoader = loadFlacLibWasm,
): Promise<Uint8Array> {
  const flac = (await loader()) as FlacLib & FlacEncoderNative
  const frames = Math.floor(data.length / 2)
  const pcm = new Int32Array(data.length)
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]))
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  const encoder = new FlacEncoder(flac, { sampleRate, compression: 5 })
  try {
    for (let f = 0; f < frames; f += FLAC_CHUNK_FRAMES) {
      const end = Math.min(frames, f + FLAC_CHUNK_FRAMES)
      if (!encoder.encode(pcm.subarray(f * 2, end * 2), end - f)) {
        throw new Error('FLAC 编码失败')
      }
    }
    return encoder.finish()
  } finally {
    encoder.destroy()
  }
}

// —— 解码（@wasm-audio-decoders/flac） ——

/** 把完整 FLAC 字节解码为 interleaved stereo Float32（16-bit）。 */
export async function decodeFlac(bytes: Uint8Array): Promise<Float32Array> {
  const decoder = new FLACDecoder()
  try {
    await decoder.ready
    const { channelData, samplesDecoded } = await decoder.decodeFile(bytes)
    if (channelData.length !== 2) {
      throw new Error(`FLAC 声道数异常：${channelData.length}`)
    }
    const interleaved = new Float32Array(samplesDecoded * 2)
    const l = channelData[0]
    const r = channelData[1]
    for (let i = 0; i < samplesDecoded; i++) {
      interleaved[i * 2] = l[i]
      interleaved[i * 2 + 1] = r[i]
    }
    return interleaved
  } finally {
    decoder.free()
  }
}

// —— WebCodecs 编码 ——

/** WebCodecs 是否支持 FLAC 编码（运行时检测；worker 内缓存）。 */
export async function isFlacWebCodecsSupported(): Promise<boolean> {
  if (webCodecsSupported !== undefined) return webCodecsSupported
  let supported = false
  try {
    if (typeof AudioEncoder !== 'undefined' && typeof AudioEncoder.isConfigSupported === 'function') {
      const config: AudioEncoderConfig = {
        codec: 'flac',
        sampleRate: 44100,
        numberOfChannels: 2,
        flac: { compressLevel: 5 },
      } as AudioEncoderConfig
      const result = await AudioEncoder.isConfigSupported(config)
      supported = !!result.supported
    }
  } catch {
    supported = false
  }
  webCodecsSupported = supported
  return supported
}

/**
 * 生成 FLAC STREAMINFO metadata block（34 字节）：
 * min/max frame size 未知填 0（FLAC 规范允许）；MD5 为解码后 PCM 字节流（interleaved 16-bit LE）的 MD5。
 */
function buildStreamInfo(
  sampleRate: number,
  totalFrames: number,
  pcmMd5: Uint8Array,
  blockSize = 4096,
): Uint8Array {
  const info = new Uint8Array(34)
  const view = new DataView(info.buffer)
  view.setUint16(0, blockSize, false)
  view.setUint16(2, blockSize, false)
  // bytes 4-9: min/max frame size = 0
  // 组合字段（bytes 10-17）：sampleRate(20) | channels-1(3) | bps-1(5) | totalSamples(36)
  const total =
    (BigInt(sampleRate) << 36n) |
    (BigInt(2 - 1) << 33n) |
    (BigInt(16 - 1) << 32n) |
    BigInt(totalFrames)
  view.setBigUint64(10, total, false)
  info.set(pcmMd5, 18)
  return info
}

/** 把 WebCodecs 输出的 FLAC 帧组装为完整 FLAC 文件字节。 */
function assembleFlacFile(
  chunks: EncodedAudioChunk[],
  sampleRate: number,
  totalFrames: number,
  pcmMd5: Uint8Array,
): Uint8Array {
  const streamInfo = buildStreamInfo(sampleRate, totalFrames, pcmMd5)
  let total = 4 + 4 + streamInfo.length
  for (const chunk of chunks) total += chunk.byteLength
  const out = new Uint8Array(total)
  out.set([0x66, 0x4c, 0x61, 0x43], 0) // 'fLaC'
  out.set([0x80, 0, 0, 34], 4) // 最后一块 metadata、STREAMINFO(0)、长度 34
  out.set(streamInfo, 8)
  let offset = 8 + streamInfo.length
  for (const chunk of chunks) {
    chunk.copyTo(out.subarray(offset, offset + chunk.byteLength))
    offset += chunk.byteLength
  }
  return out
}

/** 用 WebCodecs（Chromium）编码 interleaved stereo Float32 → 完整 FLAC 字节。不支持/失败时抛错。 */
export async function encodeFlacWebCodecs(
  data: Float32Array,
  sampleRate: number,
): Promise<Uint8Array> {
  if (!(await isFlacWebCodecsSupported())) throw new Error('WebCodecs 不支持 FLAC 编码')
  const frames = Math.floor(data.length / 2)
  const chunks: EncodedAudioChunk[] = []
  let encodeError: DOMException | null = null
  const encoder = new AudioEncoder({
    output: (chunk) => {
      chunks.push(chunk)
    },
    error: (error) => {
      encodeError = error
    },
  })
  const config: AudioEncoderConfig = {
    codec: 'flac',
    sampleRate,
    numberOfChannels: 2,
    flac: { compressLevel: 5 },
  } as AudioEncoderConfig
  encoder.configure(config)
  // 分块转 planar 编码，控制峰值内存
  for (let f = 0; f < frames; f += FLAC_CHUNK_FRAMES) {
    const end = Math.min(frames, f + FLAC_CHUNK_FRAMES)
    const n = end - f
    const planar = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) {
      planar[i] = data[(f + i) * 2]
      planar[n + i] = data[(f + i) * 2 + 1]
    }
    const audioData = new AudioData({
      format: 'f32-planar',
      sampleRate,
      numberOfFrames: n,
      numberOfChannels: 2,
      timestamp: Math.round((f * 1_000_000) / sampleRate),
      data: planar,
    })
    encoder.encode(audioData)
    audioData.close()
  }
  await encoder.flush()
  encoder.close()
  if (encodeError) throw encodeError
  if (chunks.length === 0) throw new Error('WebCodecs FLAC 编码无输出')
  return assembleFlacFile(chunks, sampleRate, frames, md5(pcm16Bytes(data)))
}

/** 首次 WebCodecs 编码前用解码器验证产物，避免跨实现不匹配写出坏文件。 */
async function verifyWebCodecsOnce(sampleRate: number): Promise<void> {
  if (webCodecsVerified) return
  const seconds = 1
  const data = new Float32Array(sampleRate * 2 * seconds)
  for (let i = 0; i < sampleRate * seconds; i++) {
    const v = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5
    data[i * 2] = v
    data[i * 2 + 1] = v
  }
  const encoded = await encodeFlacWebCodecs(data, sampleRate)
  const decoded = await decodeFlac(encoded)
  if (decoded.length !== data.length) {
    throw new Error('WebCodecs FLAC 校验失败：样本数不一致')
  }
  webCodecsVerified = true
}

/**
 * 把 interleaved stereo Float32 编码为完整 FLAC 字节。
 * WebCodecs 优先（Chromium），不支持/校验失败/编码失败时回退 WASM libflacjs。
 */
export async function encodeFlac(
  data: Float32Array,
  sampleRate: number,
  loader: FlacLibLoader = loadFlacLibWasm,
): Promise<Uint8Array> {
  if (await isFlacWebCodecsSupported()) {
    try {
      await verifyWebCodecsOnce(sampleRate)
      return await encodeFlacWebCodecs(data, sampleRate)
    } catch {
      // WebCodecs 不可靠 → 回退 WASM
    }
  }
  return encodeFlacWasm(data, sampleRate, loader)
}
