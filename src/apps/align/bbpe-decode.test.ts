/**
 * 字节 BPE 解码单测（node --experimental-strip-types 直接跑）。
 * 验证 sherpa-onnx zipformer-ctc-zh 的 token 解码：
 *  `▁ƎĽĥ` = byte [0x20, 0xE7, 0x9A, 0x84] = " 的"
 *  `▁ƋŞġ` = byte [0x20, 0xE4, 0xB8, 0x80] = " 一"
 *  多字 token 展开为逐字单元。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { decodeByteBpe, decodeTokenToUnits } from './bbpe-decode.ts'

// —— 1. 基础字节解码 ——
{
  assert.equal(decodeByteBpe('▁ƎĽĥ'), ' 的')
  assert.equal(decodeByteBpe('▁ƋŞġ'), ' 一')
}

// —— 2. 空格词边界 ——
{
  // byte 32 的两种表示（空格 / ⁇）
  assert.equal(decodeByteBpe(' \u{2047}'), '  ')
  // ▁ 作为词边界
  assert.equal(decodeByteBpe('▁ƎĽĥ▁ƋŞġ'), ' 的 一')
}

// —— 3. ASCII 字符直通 ——
{
  assert.equal(decodeByteBpe('AB'), 'AB')
  assert.equal(decodeByteBpe('a!b'), 'a!b')
}

// —— 4. 逐字展开 ——
{
  assert.deepEqual(decodeTokenToUnits('▁ƎĽĥ'), ['的'])
  assert.deepEqual(decodeTokenToUnits('▁ƋŞġ'), ['一'])
}

// —— 5. 真实词表：id→token 解析后全部能解码出非空文本 ——
{
  const path = fileURLToPath(new URL('../../../public/assets/zipformer-ctc/tokens.txt', import.meta.url))
  const text = readFileSync(path, 'utf8')
  const tokens: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length >= 2) tokens[Number(parts[1])] = parts[0]
  }
  let decodedCount = 0
  for (let id = 0; id < tokens.length; id++) {
    const sym = tokens[id]
    if (!sym) continue
    if (sym === '<blk>' || sym === '<sos/eos>' || sym === '<unk>') continue
    const out = decodeByteBpe(sym)
    assert.ok(out.length > 0, `token ${id}「${sym}」应解码出非空文本`)
    decodedCount += 1
  }
  assert.ok(decodedCount > 500, `应有大量可解码 token，实际 ${decodedCount}`)
}
