/**
 * 模型本地导入：大小 / SHA-256 校验。
 * 运行：node --experimental-strip-types src/os/model-cache-import.test.ts
 */
import assert from 'node:assert/strict'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import {
  assertImportedModelHash,
  assertImportedModelSize,
  MDX_MODEL_BYTES,
  MDX_MODEL_LABEL,
  MDX_MODEL_SHA256,
  sha256HexFromBlob,
  type ModelCacheEntry,
} from './model-cache.ts'

const MDX_ENTRY: ModelCacheEntry = {
  url: '/assets/mdx/models/UVR-MDX-NET-Inst_full_292.onnx',
  label: MDX_MODEL_LABEL,
  totalBytes: MDX_MODEL_BYTES,
  sha256: MDX_MODEL_SHA256,
}

{
  assert.doesNotThrow(() => assertImportedModelSize(MDX_ENTRY, MDX_MODEL_BYTES))
  assert.throws(
    () => assertImportedModelSize(MDX_ENTRY, MDX_MODEL_BYTES - 1),
    /大小与「MDX-NET 人声增强（伴奏模型）」不符/,
  )
}

{
  assert.doesNotThrow(() => assertImportedModelHash(MDX_ENTRY, MDX_MODEL_SHA256))
  assert.doesNotThrow(() => assertImportedModelHash(MDX_ENTRY, MDX_MODEL_SHA256.toUpperCase()))
  assert.throws(
    () => assertImportedModelHash(MDX_ENTRY, '0'.repeat(64)),
    /不是「MDX-NET 人声增强（伴奏模型）」（SHA-256 不匹配）/,
  )
}

{
  const payload = new Uint8Array([1, 2, 3, 4, 5, 9])
  const expected = bytesToHex(sha256(payload))
  const actual = await sha256HexFromBlob(new Blob([payload]))
  assert.equal(actual, expected)
}

console.log('model-cache import tests ok')
