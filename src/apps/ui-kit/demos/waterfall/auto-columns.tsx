import { useState } from 'preact/hooks'
import { Waterfall } from '../../../../ui/waterfall.tsx'
import { IosRangeSlider } from '../../../../ui/ios-range-slider.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

type FeatureCard = { id: string; title: string; sub: string; badge: string; from: string; to: string }

/** App Store 精选式卡片：渐变封面 + 角标 + 标题/副标题 */
const CARDS: FeatureCard[] = [
  { id: 'starlight', title: '星轨远征', sub: '年度科幻大作 · 新章开启', badge: '新企划', from: '#667eea', to: '#764ba2' },
  { id: 'valley', title: '山谷食集', sub: '本地农场直送菜单', badge: '限时活动', from: '#f6d365', to: '#fda085' },
  { id: 'ink', title: '墨韵', sub: '水墨风解谜小品', badge: '编辑推荐', from: '#a18cd1', to: '#5b4b8a' },
  { id: 'tide', title: '潮汐电台', sub: '深夜歌单陪你入眠', badge: '热门', from: '#ff9a9e', to: '#c86dd7' },
  { id: 'cityline', title: '城市脉络', sub: '地铁通勤实时攻略', badge: '实用', from: '#4facfe', to: '#00c9c8' },
  { id: 'tundra', title: '苔原行者', sub: '开放世界生存新作', badge: '预约中', from: '#134e5e', to: '#71b280' },
  { id: 'lumiere', title: '光影工坊', sub: '一键出片的电影感滤镜', badge: '限时优惠', from: '#ff6a88', to: '#ff99ac' },
  { id: 'papercalc', title: '纸间计算', sub: '会写草稿的计算器', badge: '小而美', from: '#cfd9df', to: '#8399a8' },
  { id: 'stargaze', title: '星野漫步', sub: '每日一张深空美图', badge: '免费', from: '#0ba360', to: '#3cba92' },
]

/** 自适应列数：不给 columns，滑杆改卡片最小宽（或拖窄窗口），列数随之变化；点按打开 */
export default function WaterfallAutoColumnsDemo() {
  const [minItemWidth, setMinItemWidth] = useState(220)
  const [opened, setOpened] = useState<string | null>(null)

  const open = (title: string) => {
    setOpened(title)
    setTimeout(() => setOpened((current) => (current === title ? null : current)), 1200)
  }

  return (
    <DemoVariants>
      <DemoVariant label="图文卡片墙 · 卡片最小宽跟滑杆走">
        <div class="ui-kit-demo__wf-toolbar">
          <span class="ui-kit-demo__status" style={{ whiteSpace: 'nowrap' }}>
            卡片最小宽 {minItemWidth}px
          </span>
          <div style={{ flex: 1, maxWidth: 240 }}>
            <IosRangeSlider value={minItemWidth} min={180} max={320} step={10} onChange={setMinItemWidth} />
          </div>
          <span class="ui-kit-demo__status">{opened ? `已打开「${opened}」` : '点按打开'}</span>
        </div>
        <div style={{ height: 340 }} class="ui-kit-demo__wf-frame">
          <Waterfall
            items={CARDS}
            itemKey={(card) => card.id}
            minItemWidth={minItemWidth}
            itemHeight={150}
            gap={10}
            renderItem={(card) => (
              <button type="button" class="ui-kit-demo__wf-card" onClick={() => open(card.title)}>
                <span
                  class="ui-kit-demo__wf-card-art"
                  style={{ background: `linear-gradient(150deg, ${card.from}, ${card.to})` }}
                >
                  <span class="ui-kit-demo__wf-card-badge">{card.badge}</span>
                </span>
                <span class="ui-kit-demo__wf-card-title">{card.title}</span>
                <span class="ui-kit-demo__wf-card-sub">{card.sub}</span>
              </button>
            )}
          />
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}
