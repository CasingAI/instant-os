import { useState } from 'preact/hooks'
import { CollectionView } from '../../../../ui/collection-view.tsx'
import { Icon } from '../../../../ui/icon.tsx'
import { SegmentedControl } from '../../../../ui/segmented-control.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

type Wallpaper = { id: string; name: string; category: 'featured' | 'nature' | 'solid'; background: string }

/** 墙纸：纯 CSS 渐变充当缩略图，三档分类 */
const WALLPAPERS: Wallpaper[] = [
  { id: 'sunset', name: '日落', category: 'featured', background: 'linear-gradient(160deg, #ff9a5a, #ff4e78)' },
  { id: 'dawnmist', name: '晨雾', category: 'featured', background: 'linear-gradient(160deg, #c9d6ff, #7f9bfa)' },
  { id: 'dusk', name: '暮紫', category: 'featured', background: 'linear-gradient(160deg, #a18cd1, #5b4b8a)' },
  { id: 'ember', name: '焰夜', category: 'featured', background: 'linear-gradient(160deg, #f5576c, #2b0b3f)' },
  { id: 'gold', name: '金穗', category: 'featured', background: 'linear-gradient(160deg, #f6d365, #b06ab3)' },
  { id: 'sea', name: '深海', category: 'nature', background: 'linear-gradient(160deg, #2193b0, #6dd5ed)' },
  { id: 'forest', name: '森林', category: 'nature', background: 'linear-gradient(160deg, #134e5e, #71b280)' },
  { id: 'aurora', name: '极光', category: 'nature', background: 'linear-gradient(160deg, #00c9a7, #5b4b8a)' },
  { id: 'snow', name: '雪岭', category: 'nature', background: 'linear-gradient(160deg, #e0eafc, #8fa8c8)' },
  { id: 'lake', name: '湖心', category: 'nature', background: 'linear-gradient(160deg, #4facfe, #00c6a7)' },
  { id: 'marsh', name: '苔泽', category: 'nature', background: 'linear-gradient(160deg, #3e8e7e, #9be15d)' },
  { id: 'obsidian', name: '曜石', category: 'solid', background: 'linear-gradient(160deg, #3a3a3c, #1c1c1e)' },
  { id: 'moon', name: '月白', category: 'solid', background: 'linear-gradient(160deg, #ffffff, #e2e2e8)' },
  { id: 'sakura', name: '樱粉', category: 'solid', background: 'linear-gradient(160deg, #ffd3e0, #ff8fb1)' },
  { id: 'azure', name: '天青', category: 'solid', background: 'linear-gradient(160deg, #a1c4fd, #6a9cf5)' },
  { id: 'apricot', name: '沙杏', category: 'solid', background: 'linear-gradient(160deg, #f8e3c4, #e8b97e)' },
]

const CATEGORY_ITEMS = [
  { id: 'featured', label: '推荐' },
  { id: 'nature', label: '自然' },
  { id: 'solid', label: '纯色' },
] as const

type CategoryId = (typeof CATEGORY_ITEMS)[number]['id']

/** 基础用法：iOS 设置式壁纸选择宫格——固定 3 列、分类切换、点选蓝勾随选择迁移 */
export default function CollectionViewBasicDemo() {
  const [category, setCategory] = useState<CategoryId>('featured')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const filtered = WALLPAPERS.filter((wallpaper) => wallpaper.category === category)
  const selected = WALLPAPERS.find((wallpaper) => wallpaper.id === selectedId)
  const categoryLabel = CATEGORY_ITEMS.find((item) => item.id === category)?.label ?? ''

  return (
    <DemoVariants>
      <DemoVariant label={`壁纸选择 · 固定 3 列 · ${categoryLabel} ${filtered.length} 张`} wide>
        <div class="ui-kit-demo__cv-toolbar">
          <SegmentedControl value={category} items={CATEGORY_ITEMS} onChange={setCategory} ariaLabel="墙纸分类" />
          <span class="ui-kit-demo__status">{selected ? `已选：${selected.name}` : '选一张做墙纸'}</span>
        </div>
        <div style={{ height: 300 }} class="ui-kit-demo__cv-frame">
          <CollectionView
            items={filtered}
            itemKey={(wallpaper) => wallpaper.id}
            columns={3}
            itemHeight={112}
            gap={10}
            renderItem={(wallpaper) => (
              <button
                type="button"
                class="ui-kit-demo__cv-wall"
                onClick={() => setSelectedId(wallpaper.id)}
              >
                <span
                  class={`ui-kit-demo__cv-wall-thumb${
                    wallpaper.id === selectedId ? ' ui-kit-demo__cv-wall-thumb--selected' : ''
                  }`}
                  style={{ background: wallpaper.background }}
                >
                  {wallpaper.id === selectedId ? (
                    <span class="ui-kit-demo__cv-wall-check">
                      <Icon name="check" size={14} />
                    </span>
                  ) : undefined}
                </span>
                <span class="ui-kit-demo__cv-wall-name">{wallpaper.name}</span>
              </button>
            )}
          />
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}
