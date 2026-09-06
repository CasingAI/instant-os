import { useState } from 'preact/hooks'
import { DarkMode } from '../../../../ui/theme.tsx'
import { Nav, useNav } from '../../../../ui/nav.tsx'
import { List } from '../../../../ui/list.tsx'
import { ListItem } from '../../../../ui/list-item.tsx'
import { SegmentedControl } from '../../../../ui/segmented-control.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

/** 演示条目：列表页点进详情页，域状态只有选中 id */
const ITEMS = [
  { id: 'appearance', title: '外观', detail: '这里演示详情页：底色、标题栏、返回键全部随所在主题作用域取色。' },
  { id: 'network', title: '网络', detail: '切到亮色再看一遍：整棵子树被强制回亮色，与外层应用底色无关。' },
  { id: 'privacy', title: '隐私', detail: '宽窄形变、返回键编排属于 Nav 本身的行为，与主题作用域互不干扰。' },
] as const

type ItemId = (typeof ITEMS)[number]['id']

/** 正文文字随最近的主题作用域翻转：--page-header-title-color 在
 * :root / dark / light 三处都有定义，暗底上是浅色字 */
const BODY_TEXT_STYLE = {
  padding: '16px 20px',
  lineHeight: 1.7,
  color: 'var(--page-header-title-color, #222)',
} as const

/** 基础用法：真实 Nav 演示整页主题强制切换——顶部切换器把整个页面
 * （Nav 的列表页、详情帧、返回键全部标准件）在亮暗之间一翻到底 */
export default function ThemeBasicDemo() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [selectedId, setSelectedId] = useState<ItemId | null>(null)
  const selected = ITEMS.find((item) => item.id === selectedId)

  const controller = useNav({
    // 域状态唯一真源：选中了条目 → 窄屏应处详情页，否则回列表
    narrowPageForState: () => (selected ? 'detail' : 'list'),
    split: true,
    listPage: 'list',
  })

  const renderPage = (page: string) => {
    if (page === 'detail' && selected) {
      return (
        <Nav.Page
          title={selected.title}
          backLabel="返回"
          onBack={() => controller.navigate('list', 'pop', () => setSelectedId(null))}
        >
          <div style={BODY_TEXT_STYLE}>
            <p style={{ margin: 0 }}>{selected.detail}</p>
          </div>
        </Nav.Page>
      )
    }
    return (
      <Nav.Page title="设置">
        <div
          style={{
            padding: '12px 16px',
            color: 'var(--page-header-title-color, #222)',
          }}
        >
          <List>
            {ITEMS.map((item) => (
              <ListItem
                key={item.id}
                label={item.title}
                accessory="disclosure"
                onClick={() => {
                  setSelectedId(item.id)
                  controller.navigate('detail', 'push')
                }}
              />
            ))}
          </List>
        </div>
      </Nav.Page>
    )
  }

  return (
    <DemoVariants>
      <DemoVariant label="真实 Nav · 顶部切换整页亮暗" wide>
        <DarkMode disabled={theme === 'light'}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              height: 420,
            }}
          >
            <SegmentedControl
              value={theme}
              items={[
                { id: 'dark', label: '暗色' },
                { id: 'light', label: '亮色' },
              ]}
              onChange={setTheme}
              ariaLabel="整页主题"
            />
            <div style={{ flex: 1, minHeight: 0 }}>
              <Nav
                controller={controller}
                renderNarrowPage={renderPage}
                renderWideFrames={() =>
                  selected
                    ? [
                        {
                          id: 'detail',
                          content: renderPage('detail'),
                        },
                      ]
                    : []
                }
                framesResetKey={selectedId ?? ''}
              />
            </div>
          </div>
        </DarkMode>
      </DemoVariant>
    </DemoVariants>
  )
}
