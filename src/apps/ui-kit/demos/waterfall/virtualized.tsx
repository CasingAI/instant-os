import { useState } from 'preact/hooks'
import { Waterfall } from '../../../../ui/waterfall.tsx'
import { Icon } from '../../../../ui/icon.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

type Photo = { id: string; place: string; date: string; gradient: string }

const PLACES = [
  '西湖', '外滩', '故宫', '洱海', '鼓浪屿', '稻城亚丁', '嘉峪关', '婺源',
  '洪崖洞', '沙坡头', '泸沽湖', '莫干山', '霞浦', '喀纳斯', '阳朔', '青海湖',
]

const PHOTO_COUNT = 10_000

/** 万张「照片」：确定性生成渐变底与地点/日期，点按收藏 */
const PHOTOS: Photo[] = Array.from({ length: PHOTO_COUNT }, (_, i) => {
  const hue = Math.round((i * 137.508) % 360)
  const hue2 = (hue + 45 + (i % 3) * 25) % 360
  return {
    id: `p${i}`,
    place: PLACES[i % PLACES.length],
    date: `202${4 + (i % 3)} 年 ${1 + (i % 12)} 月 ${1 + ((i * 7) % 28)} 日`,
    gradient: `linear-gradient(155deg, hsl(${hue} 68% 62%), hsl(${hue2} 72% 36%))`,
  }
})

const JUMP_TARGETS = [
  { index: 0, label: '回到顶部' },
  { index: 4999, label: '第 5000 项' },
  { index: 9499, label: '第 9500 项' },
]

/** 虚拟滚动：1 万张照片只挂可见行；卡片点按收藏、按钮跳到任意一项 */
export default function WaterfallVirtualizedDemo() {
  const [favs, setFavs] = useState<ReadonlySet<string>>(new Set())
  const [scrollToIndex, setScrollToIndex] = useState<number | undefined>(undefined)

  const toggleFav = (id: string) => {
    setFavs((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <DemoVariants>
      <DemoVariant label={`照片墙 · ${PHOTO_COUNT.toLocaleString()} 张 · 已收藏 ${favs.size} 张`} wide>
        <div class="ui-kit-demo__wf-toolbar">
          {JUMP_TARGETS.map((target) => (
            <button
              key={target.index}
              type="button"
              class="ui-kit-demo__ghost-btn"
              onClick={() => setScrollToIndex(target.index)}
            >
              {target.label}
            </button>
          ))}
          <span class="ui-kit-demo__status">点卡片右上角收藏</span>
        </div>
        <div style={{ height: 360 }} class="ui-kit-demo__wf-frame">
          <Waterfall
            items={PHOTOS}
            itemKey={(photo) => photo.id}
            columns={4}
            itemHeight={108}
            gap={8}
            scrollToIndex={scrollToIndex}
            renderItem={(photo) => (
              <button
                type="button"
                class="ui-kit-demo__wf-photo"
                style={{ background: photo.gradient }}
                onClick={() => toggleFav(photo.id)}
              >
                <span class="ui-kit-demo__wf-photo-heart" style={{ color: favs.has(photo.id) ? '#ff3b30' : '#fff' }}>
                  <Icon name="favorite" size={14} fill={favs.has(photo.id)} />
                </span>
                <span class="ui-kit-demo__wf-photo-caption">
                  <span class="ui-kit-demo__wf-photo-place">{photo.place}</span>
                  <span class="ui-kit-demo__wf-photo-date">{photo.date}</span>
                </span>
              </button>
            )}
          />
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}
