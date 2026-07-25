import { useState } from 'preact/hooks'
import { IosSwitch } from '../../ui/ios-switch.tsx'
import { IosCheckToggle } from '../../ui/ios-check-toggle.tsx'
import { SegmentedControl } from '../../ui/segmented-control.tsx'
import { SettingsChoiceField } from '../../ui/settings-choice-field.tsx'
import { SettingsNavRow } from '../../ui/settings-nav-row.tsx'
import { SettingsSwitchRow } from '../../ui/settings-switch-row.tsx'
import { DocumentTabBar, type DocumentTabItem } from '../../ui/document-tab-bar.tsx'
import { AdaptiveActionMenu, type AdaptiveActionMenuItem } from '../../ui/adaptive-action-menu.tsx'
import { WindowModal } from '../../window/window-modal.tsx'

export function IosSwitchDemo() {
  const [enabled, setEnabled] = useState(true)
  return <IosSwitch checked={enabled} onChange={setEnabled} label="启用功能" />
}

export function IosCheckToggleDemo() {
  const [agreed, setAgreed] = useState(false)
  return <IosCheckToggle checked={agreed} onChange={setAgreed} label="同意条款" />
}

export function SegmentedControlDemo() {
  const [tab, setTab] = useState('all')
  return (
    <SegmentedControl
      value={tab}
      items={[
        { id: 'all', label: '全部', badge: 5 },
        { id: 'unread', label: '未读', dirty: true },
        { id: 'starred', label: '星标' },
      ]}
      onChange={setTab}
      ariaLabel="消息分类"
    />
  )
}

export function SettingsChoiceFieldDemo() {
  const [theme, setTheme] = useState('auto')
  return (
    <SettingsChoiceField
      label="主题"
      value={theme}
      options={[
        { id: 'auto', label: '自动' },
        { id: 'light', label: '浅色' },
        { id: 'dark', label: '深色' },
      ]}
      onChange={setTheme}
      wideLayout={true}
      presentation="form"
      fieldClass="ui-kit-demo__field"
      labelClass="ui-kit-demo__label"
    />
  )
}

export function SettingsNavRowDemo() {
  const [clicked, setClicked] = useState(false)
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: '8px', overflow: 'hidden' }}>
      <SettingsNavRow
        label="账号设置"
        value={clicked ? '已点击' : 'user@example.com'}
        onClick={() => setClicked(!clicked)}
      />
    </div>
  )
}

export function SettingsSwitchRowDemo() {
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: '8px', overflow: 'hidden', padding: '0 16px' }}>
      <SettingsSwitchRow
        label="启用通知"
        checked={notificationsEnabled}
        onChange={setNotificationsEnabled}
      />
    </div>
  )
}

export function DocumentTabBarDemo() {
  const [tabs, setTabs] = useState<DocumentTabItem[]>([
    { id: '1', title: 'index.tsx', dirty: true },
    { id: '2', title: 'app.css' },
    { id: '3', title: 'README.md' },
  ])
  const [activeTabId, setActiveTabId] = useState('1')

  const handleClose = (tabId: string) => {
    setTabs(tabs.filter(tab => tab.id !== tabId))
    if (activeTabId === tabId && tabs.length > 0) {
      setActiveTabId(tabs[0].id)
    }
  }

  return (
    <div style={{ background: '#f5f5f5', border: '1px solid #e5e5e5', borderRadius: '8px', overflow: 'hidden' }}>
      <DocumentTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onActivate={setActiveTabId}
        onClose={handleClose}
      />
    </div>
  )
}

export function AdaptiveActionMenuDemo() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [lastAction, setLastAction] = useState<string>('')

  const items: AdaptiveActionMenuItem[] = [
    {
      type: 'action',
      label: '复制',
      onClick: () => setLastAction('复制'),
    },
    {
      type: 'action',
      label: '粘贴',
      onClick: () => setLastAction('粘贴'),
    },
    { type: 'separator' },
    {
      type: 'action',
      label: '删除',
      onClick: () => setLastAction('删除'),
    },
  ]

  return (
    <div style={{ position: 'relative', minHeight: '60px' }}>
      <button
        type="button"
        onClick={() => setMenuOpen(!menuOpen)}
        style={{
          padding: '8px 16px',
          background: '#5856d6',
          color: '#fff',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
        }}
      >
        打开菜单
      </button>
      {lastAction && (
        <div style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
          最后操作: {lastAction}
        </div>
      )}
      <AdaptiveActionMenu
        open={menuOpen}
        title="操作"
        items={items}
        narrowLayout={false}
        anchor={{ x: 50, y: 100 }}
        onClose={() => setMenuOpen(false)}
        mount="contained"
      />
    </div>
  )
}

export function WindowModalDemo() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [result, setResult] = useState<string>('')

  const handleConfirm = () => {
    setResult('已确认')
    setDialogOpen(false)
  }

  const handleClose = () => {
    setResult('已取消')
    setDialogOpen(false)
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        style={{
          padding: '8px 16px',
          background: '#5856d6',
          color: '#fff',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
        }}
      >
        打开对话框
      </button>
      {result && (
        <div style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
          结果: {result}
        </div>
      )}
      <WindowModal
        open={dialogOpen}
        title="确认操作"
        onClose={handleClose}
        actions={[
          { label: '取消', onClick: handleClose },
          { label: '确认', tone: 'primary', onClick: handleConfirm },
        ]}
      >
        <p>确定要执行此操作吗？</p>
      </WindowModal>
    </div>
  )
}
