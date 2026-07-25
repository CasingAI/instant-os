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
  const [lang, setLang] = useState('zh')
  const [region, setRegion] = useState('cn')
  const [sort, setSort] = useState('name')

  const themeOptions = [
    { id: 'auto', label: '自动' },
    { id: 'light', label: '浅色' },
    { id: 'dark', label: '深色' },
  ]
  const langOptions = [
    { id: 'zh', label: '中文' },
    { id: 'en', label: 'English' },
    { id: 'ja', label: '日本語' },
  ]
  const regionOptions = [
    { id: 'cn', label: '中国大陆' },
    { id: 'hk', label: '中国香港' },
    { id: 'us', label: '美国' },
  ]
  const sortOptions = [
    { id: 'name', label: '按名称' },
    { id: 'date', label: '按日期' },
    { id: 'size', label: '按大小' },
  ]

  return (
    <div class="ui-kit-demo__variants">
      {/* 内置 trigger — form */}
      <div class="ui-kit-demo__variant">
        <div class="ui-kit-demo__variant-label">内置 (form)</div>
        <SettingsChoiceField
          label="主题"
          value={theme}
          options={themeOptions}
          onChange={setTheme}
          wideLayout={true}
          presentation="form"
          fieldClass="ui-kit-demo__field"
          labelClass="ui-kit-demo__label"
        />
      </div>

      {/* 内置 trigger — list */}
      <div class="ui-kit-demo__variant">
        <div class="ui-kit-demo__variant-label">内置 (list)</div>
        <SettingsChoiceField
          label="语言"
          value={lang}
          options={langOptions}
          onChange={setLang}
          wideLayout={true}
          presentation="list"
        />
      </div>

      {/* 自定义 trigger — children */}
      <div class="ui-kit-demo__variant">
        <div class="ui-kit-demo__variant-label">自定义 children</div>
        <SettingsChoiceField
          label="地区"
          value={region}
          options={regionOptions}
          onChange={setRegion}
          wideLayout={true}
        >
          {({ open, setOpen, triggerRef, displayValue }) => (
            <button
              ref={triggerRef}
              type="button"
              onClick={() => setOpen(!open)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 12px',
                border: '1px solid #ccc',
                borderRadius: '8px',
                background: '#f9f9f9',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              🌍 {displayValue}
              <span style={{ fontSize: '10px', color: '#999' }}>{open ? '▲' : '▼'}</span>
            </button>
          )}
        </SettingsChoiceField>
      </div>

      {/* 自定义 trigger — dark */}
      <div class="ui-kit-demo__variant">
        <div class="ui-kit-demo__variant-label">自定义 + dark</div>
        <SettingsChoiceField
          label="排序"
          value={sort}
          options={sortOptions}
          onChange={setSort}
          wideLayout={true}
          dark
        >
          {({ open, setOpen, triggerRef, displayValue }) => (
            <button
              ref={triggerRef}
              type="button"
              onClick={() => setOpen(!open)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                border: 'none',
                borderRadius: '6px',
                background: 'linear-gradient(135deg, #5856d6, #7b78ee)',
                color: '#fff',
                fontSize: '12px',
                fontWeight: '500',
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(88, 86, 214, 0.3)',
              }}
            >
              {displayValue}
              <span style={{ fontSize: '10px', opacity: '0.8' }}>{open ? '▲' : '▼'}</span>
            </button>
          )}
        </SettingsChoiceField>
      </div>
    </div>
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
