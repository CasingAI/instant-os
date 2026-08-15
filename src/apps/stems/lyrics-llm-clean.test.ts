/**
 * LLM 歌词清洗纯逻辑单测：提示词约束、解析与行数校验、改词回退。
 * cleanLyricsWithLlm 依赖网络，不在此单测（靠 tsc 类型检查）。
 */
import assert from 'node:assert/strict'
import {
  buildCleanSystemPrompt,
  buildCleanUserMessage,
  parseCleanResult,
} from './lyrics-llm-clean.ts'

// —— parseCleanResult：删行首演唱者前缀通过 ——
{
  const original = ['徐/刘：热恋的人总会特别可爱', '你说你爱我', '爱到天荒地老']
  const result = parseCleanResult(
    '热恋的人总会特别可爱\n你说你爱我\n爱到天荒地老',
    original,
  )
  assert.equal(result, '热恋的人总会特别可爱\n你说你爱我\n爱到天荒地老')
}

// —— parseCleanResult：行数不符 → 返回 null（防行时间戳错位） ——
{
  const result = parseCleanResult('只有一行', ['第一行', '第二行'])
  assert.equal(result, null)
  const fewer = parseCleanResult('第一行', ['第一行', '第二行'])
  assert.equal(fewer, null)
}

// —— parseCleanResult：LLM 改了歌词字（替换非删减）→ 该行回退原样 ——
{
  const original = ['我爱北京天安门']
  const result = parseCleanResult('我恨北京天安门', original)
  assert.equal(result, '我爱北京天安门')
}

// —— parseCleanResult：删中间注释但损失超过半 → 保守回退（防误删歌词词） ——
{
  const original = ['热恋（演唱：徐刘）的人总会特别可爱']
  const result = parseCleanResult('热恋的人总会特别可爱', original)
  assert.equal(result, '热恋（演唱：徐刘）的人总会特别可爱')
}

// —— parseCleanResult：剥 Markdown 代码块 ——
{
  const original = ['热恋的人总会特别可爱']
  const result = parseCleanResult('```text\n热恋的人总会特别可爱\n```', original)
  assert.equal(result, '热恋的人总会特别可爱')
}

// —— parseCleanResult：无改动行原样保留；首尾空白容忍 ——
{
  const original = ['你说你爱我']
  const result = parseCleanResult('  你说你爱我  ', original)
  assert.equal(result, '你说你爱我')
}

// —— buildCleanSystemPrompt：约束行数一致 + 不改词 ——
{
  const prompt = buildCleanSystemPrompt()
  assert.ok(prompt.includes('行数'), '提示词应要求行数一致')
  assert.ok(prompt.includes('不得改写'), '提示词应禁止改词')
  assert.ok(prompt.includes('非歌词内容'), '提示词应聚焦非歌词内容')
}

// —— buildCleanUserMessage：逐行编号传入 ——
{
  const message = buildCleanUserMessage('第一行\n第二行')
  assert.ok(message.includes('2\t第二行'), '应逐行编号')
  assert.ok(message.includes('共 2 行'), '应声明行数')
}

console.log('lyrics-llm-clean: 全部通过')
