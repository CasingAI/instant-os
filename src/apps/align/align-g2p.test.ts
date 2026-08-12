/**
 * G2P 解析/分词单测。
 * 运行：node --experimental-strip-types src/apps/align/align-g2p.test.ts
 */
import assert from 'node:assert/strict'
import {
  buildLyricsSkeleton,
  flattenG2pLines,
  parseG2pResult,
  pickVocabHint,
  tokenizeLyricsLine,
} from './align-g2p.ts'

function testTokenize(): void {
  assert.deepEqual(tokenizeLyricsLine('你好，世界'), ['你', '好', '，', '世', '界'])
  assert.deepEqual(tokenizeLyricsLine('Hello world!'), ['Hello', 'world', '!'])
  assert.deepEqual(tokenizeLyricsLine('春 天'), ['春', '天'])
  assert.deepEqual(tokenizeLyricsLine("It's OK"), ["It's", 'OK'])
}

function testSkeleton(): void {
  const lines = buildLyricsSkeleton('  你好  \n\n世界\n')
  assert.equal(lines.length, 2)
  assert.equal(lines[0].text, '你好')
  assert.equal(lines[0].units.length, 2)
  assert.equal(lines[1].units[0].text, '世')
}

function testParseOk(): void {
  const lyrics = '你好\n世界'
  const raw = JSON.stringify({
    lines: [
      {
        text: '你好',
        units: [
          { text: '你', phones: ['n', 'i5'] },
          { text: '好', phones: ['x', 'ɑu5'] },
        ],
      },
      {
        text: '世界',
        units: [
          { text: '世', phones: ['ʂ'] },
          { text: '界', phones: ['tɕ', 'ie'] },
        ],
      },
    ],
  })
  const parsed = parseG2pResult(raw, lyrics)
  assert.equal(parsed.length, 2)
  assert.deepEqual(parsed[0].units[0].phones, ['n', 'i5'])
  assert.equal(flattenG2pLines(parsed).length, 4)
}

function testParseFencedAndRepair(): void {
  // markdown 包裹 + 单元文字被改写但数量一致 → 按骨架纠正
  const lyrics = '春天'
  const raw = '```json\n{"lines":[{"text":"春天","units":[{"text":"春X","phones":["tɕ"]},{"text":"天Y","phones":["t"]}]}]}\n```'
  const parsed = parseG2pResult(raw, lyrics)
  assert.equal(parsed[0].units[0].text, '春')
  assert.equal(parsed[0].units[1].text, '天')
  assert.deepEqual(parsed[0].units[0].phones, ['tɕ'])
}

function testParseMismatchThrows(): void {
  const lyrics = '你好'
  const raw = JSON.stringify({
    lines: [
      {
        text: '你好',
        units: [{ text: '你', phones: ['n'] }], // 少一个字 → 抛错
      },
    ],
  })
  assert.throws(() => parseG2pResult(raw, lyrics), /文字不一致|行数不匹配/)
}

function testVocabHint(): void {
  const hint = pickVocabHint(['<pad>', 'n', 'a', 'i5', '??', 'x'], 3)
  assert.equal(hint, 'n a i5')
}

async function runAll(): Promise<void> {
  testTokenize()
  testSkeleton()
  testParseOk()
  testParseFencedAndRepair()
  testParseMismatchThrows()
  testVocabHint()
  console.log('align-g2p: 全部通过')
}

runAll().catch((error) => {
  console.error(error)
  process.exit(1)
})
