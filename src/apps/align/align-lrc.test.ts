/**
 * 增强 LRC 生成单测。
 * 运行：node --experimental-strip-types src/apps/align/align-lrc.test.ts
 */
import assert from 'node:assert/strict'
import { buildAlignLrc, formatLrcTimestamp, isPunctuationOnly } from './align-lrc.ts'
import type { AlignedUnit, G2pLine } from './align-types.ts'

function testFormatTimestamp(): void {
  assert.equal(formatLrcTimestamp(0), '00:00.00')
  assert.equal(formatLrcTimestamp(1.23), '00:01.23')
  assert.equal(formatLrcTimestamp(65.078), '01:05.07')
  assert.equal(formatLrcTimestamp(125.994), '02:05.99')
  assert.equal(formatLrcTimestamp(-1), '00:00.00')
}

function testPunctuation(): void {
  assert.equal(isPunctuationOnly('，'), true)
  assert.equal(isPunctuationOnly('...'), true)
  assert.equal(isPunctuationOnly('你'), false)
  assert.equal(isPunctuationOnly('hello'), false)
  assert.equal(isPunctuationOnly(''), true)
}

function testChineseLine(): void {
  const units: AlignedUnit[] = [
    { text: '你', phones: ['n'], start: 1.0, end: 1.2 },
    { text: '好', phones: ['x'], start: 1.3, end: 1.5 },
    { text: '，', phones: [], start: 1.5, end: 1.5 },
    { text: '世', phones: ['ʂ'], start: 2.0, end: 2.2 },
    { text: '界', phones: ['tɕ'], start: 2.3, end: 2.5 },
  ]
  const lines: G2pLine[] = [
    { text: '你好，', units: [{ text: '你', phones: [] }, { text: '好', phones: [] }, { text: '，', phones: [] }] },
    { text: '世界', units: [{ text: '世', phones: [] }, { text: '界', phones: [] }] },
  ]
  const lrc = buildAlignLrc(units, lines)
  const outLines = lrc.split('\n')
  assert.equal(outLines.length, 2)
  // 第一行：标点附在「好」后面
  assert.equal(outLines[0], '[00:01.00]<00:01.00>你<00:01.30>好，')
  assert.equal(outLines[1], '[00:02.00]<00:02.00>世<00:02.30>界')
}

function testEnglishWords(): void {
  const units: AlignedUnit[] = [
    { text: 'Hello', phones: ['h', 'ə', 'l', 'oʊ'], start: 0.5, end: 0.9 },
    { text: 'world', phones: ['w', 'ɝ', 'l', 'd'], start: 1.0, end: 1.4 },
  ]
  const lrc = buildAlignLrc(units)
  assert.equal(lrc, '[00:00.50]<00:00.50>Hello<00:01.00>world')
}

function testEmpty(): void {
  assert.equal(buildAlignLrc([]), '')
}

async function runAll(): Promise<void> {
  testFormatTimestamp()
  testPunctuation()
  testChineseLine()
  testEnglishWords()
  testEmpty()
  console.log('align-lrc: 全部通过')
}

runAll().catch((error) => {
  console.error(error)
  process.exit(1)
})
