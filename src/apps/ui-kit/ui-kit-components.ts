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
    description: 'iOS 6 风格 ON/OFF 滑块开关；可单独使用，也可嵌在设置行里',
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
    description: 'iOS 风格复选框；支持 default / small 尺寸与 disabled',
    category: 'form',
    importPath: "import { IosCheckToggle } from '../../ui/ios-check-toggle.tsx'",
    props: [
      { name: 'checked', type: 'boolean', description: '选中状态' },
      { name: 'onChange', type: '(checked: boolean) => void', description: '状态变化回调' },
      { name: 'label', type: 'string', description: '无障碍标签' },
      { name: 'size', type: "'default' | 'small'", description: '尺寸' },
      { name: 'disabled', type: 'boolean?', description: '是否禁用' },
    ],
    codeExample: `<IosCheckToggle
  checked={agreed}
  onChange={setAgreed}
  label="同意条款"
  size="small"
/>`,
  },
  {
    id: 'checkbox',
    name: 'Checkbox',
    description:
      'macOS Aqua 风格方形勾选框；勾选态固定系统蓝，用于窗口弹窗等 Mac 风格界面（如重名冲突的「应用到全部」）',
    category: 'form',
    importPath: "import { Checkbox } from '../../ui/checkbox.tsx'",
    props: [
      { name: 'checked', type: 'boolean', description: '勾选状态' },
      { name: 'onChange', type: '(checked: boolean) => void', description: '状态变化回调' },
      { name: 'label', type: 'string?', description: '可见文字，兼作无障碍标签' },
      { name: 'ariaLabel', type: 'string?', description: '无可见文字时的无障碍标签' },
      { name: 'disabled', type: 'boolean?', description: '是否禁用' },
    ],
    codeExample: `<Checkbox
  checked={applyToAll}
  onChange={setApplyToAll}
  label="应用到全部"
/>`,
  },
  {
    id: 'ios-button',
    name: 'IosButton',
    description:
      'iOS 6 拟物按钮；secondary / primary / danger，支持 compact 与 icon 方形。可在父级覆盖 --ios-button-* CSS 变量换皮（与 IosNavBackButton 相同）',
    category: 'form',
    importPath: "import { IosButton } from '../../ui/ios-button.tsx'",
    props: [
      { name: 'tone', type: "'secondary' | 'primary' | 'danger'", description: '按钮色调，默认 secondary' },
      { name: 'size', type: "'default' | 'compact'", description: '尺寸' },
      { name: 'icon', type: 'boolean?', description: '方形图标按钮' },
      { name: 'disabled', type: 'boolean?', description: '是否禁用' },
      { name: 'type', type: "'button' | 'submit' | 'reset'", description: '原生 button type' },
      { name: 'aria-label', type: 'string?', description: '无障碍标签' },
      { name: 'onClick', type: '() => void', description: '点击回调' },
    ],
    codeExample: `<IosButton tone="primary" onClick={handleSave}>保存</IosButton>
<IosButton size="compact">取消</IosButton>
{/* 父级设置 --ios-button-color / --ios-button-bg 等即可换皮 */}
<div style={{ '--ios-button-color': '#c77400' }}>
  <IosButton size="compact">书城</IosButton>
</div>`,
  },
  {
    id: 'ios-text-field',
    name: 'IosTextField',
    description:
      'iOS 6 内凹文本输入框；属性与原生 input 一致。开启「语音实验室」后可长按空格语音听写',
    category: 'form',
    importPath: "import { IosTextField } from '../../ui/ios-text-field.tsx'",
    props: [
      { name: 'value', type: 'string', description: '输入值' },
      { name: 'placeholder', type: 'string?', description: '占位文案' },
      { name: 'disabled', type: 'boolean?', description: '是否禁用' },
      { name: 'onInput', type: '(event) => void', description: '输入回调' },
      {
        name: 'voiceDictation',
        type: 'boolean?',
        description:
          '长按空格语音听写；undefined 跟随开发者选项「语音实验室」，false 强制关闭',
      },
    ],
    codeExample: `<IosTextField
  value={query}
  placeholder="搜索…"
  onInput={(event) => setQuery(event.currentTarget.value)}
/>
{/* 长按空格说话，松手插入（需开启语音实验室） */}
<IosTextField
  value={query}
  onInput={(event) => setQuery(event.currentTarget.value)}
/>`,
  },
  {
    id: 'ios-range-slider',
    name: 'IosRangeSlider',
    description: 'iOS 风格数值滑块；左侧数字输入，右侧水平拖块，支持刻度点、标签与单位后缀',
    category: 'form',
    importPath: "import { IosRangeSlider, type IosRangeSliderMark } from '../../ui/ios-range-slider.tsx'",
    props: [
      { name: 'value', type: 'number', description: '当前值' },
      { name: 'min', type: 'number', description: '最小值' },
      { name: 'max', type: 'number', description: '最大值' },
      { name: 'step', type: 'number', description: '步进，值会按 step 吸附' },
      { name: 'label', type: 'string?', description: '左侧标签' },
      { name: 'suffix', type: 'string?', description: '数值后缀，如 MB / %' },
      { name: 'disabled', type: 'boolean?', description: '是否禁用' },
      { name: 'marks', type: 'IosRangeSliderMark[]?', description: '刻度点；value 在范围内即可，会被自动吸附到 step' },
      { name: 'onChange', type: '(value: number) => void', description: '值变化回调' },
    ],
    codeExample: `const marks: IosRangeSliderMark[] = [
  { value: 0, label: '0%' },
  { value: 50, label: '50%' },
  { value: 100, label: '100%' },
]

<IosRangeSlider
  value={volume}
  min={0}
  max={100}
  step={1}
  suffix="%"
  marks={marks}
  onChange={setVolume}
/>`,
  },
  {
    id: 'segmented-control',
    name: 'SegmentedControl',
    description: '分段选择器；支持徽章数量与脏状态小橙点',
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
    description: '设置选项字段；form / list 内置触发器，或 children 自定义；支持宽窄屏与 dark',
    category: 'settings',
    importPath: "import { SettingsChoiceField } from '../../ui/settings-choice-field.tsx'",
    props: [
      { name: 'label', type: 'string', description: '字段标签' },
      { name: 'value', type: 'string', description: '当前值' },
      { name: 'options', type: 'SettingsChoiceOption[]', description: '选项列表' },
      { name: 'onChange', type: '(value: string) => void', description: '变化回调' },
      { name: 'wideLayout', type: 'boolean', description: '是否宽屏布局' },
      { name: 'presentation', type: "'form' | 'list'", description: '内置触发器样式' },
      { name: 'dark', type: 'boolean?', description: '深色弹出菜单' },
      { name: 'children', type: '(props: SettingsChoiceTriggerProps) => VNode', description: '自定义 trigger 渲染' },
    ],
    codeExample: `// 内置 form
<SettingsChoiceField
  label="主题" value={theme}
  options={[...]} onChange={setTheme}
  wideLayout presentation="form"
/>

// 自定义 trigger + dark
<SettingsChoiceField
  label="排序" value={sort}
  options={[...]} onChange={setSort}
  wideLayout dark
>
  {({ open, setOpen, triggerRef, displayValue }) => (
    <button ref={triggerRef} onClick={() => setOpen(!open)}>
      {displayValue}
    </button>
  )}
</SettingsChoiceField>`,
  },
  {
    id: 'settings-nav-row',
    name: 'SettingsNavRow',
    description: '设置导航行；右侧值、密钥圆点掩码、禁用态',
    category: 'settings',
    importPath: "import { SettingsNavRow } from '../../ui/settings-nav-row.tsx'",
    props: [
      { name: 'label', type: 'string', description: '左侧标签' },
      { name: 'value', type: 'string', description: '右侧显示值' },
      { name: 'onClick', type: '() => void', description: '点击回调' },
      { name: 'disabled', type: 'boolean?', description: '是否禁用' },
      { name: 'secretLength', type: 'number?', description: '密钥长度；有值时显示圆点掩码' },
    ],
    codeExample: `<SettingsNavRow
  label="账号设置"
  value="user@example.com"
  onClick={() => navigate('account')}
/>

<SettingsNavRow
  label="API Key"
  value=""
  secretLength={24}
  onClick={openSecretEditor}
/>`,
  },
  {
    id: 'settings-switch-row',
    name: 'SettingsSwitchRow',
    description: '设置开关行；标签 + IosSwitch 组合，常成组出现',
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
    id: 'settings-stepper-row',
    name: 'SettingsStepperRow',
    description: '设置数字行；点击弹出模态，在模态内用 [−] / 输入 / [+] 调节',
    category: 'settings',
    importPath: "import { SettingsStepperRow } from '../../ui/settings-stepper-row.tsx'",
    props: [
      { name: 'label', type: 'string', description: '左侧标签' },
      { name: 'value', type: 'number', description: '当前值' },
      { name: 'onChange', type: '(value: number) => void', description: '值变化回调' },
      { name: 'min', type: 'number?', description: '最小值' },
      { name: 'max', type: 'number?', description: '最大值' },
      { name: 'step', type: 'number?', description: '步进，默认 1' },
      { name: 'unit', type: 'string?', description: '单位，显示在右侧当前值旁' },
      { name: 'editable', type: 'boolean?', description: '模态内是否允许直接输入，默认 true' },
      { name: 'disabled', type: 'boolean?', description: '是否禁用' },
    ],
    codeExample: `<SettingsStepperRow
  label="字号"
  value={fontSize}
  min={10}
  max={24}
  onChange={setFontSize}
/>`,
  },
  {
    id: 'settings-check-row',
    name: 'SettingsCheckRow',
    description: '设置勾选行；左侧标签、右侧无边框勾，整行点按切换；禁用态灰底灰字',
    category: 'settings',
    importPath: "import { SettingsCheckRow } from '../../ui/settings-check-row.tsx'",
    props: [
      { name: 'label', type: 'string', description: '标签文本' },
      { name: 'checked', type: 'boolean', description: '选中状态' },
      { name: 'onChange', type: '(checked: boolean) => void', description: '状态变化回调' },
      { name: 'disabled', type: 'boolean?', description: '是否禁用（锁定项）' },
    ],
    codeExample: `<SettingsCheckRow
  label="图像识别"
  checked={supportsVision}
  onChange={setSupportsVision}
/>

<SettingsCheckRow
  label="文本"
  checked
  disabled
  onChange={() => undefined}
/>`,
  },
  {
    id: 'settings-inline-input-row',
    name: 'SettingsInlineInputRow',
    description: '设置内联输入行；文本 / URL / 密码',
    category: 'settings',
    importPath: "import { SettingsInlineInputRow } from '../../ui/settings-inline-input-row.tsx'",
    props: [
      { name: 'label', type: 'string', description: '左侧标签' },
      { name: 'value', type: 'string', description: '输入值' },
      { name: 'onChange', type: '(value: string) => void', description: '变化回调' },
      { name: 'type', type: "'text' | 'password' | 'url'", description: '输入类型' },
      { name: 'placeholder', type: 'string?', description: '占位文案' },
    ],
    codeExample: `<SettingsInlineInputRow
  label="服务地址"
  value={url}
  onChange={setUrl}
  type="url"
  placeholder="https://"
/>`,
  },
  {
    id: 'document-tab-bar',
    name: 'DocumentTabBar',
    description: '文档标签栏；脏状态、关闭动画、拥挤时悬停加宽、minTabsToShow',
    category: 'navigation',
    importPath: "import { DocumentTabBar } from '../../ui/document-tab-bar.tsx'",
    props: [
      { name: 'tabs', type: 'DocumentTabItem[]', description: '标签列表' },
      { name: 'activeTabId', type: 'string | undefined', description: '当前激活标签' },
      { name: 'onActivate', type: '(tabId: string) => void', description: '激活回调' },
      { name: 'onClose', type: '(tabId: string) => void', description: '关闭回调' },
      { name: 'minTabsToShow', type: 'number?', description: '低于此数量时隐藏标签栏，默认 2' },
    ],
    codeExample: `<DocumentTabBar
  tabs={openFiles}
  activeTabId={currentFile}
  onActivate={openFile}
  onClose={closeFile}
  minTabsToShow={2}
/>`,
  },
  {
    id: 'adaptive-action-menu',
    name: 'AdaptiveActionMenu',
    description: '自适应操作菜单；宽屏下拉，窄屏底部面板',
    category: 'navigation',
    importPath: "import { AdaptiveActionMenu } from '../../ui/adaptive-action-menu.tsx'",
    props: [
      { name: 'open', type: 'boolean', description: '是否打开' },
      { name: 'title', type: 'string', description: '菜单标题' },
      { name: 'items', type: 'AdaptiveActionMenuItem[]', description: '菜单项列表' },
      { name: 'narrowLayout', type: 'boolean', description: '是否窄屏布局' },
      { name: 'onClose', type: '() => void', description: '关闭回调' },
      { name: 'mount', type: "'contained' | 'portal'", description: '挂载方式' },
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
    id: 'ios-nav-back-button',
    name: 'IosNavBackButton',
    description: 'iOS 风格返回按钮；用于子页标题栏',
    category: 'navigation',
    importPath: "import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'",
    props: [
      { name: 'label', type: 'string', description: '返回目标名称' },
      { name: 'onClick', type: '(event) => void', description: '点击回调' },
      { name: 'disabled', type: 'boolean?', description: '是否禁用' },
      { name: 'iconSize', type: 'number?', description: '箭头图标尺寸，默认 13' },
    ],
    codeExample: `<IosNavBackButton
  label="设置"
  onClick={() => navigateBack()}
/>`,
  },
  {
    id: 'tree-view',
    name: 'TreeView',
    description: '通用折叠树：递归子级、展开/折叠带滑出/滑入动画、单选高亮；行内容经 renderNode 注入。支持双击展开/收起与键盘导航（↑/↓ 选中、→/← 展开收起、Home/End/Enter）',
    category: 'navigation',
    importPath: "import { TreeView } from '../../ui/tree-view.tsx'",
    props: [
      { name: 'nodes', type: 'readonly T[]', description: '多根节点列表（T 需含 id 与 children）' },
      { name: 'defaultExpandedIds', type: 'Iterable<string>?', description: '初始展开的节点 id 集合' },
      { name: 'selectedId', type: 'string?', description: '受控选中节点 id' },
      { name: 'onSelect', type: '(node: T) => void?', description: '行点击回调' },
      { name: 'onExpandedChange', type: '(node: T, expanded: boolean) => void?', description: '展开/折叠变化回调（供懒加载）' },
      { name: 'renderNode', type: '(node: T, ctx: TreeViewRowContext<T>) => ComponentChildren', description: '渲染行业务内容（图标/标签/附加列）' },
      { name: 'indent', type: 'number?', description: '每级缩进像素，默认 28' },
      { name: 'className', type: 'string?', description: '透传到容器（宿主滚动/尺寸样式）' },
      { name: 'ariaLabel', type: 'string?', description: '容器无障碍标签' },
    ],
    codeExample: `<TreeView
  nodes={folders}
  defaultExpandedIds={['docs']}
  selectedId={selectedId}
  onSelect={(node) => setSelectedId(node.id)}
  renderNode={(node, ctx) => (
    <>
      <span class="ui-kit-demo__tree-label">{node.label}</span>
      <span class="ui-kit-demo__tree-size">{formatStorageSize(node.size)}</span>
    </>
  )}
/>`,
  },
  {
    id: 'emoji-picker-popover',
    name: 'EmojiPickerPopover',
    description: '表情选择弹出层；默认触发器或自定义 children 内容',
    category: 'picker',
    importPath: "import { EmojiPickerPopover } from '../../ui/emoji-picker-popover.tsx'",
    props: [
      { name: 'value', type: 'string', description: '当前表情' },
      { name: 'onChange', type: '(emoji: string) => void', description: '选择回调' },
      { name: 'triggerLabel', type: 'string?', description: '默认触发器文案' },
      { name: 'children', type: 'ComponentChildren?', description: '自定义触发器内容' },
      { name: 'disabled', type: 'boolean?', description: '是否禁用' },
    ],
    codeExample: `<EmojiPickerPopover
  value={emoji}
  onChange={setEmoji}
  triggerLabel="选择图标"
/>`,
  },
  {
    id: 'ai-model-capability-tags',
    name: 'AiModelCapabilityTags',
    description: 'AI 模型能力标签；视觉能力可切换编辑',
    category: 'other',
    importPath: "import { AiModelCapabilityTags } from '../../ui/ai-model-capability-tags.tsx'",
    props: [
      { name: 'capabilities', type: 'readonly AiModelCapability[]', description: '已启用能力' },
      { name: 'visionEditable', type: 'boolean?', description: '是否允许切换视觉能力' },
      { name: 'onVisionChange', type: '(supportsVision: boolean) => void?', description: '视觉能力变化回调' },
    ],
    codeExample: `<AiModelCapabilityTags
  capabilities={['text', 'vision']}
  visionEditable
  onVisionChange={setSupportsVision}
/>`,
  },
  {
    id: 'popover',
    name: 'Popover',
    description:
      '通用锚定气泡；箭头自动跟随锚点，靠近视口底部向上翻、超出视口夹紧；宿主窗口宽 ≤520px 时自动退化为居中模态对话框（「好」按钮关闭）',
    category: 'other',
    importPath: "import { Popover } from '../../ui/popover.tsx'",
    props: [
      { name: 'open', type: 'boolean', description: '是否打开' },
      { name: 'anchorRef', type: 'RefObject<HTMLElement>', description: '锚点元素；箭头指向它，窄屏判定也以它所在的窗口为准' },
      { name: 'onClose', type: '() => void', description: '关闭回调（外部点按 / Esc / 窄屏按钮）' },
      { name: 'children', type: 'ComponentChildren', description: '气泡内容' },
      { name: 'ariaLabel', type: 'string?', description: '无障碍标签' },
      { name: 'dismissLabel', type: 'string?', description: '窄屏模态关闭按钮文案，默认「好」' },
    ],
    codeExample: `const [open, setOpen] = useState(false)
const buttonRef = useRef(null)

<button ref={buttonRef} onClick={() => setOpen(!open)}>说明</button>
<Popover open={open} anchorRef={buttonRef} onClose={() => setOpen(false)}>
  这里是帮助说明文字。
</Popover>`,
  },
  {
    id: 'help-hint',
    name: 'HelpHint',
    description:
      '帮助提示按钮；SVG 矢量「？」圆形按钮，点按经 Popover 弹出说明气泡（带指向箭头；宿主窗口很窄时变居中模态）',
    category: 'other',
    importPath: "import { HelpHint } from '../../ui/help-hint.tsx'",
    props: [
      { name: 'text', type: 'string', description: '说明内容，展示在弹出气泡里' },
      { name: 'label', type: 'string?', description: '无障碍标签，缺省用「说明」' },
    ],
    codeExample: `<HelpHint
  text="开启后尽量以稀疏分块存储：缺席的全零块不落库，写入全零自动打洞"
  label="机会压缩说明"
/>`,
  },
  {
    id: 'window-modal',
    name: 'WindowModal',
    description: '窗口模态对话框；primary / secondary / danger 按钮，支持 wide / scrollBody、标题对齐、副标题与关闭钮',
    category: 'window',
    importPath: "import { WindowModal } from '../../window/window-modal.tsx'",
    props: [
      { name: 'open', type: 'boolean', description: '是否打开' },
      { name: 'title', type: 'string', description: '对话框标题' },
      { name: 'subtitle', type: 'string?', description: '主标题下方的辅助说明' },
      { name: 'titleAlign', type: "'center' | 'left'?", description: '标题对齐方式，默认居中' },
      { name: 'showCloseButton', type: 'boolean?', description: '在标题栏右上角显示关闭按钮' },
      { name: 'onClose', type: '() => void', description: '关闭回调' },
      { name: 'actions', type: 'WindowModalAction[]?', description: '操作按钮列表' },
      { name: 'headerActions', type: 'WindowModalAction[]?', description: '标题栏右侧操作按钮' },
      { name: 'wide', type: 'boolean?', description: '宽对话框' },
      { name: 'scrollBody', type: 'boolean?', description: '内容区可滚动' },
      { name: 'children', type: 'ComponentChildren', description: '内容区域' },
    ],
    codeExample: `<WindowModal
  open={dialogOpen}
  title="历史记录"
  subtitle="72 个页面"
  titleAlign="left"
  showCloseButton
  onClose={handleClose}
  actions={[
    { label: '清空历史记录', tone: 'danger', onClick: handleClear }
  ]}
>
  <p>内容区域</p>
</WindowModal>`,
  },
]

export const COMPONENT_CATEGORIES = [
  { id: 'form', name: '表单控件' },
  { id: 'settings', name: '设置组件' },
  { id: 'navigation', name: '导航交互' },
  { id: 'picker', name: '选择器' },
  { id: 'other', name: '其他' },
  { id: 'window', name: '窗口系统' },
] as const
