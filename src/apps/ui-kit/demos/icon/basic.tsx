import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { Icon, type IconFamily } from '../../../../ui/icon.tsx'
import { Switch } from '../../../../ui/switch.tsx'
import { IosTextField } from '../../../../ui/ios-text-field.tsx'
import { IosRangeSlider } from '../../../../ui/ios-range-slider.tsx'
import { SegmentedControl } from '../../../../ui/segmented-control.tsx'
import { FixedRowVirtualList } from '../../../../ui/fixed-row-virtual-list.tsx'
import { ICON_RECOMMENDED, ICON_RECOMMENDED_NAMES } from '../../icon-recommended.ts'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

type MaterialIconCatalogModule = typeof import('../../material-icon-catalog.generated.ts')
type MaterialIconRow = MaterialIconCatalogModule['MATERIAL_ICONS'][number]

const ICON_FAMILY_ITEMS = [
  { id: 'outlined', label: 'Outlined' },
  { id: 'rounded', label: 'Rounded' },
  { id: 'sharp', label: 'Sharp' },
] as const

/** 生成脚本已把 Google 原始类目归并为规范类目，这里只做显示层中文名；未命中的显示原文。Android 是题材类目（设备/系统相关图标），不是整库平台限定。 */
const ICON_CATEGORY_CN: Record<string, string> = {
  'Action': '操作',
  'Alert': '提醒',
  'Android': '安卓',
  'Audio & Video': '音视频',
  'Business': '商务',
  'Communication': '通讯',
  'Content': '内容',
  'Device': '设备',
  'Editor': '文本编辑',
  'Files': '文件',
  'Hardware': '硬件',
  'Home': '家居',
  'Images': '图像',
  'Maps': '地图',
  'Navigation': '导航',
  'Notification': '通知',
  'Places': '地点',
  'Privacy': '隐私',
  'Search': '搜索',
  'Social': '社交',
  'Text': '文本',
  'Toggle': '开关',
  'Transit': '交通',
  'Travel': '旅行',
}

const ICON_GRID_ROW_HEIGHT = 70
const ICON_GRID_CELL_WIDTH = 86
/** 与 `.ui-kit-demo__icon-row` 左右 padding 同值 */
const ICON_GRID_ROW_INSET = 6
const ICON_GRID_OVERSCAN = 3

/** 推荐名单查集：iOS 6 系统界面符号精选（名单与语义见 icon-recommended.ts） */
const ICON_RECOMMENDED_SET = new Set(ICON_RECOMMENDED_NAMES)

/** 目录数据 ~1.9MB，随本示例动态 import 单独成 chunk，其余示例不为其买单。 */
export default function IconDemo() {
  const [catalog, setCatalog] = useState<MaterialIconCatalogModule | null>(null)
  const [family, setFamily] = useState<IconFamily>('rounded')
  const [fill, setFill] = useState(false)
  const [weight, setWeight] = useState(400)
  const [query, setQuery] = useState('')
  /** null=全部；''=未分类；ICON_RECOMMENDED=推荐（iOS 6 系统符号精选）；其余为规范类目名。默认落在推荐。 */
  const [category, setCategory] = useState<string | null>(ICON_RECOMMENDED)
  const [copied, setCopied] = useState<string | null>(null)
  const [gridWidth, setGridWidth] = useState(0)
  const gridAreaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    import('../../material-icon-catalog.generated.ts').then((mod) => {
      if (alive) setCatalog(mod)
    })
    return () => {
      alive = false
    }
  }, [])

  // gridarea 随 catalog 加载才挂载，跟随 catalog 重挂测量
  useLayoutEffect(() => {
    const el = gridAreaRef.current
    if (!catalog || !el) return
    const measure = () => setGridWidth(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [catalog])

  const rows = catalog?.MATERIAL_ICONS ?? null
  const normalizedQuery = query.trim().toLowerCase()
  const searching = normalizedQuery.length > 0

  // 当前字体族缺字形的图标直接不进目录，避免渲染出 ligature 原文
  const supportedRows = useMemo(() => {
    if (!rows) return null
    return rows.filter((row) => !row[3] || !row[3].split(',').includes(family))
  }, [rows, family])

  const categoryStats = useMemo(() => {
    const counts = new Map<string, number>()
    let uncategorized = 0
    if (!catalog || !supportedRows) return { counts, uncategorized, total: 0 }
    for (const cat of catalog.MATERIAL_ICON_CATEGORIES) counts.set(cat, 0)
    for (const row of supportedRows) {
      const cats = row[1] ? row[1].split(',') : []
      if (cats.length === 0) uncategorized++
      for (const cat of cats) counts.set(cat, (counts.get(cat) ?? 0) + 1)
    }
    return { counts, uncategorized, total: supportedRows.length }
  }, [catalog, supportedRows])

  // 推荐徽标数与其它徽标一样随字体族联动（名单本身三族全可用，此处仍按 supportedRows 现算以防名单日后收录缺字形图标）
  const recommendedCount = useMemo(() => {
    if (!supportedRows) return 0
    return supportedRows.filter((row) => ICON_RECOMMENDED_SET.has(row[0])).length
  }, [supportedRows])

  const visibleCategories = useMemo(() => {
    if (!catalog) return []
    return catalog.MATERIAL_ICON_CATEGORIES.filter((cat) => (categoryStats.counts.get(cat) ?? 0) > 0)
  }, [catalog, categoryStats])

  useEffect(() => {
    if (category === null) return
    if (category === ICON_RECOMMENDED) {
      // 哨兵不在 categoryStats.counts 里，必须走自己的空判断，否则会被下面的通用检查弹回全部
      if (recommendedCount === 0) setCategory(null)
      return
    }
    if (category === '') {
      if (categoryStats.uncategorized === 0) setCategory(null)
      return
    }
    if ((categoryStats.counts.get(category) ?? 0) === 0) setCategory(null)
  }, [category, categoryStats, recommendedCount])

  const filtered = useMemo(() => {
    if (!supportedRows) return null
    if (searching) {
      return supportedRows.filter((row) => `${row[0]} ${row[2]}`.includes(normalizedQuery))
    }
    if (category === null) return supportedRows
    if (category === ICON_RECOMMENDED) {
      return supportedRows.filter((row) => ICON_RECOMMENDED_SET.has(row[0]))
    }
    if (category === '') return supportedRows.filter((row) => !row[1])
    return supportedRows.filter((row) => row[1].split(',').includes(category))
  }, [supportedRows, searching, normalizedQuery, category])

  // 虚拟滚动按行喂：列数随容器宽度变化时整表重切；格宽固定，余数不进格子
  const columns = Math.max(1, Math.floor((gridWidth - ICON_GRID_ROW_INSET * 2) / ICON_GRID_CELL_WIDTH))
  const iconRows = useMemo(() => {
    if (!filtered || columns < 1) return []
    const result: MaterialIconRow[][] = []
    for (let i = 0; i < filtered.length; i += columns) {
      result.push(filtered.slice(i, i + columns))
    }
    return result
  }, [filtered, columns])

  const copyName = (name: string) => {
    navigator.clipboard.writeText(name).then(() => {
      setCopied(name)
      setTimeout(() => setCopied((current) => (current === name ? null : current)), 1200)
    }, () => {})
  }

  if (!catalog || !filtered) {
    return (
      <DemoVariants>
        <DemoVariant label="Icon 图标库" wide>
          <span class="ui-kit-demo__hint">加载图标目录…</span>
        </DemoVariant>
      </DemoVariants>
    )
  }

  const fmt = (n: number) => n.toLocaleString()
  const catClass = (value: string | null) =>
    `ui-kit-demo__icon-cat${!searching && category === value ? ' ui-kit-demo__icon-cat--active' : ''}`
  const renderCell = (row: MaterialIconRow) => (
    <button
      key={row[0]}
      type="button"
      class="ui-kit-demo__icon-cell"
      title={row[0]}
      onClick={() => copyName(row[0])}
    >
      <Icon name={row[0]} family={family} fill={fill} weight={weight} size={22} />
      <span class="ui-kit-demo__icon-name">{row[0]}</span>
    </button>
  )
  const renderRow = (row: MaterialIconRow[]) => (
    <div class="ui-kit-demo__icon-row" style={{ gridTemplateColumns: `repeat(${columns}, ${ICON_GRID_CELL_WIDTH}px)` }}>
      {row.map(renderCell)}
    </div>
  )
  const viewLabel = searching
    ? `搜索结果 · ${fmt(filtered.length)}`
    : category === null
      ? `全部 · ${fmt(categoryStats.total)}`
      : category === ICON_RECOMMENDED
        ? `推荐（iOS 6 系统符号） · ${fmt(recommendedCount)}`
        : category === ''
          ? '未分类'
          : `${ICON_CATEGORY_CN[category] ?? category}（${category}）`

  return (
    <DemoVariants>
      <DemoVariant label={viewLabel} wide>
        <div class="ui-kit-demo__icon-panel">
          <div class="ui-kit-demo__icon-toolbar">
            <div class="ui-kit-demo__icon-search">
              <IosTextField
                type="search"
                placeholder="搜索图标名或标签，如 trash…"
                value={query}
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </div>
            <SegmentedControl
              value={family}
              items={ICON_FAMILY_ITEMS}
              onChange={setFamily}
              ariaLabel="Material Symbols 字体族"
            />
            <div class="ui-kit-demo__icon-fill">
              <span class="ui-kit-demo__label">填充</span>
              <Switch checked={fill} onChange={setFill} label="填充" />
            </div>
            <div class="ui-kit-demo__icon-slider">
              <span class="ui-kit-demo__label">字重</span>
              <IosRangeSlider
                value={weight}
                min={100}
                max={700}
                step={100}
                onChange={setWeight}
              />
            </div>
            {copied ? <span class="ui-kit-demo__icon-copied">已复制 {copied}</span> : undefined}
          </div>
          <div class="ui-kit-demo__icon-browser">
            <nav class="ui-kit-demo__icon-cats" aria-label="图标分类">
              <button
                type="button"
                class={catClass(ICON_RECOMMENDED)}
                onClick={() => setCategory(ICON_RECOMMENDED)}
              >
                <span class="ui-kit-demo__icon-cat-name">推荐</span>
                <span class="ui-kit-demo__icon-cat-count">{fmt(recommendedCount)}</span>
              </button>
              <button type="button" class={catClass(null)} onClick={() => setCategory(null)}>
                <span class="ui-kit-demo__icon-cat-name">全部</span>
                <span class="ui-kit-demo__icon-cat-count">{fmt(categoryStats.total)}</span>
              </button>
              {visibleCategories.map((cat) => (
                <button key={cat} type="button" class={catClass(cat)} onClick={() => setCategory(cat)}>
                  <span class="ui-kit-demo__icon-cat-name">{ICON_CATEGORY_CN[cat] ?? cat}</span>
                  <span class="ui-kit-demo__icon-cat-count">{fmt(categoryStats.counts.get(cat) ?? 0)}</span>
                </button>
              ))}
              {categoryStats.uncategorized > 0 ? (
                <button type="button" class={catClass('')} onClick={() => setCategory('')}>
                  <span class="ui-kit-demo__icon-cat-name">未分类</span>
                  <span class="ui-kit-demo__icon-cat-count">{fmt(categoryStats.uncategorized)}</span>
                </button>
              ) : undefined}
            </nav>
            <div class="ui-kit-demo__icon-gridarea" ref={gridAreaRef}>
              {iconRows.length > 0 ? (
                <FixedRowVirtualList
                  className="fixed-row-virtual-list ui-kit-demo__icon-scroller"
                  items={iconRows}
                  rowHeight={ICON_GRID_ROW_HEIGHT}
                  overscan={ICON_GRID_OVERSCAN}
                  itemKey={(row) => row[0][0]}
                  renderItem={renderRow}
                />
              ) : (
                <div class="ui-kit-demo__icon-empty">无匹配图标</div>
              )}
            </div>
          </div>
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}
