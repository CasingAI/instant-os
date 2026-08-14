/**
 * SenseVoice BPE 解码纯函数单测（node --experimental-strip-types 直接跑）。
 * 验证：
 *  1. 特殊标记识别（lang/emotion/event/句界）；
 *  2. CTC 帧 → 秒时间戳（跳过前 4 帧特殊标记）；
 *  3. 英文子词拼词（▁thi + s → this）；
 *  4. 中文逐字独立成段；
 *  5. 特殊标记被过滤；
 *  6. decodeSenseVoiceBpe 完整链路。
 */

import assert from 'node:assert/strict'
import {
  isSenseVoiceSpecial,
  senseVoiceFrameTime,
  groupSenseVoiceUnits,
  decodeSenseVoiceBpe,
} from './sense-voice-bpe.ts'

// —— 1. 特殊标记识别 ——
{
  assert.equal(isSenseVoiceSpecial('<unk>'), true)
  assert.equal(isSenseVoiceSpecial('<s>'), true)
  assert.equal(isSenseVoiceSpecial('</s>'), true)
  assert.equal(isSenseVoiceSpecial('<|zh|>'), true)
  assert.equal(isSenseVoiceSpecial('<|en|>'), true)
  assert.equal(isSenseVoiceSpecial('<|HAPPY|>'), true)
  assert.equal(isSenseVoiceSpecial('<|Speech|>'), true)
  assert.equal(isSenseVoiceSpecial('<|SPECIAL_TOKEN_35|>'), true)
  assert.equal(isSenseVoiceSpecial('▁the'), false)
  assert.equal(isSenseVoiceSpecial('s'), false)
  assert.equal(isSenseVoiceSpecial('你'), false)
}

// —— 2. CTC 帧 → 秒（跳过前 4 帧）——
{
  const shift = 0.06
  assert.equal(senseVoiceFrameTime(4, shift), 0)
  assert.equal(senseVoiceFrameTime(5, shift), 0.06)
  assert.equal(senseVoiceFrameTime(10, shift), 0.36)
  assert.equal(senseVoiceFrameTime(4, shift, 10), 10)
  assert.equal(senseVoiceFrameTime(6, shift, 10), 10.12)
}

// —— 3. 英文子词拼词 ——
{
  const segments = groupSenseVoiceUnits([
    { text: '▁thi', start: 0, end: 0.06 },
    { text: 's', start: 0.06, end: 0.12 },
    { text: '▁I', start: 0.12, end: 0.18 },
    { text: '▁love', start: 0.18, end: 0.24 },
  ])
  assert.deepEqual(segments, [
    { symbol: 'this', start: 0, end: 0.12 },
    { symbol: 'I', start: 0.12, end: 0.18 },
    { symbol: 'love', start: 0.18, end: 0.24 },
  ])
}

// —— 4. 中文逐字独立成段（无 ▁，非拉丁，不拼入）——
{
  const segments = groupSenseVoiceUnits([
    { text: '你', start: 0, end: 0.06 },
    { text: '好', start: 0.06, end: 0.12 },
    { text: '世', start: 0.12, end: 0.18 },
    { text: '界', start: 0.18, end: 0.24 },
  ])
  assert.deepEqual(segments, [
    { symbol: '你', start: 0, end: 0.06 },
    { symbol: '好', start: 0.06, end: 0.12 },
    { symbol: '世', start: 0.12, end: 0.18 },
    { symbol: '界', start: 0.18, end: 0.24 },
  ])
}

// —— 5. 特殊标记被过滤 ——
{
  const segments = groupSenseVoiceUnits([
    { text: '<|zh|>', start: 0, end: 0.06 },
    { text: '<|NEUTRAL|>', start: 0.06, end: 0.12 },
    { text: '<|Speech|>', start: 0.12, end: 0.18 },
    { text: '<unk>', start: 0.18, end: 0.24 },
    { text: '你', start: 0.24, end: 0.3 },
  ])
  assert.deepEqual(segments, [{ symbol: '你', start: 0.24, end: 0.3 }])
}

// —— 6. 标点：英文词后标点独立成段、词内撇号拼入 ——
{
  const segments = groupSenseVoiceUnits([
    { text: '▁don', start: 0, end: 0.06 },
    { text: "'", start: 0.06, end: 0.12 },
    { text: 't', start: 0.12, end: 0.18 },
    { text: ',', start: 0.18, end: 0.24 },
  ])
  assert.deepEqual(segments, [
    { symbol: "don't", start: 0, end: 0.18 },
    { symbol: ',', start: 0.18, end: 0.24 },
  ])
}

// —— 6b. 拉丁续写遇大空隙时切断（中间空白的唱段不应拼成一词）——
{
  const segments = groupSenseVoiceUnits([
    { text: '▁STOP', start: 129.68, end: 129.74 },
    { text: 'RN', start: 131.20, end: 131.26 },
    { text: 'AE', start: 131.26, end: 131.32 },
  ])
  assert.equal(segments.length, 2)
  assert.equal(segments[0].symbol, 'STOP')
  assert.equal(segments[1].symbol, 'RNAE')
  assert.ok(segments[0].end <= 129.8)
  assert.ok(segments[1].start >= 131.1)
}

// —— 6c. 连续无 ▁ 的拉丁子词超过最长时长时截断 ——
{
  const units: { text: string; start: number; end: number }[] = []
  // 0.06s × 20 = 1.2s，超过 LATIN_MAX_SEG_SEC=0.8，应拆成两段以上
  for (let i = 0; i < 20; i++) {
    units.push({
      text: i === 0 ? '▁ab' : 'cd',
      start: i * 0.06,
      end: (i + 1) * 0.06,
    })
  }
  const segments = groupSenseVoiceUnits(units)
  assert.ok(segments.length >= 2, `超长拉丁段应截断，实际 ${segments.length} 段`)
  for (const s of segments) {
    assert.ok(s.end - s.start <= 0.8 + 1e-6, `单段过长 ${s.end - s.start}s：${s.symbol}`)
  }
}

// —— 7. decodeSenseVoiceBpe 完整链路（词表 + 时间戳换算）——
{
  const vocab = ['<unk>', '<s>', '</s>', '▁the', 's', '▁to', '▁I', '▁love']
  const frameShift = 0.06
  // 模型输出帧 4 起是语音（前 4 帧 lang/emotion/event 被跳过）
  const segments = decodeSenseVoiceBpe(
    [
      { token: 3, frame: 4 }, // ▁the
      { token: 4, frame: 5 }, // s → 拼入 thes
      { token: 6, frame: 6 }, // ▁I
      { token: 7, frame: 7 }, // ▁love
    ],
    vocab,
    frameShift,
  )
  assert.deepEqual(segments, [
    { symbol: 'thes', start: 0, end: 0.12 },
    { symbol: 'I', start: 0.12, end: 0.18 },
    { symbol: 'love', start: 0.18, end: 0.24 },
  ])
}

// —— 8. decodeSenseVoiceBpe 带 baseSec（跨块时间轴偏移）——
{
  const vocab = ['', '', '', '▁你']
  const segments = decodeSenseVoiceBpe(
    [{ token: 3, frame: 4 }],
    vocab,
    0.06,
    56, // 块输入起点秒
  )
  assert.deepEqual(segments, [{ symbol: '你', start: 56, end: 56.06 }])
}
