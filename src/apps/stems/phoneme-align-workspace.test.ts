/**
 * 歌词对齐工作区纯逻辑单测（素材文件生成 / 进度计数 / 回复提取 LRC）。
 * 运行：node --experimental-strip-types src/apps/stems/phoneme-align-workspace.test.ts
 */
import assert from 'node:assert/strict'
import {
  buildPhonemeSidecarText,
  buildPhonemeWorkspaceFiles,
  countAlignedLrcLines,
  extractLrcFromAnswer,
  parsePhonemeSidecarText,
  phonemeSidecarPath,
} from './phoneme-align-workspace.ts'
import type { AlignedPhone } from './phoneme-types.ts'

function makePhones(count: number): AlignedPhone[] {
  return Array.from({ length: count }, (_, i) => ({
    symbol: i % 2 === 0 ? 'tɕ' : 'a',
    start: i * 0.1,
    end: i * 0.1 + 0.09,
  }))
}

function testLyricsText(): void {
  // 多行歌词：trim 后去空行，内容逐字原样
  const { lyricsText } = buildPhonemeWorkspaceFiles({
    lyrics: '  第一句  \n\n第二句\n \t \n第三句',
    phoneList: [],
  })
  assert.equal(lyricsText, '第一句\n第二句\n第三句')

  // 空输入 → 空文本
  const empty = buildPhonemeWorkspaceFiles({ lyrics: '  \n\n', phoneList: [] })
  assert.equal(empty.lyricsText, '')
}

function testPhonesTsv(): void {
  const files = buildPhonemeWorkspaceFiles({
    lyrics: '一句',
    phoneList: [
      { symbol: 'tɕ', start: 0, end: 0.1234 },
      { symbol: 'iɛ5', start: 0.1234, end: 0.25 },
      { symbol: '<pad>', start: 0.25, end: 0.3 }, // CTC 标记 → 跳过
      { symbol: 'zzz-unmapped', start: 0.3, end: 0.4 }, // 未映射符号 → 保留原样
    ],
  })
  const lines = files.phonesTsv.split('\n')
  assert.equal(lines.length, 3)
  // 时间戳两位小数 + 拼音列
  assert.equal(lines[0], '0.00\t0.12\tj\ttɕ')
  assert.equal(lines[1], '0.12\t0.25\tie\tiɛ5')
  // 未映射符号保留原样（ipaToPinyin 兜底）
  assert.ok(lines[2].endsWith('\tzzz-unmapped'))
  // 不含 CTC 标记
  assert.ok(!files.phonesTsv.includes('<pad>'))

  // 全 CTC → 空表
  const onlyCtc = buildPhonemeWorkspaceFiles({
    lyrics: '一句',
    phoneList: [{ symbol: '<s>', start: 0, end: 1 }],
  })
  assert.equal(onlyCtc.phonesTsv, '')
}

function testCountAlignedLines(): void {
  const text = [
    '[00:01.00]<00:01.00>你好',
    '[00:03.00]<00:03.00>世界',
    '（无时间戳的说明行）',
    '[00:05.00]<00:05.00>再见',
    '',
  ].join('\n')
  assert.equal(countAlignedLrcLines(text), 3)
  assert.equal(countAlignedLrcLines(''), 0)
  assert.equal(countAlignedLrcLines('只有文字没有时间戳'), 0)
}

function testSidecarPath(): void {
  // 常规扩展名 → 同目录同名 .phones.tsv
  assert.equal(phonemeSidecarPath('/user/音乐/晴天.mp3'), '/user/音乐/晴天.phones.tsv')
  // 无扩展名
  assert.equal(phonemeSidecarPath('/user/abc'), '/user/abc.phones.tsv')
  // 深层目录 / 卷根附近
  assert.equal(
    phonemeSidecarPath('/mount/我的歌单/子目录/夜曲.flac'),
    '/mount/我的歌单/子目录/夜曲.phones.tsv',
  )
}

function testSidecarRoundTrip(): void {
  const phones: AlignedPhone[] = [
    { symbol: 'tɕ', start: 0, end: 0.1234 },
    { symbol: '<pad>', start: 0.1234, end: 0.2 }, // CTC → 不写旁存
    { symbol: 'a', start: 0.2, end: 0.35 },
  ]
  const text = buildPhonemeSidecarText({
    duration: 182.34,
    sampleRate: 16000,
    provider: 'webgpu',
    phoneList: phones,
  })
  const lines = text.split('\n')
  assert.ok(lines[0].startsWith('# instant-phoneme'))
  assert.ok(lines.includes('# duration=182.34'))
  assert.ok(lines.includes('# sampleRate=16000'))
  assert.ok(lines.includes('# provider=webgpu'))
  assert.ok(!text.includes('<pad>'))

  const parsed = parsePhonemeSidecarText(text)
  assert.equal(parsed.duration, 182.34)
  assert.equal(parsed.sampleRate, 16000)
  assert.equal(parsed.provider, 'webgpu')
  assert.equal(parsed.phones.length, 2)
  assert.deepEqual(parsed.phones[0], { symbol: 'tɕ', start: 0, end: 0.12 })
  assert.deepEqual(parsed.phones[1], { symbol: 'a', start: 0.2, end: 0.35 })
}

function testSidecarParseBadRows(): void {
  const text = [
    '# instant-phoneme v1',
    '0.00\t0.10\tj\ttɕ',
    'bad\trow\tx\ty', // 坏行 → 跳过
    '\t\t\t', // 空列 → 跳过
    '1.00\t1.50\tie\tiɛ5',
    '# provider=wasm',
  ].join('\n')
  const parsed = parsePhonemeSidecarText(text)
  assert.equal(parsed.phones.length, 2)
  assert.equal(parsed.phones[1].symbol, 'iɛ5')
  assert.equal(parsed.provider, 'wasm')
}

function testExtractLrc(): void {
  // markdown 代码块包裹
  const fenced = '```lrc\n[00:01.00]<00:01.00>你好\n```\n\n已对齐完成。'
  assert.equal(extractLrcFromAnswer(fenced), '[00:01.00]<00:01.00>你好')

  // 无代码块：保留含时间戳的行
  const mixed = '开始对齐\n[00:01.00]<00:01.00>你好\n[00:03.00]<00:03.00>世界\n说明文字'
  assert.equal(
    extractLrcFromAnswer(mixed),
    '[00:01.00]<00:01.00>你好\n[00:03.00]<00:03.00>世界',
  )

  // 完全没有时间戳 → 原样返回
  const plain = '没有对齐任何内容'
  assert.equal(extractLrcFromAnswer(plain), plain)

  // 空输入
  assert.equal(extractLrcFromAnswer(''), '')
}

async function runAll(): Promise<void> {
  testLyricsText()
  testPhonesTsv()
  testCountAlignedLines()
  testSidecarPath()
  testSidecarRoundTrip()
  testSidecarParseBadRows()
  testExtractLrc()
  console.log('phoneme-align-workspace: 全部通过')
}

runAll().catch((error) => {
  console.error(error)
  process.exit(1)
})
