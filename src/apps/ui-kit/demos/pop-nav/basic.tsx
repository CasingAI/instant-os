import { useCallback, useState } from 'preact/hooks'
import { Button } from '../../../../ui/button.tsx'
import { List } from '../../../../ui/list.tsx'
import { ListItem } from '../../../../ui/list-item.tsx'
import { PopNav, PopNavTrigger } from '../../../../ui/pop-nav.tsx'
import { Nav, useNav } from '../../../../ui/nav.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

const LIST_ITEMS = [
  { id: 'item-1', title: '列表项一', detail: '第一项的详情内容：PopNav 的内容只能是 Nav 页面，从列表推入详情、返回键退回。' },
  { id: 'item-2', title: '列表项二', detail: '第二项的详情内容：关窗（点外面 / Esc）只是隐藏，再开还在原页。' },
  { id: 'item-3', title: '列表项三', detail: '第三项的详情内容：面板固定 320×280，超出宿主窗口时自动钳回窗口内。' },
]

type DemoNav = {
  page: string
  selected: number
  openItem: (index: number) => void
  goBack: () => void
}

function useDemoNav(): DemoNav & { controller: ReturnType<typeof useNav> } {
  const [page, setPage] = useState('list')
  const [selected, setSelected] = useState(0)
  const nav = useNav({ narrowPageForState: () => page })
  const openItem = useCallback(
    (index: number) => {
      setSelected(index)
      setPage('detail')
      nav.navigate('detail', 'push')
    },
    [nav],
  )
  const goBack = useCallback(() => {
    nav.navigate('list', 'pop', () => setPage('list'))
  }, [nav])
  return { controller: nav, page, selected, openItem, goBack }
}

/** 页面外壳由 <Nav.Page> 统一绘制（标题栏 + 返回键），与全系统导航一个长相 */
function renderDemoPages(page: string, demo: DemoNav) {
  if (page === 'detail') {
    const item = LIST_ITEMS[demo.selected]
    return (
      <Nav.Page title={item.title} backLabel="示例列表" onBack={demo.goBack}>
        <p style={{ margin: 0, padding: '4px 16px 16px', fontSize: 13, lineHeight: 1.6, color: '#444' }}>
          {item.detail}
        </p>
      </Nav.Page>
    )
  }
  return (
    <Nav.Page title="示例列表">
      <List variant="plain">
        {LIST_ITEMS.map((item, index) => (
          <ListItem
            key={item.id}
            label={item.title}
            accessory="disclosure"
            onClick={() => demo.openItem(index)}
          />
        ))}
      </List>
    </Nav.Page>
  )
}

/** 锚定形态：PopNavTrigger 直接包 Button（ref 注入，不再手包 span），箭头指向按钮 */
function AnchoredPopNav() {
  const [open, setOpen] = useState(false)
  const demo = useDemoNav()
  return (
    <div class="ui-kit-demo__row">
      <PopNav
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        ariaLabel="示例弹出导航"
        controller={demo.controller}
        frames={[]}
        renderPage={(page) => renderDemoPages(page, demo)}
      >
        <PopNavTrigger>
          <Button>打开弹窗</Button>
        </PopNavTrigger>
      </PopNav>
      <span class="ui-kit-demo__hint">点按钮弹出：列表推入详情；贴近视口底部自动上翻、箭头换边</span>
    </div>
  )
}

/** hide 不 destroy：翻到详情页 → 点外面收起 → 再开，仍在详情页 */
function StatefulPopNav() {
  const [open, setOpen] = useState(false)
  const demo = useDemoNav()
  return (
    <div class="ui-kit-demo__row">
      <PopNav
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        ariaLabel="状态保持示例"
        controller={demo.controller}
        frames={[]}
        renderPage={(page) => renderDemoPages(page, demo)}
      >
        <PopNavTrigger>
          <Button>打开弹窗</Button>
        </PopNavTrigger>
      </PopNav>
      <span class="ui-kit-demo__hint">进详情 → 点弹窗外面收起 → 再打开：仍停在详情页（hide 不 destroy）</span>
    </div>
  )
}

export default function PopNavDemo() {
  return (
    <DemoVariants>
      <DemoVariant label="锚定弹窗（箭头跟随触发器）" wide>
        <AnchoredPopNav />
      </DemoVariant>
      <DemoVariant label="关窗不销毁" wide>
        <StatefulPopNav />
      </DemoVariant>
      <DemoVariant label="窄窗自适应">
        <span class="ui-kit-demo__hint">把窗口拖窄到 520px 以下，弹窗会变成居中模态对话框</span>
      </DemoVariant>
    </DemoVariants>
  )
}
