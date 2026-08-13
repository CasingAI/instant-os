#!/usr/bin/env node
// Extract metadata_props from an ONNX model (protobuf wire format) as JSON.
// onnxruntime-web does not expose model metadata, so vendor scripts call this
// to produce meta.json for runtime use (e.g. SenseVoice CMVN/LFR parameters).
//
// Usage: node scripts/extract-onnx-metadata.mjs <input.onnx> <output.json>
//
// Only the metadata_props field (ModelProto field 14, repeated
// StringStringEntryProto) is collected; graph/blob fields are skipped by
// walking the protobuf wire format.

import fs from 'node:fs'

const inputPath = process.argv[2]
const outputPath = process.argv[3]
if (!inputPath || !outputPath) {
  console.error('Usage: node scripts/extract-onnx-metadata.mjs <input.onnx> <output.json>')
  process.exit(1)
}

const buf = new Uint8Array(fs.readFileSync(inputPath))
const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

function readVarint(pos) {
  let result = 0
  let shift = 0
  while (pos < buf.length) {
    const byte = buf[pos]
    pos += 1
    result |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value: result, pos }
    shift += 7
    if (shift > 63) throw new Error('varint 过长')
  }
  throw new Error('文件截断：varint 未结束')
}

function readBytes(pos, len) {
  if (pos + len > buf.length) throw new Error('文件截断：bytes 越界')
  const out = new Uint8Array(len)
  out.set(buf.subarray(pos, pos + len))
  return { data: out, pos: pos + len }
}

function skipField(pos, wireType) {
  switch (wireType) {
    case 0: {
      const r = readVarint(pos)
      return r.pos
    }
    case 1:
      return pos + 8
    case 2: {
      const r = readVarint(pos)
      return r.pos + r.value
    }
    case 5:
      return pos + 4
    default:
      throw new Error(`不支持的 wire type: ${wireType}`)
  }
}

function decodeString(start, len) {
  const sub = buf.subarray(start, start + len)
  return new TextDecoder('utf-8', { fatal: false }).decode(sub)
}

function parseEntry(start, end) {
  const entry = {}
  let pos = start
  while (pos < end) {
    const tagStart = pos
    const tag = readVarint(pos)
    pos = tag.pos
    const fieldNum = tag.value >> 3
    const wireType = tag.value & 7
    if (fieldNum === 1 && wireType === 2) {
      const len = readVarint(pos)
      pos = len.pos
      entry.key = decodeString(pos, len.value)
      pos += len.value
    } else if (fieldNum === 2 && wireType === 2) {
      const len = readVarint(pos)
      pos = len.pos
      entry.value = decodeString(pos, len.value)
      pos += len.value
    } else {
      pos = skipField(pos, wireType)
    }
    if (pos === tagStart) throw new Error('解析未推进')
  }
  return entry
}

const metadataProps = {}
let pos = 0
while (pos < buf.length) {
  const tagStart = pos
  const tag = readVarint(pos)
  pos = tag.pos
  const fieldNum = tag.value >> 3
  const wireType = tag.value & 7
  if (fieldNum === 14 && wireType === 2) {
    const len = readVarint(pos)
    pos = len.pos
    const entry = parseEntry(pos, pos + len.value)
    if (entry.key !== undefined && entry.value !== undefined) {
      metadataProps[entry.key] = entry.value
    }
    pos += len.value
  } else {
    pos = skipField(pos, wireType)
  }
  if (pos === tagStart) throw new Error('解析未推进')
}

fs.writeFileSync(outputPath, JSON.stringify(metadataProps, null, 2) + '\n')
const keys = Object.keys(metadataProps)
if (keys.length === 0) {
  console.error(`警告：${inputPath} 没有 metadata_props`)
}
console.log(`${inputPath}: ${keys.length} 个 metadata_props → ${outputPath}`)
