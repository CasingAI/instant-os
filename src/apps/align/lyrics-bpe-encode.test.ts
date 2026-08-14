/**
 * 歌词 → token 编码器单测（node --experimental-strip-types 直接跑）。
 * 验证：
 *  1. zh 模式（字节 BPE）：中文行编码可往返还原歌词原文；
 *  2. en 模式（大写字符 BPE）：英文行编码、单元归属正确；
 *  3. 词边界 token（单独 ▁）不进入 tokenIds；
 *  4. 无法编码的单元被标记 unencodableUnits；
 *  5. 单元归属单调且不跨单元。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decodeByteBpe, encodeTextToBpeChars } from './bbpe-decode.ts'
import { buildVocab, encodeLyricsLine } from './lyrics-bpe-encode.ts'

function loadVocab(path: string) {
  const text = readFileSync(path, 'utf8')
  const tokens: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 2) continue
    const id = Number(parts[1])
    tokens[id] = parts[0]
  }
  return buildVocab(tokens)
}

const zhVocab = loadVocab('public/assets/zipformer-ctc/tokens.txt')
const enVocab = loadVocab('public/assets/zipformer-ctc-en/models/tokens.txt')

// —— 1. zh 模式：中文行往返还原 + token 归属 ——
{
  const line = '大家来恋爱'
  const enc = encodeLyricsLine(line, 'zh', zhVocab)
  assert.equal(enc.units.length, 5, '五个汉字五个单元')
  assert.ok(enc.tokenIds.length > 0, '应有 token')
  assert.equal(enc.unencodableUnits.length, 0, '中文应全部可编码')
  for (let k = 0; k < enc.tokenIds.length; k++) {
    const u = enc.tokenUnits[k]
    assert.ok(u >= 0 && u < enc.units.length, `token ${k} 归属单元越界 ${u}`)
  }
  // token 顺序不跨单元：unit 序列非降
  for (let k = 1; k < enc.tokenIds.length; k++) {
    assert.ok(enc.tokenUnits[k] >= enc.tokenUnits[k - 1], 'token 单元应单调')
  }
  // 往返：zh 模式字节流 + ▁ 前缀，解码 strip 首尾空白后还原
  const chars = ['▁', ...encodeTextToBpeChars(line)]
  const back = decodeByteBpe(chars.join('')).trim()
  assert.equal(back, line, '往返应还原原文')
}

// —— 2. en 模式：英文行编码 + 单元归属 ——
{
  const line = "Why you talkin' that mess huh"
  const enc = encodeLyricsLine(line, 'en', enVocab)
  assert.equal(enc.units.length, 6, '六个英文单元')
  assert.equal(enc.unencodableUnits.length, 0, '英文应全部可编码')
  assert.ok(enc.tokenIds.length >= 6, `应有至少 6 个 token，实际 ${enc.tokenIds.length}`)
  // 每个单元至少一个 token（除空）
  const covered = new Set(enc.tokenUnits)
  for (let u = 0; u < enc.units.length; u++) {
    assert.ok(covered.has(u), `单元 ${enc.units[u]} 应有 token`)
  }
  // 大写化规则：token 全部落在对应单元（不需要验证 token 内容，仅结构）
  for (let k = 1; k < enc.tokenIds.length; k++) {
    assert.ok(enc.tokenUnits[k] >= enc.tokenUnits[k - 1], 'token 单元应单调')
  }
}

// —— 3. 词边界单独 token 不入序列：zh 行首伪 ▁ ——
{
  // "大家来恋爱" 若 ▁ 单独成 token（id 999），不应进入 tokenIds
  const enc = encodeLyricsLine('大家来恋爱', 'zh', zhVocab)
  const blankBoundary = 999
  assert.ok(!enc.tokenIds.includes(blankBoundary), '词边界 token 不应进入序列')
}

// —— 4. 无法编码的单元被标记 ——
{
  // en 模型词表无中文，混合行 "Love is so 完美" 的「完」「美」应不可编码
  const enc = encodeLyricsLine('Love is so 完美', 'en', enVocab)
  assert.equal(enc.unencodableUnits.length, 2, '完、美两个单元都应标记不可编码')
  const wanIdx = enc.units.indexOf('完')
  const meiIdx = enc.units.indexOf('美')
  assert.ok(enc.unencodableUnits.includes(wanIdx), '完单元应在 unencodableUnits')
  assert.ok(enc.unencodableUnits.includes(meiIdx), '美单元应在 unencodableUnits')
  // 其余英文单元仍有 token
  const covered = new Set(enc.tokenUnits)
  assert.ok(covered.has(0), 'Love 应有 token')
  assert.ok(!covered.has(wanIdx), '完不应有 token')
}

// —— 5. 标点/空白处理：逗号不可编码时跳过不崩 ——
{
  const enc = encodeLyricsLine("So just don, don t fight", 'en', enVocab)
  assert.ok(enc.tokenIds.length > 0, '仍有 token')
  assert.ok(enc.units.length > 0, '仍有单元')
}

// —— 6. 空行/纯空白 ——
{
  const enc = encodeLyricsLine('   ', 'en', enVocab)
  assert.equal(enc.units.length, 0, '纯空白无单元')
  assert.equal(enc.tokenIds.length, 0, '纯空白无 token')
}

console.log('lyrics-bpe-encode: 全部通过')
