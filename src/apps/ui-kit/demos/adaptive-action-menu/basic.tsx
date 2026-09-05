import { useState } from 'preact/hooks'
import { AdaptiveActionMenu, type AdaptiveActionMenuItem } from '../../../../ui/adaptive-action-menu.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function AdaptiveActionMenuDemo() {
  const [wideOpen, setWideOpen] = useState(false)
  const [narrowOpen, setNarrowOpen] = useState(false)
  const [lastAction, setLastAction] = useState('')

  const items: AdaptiveActionMenuItem[] = [
    { type: 'action', label: '复制', onClick: () => setLastAction('复制') },
    { type: 'action', label: '粘贴', onClick: () => setLastAction('粘贴') },
    { type: 'separator' },
    { type: 'action', label: '删除', onClick: () => setLastAction('删除') },
  ]

  return (
    <DemoVariants>
      <DemoVariant label="宽屏下拉">
        <div class="ui-kit-demo__menu-host">
          <button type="button" class="ui-kit-demo__ghost-btn ui-kit-demo__ghost-btn--accent" onClick={() => setWideOpen(true)}>
            打开菜单
          </button>
          <AdaptiveActionMenu
            open={wideOpen}
            title="操作"
            items={items}
            narrowLayout={false}
            anchor={{ x: 40, y: 48 }}
            onClose={() => setWideOpen(false)}
            mount="contained"
          />
        </div>
      </DemoVariant>
      <DemoVariant label="窄屏底部面板">
        <div class="ui-kit-demo__menu-host">
          <button type="button" class="ui-kit-demo__ghost-btn" onClick={() => setNarrowOpen(true)}>
            打开面板
          </button>
          <AdaptiveActionMenu
            open={narrowOpen}
            title="操作"
            items={items}
            narrowLayout={true}
            onClose={() => setNarrowOpen(false)}
            mount="contained"
          />
        </div>
      </DemoVariant>
      {lastAction && (
        <DemoVariant label="最近操作" wide>
          <p class="ui-kit-demo__status">最后操作: {lastAction}</p>
        </DemoVariant>
      )}
    </DemoVariants>
  )
}
