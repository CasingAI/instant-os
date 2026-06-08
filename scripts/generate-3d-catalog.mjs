#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MODELS = path.join(ROOT, 'public/assets/3d/models')
const OVERRIDES_PATH = path.join(ROOT, 'src/assets/3d/catalog-overrides.json')
const OUT_PATH = path.join(ROOT, 'src/assets/3d/asset-catalog-entries.ts')

/** @type {import('../src/assets/3d/asset-catalog.ts').Instant3dSourcePack[]} */
export const PACKS = [
  {
    id: 'kaykit-furniture',
    title: 'KayKit 家具',
    subtitle: 'KayKit Furniture Bits',
    license: 'CC0 1.0',
    dir: 'kaykit-furniture',
    prefix: 'kaykit',
    urlBase: '/assets/3d/models/kaykit-furniture',
  },
  {
    id: 'tiny-treats-homely',
    title: 'Tiny Treats 家居',
    subtitle: 'Homely House',
    license: 'CC0 1.0',
    dir: 'tiny-treats-homely',
    prefix: 'tiny',
    urlBase: '/assets/3d/models/tiny-treats-homely',
  },
  {
    id: 'kaykit-city-builder',
    title: 'KayKit 城市',
    subtitle: 'KayKit City Builder Bits',
    license: 'CC0 1.0',
    dir: 'kaykit-city-builder',
    prefix: 'city',
    urlBase: '/assets/3d/models/kaykit-city-builder',
  },
  {
    id: 'kaykit-restaurant',
    title: 'KayKit 餐厅',
    subtitle: 'KayKit Restaurant Bits',
    license: 'CC0 1.0',
    dir: 'kaykit-restaurant',
    prefix: 'restaurant',
    urlBase: '/assets/3d/models/kaykit-restaurant',
  },
  {
    id: 'kaykit-space-base',
    title: 'KayKit 太空基地',
    subtitle: 'KayKit Space Base Bits',
    license: 'CC0 1.0',
    dir: 'kaykit-space-base',
    prefix: 'space',
    urlBase: '/assets/3d/models/kaykit-space-base',
  },
  {
    id: 'kaykit-halloween',
    title: 'KayKit 万圣节',
    subtitle: 'KayKit Halloween Bits',
    license: 'CC0 1.0',
    dir: 'kaykit-halloween',
    prefix: 'halloween',
    urlBase: '/assets/3d/models/kaykit-halloween',
  },
]

const WORDS = {
  arch: '拱门',
  armchair: '扶手椅',
  banner: '旗帜',
  base: '基座',
  basemodule: '基础模块',
  bench: '长椅',
  bone: '骨头',
  book: '书',
  bowl: '碗',
  box: '箱子',
  broken: '破损',
  building: '建筑',
  burger: '汉堡',
  buns: '面包卷',
  cabinet: '柜子',
  candle: '蜡烛',
  cargo: '货物',
  cargodepot: '货运站',
  carrots: '胡萝卜',
  chair: '椅子',
  cheese: '奶酪',
  coffin: '棺材',
  container: '集装箱',
  containers: '集装箱',
  countertop: '台面',
  corner: '转角',
  couch: '沙发',
  crate: '板条箱',
  crypt: '墓穴',
  cup: '杯子',
  cuttingboard: '砧板',
  decorated: '装饰',
  depot: '仓库',
  dirty: '脏',
  dish: '盘子',
  dishrack: '碗架',
  door: '门',
  double: '双人',
  drill: '钻机',
  fence: '栅栏',
  floor: '地面',
  foliage: '灌木',
  food: '食物',
  fork: '叉子',
  frame: '画框',
  fridge: '冰箱',
  garage: '车库',
  gate: '大门',
  ground: '地面',
  ham: '火腿',
  house: '房子',
  kitchen: '厨房',
  knife: '刀',
  lamp: '灯',
  large: '大',
  lettuce: '生菜',
  lid: '盖子',
  long: '长',
  mailbox: '邮箱',
  medium: '中',
  melted: '融化',
  module: '模块',
  multi: '多功能',
  onions: '洋葱',
  open: '开口',
  oven: '烤箱',
  packed: '打包',
  pillar: '柱子',
  pizza: '披萨',
  plate: '盘子',
  plates: '盘子',
  post: '柱',
  potatoes: '土豆',
  pumpkin: '南瓜',
  rails: '栏杆',
  road: '道路',
  crossing: '人行横道',
  junction: '交叉口',
  tsplit: 'T 形路口',
  curved: '弧形',
  diagonal: '斜向',
  slope: '斜坡',
  doorway: '门洞',
  orderwindow: '点餐窗',
  backsplash: '挡水板',
  seperate: '独立段',
  path: '小路',
  rocket: '火箭',
  rug: '地毯',
  satellite: '卫星',
  shelf: '架子',
  sink: '水槽',
  single: '单头',
  skull: '骷髅',
  small: '小',
  sofa: '沙发',
  spoon: '勺子',
  stacked: '堆叠',
  steak: '牛排',
  stool: '凳子',
  stove: '炉灶',
  straight: '直线',
  structure: '结构',
  table: '桌子',
  thin: '细',
  tombstone: '墓碑',
  tomatoes: '番茄',
  tower: '塔',
  tree: '树',
  triple: '三支',
  wide: '宽',
  wood: '木',
  without: '无',
  withoutBase: '无底座',
}

const VARIANT_SUFFIX = /^[A-Z]$/

function translateStem(stem) {
  const parts = stem.split('_')
  const labelParts = []
  const keywords = new Set()

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    const next = parts[i + 1]

    if (part === 'without' && next === 'Base') {
      labelParts.push('（无底座）')
      keywords.add('无底座')
      keywords.add('withoutBase')
      i += 1
      continue
    }

    if (VARIANT_SUFFIX.test(part)) {
      labelParts.push(` ${part}`)
      keywords.add(part)
      continue
    }

    const mapped = WORDS[part]
    if (mapped) {
      labelParts.push(mapped)
      keywords.add(mapped)
      keywords.add(part)
      continue
    }

    const compound = WORDS[part + (next ? `_${next}` : '')]
    if (compound) {
      labelParts.push(compound)
      keywords.add(compound)
      keywords.add(part)
      if (next) keywords.add(next)
      i += 1
      continue
    }

    keywords.add(part)
    labelParts.push(part.replace(/([a-z])([A-Z])/g, '$1 $2'))
  }

  let label = labelParts.join('').replace(/\s+/g, ' ').trim()
  if (!label || /^[a-z0-9\s]+$/i.test(label)) {
    label = stem
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  }
  return {
    label: label || stem,
    keywords: [...keywords],
  }
}

function listGltfFiles(dir) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.gltf'))
    .sort((a, b) => a.localeCompare(b))
}

const PACK_APPEARANCE = {
  'kaykit-furniture': {
    style: '低多边形卡通家具（KayKit）',
    palette: 'KayKit 家具渐变纹理色板',
  },
  'tiny-treats-homely': {
    style: '低多边形卡通家居与庭院（Tiny Treats）',
    palette: 'Tiny Treats 彩绘纹理色板',
  },
  'kaykit-city-builder': {
    style: '低多边形卡通城市建筑（KayKit）',
    palette: 'KayKit 城市渐变纹理色板',
  },
  'kaykit-restaurant': {
    style: '低多边形卡通餐厅与厨房（KayKit）',
    palette: 'KayKit 餐厅渐变纹理色板',
  },
  'kaykit-space-base': {
    style: '低多边形卡通科幻基地（KayKit）',
    palette: 'KayKit 科幻渐变纹理色板',
  },
  'kaykit-halloween': {
    style: '低多边形卡通万圣节主题（KayKit）',
    palette: 'KayKit 万圣节渐变纹理色板',
  },
}

function roundMeters(value) {
  return Number(value.toFixed(2))
}

/** @typedef {'+x' | '-x' | '+z' | '-z'} AxisSide */
/** @typedef {'free' | 'tile' | 'linear' | 'corner' | 'junction' | 'wall'} PlacementKind */

/**
 * @param {PlacementKind} kind
 * @param {string} hint
 * @param {{ tileStepMeters?: number, connects?: AxisSide[], forward?: AxisSide, face?: AxisSide }} [extra]
 */
function placement(kind, hint, extra = {}) {
  return { kind, hint, ...extra }
}

/**
 * @param {string} stem
 * @param {string} packId
 * @param {{ width: number, height: number, depth: number }} sizeMeters
 * @returns {{ kind: PlacementKind, hint: string, tileStepMeters?: number, connects?: AxisSide[], forward?: AxisSide, face?: AxisSide }}
 */
function inferPlacement(stem, packId, sizeMeters) {
  const width = sizeMeters.width
  const depth = sizeMeters.depth
  const dominantAxis = width >= depth * 1.25 ? '+x' : depth >= width * 1.25 ? '+z' : undefined
  const dominantSpan = Math.max(width, depth)

  if (stem.startsWith('road_')) {
    if (stem === 'road_straight') {
      return placement('tile', '2m 道路直线瓦片；默认沿 Z 轴双向延伸；-Z 与 +Z 边可接直线/交叉口', {
        tileStepMeters: 2,
        connects: ['-z', '+z'],
        forward: '+z',
      })
    }
    if (stem === 'road_straight_crossing') {
      return placement('junction', '2m 道路人行横道瓦片；四向均可接道路', {
        tileStepMeters: 2,
        connects: ['-z', '+z', '-x', '+x'],
      })
    }
    if (stem === 'road_corner' || stem === 'road_corner_curved') {
      const curved = stem.includes('curved') ? '弧形' : '直角'
      return placement('corner', `2m 道路${curved}弯瓦片；默认从 +Z 弯向 +X（90°）；rotation.y 可改弯向`, {
        tileStepMeters: 2,
        connects: ['+z', '+x'],
      })
    }
    if (stem === 'road_junction') {
      return placement('junction', '2m 十字路口瓦片；四向均可接道路', {
        tileStepMeters: 2,
        connects: ['-z', '+z', '-x', '+x'],
      })
    }
    if (stem === 'road_tsplit') {
      return placement('junction', '2m T 形路口瓦片；默认 -Z/+Z 为直道、+X 为支路', {
        tileStepMeters: 2,
        connects: ['-z', '+z', '+x'],
        forward: '+z',
      })
    }
  }

  if (stem.startsWith('path_')) {
    return placement('tile', '约 2m 地面小路瓦片；可平铺拼接，默认水平铺地', {
      tileStepMeters: roundMeters(dominantSpan),
    })
  }

  if (stem.startsWith('floor_') || stem === 'floor_kitchen' || stem === 'floor_base' || stem === 'cobblestones') {
    return placement('tile', '地面/路面瓦片；按包围盒尺寸平铺，相邻块中心间距等于较长边', {
      tileStepMeters: roundMeters(dominantSpan),
    })
  }

  if (stem.startsWith('terrain_')) {
    if (stem.includes('inner_corner') || stem.includes('outer_corner')) {
      return placement('corner', '地形转角块；按 connects 与相邻地形拼接', {
        tileStepMeters: 2,
        connects: ['+z', '+x'],
      })
    }
    if (stem.includes('curved')) {
      return placement('corner', '弧形地形块；默认从 +Z 弯向 +X', {
        tileStepMeters: 2,
        connects: ['+z', '+x'],
      })
    }
    if (stem.includes('slope')) {
      return placement('linear', '地形斜坡块；默认沿 +Z 升高，拼接时保持坡向一致', {
        tileStepMeters: 2,
        forward: '+z',
      })
    }
    return placement('tile', '地形平台块；2m 网格平铺', { tileStepMeters: 2 })
  }

  if (stem.startsWith('tunnel_')) {
    const diagonal = stem.includes('diagonal')
    return placement('linear', diagonal ? '隧道斜向段；默认沿对角延伸，注意与直道对齐' : '隧道直线段；默认沿 X 轴延伸，首尾相接', {
      forward: diagonal ? '+x' : dominantAxis ?? '+x',
      tileStepMeters: roundMeters(dominantSpan),
    })
  }

  if (stem.startsWith('fence_') || stem.startsWith('gate_')) {
    if (stem.includes('corner')) {
      return placement('corner', '栅栏转角；默认从 +X 弯向 +Z，围合庭院角', {
        connects: ['+x', '+z'],
      })
    }
    if (stem.includes('straight') || stem.includes('rails') || stem.includes('wide')) {
      const axis = dominantAxis ?? '+x'
      return placement('linear', `栅栏直线段；沿 ${axis} 延伸约 ${roundMeters(dominantSpan)}m，多段首尾相接围合区域`, {
        forward: axis,
      })
    }
    if (stem.includes('open')) {
      return placement('linear', '栅栏开口段；沿长边方向放置，与直线段对齐', {
        forward: dominantAxis ?? '+x',
      })
    }
    if (stem.includes('gate')) {
      return placement('linear', '栅栏门；正面朝场景内侧，与栅栏段对齐', {
        forward: dominantAxis ?? '+x',
        face: '+z',
      })
    }
    if (stem.includes('post') || stem.includes('pillar') || stem.includes('seperate')) {
      return placement('free', '栅栏柱/独立段；可任意旋转，用于转角加固或端点')
    }
    if (stem === 'fence' || stem.includes('broken')) {
      return placement('linear', '栅栏段；沿长边延伸，与柱/转角拼接', {
        forward: dominantAxis ?? '+x',
      })
    }
  }

  if (stem.startsWith('wall_') || stem.startsWith('door_')) {
    const face = '+z'
    const axis = width >= depth ? '+x' : '+z'
    return placement('wall', `墙/门洞段；沿 ${axis} 延伸，正面朝 ${face}；贴地 y=0，多段首尾相接`, {
      forward: axis,
      face,
    })
  }

  if (stem.startsWith('kitchencounter_') || stem.startsWith('kitchencabinet_')) {
    if (stem.includes('innercorner')) {
      return placement('corner', '厨房柜台内转角；默认 +Z 与 +X 两侧接直线柜', {
        tileStepMeters: 2,
        connects: ['+z', '+x'],
      })
    }
    if (stem.includes('outercorner')) {
      return placement('corner', '厨房柜台外转角；默认 +Z 与 +X 两侧接直线柜', {
        tileStepMeters: 2,
        connects: ['+z', '+x'],
      })
    }
    if (stem.includes('straight')) {
      return placement('linear', '厨房柜台直线段；默认沿 Z 轴延伸，2m 网格拼接', {
        tileStepMeters: 2,
        forward: '+z',
      })
    }
    return placement('tile', '厨房柜体块；按 2m 网格与相邻柜体对齐', { tileStepMeters: 2 })
  }

  if (stem.startsWith('rug_')) {
    return placement('tile', '地毯；水平铺地，按长边对齐家具区域', {
      forward: width >= depth ? '+x' : '+z',
    })
  }

  if (stem.includes('bench') && packId === 'tiny-treats-homely') {
    return placement('linear', '长椅；座面沿长边方向，通常背靠庭院边界', {
      forward: dominantAxis ?? '+x',
      face: '+z',
    })
  }

  if (stem.includes('streetlight') || stem === 'trafficlight_A' || stem === 'trafficlight_B') {
    return placement('free', '路灯/信号灯；竖立摆放，灯头朝向道路或路口')
  }

  if (dominantAxis && dominantSpan >= 1.2 && (stem.includes('straight') || stem.includes('long'))) {
    return placement('linear', `直线型部件；沿 ${dominantAxis} 延伸约 ${roundMeters(dominantSpan)}m`, {
      forward: dominantAxis,
    })
  }

  if (
    stem.includes('corner') &&
    !stem.includes('without') &&
    (packId === 'kaykit-city-builder' || packId === 'kaykit-space-base' || packId === 'tiny-treats-homely')
  ) {
    return placement('corner', '转角块；默认从 +Z 弯向 +X，rotation.y 以 90° 调整', {
      connects: ['+z', '+x'],
    })
  }

  return placement('free', '自由摆放；按场景需要设置 position 与 rotation.y')
}

function factorToHex(factor) {
  if (!Array.isArray(factor) || factor.length < 3) return undefined
  const [r, g, b] = factor
  const toByte = (channel) => Math.round(Math.max(0, Math.min(1, channel)) * 255)
  return `#${[toByte(r), toByte(g), toByte(b)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function extractGltfAppearance(gltfPath, packId, label) {
  const packAppearance = PACK_APPEARANCE[packId] ?? {
    style: '低多边形卡通 3D 模型',
    palette: '共享纹理色板',
  }
  const gltf = JSON.parse(fs.readFileSync(gltfPath, 'utf8'))
  const accessors = gltf.accessors ?? []
  const meshes = gltf.meshes ?? []
  const materials = gltf.materials ?? []
  const textures = gltf.textures ?? []
  const images = gltf.images ?? []

  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  let vertices = 0
  let triangles = 0

  for (const mesh of meshes) {
    for (const primitive of mesh.primitives ?? []) {
      const positionIndex = primitive.attributes?.POSITION
      if (positionIndex === undefined) continue
      const positionAccessor = accessors[positionIndex]
      if (!positionAccessor?.min || !positionAccessor?.max) continue

      vertices += positionAccessor.count ?? 0
      minX = Math.min(minX, positionAccessor.min[0])
      minY = Math.min(minY, positionAccessor.min[1])
      minZ = Math.min(minZ, positionAccessor.min[2])
      maxX = Math.max(maxX, positionAccessor.max[0])
      maxY = Math.max(maxY, positionAccessor.max[1])
      maxZ = Math.max(maxZ, positionAccessor.max[2])

      const indicesIndex = primitive.indices
      if (indicesIndex !== undefined) {
        const indicesAccessor = accessors[indicesIndex]
        triangles += Math.round((indicesAccessor?.count ?? 0) / 3)
      }
    }
  }

  const sizeMeters = {
    width: roundMeters(maxX - minX),
    height: roundMeters(maxY - minY),
    depth: roundMeters(maxZ - minZ),
  }

  const materialNames = [...new Set(materials.map((material) => material.name).filter(Boolean))]
  const textureNames = new Set()
  const solidColors = new Set()
  let hasTexture = false
  let hasSolid = false

  for (const material of materials) {
    const pbr = material.pbrMetallicRoughness ?? {}
    if (pbr.baseColorTexture?.index !== undefined) {
      hasTexture = true
      const texture = textures[pbr.baseColorTexture.index]
      const image = texture ? images[texture.source] : undefined
      if (image?.name) textureNames.add(image.name)
      else if (image?.uri) textureNames.add(image.uri)
    }
    const hex = factorToHex(pbr.baseColorFactor)
    if (hex && hex !== '#ffffff') {
      hasSolid = true
      solidColors.add(hex)
    }
  }

  let colorMode = 'solid'
  if (hasTexture && hasSolid) colorMode = 'mixed'
  else if (hasTexture) colorMode = 'texture'

  const formatSize = (value) => Number(value.toFixed(2)).toString()
  const sizeText = `${formatSize(sizeMeters.width)} × ${formatSize(sizeMeters.height)} × ${formatSize(sizeMeters.depth)} m`
  const textureList = [...textureNames]
  const colorText =
    colorMode === 'texture'
      ? `使用 ${textureList.join('、') || '共享'} 纹理贴图着色（${packAppearance.palette}）`
      : colorMode === 'solid'
        ? `使用纯色 PBR 材质着色`
        : `混合纹理贴图与纯色材质`

  const placementInfo = inferPlacement(
    path.basename(gltfPath).replace(/\.gltf$/, ''),
    packId,
    sizeMeters,
  )
  const placementText =
    placementInfo.kind === 'free'
      ? ''
      : ` ${placementInfo.hint}${placementInfo.connects ? `（接口 ${placementInfo.connects.join('/')}）` : ''}${placementInfo.forward ? `；默认延伸 ${placementInfo.forward}` : ''}${placementInfo.face ? `；正面 ${placementInfo.face}` : ''}。`
  const description = `${packAppearance.style}「${label}」。包围盒约 ${sizeText}。${colorText}。${placementText}`.replace(
    /\s+/g,
    ' ',
  )

  return {
    style: packAppearance.style,
    description,
    sizeMeters,
    vertices,
    triangles,
    materials: materialNames,
    textures: textureList,
    colorMode,
    solidColors: [...solidColors],
    placement: placementInfo,
  }
}

const overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'))

/** @type {Array<{id:string,label:string,keywords:string[],url:string,source:string,appearance:object}>} */
const entries = []

for (const pack of PACKS) {
  const dir = path.join(MODELS, pack.dir)
  for (const file of listGltfFiles(dir)) {
    const stem = file.replace(/\.gltf$/, '')
    const id = `${pack.prefix}.${stem}`
    const override = overrides[id]
    const auto = translateStem(stem)
    const label = override?.label ?? auto.label
    const keywords = override?.keywords ?? auto.keywords
    const appearance = extractGltfAppearance(path.join(dir, file), pack.id, label)
    if (override?.placement) {
      appearance.placement = { ...appearance.placement, ...override.placement }
      if (override.placement.hint) {
        const placementNote = ` ${override.placement.hint}`
        if (!appearance.description.includes(override.placement.hint)) {
          appearance.description = `${appearance.description}${placementNote}`
        }
      }
    }

    entries.push({
      id,
      label,
      keywords,
      url: `${pack.urlBase}/${file}`,
      source: pack.id,
      appearance,
    })
  }
}

function escapeTs(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function serializeAxisList(sides) {
  if (!sides || sides.length === 0) return ''
  return sides.map((side) => `'${side}'`).join(', ')
}

function serializePlacement(placement) {
  const lines = [
    '      placement: {',
    `        kind: '${placement.kind}',`,
    `        hint: '${escapeTs(placement.hint)}',`,
  ]
  if (placement.tileStepMeters !== undefined) {
    lines.push(`        tileStepMeters: ${placement.tileStepMeters},`)
  }
  if (placement.connects && placement.connects.length > 0) {
    lines.push(`        connects: [${serializeAxisList(placement.connects)}],`)
  }
  if (placement.forward) {
    lines.push(`        forward: '${placement.forward}',`)
  }
  if (placement.face) {
    lines.push(`        face: '${placement.face}',`)
  }
  lines.push('      },')
  return lines.join('\n')
}

function serializeAppearance(appearance) {
  const materials = appearance.materials.map((name) => `'${escapeTs(name)}'`).join(', ')
  const textures = appearance.textures.map((name) => `'${escapeTs(name)}'`).join(', ')
  const solidColors = appearance.solidColors.map((color) => `'${escapeTs(color)}'`).join(', ')
  return [
    'appearance: {',
    `      style: '${escapeTs(appearance.style)}',`,
    `      description: '${escapeTs(appearance.description)}',`,
    `      sizeMeters: { width: ${appearance.sizeMeters.width}, height: ${appearance.sizeMeters.height}, depth: ${appearance.sizeMeters.depth} },`,
    `      vertices: ${appearance.vertices},`,
    `      triangles: ${appearance.triangles},`,
    `      materials: [${materials}],`,
    `      textures: [${textures}],`,
    `      colorMode: '${appearance.colorMode}',`,
    `      solidColors: [${solidColors}],`,
    serializePlacement(appearance.placement),
    '    }',
  ].join('\n')
}

const lines = [
  '// Auto-generated by scripts/generate-3d-catalog.mjs — do not edit by hand.',
  "import type { Instant3dCatalogEntry } from './asset-catalog.ts'",
  '',
  'export const INSTANT3D_CATALOG_ENTRIES: Instant3dCatalogEntry[] = [',
]

for (const entry of entries) {
  const kw = entry.keywords.map((k) => `'${escapeTs(k)}'`).join(', ')
  lines.push(
    `  { id: '${escapeTs(entry.id)}', label: '${escapeTs(entry.label)}', keywords: [${kw}], url: '${escapeTs(entry.url)}', source: '${escapeTs(entry.source)}',`,
    `    ${serializeAppearance(entry.appearance)},`,
    '  },',
  )
}

lines.push(']', '')

fs.writeFileSync(OUT_PATH, lines.join('\n'))
console.log(`Wrote ${entries.length} catalog entries to ${path.relative(ROOT, OUT_PATH)}`)
