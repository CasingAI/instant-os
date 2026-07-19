import { INSTANT3D_CATALOG_ENTRIES } from './asset-catalog-entries.ts'

export type Instant3dPrimitiveKind = 'box' | 'sphere' | 'cylinder' | 'plane'

export type Instant3dSourceId =
  | 'kaykit-furniture'
  | 'tiny-treats-homely'
  | 'kaykit-city-builder'
  | 'kaykit-restaurant'
  | 'kaykit-space-base'
  | 'kaykit-halloween'

export type Instant3dSizeMeters = {
  width: number
  height: number
  depth: number
}

export type Instant3dColorMode = 'texture' | 'solid' | 'mixed'

export type Instant3dAxisSide = '+x' | '-x' | '+z' | '-z'

export type Instant3dPlacementKind = 'free' | 'tile' | 'linear' | 'corner' | 'junction' | 'wall'

export type Instant3dPlacement = {
  kind: Instant3dPlacementKind
  hint: string
  tileStepMeters?: number
  connects?: Instant3dAxisSide[]
  forward?: Instant3dAxisSide
  face?: Instant3dAxisSide
  /** 椅背 / 床头 / 柜背等背面朝向 */
  back?: Instant3dAxisSide
  /** 关键部件相对坐标轴的对照说明（来自模型识图） */
  axisLandmarks?: string
  /** 给场景生成 AI 的摆放操作建议（来自模型识图） */
  sceneUseHint?: string
}

export type Instant3dModelAppearance = {
  style: string
  description: string
  /** 材质、配色与表面细节补充（来自模型识图） */
  appearanceNotes?: string
  sizeMeters: Instant3dSizeMeters
  vertices: number
  triangles: number
  materials: string[]
  textures: string[]
  colorMode: Instant3dColorMode
  solidColors: string[]
  placement: Instant3dPlacement
}

export type Instant3dCatalogEntry = {
  id: string
  label: string
  keywords: string[]
  url: string
  source: Instant3dSourceId
  appearance: Instant3dModelAppearance
}

export type Instant3dSourcePack = {
  id: Instant3dSourceId
  title: string
  subtitle: string
  license: string
}

export const INSTANT3D_SOURCE_PACKS: Instant3dSourcePack[] = [
  {
    id: 'kaykit-furniture',
    title: 'KayKit 家具',
    subtitle: 'KayKit Furniture Bits',
    license: 'CC0 1.0',
  },
  {
    id: 'tiny-treats-homely',
    title: 'Tiny Treats 家居',
    subtitle: 'Homely House',
    license: 'CC0 1.0',
  },
  {
    id: 'kaykit-city-builder',
    title: 'KayKit 城市',
    subtitle: 'KayKit City Builder Bits',
    license: 'CC0 1.0',
  },
  {
    id: 'kaykit-restaurant',
    title: 'KayKit 餐厅',
    subtitle: 'KayKit Restaurant Bits',
    license: 'CC0 1.0',
  },
  {
    id: 'kaykit-space-base',
    title: 'KayKit 太空基地',
    subtitle: 'KayKit Space Base Bits',
    license: 'CC0 1.0',
  },
  {
    id: 'kaykit-halloween',
    title: 'KayKit 万圣节',
    subtitle: 'KayKit Halloween Bits',
    license: 'CC0 1.0',
  },
]

export const INSTANT3D_CATALOG: Instant3dCatalogEntry[] = INSTANT3D_CATALOG_ENTRIES

export const INSTANT3D_PRIMITIVES: Instant3dPrimitiveKind[] = ['box', 'sphere', 'cylinder', 'plane']

export function formatPlacementPrompt(entry: Instant3dCatalogEntry): string | undefined {
  const placement = entry.appearance.placement
  const parts: string[] = []
  if (placement.kind !== 'free') {
    parts.push(placementKindLabel(placement.kind))
  }
  if (placement.tileStepMeters !== undefined) {
    parts.push(`瓦片步长 ${placement.tileStepMeters}m`)
  }
  if (placement.connects && placement.connects.length > 0) {
    parts.push(`接口 ${placement.connects.join('/')}`)
  }
  if (placement.forward) {
    parts.push(`延伸 ${placement.forward}`)
  }
  if (placement.face) {
    parts.push(`正面 ${placement.face}`)
  }
  if (placement.back) {
    parts.push(`背面 ${placement.back}`)
  }
  // 批量目录只带短 hint；完整 sceneUseHint / axisLandmarks 留在 catalog 条目供详情与按需取用
  if (placement.kind !== 'free' && placement.hint) {
    const shortHint =
      placement.hint.length > 48 ? `${placement.hint.slice(0, 47).trimEnd()}…` : placement.hint
    parts.push(shortHint)
  }
  if (parts.length === 0) return undefined
  return parts.join('；')
}


export function buildThreejsCatalogPromptSection(): string {
  const lines: string[] = [
    '【Three.js 模型资源目录】加载 GLTF 时只能使用下列 url，禁止编造路径：',
    '格式：modelId | url | 名称 | 尺寸 | 摆放 | 关键词',
    '',
    '摆放与比例规则：',
    '- 坐标系：X 右、Y 上、Z 前；尺寸为包围盒 宽×高×深（米）',
    '- 模型按 1:1 比例加载；除非用户明确要求缩放，否则不要设置 scale',
    '- 加载后设置 position，家具/道具通常 y=0 让底面贴地',
    '- 水平间距：相邻物体中心距离 ≥ (两者宽度之和)/2 + 0.3m',
    '- 地面需用 PlaneGeometry 等铺地，大小覆盖全部物体并留 ≥1m 边距',
    '- 「摆放」含默认朝向（正面/背面/延伸/接口）；tile/linear/corner/junction/wall 按接口拼接',
    '- 改变朝向用 object.rotation.y（弧度）；90° = Math.PI/2',
  ]

  for (const pack of INSTANT3D_SOURCE_PACKS) {
    const packEntries = catalogEntriesForSource(pack.id)
    if (packEntries.length === 0) continue

    lines.push(
      '',
      `■ ${pack.title}（${packEntries[0]?.appearance.style}，共 ${packEntries.length} 个）`,
    )
    for (const entry of packEntries) {
      const size = formatSizeMeters(entry.appearance.sizeMeters)
      const keywords = entry.keywords.slice(0, 5).join('、')
      const placement = formatPlacementPrompt(entry)
      const placementSuffix = placement ? ` | 摆放 ${placement}` : ''
      lines.push(`- ${entry.id} | ${entry.url} | ${entry.label} | 尺寸 ${size}${placementSuffix} | ${keywords}`)
    }
  }

  return lines.join('\n')
}

export function catalogEntryById(id: string): Instant3dCatalogEntry | undefined {
  return INSTANT3D_CATALOG.find((entry) => entry.id === id)
}

export function catalogEntriesForSource(source: Instant3dSourceId): Instant3dCatalogEntry[] {
  return INSTANT3D_CATALOG.filter((entry) => entry.source === source)
}

export function formatSizeMeters(size: Instant3dSizeMeters): string {
  const format = (value: number) => Number(value.toFixed(2)).toString()
  return `${format(size.width)} × ${format(size.height)} × ${format(size.depth)} m`
}

export function colorModeLabel(mode: Instant3dColorMode): string {
  if (mode === 'texture') return '纹理贴图'
  if (mode === 'solid') return '纯色材质'
  return '纹理 + 纯色'
}

export function placementKindLabel(kind: Instant3dPlacementKind): string {
  if (kind === 'tile') return '瓦片'
  if (kind === 'linear') return '直线段'
  if (kind === 'corner') return '转角'
  if (kind === 'junction') return '交叉口'
  if (kind === 'wall') return '墙体'
  return '自由摆放'
}
