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
}

export type Instant3dModelAppearance = {
  style: string
  description: string
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
  if (placement.kind === 'free') return undefined

  const parts: string[] = []
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
  parts.push(placement.hint)
  return parts.join('；')
}

export function buildCatalogPromptLine(entry: Instant3dCatalogEntry): string {
  const size = formatSizeMeters(entry.appearance.sizeMeters)
  const keywords = entry.keywords.slice(0, 5).join('、')
  const placement = formatPlacementPrompt(entry)
  const placementSuffix = placement ? ` | 摆放 ${placement}` : ''
  return `- ${entry.id} | ${entry.label} | 尺寸 ${size}${placementSuffix} | ${keywords}`
}

export function buildCatalogPromptSection(): string {
  const lines: string[] = [
    '【Instant3D 摆放与比例规则】',
    '- 坐标系：X 右、Y 上、Z 前；尺寸为包围盒 宽×高×深（米）',
    '- 模型按 1:1 真实比例加载；除非用户明确要求缩放，否则不要设置 scale',
    '- position 为模型原点；家具/道具通常 position: [x, 0, z] 让底面落在地面',
    '- 水平间距：相邻物体中心距离 ≥ (两者宽度之和)/2 + 0.3m，避免重叠',
    '- 地面 plane 的 width/depth 应覆盖全部物体并留 ≥1m 边距',
    '- 参考尺度：椅子高约 0.8–1.3m，餐桌高约 0.7–0.8m，沙发宽约 1.5–2.5m，建筑可达 3–8m',
    '',
    '【方向与拼接规则】',
    '- 目录中带「摆放」字段的模型具有方向/接口语义，须按 hint 理解默认朝向与拼接方式',
    '- tile：按 tileStepMeters 网格铺设，相邻块中心间距 = 步长；接口边对齐拼接',
    '- linear：沿 forward 轴延伸；多段首尾相接，必要时 rotation.y 调整方向',
    '- corner：默认弯折方向见 connects；rotation.y 以 90° 为步进旋转',
    '- junction：多向交叉口；按 connects 与相邻 tile/linear 对齐',
    '- wall：沿 forward 延伸，face 为正面朝向；墙体应围成闭合或连续立面',
    '- 改变朝向用 rotation: [0, 弧度, 0]；90° = Math.PI/2，180° = Math.PI',
    '',
    '【Instant3D 内置模型目录】只能使用下列 modelId，禁止编造不存在的 id。',
    '格式：modelId | 名称 | 尺寸 | 关键词。按素材包分组，优先选语义最接近的包：',
  ]

  for (const pack of INSTANT3D_SOURCE_PACKS) {
    const packEntries = catalogEntriesForSource(pack.id)
    if (packEntries.length === 0) continue

    lines.push(
      '',
      `■ ${pack.title}（前缀 ${packEntries[0]?.id.split('.')[0]}.*，${packEntries[0]?.appearance.style}，共 ${packEntries.length} 个）`,
    )
    for (const entry of packEntries) {
      lines.push(buildCatalogPromptLine(entry))
    }
  }

  lines.push(
    '',
    '【Instant3D 内置几何基元】primitive 参数 type 只能取：',
    ...INSTANT3D_PRIMITIVES.map((kind) => `- ${kind}`),
    '- plane 用于地面/地毯；width、depth 按场景实际跨度设置（通常 6–20m）',
  )

  return lines.join('\n')
}

export function buildThreejsCatalogPromptSection(): string {
  const lines: string[] = [
    '【Three.js 模型资源目录】加载 GLTF 时只能使用下列 url，禁止编造路径：',
    '格式：modelId | url | 名称 | 尺寸 | 关键词',
    '',
    '摆放与比例规则：',
    '- 坐标系：X 右、Y 上、Z 前；尺寸为包围盒 宽×高×深（米）',
    '- 模型按 1:1 比例加载；除非用户明确要求缩放，否则不要设置 scale',
    '- 加载后设置 position，家具/道具通常 y=0 让底面贴地',
    '- 水平间距：相邻物体中心距离 ≥ (两者宽度之和)/2 + 0.3m',
    '- 地面需用 PlaneGeometry 等铺地，大小覆盖全部物体并留 ≥1m 边距',
    '- 带「摆放」字段的模型须按 hint 理解默认朝向；tile/linear/corner/junction/wall 按接口拼接',
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
