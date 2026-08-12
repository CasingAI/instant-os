/**
 * G2P 解析/校验单测。
 * 运行：node --experimental-strip-types src/apps/align/align-g2p.test.ts
 */
import assert from 'node:assert/strict'
import {
  buildG2pUserMessage,
  extractJsonFromAnswer,
  G2pParseError,
  parseG2pResult,
} from './align-g2p.ts'

function testExtractJson(): void {
  // fence 包裹
  const fenced = '```json\n[{"units":[]}]\n```\n已转换完成。'
  assert.equal(extractJsonFromAnswer(fenced), '[{"units":[]}]')

  // 无 fence，前后有说明文字
  const plain = '好的，结果如下：\n[{"units":[{"text":"你","phones":["n","i"]}]}]\n以上就是全部。'
  assert.equal(
    extractJsonFromAnswer(plain),
    '[{"units":[{"text":"你","phones":["n","i"]}]}]',
  )

  // 纯 JSON
  assert.equal(extractJsonFromAnswer('[]'), '[]')
  console.log('  extract-json ok')
}

function testParseValid(): void {
  const lyrics = ['你好', '世界']
  const answer = JSON.stringify([
    { units: [{ text: '你', phones: ['n', 'i'] }, { text: '好', phones: ['x', 'ɑu'] }] },
    { units: [{ text: '世', phones: ['ʂ', 'ə'] }, { text: '界', phones: ['tɕ', 'iɛ'] }] },
  ])
  const lines = parseG2pResult(answer, lyrics)
  assert.equal(lines.length, 2)
  assert.equal(lines[0].length, 2)
  assert.deepEqual(lines[0][0], { text: '你', phones: ['n', 'i'] })
  assert.deepEqual(lines[1][1].phones, ['tɕ', 'iɛ'])
  console.log('  parse-valid ok')
}

function testPunctuationAndSpaces(): void {
  // 标点并入前单元；英文词间空格不输出 —— 拼接（去空白）仍与原文一致
  const lyrics = ['你好，世界！', 'I love you']
  const answer = JSON.stringify([
    { units: [
      { text: '你好，', phones: ['n', 'i', 'x', 'ɑu'] },
      { text: '世界！', phones: ['ʂ', 'ə', 'tɕ', 'iɛ'] },
    ] },
    { units: [
      { text: 'I', phones: ['aɪ'] },
      { text: 'love', phones: ['l', 'ʌ', 'v'] },
      { text: 'you', phones: ['j', 'u'] },
    ] },
  ])
  const lines = parseG2pResult(answer, lyrics)
  assert.equal(lines[0].length, 2)
  assert.equal(lines[1].length, 3)
  assert.equal(lines[1][0].text, 'I')
  assert.equal(lines[1][2].text, 'you')
  console.log('  punctuation-spaces ok')
}

function testLineCountMismatch(): void {
  const lyrics = ['第一行', '第二行']
  const answer = JSON.stringify([
    { units: [{ text: '第一行', phones: ['a'] }] },
  ])
  assert.throws(
    () => parseG2pResult(answer, lyrics),
    (e: unknown) => e instanceof G2pParseError && e.message.includes('行数不匹配'),
  )
  console.log('  line-count-mismatch ok')
}

function testTextMismatch(): void {
  const lyrics = ['你很好']
  // LLM 改写了歌词（漏字）→ 应报错并给出不一致行
  const answer = JSON.stringify([
    { units: [{ text: '你好', phones: ['n', 'i', 'x', 'ɑu'] }] },
  ])
  assert.throws(
    () => parseG2pResult(answer, lyrics),
    (e: unknown) => e instanceof G2pParseError && e.issues.length === 1,
  )
  console.log('  text-mismatch ok')
}

function testPhonesFiltering(): void {
  const lyrics = ['你']
  const answer = JSON.stringify([
    { units: [{ text: '你', phones: ['n', '', 42, 'i'] }] },
  ])
  const lines = parseG2pResult(answer, lyrics)
  assert.deepEqual(lines[0][0].phones, ['n', 'i'])
  console.log('  phones-filtering ok')
}

function testNotJson(): void {
  const lyrics = ['你']
  assert.throws(
    () => parseG2pResult('我不是 JSON', lyrics),
    (e: unknown) => e instanceof G2pParseError,
  )
  console.log('  not-json ok')
}

function testBuildUserMessage(): void {
  const msg = buildG2pUserMessage(['第一行', '第二行'])
  assert.ok(msg.includes('第 1 行：第一行'))
  assert.ok(msg.includes('第 2 行：第二行'))
  console.log('  build-user-message ok')
}

function runAll(): void {
  testExtractJson()
  testParseValid()
  testPunctuationAndSpaces()
  testLineCountMismatch()
  testTextMismatch()
  testPhonesFiltering()
  testNotJson()
  testBuildUserMessage()
  console.log('align-g2p: 全部通过')
}

runAll()
