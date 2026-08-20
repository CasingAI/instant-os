#!/usr/bin/env node
/**
 * 将 model-vision 导出的 JSON 固化为 catalog-vision.json，供 generate-3d-catalog 合并。
 *
 * 用法：
 *   node scripts/import-catalog-vision.mjs [path/to/model-vision-results.json]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_PATH = path.join(ROOT, 'src/assets/3d/catalog-vision.json')

const AXIS_SIDES = new Set(['+x', '-x', '+z', '-z'])
const PLACEMENT_KINDS = new Set(['free', 'tile', 'linear', 'corner', 'junction', 'wall'])
const CONFIDENCES = new Set(['high', 'medium', 'low'])

const inputPath = path.resolve(
  process.argv[2] ?? path.join(process.env.HOME ?? '', 'Downloads/model-vision-results.json'),
)

if (!fs.existsSync(inputPath)) {
  console.error(`找不到导出文件：${inputPath}`)
  process.exit(1)
}

const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
const results = Array.isArray(payload.results) ? payload.results : []

/** @type {Record<string, object>} */
const byId = {}

function parseAxis(value) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return AXIS_SIDES.has(normalized) ? normalized : undefined
}

function parseAxes(value) {
  if (!Array.isArray(value)) return undefined
  const sides = [...new Set(value.map(parseAxis).filter(Boolean))]
  return sides.length > 0 ? sides : undefined
}

function parsePlacementKind(value) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return PLACEMENT_KINDS.has(normalized) ? normalized : undefined
}

function parseConfidence(value) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return CONFIDENCES.has(normalized) ? normalized : undefined
}

function optionalString(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** 少数模型把整段 JSON 误写入 visualDescription，尝试拆回字段。 */
function recoverEmbeddedJson(record) {
  const raw = optionalString(record.visualDescription)
  if (!raw || !raw.startsWith('{')) return record

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = extractPartialJsonFields(raw)
  }
  if (!parsed || typeof parsed !== 'object') return record

  return {
    ...record,
    visualDescription: optionalString(parsed.visualDescription) ?? record.visualDescription,
    appearanceNotes: optionalString(parsed.appearanceNotes) ?? record.appearanceNotes,
    orientation: {
      ...(record.orientation && typeof record.orientation === 'object' ? record.orientation : {}),
      placementKind: parsed.placementKind ?? record.orientation?.placementKind,
      placementHint: optionalString(parsed.placementHint) ?? record.orientation?.placementHint,
      axisLandmarks: optionalString(parsed.axisLandmarks) ?? record.orientation?.axisLandmarks,
      sceneUseHint: optionalString(parsed.sceneUseHint) ?? record.orientation?.sceneUseHint,
      forward: parsed.forward ?? record.orientation?.forward,
      face: parsed.face ?? record.orientation?.face,
      back: parsed.back ?? record.orientation?.back,
      connects: parsed.connects ?? record.orientation?.connects,
      confidence: parsed.confidence ?? record.orientation?.confidence,
    },
  }
}

/** JSON 不完整时，用字段正则尽量捞回已知键。 */
function extractPartialJsonFields(raw) {
  /** @type {Record<string, string>} */
  const fields = {}
  for (const key of [
    'visualDescription',
    'appearanceNotes',
    'axisLandmarks',
    'sceneUseHint',
    'placementHint',
    'placementKind',
    'forward',
    'face',
    'back',
    'confidence',
  ]) {
    const match = raw.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`))
    if (match?.[1]) {
      fields[key] = match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\')
    }
  }
  return Object.keys(fields).length > 0 ? fields : undefined
}

let imported = 0
let skipped = 0

for (const record of results) {
  const recovered = recoverEmbeddedJson(record)
  const modelId = optionalString(recovered?.modelId)
  if (!modelId || recovered?.error) {
    skipped += 1
    continue
  }

  const visualDescription = optionalString(recovered.visualDescription)
  const appearanceNotes = optionalString(recovered.appearanceNotes)
  const orientation =
    recovered.orientation && typeof recovered.orientation === 'object' ? recovered.orientation : {}

  /** @type {Record<string, unknown>} */
  const entry = {}
  if (visualDescription) entry.visualDescription = visualDescription
  if (appearanceNotes) entry.appearanceNotes = appearanceNotes

  /** @type {Record<string, unknown>} */
  const orient = {}
  const placementKind = parsePlacementKind(orientation.placementKind)
  const placementHint = optionalString(orientation.placementHint)
  const axisLandmarks = optionalString(orientation.axisLandmarks)
  const sceneUseHint = optionalString(orientation.sceneUseHint)
  const forward = parseAxis(orientation.forward)
  const face = parseAxis(orientation.face)
  const back = parseAxis(orientation.back)
  const connects = parseAxes(orientation.connects)
  const confidence = parseConfidence(orientation.confidence)

  if (placementKind) orient.placementKind = placementKind
  if (placementHint) orient.placementHint = placementHint
  if (axisLandmarks) orient.axisLandmarks = axisLandmarks
  if (sceneUseHint) orient.sceneUseHint = sceneUseHint
  if (forward) orient.forward = forward
  if (face) orient.face = face
  if (back) orient.back = back
  if (connects) orient.connects = connects
  if (confidence) orient.confidence = confidence

  if (Object.keys(orient).length > 0) entry.orientation = orient

  if (!entry.visualDescription && !entry.appearanceNotes && !entry.orientation) {
    skipped += 1
    continue
  }

  byId[modelId] = entry
  imported += 1
}

const sorted = Object.fromEntries(Object.entries(byId).sort(([a], [b]) => a.localeCompare(b)))
fs.writeFileSync(OUT_PATH, `${JSON.stringify(sorted, undefined, 2)}\n`)
console.log(
  `Imported ${imported} vision entries (${skipped} skipped) → ${path.relative(ROOT, OUT_PATH)}`,
)
