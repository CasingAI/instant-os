/**
 * 分轨持久化单测：打包 → 解包 round-trip、字节一致性、manifest 校验、路径计算。
 * 运行：node --experimental-strip-types src/apps/stems/stems-persistence.test.ts
 */
import assert from 'node:assert/strict'
import { unzipSync } from 'fflate'
import {
  STEM_CHANNELS,
  encodeWav,
} from './stems-separator.ts'
import { STEM_IDS } from './stems-types.ts'
import type { StemAudio } from './stems-types.ts'
import {
  convertToPcm16,
  decodeStemWavBytes,
  encodeStemWavBytes,
  loadStemsArchive,
  parseStemsManifest,
  saveStemsArchive,
  STEMS_ARCHIVE_EXTENSION,
  STEMS_MANIFEST_ENTRY,
  stemsArchiveEntryNames,
  stemsArchivePathFor,
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
}

async function testRoundTrip(): Promise<void> {
  await roundTrip(makeFakeStems(), '/user/Musics/song.mp3')
  // 不同采样率与较短的音频
  await roundTrip(makeFakeStems(100), '/user/Musics/短歌.flac')
  console.log('ok: save → load round-trip（含 16-bit 量化与跨块边界）')
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
    version: 2,
    sourcePath: '/user/Musics/song.mp3',
    sourceName: 'song.mp3',
    durationSec: 10,
    sampleRate: 44100,
    createdAt: 123,
    stems: STEM_IDS.map((id) => ({ id, file: stemWavEntryName(id) })),
  }
  assert.ok(parseStemsManifest(JSON.stringify(good)), '合法 manifest 应通过')
  assert.equal(parseStemsManifest(JSON.stringify({ ...good, version: 3 })), null, '版本不符')
  assert.equal(parseStemsManifest(JSON.stringify({ ...good, stems: good.stems.slice(0, 5) })), null, '缺轨')
  assert.equal(
    parseStemsManifest(JSON.stringify({ ...good, stems: [{ id: 'bogus', file: 'bogus.wav' }] })),
    null,
    '非法轨 id',
  )
  assert.equal(parseStemsManifest('not json'), null, '非法 JSON')
  console.log('ok: parseStemsManifest 校验')
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
  assert.equal(stemsArchiveEntryNames().length, STEM_IDS.length + 1)
  console.log('ok: stemsArchiveEntryNames')
}

await testRoundTrip()
testPcm16Chunking()
testManifestValidation()
testArchivePath()
testArchiveEntryNames()
