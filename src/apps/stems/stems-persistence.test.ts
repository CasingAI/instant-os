/**
 * 分轨持久化单测：打包 → 解包 round-trip、字节一致性、manifest 校验、路径计算。
 * 运行：node --experimental-strip-types src/apps/stems/stems-persistence.test.ts
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { unzipSync, zipSync } from 'fflate'
import {
  STEM_CHANNELS,
  buildWaveformPyramid,
  encodeWav,
} from './stems-separator.ts'
import { STEM_IDS } from './stems-types.ts'
import type { StemAudio } from './stems-types.ts'
import { decodeFlacWasm, encodeFlacWasm } from './stems-flac.ts'
import type { FlacLib } from './stems-flac.ts'
import {
  convertToPcm16,
  decodeStemFromLayout,
  decodeStemWavBytes,
  deserializeWaveformPeaks,
  encodeStemWavBytes,
  loadStemsArchive,
  parseStemsManifest,
  readStemsArchiveLayout,
  readStemsArchiveLayoutRanged,
  saveStemsArchive,
  serializeWaveformPeaks,
  STEMS_ARCHIVE_EXTENSION,
  STEMS_MANIFEST_ENTRY,
  STEMS_MANIFEST_VERSION,
  STEMS_PEAKS_ENTRY,
  stemAudioEntryName,
  stemsArchiveEntryNames,
  stemsArchivePathFor,
  stemsArchiveRequiredEntryNames,
  stemWavEntryName,
} from './stems-persistence.ts'

/** 造 7 轨测试数据：每轨不同常数/斜坡/正弦，长度超过一个转换块以覆盖分块边界。 */
function makeFakeStems(frames: number = 600_000): StemAudio[] {
  return STEM_IDS.map((stemId, stem) => {
    const data = new Float32Array(frames * STEM_CHANNELS)
    for (let i = 0; i < frames; i++) {
      const v =
        stem === 0
          ? Math.sin((2 * Math.PI * 440 * i) / 44100) * 0.5
          : ((i % 997) / 997) * 0.8 - 0.4 + stem * 0.01
      data[i * STEM_CHANNELS] = v
      data[i * STEM_CHANNELS + 1] = -v * 0.5
    }
    return { stemId, data }
  })
}

// —— FLAC 编解码（测试用 libflacjs asm.js 变体，纯 JS 无需 wasm 文件） ——

const nodeRequire = createRequire(import.meta.url)
let asmFlacLib: FlacLib | undefined

async function loadFlacAsmJs(): Promise<FlacLib> {
  if (!asmFlacLib) {
    const factory = nodeRequire('libflacjs') as (variant: string) => FlacLib
    asmFlacLib = factory('asmjs')
  }
  if (!asmFlacLib.isReady()) {
    await new Promise<void>((resolve) => asmFlacLib!.on('ready', () => resolve()))
  }
  return asmFlacLib
}

/**
 * 解析 zip 字节，返回每条目的压缩方法（compression method）：0 = STORE，8 = DEFLATE。
 * 从尾部 EOCD 找中央目录，再逐条读中央目录条目（比遍历本地文件头更可靠，不依赖 data descriptor 变体）。
 */
function zipEntryMethods(zipBytes: Uint8Array): Map<string, number> {
  const methods = new Map<string, number>()
  const data = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength)
  const textDecoder = new TextDecoder()
  // EOCD 在文件末尾 22+65535 字节内，倒序找签名 0x06054b50
  let eocdOffset = -1
  const searchStart = Math.max(0, zipBytes.length - 22 - 65535)
  for (let i = zipBytes.length - 22; i >= searchStart; i--) {
    if (data.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset < 0) return methods
  const count = data.getUint16(eocdOffset + 10, true)
  const cdOffset = data.getUint32(eocdOffset + 16, true)
  let offset = cdOffset
  for (let n = 0; n < count; n++) {
    if (data.getUint32(offset, true) !== 0x02014b50) break
    const method = data.getUint16(offset + 10, true)
    const nameLength = data.getUint16(offset + 28, true)
    const extraLength = data.getUint16(offset + 30, true)
    const commentLength = data.getUint16(offset + 32, true)
    const name = textDecoder.decode(zipBytes.subarray(offset + 46, offset + 46 + nameLength))
    methods.set(name, method)
    offset += 46 + nameLength + extraLength + commentLength
  }
  return methods
}

async function roundTrip(stems: StemAudio[], sourcePath: string): Promise<void> {
  const chunks: Uint8Array[] = []
  const sink = {
    write: (chunk: Uint8Array) => {
      chunks.push(chunk)
    },
    close: () => undefined,
  }
  let progressEvents = 0
  await saveStemsArchive({
    stems,
    sourcePath,
    sourceName: 'test.mp3',
    durationSec: 12.34,
    sampleRate: 44100,
    sink,
    onProgress: (saved, total) => {
      progressEvents += 1
      assert.ok(saved >= 1 && saved <= total, '进度计数应在 1..total 之间')
      assert.equal(total, STEM_IDS.length)
    },
  })
  assert.equal(progressEvents, STEM_IDS.length, '每轨应上报一次进度')

  // 压缩包结构：7 条 WAV + manifest，且可被标准 unzipSync 解析
  const zipBytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let offset = 0
  for (const c of chunks) {
    zipBytes.set(c, offset)
    offset += c.length
  }
  const unzipped = unzipSync(zipBytes)
  assert.deepEqual(Object.keys(unzipped).sort(), stemsArchiveEntryNames().sort(), '压缩包条目')

  // 压缩方法：WAV 用 STORE（method 0），manifest 用 DEFLATE（method 8）
  const methods = zipEntryMethods(zipBytes)
  for (const stem of stems) {
    assert.equal(
      methods.get(stemWavEntryName(stem.stemId)),
      0,
      `${stemWavEntryName(stem.stemId)} 应为不压缩（method 0）`,
    )
  }
  assert.equal(methods.get(STEMS_MANIFEST_ENTRY), 8, 'stems.json 应为 deflate（method 8）')

  // 每条 WAV 与 encodeWav 逐字节一致
  for (const stem of stems) {
    const expected = new Uint8Array(encodeWav(stem.data, 44100))
    const actual = unzipped[stemWavEntryName(stem.stemId)]
    assert.ok(actual, `缺少 ${stemWavEntryName(stem.stemId)}`)
    assert.equal(actual.length, expected.length)
    assert.ok(
      actual.every((b, i) => b === expected[i]),
      `WAV 字节应与 encodeWav 一致（${stem.stemId}）`,
    )
  }

  // 载入 round-trip：数据与 manifest 完全还原
  const loaded = await loadStemsArchive(new Blob([zipBytes]))
  assert.equal(loaded.manifest.sourcePath, sourcePath)
  assert.equal(loaded.manifest.sourceName, 'test.mp3')
  assert.equal(loaded.manifest.durationSec, 12.34)
  assert.equal(loaded.manifest.sampleRate, 44100)
  assert.deepEqual(
    loaded.stems.map((s) => s.stemId),
    STEM_IDS,
  )
  for (const [a, b] of loaded.stems.map((s, i) => [s, stems[i]] as const)) {
    assert.equal(a.data.length, b.data.length)
    for (let i = 0; i < a.data.length; i += 512) {
      // 16-bit 量化往返，误差允许 2 LSB
      assert.ok(Math.abs(a.data[i] - b.data[i]) < 2 / 32767, `数据应还原（${a.stemId} @${i}）`)
    }
  }

  // 峰值表 round-trip：每轨金字塔存在、桶数与长度自洽、与直接重算一致
  assert.equal(loaded.peaks.size, STEM_IDS.length, 'v4 包应含全部轨的峰值表')
  for (const stem of stems) {
    const p = loaded.peaks.get(stem.stemId)
    assert.ok(p, `缺少 ${stem.stemId} 的峰值表`)
    const expected = buildWaveformPyramid(stem.data, 44100)
    assert.equal(p.bucketSamples, expected.bucketSamples)
    assert.equal(p.bucketCount, expected.bucketCount)
    assert.ok(p.min.every((v, i) => v === expected.min[i]), `min 应一致（${stem.stemId}）`)
    assert.ok(p.max.every((v, i) => v === expected.max[i]), `max 应一致（${stem.stemId}）`)
    // v4：左右声道峰值/RMS 一并还原（双色叠加波形依赖）
    assert.ok(p.ampL && p.ampL.every((v, i) => v === expected.ampL![i]), `ampL 应一致（${stem.stemId}）`)
    assert.ok(p.ampR && p.ampR.every((v, i) => v === expected.ampR![i]), `ampR 应一致（${stem.stemId}）`)
    assert.ok(p.rmsL && p.rmsL.every((v, i) => v === expected.rmsL![i]), `rmsL 应一致（${stem.stemId}）`)
    assert.ok(p.rmsR && p.rmsR.every((v, i) => v === expected.rmsR![i]), `rmsR 应一致（${stem.stemId}）`)
  }
}

async function testRoundTrip(): Promise<void> {
  await roundTrip(makeFakeStems(), '/user/Musics/song.mp3')
  // 不同采样率与较短的音频
  await roundTrip(makeFakeStems(100), '/user/Musics/短歌.flac')
  console.log('ok: save → load round-trip（含 16-bit 量化与跨块边界）')
}

/** 6 轨包（other2 近似静音被并入 other）：round-trip + peaks.bin 顺序正确性。 */
async function testSixStemRoundTrip(): Promise<void> {
  const stems = makeFakeStems(1000).filter((s) => s.stemId !== 'other2')
  assert.equal(stems.length, 6)
  const chunks: Uint8Array[] = []
  await saveStemsArchive({
    stems,
    sourcePath: '/user/Musics/song.mp3',
    sourceName: 'song.mp3',
    durationSec: 1,
    sampleRate: 44100,
    sink: {
      write: (c) => {
        chunks.push(c)
      },
      close: () => undefined,
    },
  })
  const zipBytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let o = 0
  for (const c of chunks) {
    zipBytes.set(c, o)
    o += c.length
  }

  const loaded = await loadStemsArchive(new Blob([zipBytes]))
  assert.equal(loaded.manifest.stems.length, 6)
  assert.equal(loaded.stems.length, 6)
  assert.equal(loaded.peaks.size, 6, '6 轨包峰值表应含 6 条')

  const layout = readStemsArchiveLayout(zipBytes)
  assert.equal(layout.manifest.stems.length, 6)
  assert.equal(layout.peaks.size, 6)
  // 关键：peaks.bin 按 manifest 轨序反序列化，id 映射必须正确（防止按固定 STEM_IDS 顺序读导致错位）
  for (const stem of stems) {
    const exact = buildWaveformPyramid(stem.data, 44100)
    const peak = layout.peaks.get(stem.stemId)
    assert.ok(peak, `${stem.stemId} 应有峰值表`)
    assert.equal(peak.bucketCount, exact.bucketCount, `${stem.stemId} 桶数一致`)
    for (let b = 0; b < peak.bucketCount; b++) {
      assert.ok(Math.abs(peak.max[b] - exact.max[b]) < 1e-6, `${stem.stemId} 桶 ${b} max 应一致`)
    }
  }
  assert.equal(layout.peaks.has('other2'), false, '6 轨包不应有 other2 峰值表')
  console.log('ok: 6 轨包 round-trip（含 peaks 顺序正确性）')
}

/** v2 旧包（全 deflate、无 peaks.bin、version 2）应仍可加载，peaks 为空 Map。 */
async function testLegacyV2Archive(): Promise<void> {
  const stems = makeFakeStems(1000)
  const manifest = {
    version: 2,
    sourcePath: '/user/Musics/song.mp3',
    sourceName: 'song.mp3',
    durationSec: 1,
    sampleRate: 44100,
    createdAt: 123,
    stems: STEM_IDS.map((id) => ({ id, file: stemWavEntryName(id) })),
  }
  const files: Record<string, Uint8Array> = {
    [STEMS_MANIFEST_ENTRY]: new TextEncoder().encode(JSON.stringify(manifest)),
  }
  for (const stem of stems) {
    files[stemWavEntryName(stem.stemId)] = new Uint8Array(encodeWav(stem.data, 44100))
  }
  const zipBytes = zipSync(files) // zipSync 全条目 deflate，等价于旧 v2 打包
  const loaded = await loadStemsArchive(new Blob([zipBytes]))
  assert.equal(loaded.manifest.version, 2)
  assert.equal(loaded.peaks.size, 0, 'v2 包无峰值表，应返回空 Map')
  assert.equal(loaded.stems.length, STEM_IDS.length)
  assert.equal(loaded.stems[0].data.length, stems[0].data.length)
  console.log('ok: v2 旧包（全 deflate）兼容加载')
}

/** 快路径（zip 目录定位 + 零拷贝 STORE）：manifest/peaks 读取、WAV 后台解码 round-trip。 */
async function testLayoutFastPath(): Promise<void> {
  const stems = makeFakeStems(2000)
  const chunks: Uint8Array[] = []
  await saveStemsArchive({
    stems,
    sourcePath: '/user/Musics/song.mp3',
    sourceName: 'song.mp3',
    durationSec: 2,
    sampleRate: 44100,
    sink: {
      write: (c) => {
        chunks.push(c)
      },
      close: () => undefined,
    },
  })
  const zipBytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let o = 0
  for (const c of chunks) {
    zipBytes.set(c, o)
    o += c.length
  }

  const layout = readStemsArchiveLayout(zipBytes)
  assert.equal(layout.manifest.sourceName, 'song.mp3')
  assert.equal(layout.peaks.size, STEM_IDS.length, '快路径应读到全部峰值表')
  for (const stem of stems) {
    const entry = layout.entries.get(stemWavEntryName(stem.stemId))
    assert.ok(entry, `缺少 ${stem.stemId} 的条目定位`)
    assert.equal(entry.method, 0, 'WAV 应为 STORE')
    // 后台解码与完整解包一致（含非对齐 subarray 路径）
    const decoded = decodeStemFromLayout(zipBytes, entry)
    assert.equal(decoded.length, stem.data.length)
    for (let i = 0; i < decoded.length; i += 128) {
      assert.ok(Math.abs(decoded[i] - stem.data[i]) < 2 / 32767, `${stem.stemId} 解码应还原`)
    }
  }
  console.log('ok: 快路径（zip 目录 + STORE 零拷贝）读取与后台解码')
}

/** 范围读版快路径：只读尾部 + 按需区间（模拟 VFS 范围读），与整包快路径结果一致。 */
async function testLayoutFastPathRanged(): Promise<void> {
  const stems = makeFakeStems(2000)
  const chunks: Uint8Array[] = []
  await saveStemsArchive({
    stems,
    sourcePath: '/user/Musics/song.mp3',
    sourceName: 'song.mp3',
    durationSec: 2,
    sampleRate: 44100,
    sink: {
      write: (c) => {
        chunks.push(c)
      },
      close: () => undefined,
    },
  })
  const zipBytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let o = 0
  for (const c of chunks) {
    zipBytes.set(c, o)
    o += c.length
  }

  // 模拟 VFS 范围读：返回新分配的副本（对齐），等价 Blob.slice().arrayBuffer()
  const readRange = async (offset: number, length: number): Promise<Uint8Array> => {
    const start = Math.max(0, offset)
    const end = Math.min(zipBytes.byteLength, start + Math.max(0, length))
    return zipBytes.slice(start, end)
  }

  const ranged = await readStemsArchiveLayoutRanged(readRange, zipBytes.byteLength)
  assert.equal(ranged.manifest.sourceName, 'song.mp3')
  assert.equal(ranged.peaks.size, STEM_IDS.length, '范围读应读到全部峰值表')
  for (const stem of stems) {
    const decoded = await ranged.readStemBytes(stem.stemId)
    assert.equal(decoded.length, stem.data.length)
    for (let i = 0; i < decoded.length; i += 128) {
      assert.ok(Math.abs(decoded[i] - stem.data[i]) < 2 / 32767, `${stem.stemId} 解码应还原`)
    }
  }
  // 与整包版布局一致（条目定位 / manifest / peaks）
  const whole = readStemsArchiveLayout(zipBytes)
  assert.equal(ranged.manifest.sourcePath, whole.manifest.sourcePath)
  assert.deepEqual(
    [...ranged.entries.keys()].sort(),
    [...whole.entries.keys()].sort(),
    '条目定位应与整包版一致',
  )
  console.log('ok: 范围读快路径（尾部定位 + 按需区间）与整包一致')
}

/** 范围读版对 v2 旧包（全 deflate、无 peaks.bin）兼容：readStemBytes 走 inflate。 */
async function testLayoutFastPathRangedLegacyV2(): Promise<void> {
  const stems = makeFakeStems(1000)
  const manifest = {
    version: 2,
    sourcePath: '/user/Musics/song.mp3',
    sourceName: 'song.mp3',
    durationSec: 1,
    sampleRate: 44100,
    createdAt: 123,
    stems: STEM_IDS.map((id) => ({ id, file: stemWavEntryName(id) })),
  }
  const files: Record<string, Uint8Array> = {
    [STEMS_MANIFEST_ENTRY]: new TextEncoder().encode(JSON.stringify(manifest)),
  }
  for (const stem of stems) {
    files[stemWavEntryName(stem.stemId)] = new Uint8Array(encodeWav(stem.data, 44100))
  }
  const zipBytes = zipSync(files) // 全条目 deflate，等价 v2 旧包
  const readRange = async (offset: number, length: number): Promise<Uint8Array> => {
    const start = Math.max(0, offset)
    const end = Math.min(zipBytes.byteLength, start + Math.max(0, length))
    return zipBytes.slice(start, end)
  }
  const ranged = await readStemsArchiveLayoutRanged(readRange, zipBytes.byteLength)
  assert.equal(ranged.manifest.version, 2)
  assert.equal(ranged.peaks.size, 0, 'v2 包范围读应无峰值表')
  const decoded = await ranged.readStemBytes(stems[0].stemId)
  assert.equal(decoded.length, stems[0].data.length)
  for (let i = 0; i < decoded.length; i += 256) {
    assert.ok(Math.abs(decoded[i] - stems[0].data[i]) < 2 / 32767, 'v2 DEFLATE 轨应还原')
  }
  console.log('ok: 范围读快路径兼容 v2 旧包（DEFLATE）')
}

function testPcm16Chunking(): void {
  // 分块转换与 encodeWav 的 data 段逐字节一致（含奇偶帧边界）
  const frames = 100_000
  const data = new Float32Array(frames * STEM_CHANNELS)
  for (let i = 0; i < frames; i++) {
    data[i * STEM_CHANNELS] = Math.sin(i * 0.01)
    data[i * STEM_CHANNELS + 1] = Math.cos(i * 0.013) * 0.9
  }
  const wav = new Uint8Array(encodeWav(data, 48000))
  const whole = encodeStemWavBytes(data, 48000)
  assert.equal(whole.length, wav.length)
  for (let i = 0; i < wav.length; i++) {
    assert.equal(whole[i], wav[i], `字节 ${i} 应一致`)
  }
  // 解码往返：16-bit 量化误差在可接受范围
  const decoded = decodeStemWavBytes(whole)
  assert.equal(decoded.length, data.length)
  for (let i = 0; i < data.length; i += 999) {
    assert.ok(Math.abs(decoded[i] - data[i]) < 2 / 32767, '量化误差应 < 1 LSB')
  }
  console.log('ok: convertToPcm16 分块与 encodeWav 字节一致')
}

function testManifestValidation(): void {
  const good = {
    version: STEMS_MANIFEST_VERSION,
    sourcePath: '/user/Musics/song.mp3',
    sourceName: 'song.mp3',
    durationSec: 10,
    sampleRate: 44100,
    createdAt: 123,
    stems: STEM_IDS.map((id) => ({ id, file: stemWavEntryName(id) })),
  }
  assert.ok(parseStemsManifest(JSON.stringify(good)), '合法 manifest 应通过')
  assert.equal(parseStemsManifest(JSON.stringify({ ...good, version: 99 })), null, '未知版本应拒绝')
  assert.ok(parseStemsManifest(JSON.stringify({ ...good, version: 3 })), 'v3 旧包应兼容')
  assert.ok(parseStemsManifest(JSON.stringify({ ...good, version: 2 })), 'v2 旧包应兼容')
  assert.equal(parseStemsManifest(JSON.stringify({ ...good, stems: good.stems.slice(0, 5) })), null, '缺轨')
  // 6 轨（other2 近似静音并入 other）应通过；重复 id 拒绝
  const sixStems = STEM_IDS.filter((id) => id !== 'other2').map((id) => ({
    id,
    file: stemWavEntryName(id),
  }))
  assert.ok(
    parseStemsManifest(JSON.stringify({ ...good, stems: sixStems })),
    '6 轨 manifest（other2 已合并）应通过',
  )
  assert.equal(
    parseStemsManifest(JSON.stringify({ ...good, stems: [...sixStems, sixStems[0]] })),
    null,
    '重复轨 id 应拒绝',
  )
  assert.equal(
    parseStemsManifest(JSON.stringify({ ...good, stems: [] })),
    null,
    '空轨列表应拒绝',
  )
  assert.equal(
    parseStemsManifest(JSON.stringify({ ...good, stems: [{ id: 'bogus', file: 'bogus.wav' }] })),
    null,
    '非法轨 id',
  )
  assert.equal(parseStemsManifest('not json'), null, '非法 JSON')

  // lyrics / lyricsSourceName：字符串通过，非字符串按缺失处理（不整体拒绝）
  const withLyrics = parseStemsManifest(
    JSON.stringify({ ...good, lyrics: '你\n好', lyricsSourceName: '手动粘贴' }),
  )
  assert.ok(withLyrics, '含 lyrics 的 manifest 应通过')
  assert.equal(withLyrics.lyrics, '你\n好')
  assert.equal(withLyrics.lyricsSourceName, '手动粘贴')
  const badLyrics = parseStemsManifest(JSON.stringify({ ...good, lyrics: 42 }))
  assert.ok(badLyrics, 'lyrics 非字符串不应拒绝整个 manifest')
  assert.equal(badLyrics.lyrics, undefined, 'lyrics 非法按缺失处理')
  const badSrc = parseStemsManifest(JSON.stringify({ ...good, lyrics: '你', lyricsSourceName: 42 }))
  assert.ok(badSrc, 'lyricsSourceName 非字符串不应拒绝整个 manifest')
  assert.equal(badSrc.lyricsSourceName, undefined, 'lyricsSourceName 非法按缺失处理')

  // alignedLrc：字符串通过，非字符串按缺失处理（不整体拒绝）
  const withLrc = parseStemsManifest(
    JSON.stringify({ ...good, alignedLrc: '[00:00.00]<00:00.00>你<00:00.30>好' }),
  )
  assert.ok(withLrc, '含 alignedLrc 的 manifest 应通过')
  assert.equal(withLrc.alignedLrc, '[00:00.00]<00:00.00>你<00:00.30>好')
  const badLrc = parseStemsManifest(JSON.stringify({ ...good, alignedLrc: 42 }))
  assert.ok(badLrc, 'alignedLrc 非字符串不应拒绝整个 manifest')
  assert.equal(badLrc.alignedLrc, undefined, 'alignedLrc 非法按缺失处理')

  // phonemes：合法数组通过，非数组/坏形状按缺失处理（不整体拒绝）
  const withPhonemes = parseStemsManifest(
    JSON.stringify({
      ...good,
      phonemes: [
        { symbol: '你', start: 0.1, end: 0.3 },
        { symbol: '好', start: 0.3, end: 0.5 },
      ],
    }),
  )
  assert.ok(withPhonemes, '含 phonemes 的 manifest 应通过')
  assert.equal(withPhonemes.phonemes?.length, 2)
  assert.deepEqual(withPhonemes.phonemes?.[0], { symbol: '你', start: 0.1, end: 0.3 })
  const badPhonemes = parseStemsManifest(JSON.stringify({ ...good, phonemes: 'nope' }))
  assert.ok(badPhonemes, 'phonemes 非数组不应拒绝整个 manifest')
  assert.equal(badPhonemes.phonemes, undefined, 'phonemes 非法按缺失处理')
  const partialBad = parseStemsManifest(
    JSON.stringify({ ...good, phonemes: [{ symbol: '你', start: 'x', end: 0.3 }] }),
  )
  assert.ok(partialBad, 'phonemes 坏形状不应拒绝整个 manifest')
  assert.equal(partialBad.phonemes, undefined, 'phonemes 坏形状按缺失处理')
  console.log('ok: parseStemsManifest 校验')
}

/** 构造 v3 布局的 peaks.bin 字节（每轨仅 bucketSamples + bucketCount + min + max，无 L/R）。 */
function buildV3PeaksBytes(stems: StemAudio[], sampleRate: number): Uint8Array {
  let totalBytes = 0
  const pyramids = stems.map((s) => buildWaveformPyramid(s.data, sampleRate))
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

/** peaks.bin 布局：v4 round-trip（L/R 还原）与 v3 旧布局（L/R 缺省）兼容。 */
function testPeaksFormatCompatibility(): void {
  const stems = makeFakeStems(2000)
  const rate = 44100
  const stemIds = stems.map((s) => s.stemId)

  // v4：序列化 → 反序列化应还原全部 L/R 数组
  const v4Bytes = serializeWaveformPeaks(stems, rate)
  const v4 = deserializeWaveformPeaks(v4Bytes, stemIds, STEMS_MANIFEST_VERSION)
  assert.equal(v4.size, stemIds.length)
  for (const stem of stems) {
    const expected = buildWaveformPyramid(stem.data, rate)
    const p = v4.get(stem.stemId)
    assert.ok(p, `缺少 ${stem.stemId} 的 v4 峰值表`)
    assert.ok(p.ampL && p.ampL.every((v, i) => v === expected.ampL![i]), 'v4 ampL 应还原')
    assert.ok(p.ampR && p.ampR.every((v, i) => v === expected.ampR![i]), 'v4 ampR 应还原')
    assert.ok(p.rmsL && p.rmsL.every((v, i) => v === expected.rmsL![i]), 'v4 rmsL 应还原')
    assert.ok(p.rmsR && p.rmsR.every((v, i) => v === expected.rmsR![i]), 'v4 rmsR 应还原')
  }

  // v3：只有 min/max，L/R 缺省（渲染端降级单色）
  const v3Bytes = buildV3PeaksBytes(stems, rate)
  const v3 = deserializeWaveformPeaks(v3Bytes, stemIds, 3)
  assert.equal(v3.size, stemIds.length)
  for (const stem of stems) {
    const p = v3.get(stem.stemId)
    assert.ok(p, `缺少 ${stem.stemId} 的 v3 峰值表`)
    assert.ok(p.min.length > 0 && p.max.length > 0, 'v3 应有 min/max')
    assert.equal(p.ampL, undefined, 'v3 无 ampL')
    assert.equal(p.ampR, undefined, 'v3 无 ampR')
    assert.equal(p.rmsL, undefined, 'v3 无 rmsL')
    assert.equal(p.rmsR, undefined, 'v3 无 rmsR')
  }

  // 损坏字节（长度不足）→ 空 Map，不崩
  assert.equal(deserializeWaveformPeaks(new Uint8Array([1, 2, 3]), stemIds, STEMS_MANIFEST_VERSION).size, 0)
  console.log('ok: peaks.bin v4 / v3 布局兼容')
}

/** alignedLrc 持久化 round-trip：保存时带上，载入时还原。 */
async function testAlignedLrcRoundTrip(): Promise<void> {
  const stems = makeFakeStems(1000)
  const lrc = '[00:00.00]<00:00.00>你<00:00.30>好<00:00.60>世<00:00.90>界'
  const chunks: Uint8Array[] = []
  await saveStemsArchive({
    stems,
    sourcePath: '/user/Musics/song.mp3',
    sourceName: 'song.mp3',
    durationSec: 2,
    sampleRate: 44100,
    alignedLrc: lrc,
    sink: {
      write: (c) => {
        chunks.push(c)
      },
      close: () => undefined,
    },
  })
  const zipBytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let o = 0
  for (const c of chunks) {
    zipBytes.set(c, o)
    o += c.length
  }
  const loaded = await loadStemsArchive(new Blob([zipBytes]))
  assert.equal(loaded.manifest.alignedLrc, lrc, 'alignedLrc 应随包还原')
  const layout = readStemsArchiveLayout(zipBytes)
  assert.equal(layout.manifest.alignedLrc, lrc, '快路径 manifest 也应含 alignedLrc')
  console.log('ok: alignedLrc 随 .stems.zip 持久化 round-trip')
}

/** 行级方案来源持久化 round-trip：保存时带上，载入时还原（完整解包与快路径均可见）。 */
async function testLineSourcesRoundTrip(): Promise<void> {
  const stems = makeFakeStems(1000)
  const lineSources = ['whole-recognize', 'rescue-ctc', 'manual-spread', 'restored']
  const chunks: Uint8Array[] = []
  await saveStemsArchive({
    stems,
    sourcePath: '/user/Musics/song.mp3',
    sourceName: 'song.mp3',
    durationSec: 2,
    sampleRate: 44100,
    alignedLrc: '[00:00.00]<00:00.00>你<00:00.30>好',
    lineSources,
    sink: {
      write: (c) => {
        chunks.push(c)
      },
      close: () => undefined,
    },
  })
  const zipBytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let o = 0
  for (const c of chunks) {
    zipBytes.set(c, o)
    o += c.length
  }
  const loaded = await loadStemsArchive(new Blob([zipBytes]))
  assert.deepEqual(loaded.manifest.lineSources, lineSources, 'lineSources 应随包还原')
  const layout = readStemsArchiveLayout(zipBytes)
  assert.deepEqual(layout.manifest.lineSources, lineSources, '快路径 manifest 也应含 lineSources')
  // 非法 lineSources（含未知值）按缺失处理，不拒绝整个 manifest
  const withBad = parseStemsManifest(
    JSON.stringify({
      ...layout.manifest,
      lineSources: ['whole-recognize', 'not-a-real-source'],
    }),
  )
  assert.ok(withBad, 'lineSources 含非法值不应拒绝整个 manifest')
  assert.equal(withBad!.lineSources, undefined, '非法 lineSources 按缺失处理')
  // 不带 lineSources 保存时，载入后字段应为 undefined（不污染旧包语义）
  const chunks2: Uint8Array[] = []
  await saveStemsArchive({
    stems,
    sourcePath: '/user/Musics/song.mp3',
    sourceName: 'song.mp3',
    durationSec: 2,
    sampleRate: 44100,
    sink: {
      write: (c) => {
        chunks2.push(c)
      },
      close: () => undefined,
    },
  })
  const zipBytes2 = new Uint8Array(chunks2.reduce((n, c) => n + c.length, 0))
  let o2 = 0
  for (const c of chunks2) {
    zipBytes2.set(c, o2)
    o2 += c.length
  }
  const loaded2 = await loadStemsArchive(new Blob([zipBytes2]))
  assert.equal(loaded2.manifest.lineSources, undefined, '未提供 lineSources 时不应写入该字段')
  console.log('ok: 行级方案来源随 .stems.zip 持久化 round-trip')
}

/** phonemes 持久化 round-trip：保存时带上，载入时还原（完整解包与快路径均可见）。 */
async function testPhonemesRoundTrip(): Promise<void> {
  const stems = makeFakeStems(1000)
  const phonemes = [
    { symbol: '你', start: 0.1, end: 0.3 },
    { symbol: '好', start: 0.3, end: 0.5 },
    { symbol: '世', start: 0.5, end: 0.7 },
    { symbol: '界', start: 0.7, end: 0.9 },
  ]
  const chunks: Uint8Array[] = []
  await saveStemsArchive({
    stems,
    sourcePath: '/user/Musics/song.mp3',
    sourceName: 'song.mp3',
    durationSec: 2,
    sampleRate: 44100,
    alignedLrc: '[00:00.00]<00:00.00>你<00:00.30>好<00:00.60>世<00:00.90>界',
    phonemes,
    sink: {
      write: (c) => {
        chunks.push(c)
      },
      close: () => undefined,
    },
  })
  const zipBytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let o = 0
  for (const c of chunks) {
    zipBytes.set(c, o)
    o += c.length
  }
  const loaded = await loadStemsArchive(new Blob([zipBytes]))
  assert.deepEqual(loaded.manifest.phonemes, phonemes, 'phonemes 应随包还原')
  const layout = readStemsArchiveLayout(zipBytes)
  assert.deepEqual(layout.manifest.phonemes, phonemes, '快路径 manifest 也应含 phonemes')
  // 不带 phonemes 保存时，载入后字段应为 undefined（不污染旧包语义）
  const chunks2: Uint8Array[] = []
  await saveStemsArchive({
    stems,
    sourcePath: '/user/Musics/song.mp3',
    sourceName: 'song.mp3',
    durationSec: 2,
    sampleRate: 44100,
    sink: {
      write: (c) => {
        chunks2.push(c)
      },
      close: () => undefined,
    },
  })
  const zipBytes2 = new Uint8Array(chunks2.reduce((n, c) => n + c.length, 0))
  let o2 = 0
  for (const c of chunks2) {
    zipBytes2.set(c, o2)
    o2 += c.length
  }
  const loaded2 = await loadStemsArchive(new Blob([zipBytes2]))
  assert.equal(loaded2.manifest.phonemes, undefined, '未提供 phonemes 时不应写入该字段')
  console.log('ok: phonemes 随 .stems.zip 持久化 round-trip')
}

/** 原始歌词持久化 round-trip：保存时带上，载入时还原（完整解包与快路径均可见）。 */
async function testLyricsRoundTrip(): Promise<void> {
  const stems = makeFakeStems(1000)
  const lyrics = '这是\n一首歌\n测试歌词'
  const chunks: Uint8Array[] = []
  await saveStemsArchive({
    stems,
    sourcePath: '/user/Musics/song.mp3',
    sourceName: 'song.mp3',
    durationSec: 2,
    sampleRate: 44100,
    lyrics,
    lyricsSourceName: '手动粘贴',
    sink: {
      write: (c) => {
        chunks.push(c)
      },
      close: () => undefined,
    },
  })
  const zipBytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let o = 0
  for (const c of chunks) {
    zipBytes.set(c, o)
    o += c.length
  }
  const loaded = await loadStemsArchive(new Blob([zipBytes]))
  assert.equal(loaded.manifest.lyrics, lyrics, 'lyrics 应随包还原')
  assert.equal(loaded.manifest.lyricsSourceName, '手动粘贴', 'lyricsSourceName 应随包还原')
  const layout = readStemsArchiveLayout(zipBytes)
  assert.equal(layout.manifest.lyrics, lyrics, '快路径 manifest 也应含 lyrics')
  // 不带 lyrics 保存时，载入后字段应为 undefined（不污染旧包语义）
  const chunks2: Uint8Array[] = []
  await saveStemsArchive({
    stems,
    sourcePath: '/user/Musics/song.mp3',
    sourceName: 'song.mp3',
    durationSec: 2,
    sampleRate: 44100,
    sink: {
      write: (c) => {
        chunks2.push(c)
      },
      close: () => undefined,
    },
  })
  const zipBytes2 = new Uint8Array(chunks2.reduce((n, c) => n + c.length, 0))
  let o2 = 0
  for (const c of chunks2) {
    zipBytes2.set(c, o2)
    o2 += c.length
  }
  const loaded2 = await loadStemsArchive(new Blob([zipBytes2]))
  assert.equal(loaded2.manifest.lyrics, undefined, '未提供 lyrics 时不应写入该字段')
  console.log('ok: 原始歌词随 .stems.zip 持久化 round-trip')
}

function testArchivePath(): void {
  assert.equal(
    stemsArchivePathFor('/user/Musics/song.mp3'),
    '/user/Musics/song.stems.zip',
  )
  assert.equal(
    stemsArchivePathFor('/user/Musics/sub dir/歌.名.flac'),
    '/user/Musics/sub dir/歌.名.stems.zip',
  )
  assert.equal(stemsArchivePathFor('/user/README'), '/user/README.stems.zip', '无扩展名')
  assert.equal(stemsArchivePathFor('/user/Musics/song.mp3').endsWith(STEMS_ARCHIVE_EXTENSION), true)
  console.log('ok: stemsArchivePathFor 侧车路径')
}

function testArchiveEntryNames(): void {
  assert.equal(stemsArchiveEntryNames()[0], STEMS_MANIFEST_ENTRY)
  assert.equal(stemsArchiveEntryNames().length, STEM_IDS.length + 2, 'manifest + peaks.bin + 7 WAV')
  assert.ok(stemsArchiveEntryNames().includes(STEMS_PEAKS_ENTRY), '包含 peaks.bin')
  assert.deepEqual(
    stemsArchiveRequiredEntryNames().sort(),
    [STEMS_MANIFEST_ENTRY, ...STEM_IDS.map(stemWavEntryName)].sort(),
    '必需条目 = manifest + 7 WAV',
  )
  assert.deepEqual(
    stemsArchiveRequiredEntryNames('flac').sort(),
    [STEMS_MANIFEST_ENTRY, ...STEM_IDS.map((id) => stemAudioEntryName(id, 'flac'))].sort(),
    'FLAC 必需条目 = manifest + 7 .flac',
  )
  console.log('ok: stemsArchiveEntryNames')
}

/** FLAC WASM 编解码 round-trip：16-bit 量化误差应与 encodeWav 一致。 */
async function testFlacRoundTrip(): Promise<void> {
  const frames = 600_000
  const data = new Float32Array(frames * STEM_CHANNELS)
  for (let i = 0; i < frames; i++) {
    const v = Math.sin((2 * Math.PI * 440 * i) / 44100) * 0.5 + ((i % 997) / 997) * 0.3 - 0.15
    data[i * STEM_CHANNELS] = v
    data[i * STEM_CHANNELS + 1] = -v * 0.5
  }
  const flac = await encodeFlacWasm(data, 44100, loadFlacAsmJs)
  assert.equal(String.fromCharCode(flac[0], flac[1], flac[2], flac[3]), 'fLaC', 'FLAC magic 头')
  const decoded = await decodeFlacWasm(flac, loadFlacAsmJs)
  assert.equal(decoded.length, data.length, '样本数一致')
  let maxErr = 0
  for (let i = 0; i < data.length; i++) {
    maxErr = Math.max(maxErr, Math.abs(decoded[i] - data[i]))
  }
  assert.ok(maxErr <= 1 / 32768 + 1e-9, `16-bit 量化误差应 ≤ 1/32768（实际 ${maxErr}）`)
  console.log('ok: FLAC WASM round-trip（16-bit 量化一致）')
}

/** FLAC 压缩包 save → load round-trip：manifest.codec、条目名、STORE 方式、恢复一致性。 */
async function testFlacArchiveRoundTrip(): Promise<void> {
  // 分块边界覆盖见 testFlacRoundTrip；这里用小数据验证整个 save/load 流程
  const stems = makeFakeStems(60_000)
  const chunks: Uint8Array[] = []
  await saveStemsArchive({
    stems,
    sourcePath: '/user/Musics/song.flac',
    sourceName: 'song.flac',
    durationSec: 12,
    sampleRate: 44100,
    codec: 'flac',
    encodeTrack: (data, rate) => encodeFlacWasm(data, rate, loadFlacAsmJs),
    sink: {
      write: (c) => {
        chunks.push(c)
      },
      close: () => undefined,
    },
  })
  const zipBytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let offset = 0
  for (const c of chunks) {
    zipBytes.set(c, offset)
    offset += c.length
  }

  // manifest：v5、codec=flac、条目 .flac
  const layout = readStemsArchiveLayout(zipBytes)
  assert.equal(layout.manifest.version, STEMS_MANIFEST_VERSION)
  assert.equal(layout.manifest.codec, 'flac')
  for (const item of layout.manifest.stems) {
    assert.ok(item.file.endsWith('.flac'), `${item.file} 应为 .flac`)
  }

  // 条目 STORE + 内容可被标准工具解析（unzip 出 FLAC 字节）
  const methods = zipEntryMethods(zipBytes)
  const unzipped = unzipSync(zipBytes)
  for (const stem of stems) {
    const name = stemAudioEntryName(stem.stemId, 'flac')
    assert.equal(methods.get(name), 0, `${name} 应 STORE（FLAC 已压缩）`)
    const bytes = unzipped[name]
    assert.ok(bytes instanceof Uint8Array)
    assert.equal(
      String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]),
      'fLaC',
      `${name} 内容应为 FLAC`,
    )
  }

  // 完整解包恢复：与原始 PCM 16-bit 量化一致
  const loaded = await loadStemsArchive(new Blob([zipBytes]), undefined, {
    decodeFlacTrack: (b) => decodeFlacWasm(b, loadFlacAsmJs),
  })
  assert.equal(loaded.manifest.codec, 'flac')
  assert.equal(loaded.stems.length, stems.length)
  for (let s = 0; s < stems.length; s++) {
    assert.equal(loaded.stems[s].stemId, stems[s].stemId)
    assert.equal(loaded.stems[s].data.length, stems[s].data.length)
    let maxErr = 0
    for (let i = 0; i < stems[s].data.length; i++) {
      maxErr = Math.max(maxErr, Math.abs(loaded.stems[s].data[i] - stems[s].data[i]))
    }
    assert.ok(maxErr <= 1 / 32768 + 1e-9, `轨 ${stems[s].stemId} 16-bit 量化一致（${maxErr}）`)
  }

  // 范围读快路径 readStemBytes 支持 FLAC
  const ranged = await readStemsArchiveLayoutRanged(
    async (rOffset, length) => zipBytes.slice(rOffset, rOffset + length),
    zipBytes.length,
    { decodeFlacTrack: (b) => decodeFlacWasm(b, loadFlacAsmJs) },
  )
  assert.equal(ranged.manifest.codec, 'flac')
  const first = await ranged.readStemBytes(stems[0].stemId)
  assert.equal(first.length, stems[0].data.length, 'readStemBytes FLAC 解码样本数一致')
  console.log('ok: FLAC 压缩包 save → load round-trip')
}

/** manifest 校验：codec 字段、条目格式一致性、旧版缺省 wav。 */
function testManifestFlacValidation(): void {
  const base = {
    sourcePath: '/a.mp3',
    sourceName: 'a.mp3',
    sampleRate: 44100,
    durationSec: 1,
    createdAt: 0,
  }
  // codec=flac 但条目为 .wav → 不合法
  const bad = parseStemsManifest(
    JSON.stringify({ ...base, version: STEMS_MANIFEST_VERSION, codec: 'flac', stems: [{ id: 'drums', file: 'drums.wav' }] }),
  )
  assert.equal(bad, null, 'flac 包条目应为 .flac')
  // 合法 flac 包
  const good = parseStemsManifest(
    JSON.stringify({ ...base, version: STEMS_MANIFEST_VERSION, codec: 'flac', stems: [{ id: 'drums', file: 'drums.flac' }] }),
  )
  assert.ok(good, '合法 flac 包应通过')
  assert.equal(good?.codec, 'flac')
  // 非法 codec 值 → 按缺失处理为 wav（不整体拒绝）
  const unknownCodec = parseStemsManifest(
    JSON.stringify({ ...base, version: STEMS_MANIFEST_VERSION, codec: 'opus', stems: [{ id: 'drums', file: 'drums.wav' }] }),
  )
  assert.ok(unknownCodec, '未知 codec 按缺失处理')
  assert.equal(unknownCodec?.codec, 'wav')
  // 旧版无 codec → 缺省 wav
  const legacy = parseStemsManifest(
    JSON.stringify({ ...base, version: 4, stems: [{ id: 'drums', file: 'drums.wav' }] }),
  )
  assert.ok(legacy)
  assert.equal(legacy?.codec, 'wav', '旧包缺省 wav')
  console.log('ok: FLAC manifest 校验')
}

await testRoundTrip()
await testSixStemRoundTrip()
await testLegacyV2Archive()
await testLayoutFastPath()
await testLayoutFastPathRanged()
await testLayoutFastPathRangedLegacyV2()
await testAlignedLrcRoundTrip()
await testLineSourcesRoundTrip()
await testPhonemesRoundTrip()
await testLyricsRoundTrip()
testPcm16Chunking()
testManifestValidation()
testPeaksFormatCompatibility()
testArchivePath()
testArchiveEntryNames()
await testFlacRoundTrip()
await testFlacArchiveRoundTrip()
testManifestFlacValidation()
