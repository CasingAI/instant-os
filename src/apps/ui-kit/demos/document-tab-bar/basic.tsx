import { useState } from 'preact/hooks'
import { DocumentTabBar, type DocumentTabItem } from '../../../../ui/document-tab-bar.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function DocumentTabBarDemo() {
  const [tabs, setTabs] = useState<DocumentTabItem[]>([
    { id: '1', title: 'index.tsx', dirty: true },
    { id: '2', title: 'app.css' },
    { id: '3', title: 'README.md' },
    { id: '4', title: '很长的文件名-config.local.json' },
  ])
  const [activeTabId, setActiveTabId] = useState('1')
  const [fewTabs, setFewTabs] = useState<DocumentTabItem[]>([
    { id: 'a', title: '单页.md' },
  ])

  const handleClose = (tabId: string) => {
    setTabs((prev) => {
      const next = prev.filter((tab) => tab.id !== tabId)
      if (activeTabId === tabId && next.length > 0) {
        setActiveTabId(next[0].id)
      }
      return next
    })
  }

  return (
    <DemoVariants>
      <DemoVariant label="多标签 · 脏状态 · 长标题" wide>
        <div class="ui-kit-demo__tab-host">
          <DocumentTabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onActivate={setActiveTabId}
            onClose={handleClose}
          />
        </div>
      </DemoVariant>
      <DemoVariant label="不足最小数量时隐藏" wide>
        <div class="ui-kit-demo__tab-host">
          <DocumentTabBar
            tabs={fewTabs}
            activeTabId={fewTabs[0]?.id}
            minTabsToShow={2}
            onActivate={() => undefined}
            onClose={(id) => setFewTabs((prev) => prev.filter((tab) => tab.id !== id))}
          />
        </div>
        <p class="ui-kit-demo__status">仅 1 个标签时栏会收起（minTabsToShow=2）</p>
        <button
          type="button"
          class="ui-kit-demo__ghost-btn"
          onClick={() =>
            setFewTabs([
              { id: 'a', title: '单页.md' },
              { id: 'b', title: '另一页.md', dirty: true },
            ])
          }
        >
          添加第二个标签
        </button>
      </DemoVariant>
    </DemoVariants>
  )
}
