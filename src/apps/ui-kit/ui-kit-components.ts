export type ComponentProp = {
  name: string
  type: string
  description: string
}

export type ComponentDemo = {
  id: string
  name: string
  description: string
  category: 'form' | 'settings' | 'navigation' | 'picker' | 'other' | 'window'
  importPath: string
  props: ComponentProp[]
  codeExample: string
}

export const UI_COMPONENTS: ComponentDemo[] = [
  {
    id: 'ios-switch',
    name: 'IosSwitch',
    description: 'iOS 6 风格 ON/OFF 滑块开关',
    category: 'form',
    importPath: "import { IosSwitch } from '../../ui/ios-switch.tsx'",
    props: [
      { name: 'checked', type: 'boolean', description: '开关状态' },
      { name: 'onChange', type: '(checked: boolean) => void', description: '状态变化回调' },
      { name: 'label', type: 'string', description: '无障碍标签' },
    ],
    codeExample: `<IosSwitch
  checked={enabled}
  onChange={setEnabled}
  label="启用功能"
/>`,
  },
  {
    id: 'ios-check-toggle',
    name: 'IosCheckToggle',
    description: 'iOS 风格复选框切换',
    category: 'form',
    importPath: "import { IosCheckToggle } from '../../ui/ios-check-toggle.tsx'",
    props: [
      { name: 'checked', type: 'boolean', description: '选中状态' },
      { name: 'onChange', type: '(checked: boolean) => void', description: '状态变化回调' },
      { name: 'label', type: 'string', description: '显示标签' },
    ],
    codeExample: `<IosCheckToggle
  checked={agreed}
  onChange={setAgreed}
  label="同意条款"
/>`,
  },
  {
    id: 'segmented-control',
    name: 'SegmentedControl',
    description: '分段选择器，支持徽章和脏状态指示',
    category: 'form',
    importPath: "import { SegmentedControl } from '../../ui/segmented-control.tsx'",
    props: [
      { name: 'value', type: 'string', description: '当前选中值' },
      { name: 'items', type: 'SegmentedControlItem[]', description: '选项列表' },
      { name: 'onChange', type: '(id: string) => void', description: '选择变化回调' },
      { name: 'ariaLabel', type: 'string', description: '无障碍标签' },
    ],
    codeExample: `<SegmentedControl
  value={tab}
  items={[
    { id: 'all', label: '全部', badge: 5 },
    { id: 'unread', label: '未读', dirty: true }
  ]}
  onChange={setTab}
  ariaLabel="消息分类"
/>`,
  },
  {
    id: 'settings-choice-field',
    name: 'SettingsChoiceField',
    description: '设置选项字段，宽窄屏自适应',
    category: 'settings',
    importPath: "import { SettingsChoiceField } from '../../ui/settings-choice-field.tsx'",
    props: [
      { name: 'label', type: 'string', description: '字段标签' },
      { name: 'value', type: 'string', description: '当前值' },
      { name: 'options', type: 'SettingsChoiceOption[]', description: '选项列表' },
      { name: 'onChange', type: '(value: string) => void', description: '变化回调' },
      { name: 'wideLayout', type: 'boolean', description: '是否宽屏布局' },
    ],
    codeExample: `<SettingsChoiceField
  label="主题"
  value={theme}
  options={[
    { id: 'auto', label: '自动' },
    { id: 'light', label: '浅色' },
    { id: 'dark', label: '深色' }
  ]}
  onChange={setTheme}
  wideLayout={wide}
/>`,
  },
  {
    id: 'settings-nav-row',
    name: 'SettingsNavRow',
    description: '设置导航行，带右侧值和箭头',
    category: 'settings',
    importPath: "import { SettingsNavRow } from '../../ui/settings-nav-row.tsx'",
    props: [
      { name: 'label', type: 'string', description: '左侧标签' },
      { name: 'value', type: 'string', description: '右侧显示值' },
      { name: 'onClick', type: '() => void', description: '点击回调' },
      { name: 'disabled', type: 'boolean?', description: '是否禁用' },
    ],
    codeExample: `<SettingsNavRow
  label="账号设置"
  value="user@example.com"
  onClick={() => navigate('account')}
/>`,
  },
  {
    id: 'settings-switch-row',
    name: 'SettingsSwitchRow',
    description: '设置开关行，集成标签和开关',
    category: 'settings',
    importPath: "import { SettingsSwitchRow } from '../../ui/settings-switch-row.tsx'",
    props: [
      { name: 'label', type: 'string', description: '标签文本' },
      { name: 'checked', type: 'boolean', description: '开关状态' },
      { name: 'onChange', type: '(checked: boolean) => void', description: '状态变化回调' },
    ],
    codeExample: `<SettingsSwitchRow
  label="启用通知"
  checked={notificationsEnabled}
  onChange={setNotificationsEnabled}
/>`,
  },
  {
    id: 'document-tab-bar',
    name: 'DocumentTabBar',
    description: '文档标签栏，支持拖拽和关闭动画',
    category: 'navigation',
    importPath: "import { DocumentTabBar } from '../../ui/document-tab-bar.tsx'",
    props: [
      { name: 'tabs', type: 'DocumentTabItem[]', description: '标签列表' },
      { name: 'activeTabId', type: 'string | undefined', description: '当前激活标签' },
      { name: 'onActivate', type: '(tabId: string) => void', description: '激活回调' },
      { name: 'onClose', type: '(tabId: string) => void', description: '关闭回调' },
    ],
    codeExample: `<DocumentTabBar
  tabs={openFiles}
  activeTabId={currentFile}
  onActivate={openFile}
  onClose={closeFile}
/>`,
  },
  {
    id: 'adaptive-action-menu',
    name: 'AdaptiveActionMenu',
    description: '自适应操作菜单，宽屏显示下拉，窄屏显示底部面板',
    category: 'navigation',
    importPath: "import { AdaptiveActionMenu } from '../../ui/adaptive-action-menu.tsx'",
    props: [
      { name: 'open', type: 'boolean', description: '是否打开' },
      { name: 'title', type: 'string', description: '菜单标题' },
      { name: 'items', type: 'AdaptiveActionMenuItem[]', description: '菜单项列表' },
      { name: 'narrowLayout', type: 'boolean', description: '是否窄屏布局' },
      { name: 'onClose', type: '() => void', description: '关闭回调' },
    ],
    codeExample: `<AdaptiveActionMenu
  open={menuOpen}
  title="操作"
  items={[
    { type: 'action', label: '删除', onClick: handleDelete }
  ]}
  narrowLayout={narrow}
  onClose={() => setMenuOpen(false)}
/>`,
  },
  {
    id: 'window-modal',
    name: 'WindowModal',
    description: '窗口模态对话框，带标题、内容和操作按钮',
    category: 'window',
    importPath: "import { WindowModal } from '../../window/window-modal.tsx'",
    props: [
      { name: 'open', type: 'boolean', description: '是否打开' },
      { name: 'title', type: 'string', description: '对话框标题' },
      { name: 'onClose', type: '() => void', description: '关闭回调' },
      { name: 'actions', type: 'WindowModalAction[]?', description: '操作按钮列表' },
      { name: 'children', type: 'ComponentChildren', description: '内容区域' },
    ],
    codeExample: `<WindowModal
  open={dialogOpen}
  title="确认操作"
  onClose={handleClose}
  actions={[
    { label: '取消', onClick: handleClose },
    { label: '确认', tone: 'primary', onClick: handleConfirm }
  ]}
>
  <p>确定要执行此操作吗？</p>
</WindowModal>`,
  },
]

export const COMPONENT_CATEGORIES = [
  { id: 'form', name: '表单控件' },
  { id: 'settings', name: '设置组件' },
  { id: 'navigation', name: '导航交互' },
  { id: 'window', name: '窗口系统' },
] as const
