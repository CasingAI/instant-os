/**
 * 分轨持久化单测：打包 → 解包 round-trip、字节一致性、manifest 校验、路径计算。
 * 运行：node --experimental-strip-types src/apps/stems/stems-persistence.test.ts
 */
import assert from 'node:assert/strict'
import { unzipSync, zipSync } from 'fflate'
import {
  STEM_CHANNELS,
  buildWaveformPyramid,
  encodeWav,
} from './stems-separator.ts'
import { STEM_IDS } from './stems-types.ts'
import type { StemAudio } from './stems-types.ts'
import {
  convertToPcm16,
  decodeStemFromLayout,
  decodeStemWavBytes,
  encodeStemWavBytes,
  loadStemsArchive,
  parseStemsManifest,
  readStemsArchiveLayout,
  saveStemsArchive,
  STEMS_ARCHIVE_EXTENSION,
  STEMS_MANIFEST_ENTRY,
  STEMS_MANIFEST_VERSION,
  STEMS_PEAKS_ENTRY,
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
  assert.equal(loaded.peaks.size, STEM_IDS.length, 'v3 包应含全部轨的峰值表')
  for (const stem of stems) {
    const p = loaded.peaks.get(stem.stemId)
    assert.ok(p, `缺少 ${stem.stemId} 的峰值表`)
    const expected = buildWaveformPyramid(stem.data, 44100)
    assert.equal(p.bucketSamples, expected.bucketSamples)
    assert.equal(p.bucketCount, expected.bucketCount)
    assert.ok(p.min.every((v, i) => v === expected.min[i]), `min 应一致（${stem.stemId}）`)
    assert.ok(p.max.every((v, i) => v === expected.max[i]), `max 应一致（${stem.stemId}）`)
  }
}

async function testRoundTrip(): Promise<void> {
  await roundTrip(makeFakeStems(), '/user/Musics/song.mp3')
  // 不同采样率与较短的音频
  await roundTrip(makeFakeStems(100), '/user/Musics/短歌.flac')
  console.log('ok: save → load round-trip（含 16-bit 量化与跨块边界）')
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
  assert.equal(parseStemsManifest(JSON.stringify({ ...good, version: 4 })), null, '版本不符')
  assert.ok(parseStemsManifest(JSON.stringify({ ...good, version: 2 })), 'v2 旧包应兼容')
  assert.equal(parseStemsManifest(JSON.stringify({ ...good, stems: good.stems.slice(0, 5) })), null, '缺轨')
  assert.equal(
    parseStemsManifest(JSON.stringify({ ...good, stems: [{ id: 'bogus', file: 'bogus.wav' }] })),
    null,
    '非法轨 id',
  )
  assert.equal(parseStemsManifest('not json'), null, '非法 JSON')

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
  console.log('ok: stemsArchiveEntryNames')
}

await testRoundTrip()
await testLegacyV2Archive()
await testLayoutFastPath()
await testAlignedLrcRoundTrip()
await testPhonemesRoundTrip()
testPcm16Chunking()
testManifestValidation()
testArchivePath()
testArchiveEntryNames()
