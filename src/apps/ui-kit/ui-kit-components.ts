export type ComponentProp = {
  name: string
  type: string
  description: string
}

export type ComponentDemo = {
  id: string
  name: string
  description: string
  category: 'list-showcase' | 'form' | 'icons' | 'settings' | 'navigation' | 'tree' | 'picker' | 'other' | 'window'
  /** 卡片占满整行（grid-column: 1 / -1），给 Icon 图标库这种宽内容用 */
  wide?: boolean
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
    id: 'button',
    name: 'Button',
    description:
      'iOS 6 拟物按钮；secondary / primary / danger，支持 compact；icon 属性接收前导图标内容（元素或字符），仅图标无文字时自动渲染为方形图标按钮。可在父级覆盖 --ios-button-* CSS 变量换皮（与 IosNavBackButton 相同）',
    category: 'form',
    importPath: "import { Button } from '../../ui/button.tsx'",
    props: [
      { name: 'tone', type: "'secondary' | 'primary' | 'danger'", description: '按钮色调，默认 secondary' },
      { name: 'size', type: "'default' | 'compact'", description: '尺寸' },
      { name: 'icon', type: 'ComponentChildren?', description: '前导图标内容；仅图标无文字时自动渲染为方形图标按钮' },
      { name: 'disabled', type: 'boolean?', description: '是否禁用' },
      { name: 'type', type: "'button' | 'submit' | 'reset'", description: '原生 button type' },
      { name: 'aria-label', type: 'string?', description: '无障碍标签' },
      { name: 'onClick', type: '() => void', description: '点击回调' },
    ],
    codeExample: `<Button tone="primary" onClick={handleSave}>保存</Button>
<Button size="compact">取消</Button>
{/* 父级设置 --ios-button-color / --ios-button-bg 等即可换皮 */}
<div style={{ '--ios-button-color': '#c77400' }}>
  <Button size="compact">书城</Button>
</div>`,
  },
  {
    id: 'page-button-group',
    name: 'Button Group',
    description:
      '页头按钮组：PageButtonGroup 内放 PageActionButton 成组使用，空间不足自动三级解压——先收边距、再收间距、最后把文字连续压扁，任何宽度都不折行（解压机制只识别 PageActionButton）',
    category: 'form',
    importPath:
      "import { PageButtonGroup } from '../../ui/page-button-group.tsx'\nimport { PageActionButton } from '../../ui/page-action-button.tsx'",
    props: [
      { name: 'children', type: 'ComponentChildren', description: 'PageButtonGroup：组内放置 PageActionButton' },
      { name: 'tone', type: "'plain' | 'default' | 'danger'", description: 'PageActionButton 色调，默认 plain' },
      { name: 'activated', type: 'boolean?', description: '持久选中态（如「已收藏」），蓝底白字' },
      { name: 'icon', type: 'ComponentChildren?', description: '传入则为方形图标按钮（配 aria-label）' },
      { name: 'disabled', type: 'boolean?', description: '是否禁用' },
      { name: 'busy', type: 'boolean?', description: '提交中：文字前显示转圈' },
      { name: 'aria-label', type: 'string?', description: '无障碍标签' },
      { name: 'onClick', type: '() => void', description: '点击回调' },
    ],
    codeExample: `<PageButtonGroup>
  <PageActionButton activated={isFav} onClick={toggleFav}>收藏</PageActionButton>
  <PageActionButton>标记已读</PageActionButton>
  <PageActionButton tone="danger">删除</PageActionButton>
</PageButtonGroup>`,
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
    description: '分段选择器；支持徽章数量与脏状态小橙点。分段最小宽度随自身文字，富余空间才均分，容器放不下时整条让位换行，不出省略号',
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
    id: 'list',
    name: 'List',
    description:
      '设置风格分组列表容器；行内容放 ListItem，支持节标题/脚注、表头滚动区、A-Z 索引条与 iOS 6 编辑模式（减号删除 + 把手排序）；scrollable 滚动体内分节标题 sticky 悬停（滚到顶钉住、被下一节顶走）；样式完全自有（--list-* token），行 hover 蓝渐变反白（编辑模式暂停）',
    category: 'list-showcase',
    importPath: "import { List, ListSection } from '../../ui/list.tsx'",
    props: [
      { name: 'children', type: 'ComponentChildren', description: '列表行（ListItem / ListSection / 行组件）' },
      { name: 'class', type: 'string?', description: '追加到容器的修饰类' },
      { name: 'title', type: 'ComponentChildren?', description: '节标题（盒子外上方）' },
      { name: 'footnote', type: 'ComponentChildren?', description: '节脚注（盒子外下方）' },
      { name: 'head', type: 'ComponentChildren?', description: '表头单元格（span 序列），有值时渲染表头行' },
      { name: 'headClass', type: 'string?', description: '追加到表头的附加类' },
      { name: 'scrollable', type: 'boolean?', description: 'children 包进限高滚动区（max-height 280 + overflow auto）' },
      { name: 'bodyClass', type: 'string?', description: '追加到滚动体的附加类；配合 scrollable 使用' },
      { name: 'indexBar', type: 'boolean?', description: '右缘 A-Z 索引条；自动收集子级 ListSection，点击/沿条拖动跳节；放不下时等分压缩、显示层隔位采样。排序契约：组件不排序，节的条上标签须沿列表非降序——数据侧用 groupByIndexLetter 分组排序，dev 下逆序告警' },
      { name: 'editing', type: 'boolean?', description: '编辑模式：行出现减号删除钮与拖拽排序把手' },
      { name: 'selectedId', type: 'string?', description: '受控单选：配合 ListItem 的 id' },
      { name: 'onSelect', type: '(id: string) => void?', description: 'ListItem 点击上报选中' },
      { name: 'onDelete', type: '(id: string) => void?', description: '编辑模式：确认删除某行' },
      { name: 'onReorder', type: '(fromId: string, toId: string) => void?', description: '编辑模式：拖拽重排落定' },
    ],
    codeExample: `<List
  title="通用"
  footnote="重置网络设置将清除已保存的 Wi-Fi 密码。"
  indexBar
  editing={editing}
  onDelete={(id) => remove(id)}
  onReorder={(from, to) => reorder(from, to)}
>
  <ListSection id="A" title="A">
    <ListItem id="a1" label="阿福" accessory="disclosure" />
  </ListSection>
</List>`,
  },
  {
    id: 'list-item',
    name: 'ListItem',
    description:
      'List 的组合行（AntD List.Item 风格）：label/subtitle/leading/value/extra/control 槽位自由拼装；accessory 配件（箭头/选中勾/蓝 ⓘ）；带 id 即与 List 受控单选、编辑模式结合',
    category: 'list-showcase',
    importPath: "import { ListItem } from '../../ui/list-item.tsx'",
    props: [
      { name: 'id', type: 'string?', description: '稳定 id：参与 List 受控单选与编辑模式' },
      { name: 'label', type: 'ComponentChildren?', description: '左侧主标题' },
      { name: 'subtitle', type: 'ComponentChildren?', description: '灰色第二行副标题' },
      { name: 'leading', type: 'ComponentChildren?', description: '左侧图标/头像位' },
      { name: 'value', type: 'ComponentChildren?', description: '右侧值文本（与 extra 二选一）' },
      { name: 'extra', type: 'ComponentChildren?', description: '右侧自定义内容（与 value 二选一）' },
      { name: 'control', type: 'ComponentChildren?', description: '控件槽（IosSwitch 等）；点击不触发行选中' },
      { name: 'accessory', type: "'none' | 'disclosure' | 'check' | 'detail'?", description: '右侧配件；check 跟随选中态' },
      { name: 'badge', type: 'string?', description: '名称旁徽章文本' },
      { name: 'selected', type: 'boolean?', description: '强制选中态；缺省由 List selectedId + id 推导' },
      { name: 'disabled', type: 'boolean?', description: '禁用' },
      { name: 'onClick', type: '() => void?', description: '有则渲染为 button，否则渲染为 div' },
    ],
    codeExample: `// 展示行 + 副标题 + ⓘ
<ListItem label="iCloud 云盘" subtitle="跨设备同步文档" value="已开启" accessory="detail" />

// 与 List 受控单选结合：点击自动上报、勾随选中
<List selectedId={id} onSelect={setId}>
  <ListItem id="a" label="iCloud" accessory="check" />
  <ListItem id="b" label="Exchange" accessory="check" />
</List>

// 控件槽：开关行
<ListItem label="Wi-Fi" control={<IosSwitch checked={on} onChange={setOn} label="Wi-Fi" />} />`,
  },
  {
    id: 'list-selection',
    name: 'List 受控单选',
    description: 'List 给 selectedId/onSelect，ListItem 带 id 即结合：点击自动上报、蓝底高亮、accessory 勾随选中',
    category: 'list-showcase',
    importPath: "import { List } from '../../ui/list.tsx'\nimport { ListItem } from '../../ui/list-item.tsx'",
    props: [
      { name: 'selectedId', type: 'string?', description: 'List 受控选中的行 id' },
      { name: 'onSelect', type: '(id: string) => void?', description: '行点击上报' },
      { name: 'id', type: 'string?', description: 'ListItem 的稳定 id' },
      { name: 'accessory', type: "'check'?", description: '勾随选中态出现' },
    ],
    codeExample: `const [id, setId] = useState('icloud')

<List selectedId={id} onSelect={setId}>
  <ListItem id="icloud" label="iCloud" value="john@example.com" accessory="check" />
  <ListItem id="gmail" label="Gmail" value="john@gmail.com" accessory="check" />
</List>`,
  },
  {
    id: 'list-controls',
    name: 'List 控件行',
    description: 'ListItem 的 control 槽放 IosSwitch / IosTextField（点控件不触发行）；纯勾选行用整行点按切换',
    category: 'list-showcase',
    importPath: "import { ListItem } from '../../ui/list-item.tsx'",
    props: [
      { name: 'control', type: 'ComponentChildren?', description: '控件槽；点击不冒泡到行' },
      { name: 'value', type: 'ComponentChildren?', description: '右侧值文本' },
      { name: 'selected', type: 'boolean?', description: '强制选中态（配合 accessory="check"）' },
      { name: 'onClick', type: '() => void?', description: '整行点按（如勾选切换）' },
    ],
    codeExample: `<ListItem label="Wi-Fi" control={<IosSwitch checked={on} onChange={setOn} label="Wi-Fi" />} />
<ListItem label="自动下载" selected={auto} accessory="check" onClick={() => setAuto(!auto)} />`,
  },
  {
    id: 'list-index',
    name: 'List A-Z 索引条',
    description: 'ListSection 出分组，List 的 indexBar 出右缘字母条——条上文字由节标题自动派生（拼音/字母首字母，词组标题也只占一槽），点字母或沿条拖动跳节；槽位放不下时隔位采样（触点按全节等比映射，显示与触点不同步）。排序契约：组件不排序，启用即承诺节标签沿列表非降序（数据侧用 groupByIndexLetter 归组排序，dev 下逆序告警）',
    category: 'list-showcase',
    importPath: "import { List, ListSection } from '../../ui/list.tsx'\nimport { groupByIndexLetter } from '../../ui/list-index.ts'",
    props: [
      { name: 'indexBar', type: 'boolean?', description: '渲染右缘字母条；条上文字自动派生自 ListSection 的 title；槽位放不下完整字母时隔位采样稀疏显示' },
      { name: 'id', type: 'string', description: 'ListSection 的跳转锚点，须唯一；不出现在索引条上' },
      { name: 'title', type: 'string', description: 'ListSection 的节标题（可为词组）；条上文字缺省由它派生（水果类→S）' },
      { name: 'indexLabel', type: 'string?', description: 'ListSection 的条上文字显式覆盖；派生不准（冷僻姓氏/词典外词）时用它兜底' },
      { name: 'scrollable', type: 'boolean?', description: 'children 包进限高滚动区，索引跳转需要滚动容器' },
    ],
    codeExample: `// 平铺名单自动归组排序（A-Z 升序、# 沉底、组内按全拼）；姓氏模式修多音姓
const groups = groupByIndexLetter(names, (name) => name, { surname: true })

<List indexBar scrollable>
  {groups.map((g) => (
    <ListSection key={g.label} id={g.label} title={g.label}>
      {g.items.map((name) => (
        <ListItem key={name} label={name} accessory="disclosure" />
      ))}
    </ListSection>
  ))}
</List>

// 词组节标题：条上自动派生首字母；indexLabel 可显式覆盖
<ListSection id="fruit" title="水果类" />
<ListSection id="veg" title="蔬菜类" indexLabel="蔬" />`,
  },
  {
    id: 'list-editing',
    name: 'List 编辑模式',
    description: 'editing 进编辑态：减号/把手淡入、行内容两侧平滑内收，点减号红删除钮滑入滑出，拖右缘把手重排（拖动行浮起、其余让位），onDelete/onReorder 落数据',
    category: 'list-showcase',
    importPath: "import { List } from '../../ui/list.tsx'",
    props: [
      { name: 'editing', type: 'boolean?', description: '是否处于编辑态' },
      { name: 'onDelete', type: '(id: string) => void?', description: '确认删除某行' },
      { name: 'onReorder', type: '(fromId: string, toId: string) => void?', description: '拖拽重排落定' },
    ],
    codeExample: `const [editing, setEditing] = useState(false)

<Button onClick={() => setEditing(!editing)}>{editing ? '完成' : '编辑'}</Button>
<List class={tokens} editing={editing}
  onDelete={(id) => remove(id)}
  onReorder={(from, to) => reorder(from, to)}
>
  {items.map((it) => <ListItem key={it.id} id={it.id} label={it.label} value={it.qty} />)}
</List>`,
  },
  {
    id: 'adaptive-split-nav',
    name: 'AdaptiveSplitNav',
    description: '自适应分栏导航：宽屏「列表 + 帧栈」分栏、窄屏自动回子页栈，宽窄切换以刚性面板滑轨形变交接。分栏宽度 ≤640 时进入紧凑档（左右固定 50/50，listRatio 不参与），≥700 恢复比例。布局原语需整应用承载——点 Demo 里的按钮打开「导航组件演示」',
    category: 'navigation',
    importPath: "import { AdaptiveSplitNav, useAdaptiveSplitNav } from '../../ui/adaptive-split-nav.tsx'",
    props: [
      { name: 'controller', type: 'AdaptiveSplitNavController', description: 'useAdaptiveSplitNav() 返回的控制器' },
      { name: 'renderNarrowPage', type: '(page: string) => ComponentChildren', description: '窄屏子页栈页面渲染' },
      { name: 'renderWideFrames', type: '() => AdaptiveFrameSpec[]', description: '分栏右栏帧序列（从领域状态派生，末位最上）' },
      { name: 'framesResetKey', type: 'string?', description: '帧栈全量重置键（选中条目身份切换时整体替换）' },
      { name: 'narrowPageForState', type: '() => string', description: 'useAdaptiveSplitNav：由领域状态推导当前子页 id' },
      { name: 'listPage', type: 'string?', description: 'useAdaptiveSplitNav：分栏左栏根列表页 id' },
      { name: 'frameAnimationMs', type: 'number?', description: '形变/帧动画时长，默认 380' },
    ],
    codeExample: `const nav = useAdaptiveSplitNav({
  // 由领域状态推导窄屏应处的子页 id
  narrowPageForState: () => posPageId(pos),
  split: true,
  // 分栏左栏显示的根列表页
  listPage: ROOT,
})

<AdaptiveSplitNav
  controller={nav}
  renderNarrowPage={renderNarrowPage}
  renderWideFrames={renderWideFrames}
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
    description: '通用折叠树：递归子级、展开/折叠带滑出/滑入动画、增删行带高度展开/收起动画、单选高亮；行内容经 renderNode 注入。支持双击展开/收起与键盘导航（↑/↓ 选中、→/← 展开收起、Home/End/Enter）',
    category: 'navigation',
    importPath: "import { TreeView } from '../../ui/tree-view.tsx'",
    props: [
      { name: 'nodes', type: 'readonly T[]', description: '多根节点列表（T 需含 id 与 children）' },
      { name: 'defaultExpandedIds', type: 'Iterable<string>?', description: '初始展开的节点 id 集合' },
      { name: 'selectedId', type: 'string?', description: '受控选中节点 id' },
      { name: 'removalSelection', type: `'none' | 'prefer-previous' | 'prefer-next'?`, description: '选中节点被移除后的自动补选：none 不自动选中（默认）；prefer-previous / prefer-next 按「上一轮可见序」优先向前 / 向后选相邻幸存行，一侧到底后反向兜底，经 onSelect 通知宿主' },
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
    id: 'tree-view-interactive',
    name: 'TreeView 增删动效',
    description:
      'TreeView 动态增删演示：可在选中行上方/下方插入兄弟节点、插入为选中项子级，或删除选中行——插入带高度展开 + 淡入、删除带高度收起 + 淡出，与展开/折叠动画同一套视觉语言；删除选中行后按 removalSelection 自动补选相邻行（优先向前/向后，反向兜底）。增删均由数据驱动（派生新 nodes 数组），TreeView 内部 diff 触发对应行动画。',
    category: 'tree',
    importPath: "import { TreeView } from '../../ui/tree-view.tsx'",
    props: [
      { name: 'nodes', type: 'readonly T[]', description: '多根节点列表；增删即传派生新数组，行动画由 TreeView 内部 diff 触发' },
      { name: 'selectedId', type: 'string?', description: '受控选中节点 id（「上方/下方插入、删除选中」都基于它）' },
      { name: 'removalSelection', type: `'none' | 'prefer-previous' | 'prefer-next'?`, description: '删除选中行后的补选策略：默认不自动选中；prefer-previous / prefer-next 优先选上一行 / 下一行（可见序），另一侧兜底' },
      { name: 'onSelect', type: '(node: T) => void?', description: '行点击回调，更新选中态；补选结果也经它回流宿主' },
      { name: 'defaultExpandedIds', type: 'Iterable<string>?', description: '初始展开的节点 id 集合' },
      { name: 'renderNode', type: '(node: T, ctx: TreeViewRowContext<T>) => ComponentChildren', description: '渲染行业务内容（图标/标签/附加列）' },
    ],
    codeExample: `const insertAbove = () => {
  const node = { id: \`new-\${++seq.current}\`, label: \`新项目 \${seq.current}\` }
  setNodes((prev) => insertSibling(prev, selectedId, node, -1)) // 选中行上方插入兄弟
  setSelectedId(node.id)
}

const insertBelow = () => {
  const node = { id: \`new-\${++seq.current}\`, label: \`新项目 \${seq.current}\` }
  setNodes((prev) => insertSibling(prev, selectedId, node, 1)) // 选中行下方插入兄弟
  setSelectedId(node.id)
}

const deleteSelected = () => {
  if (!selectedId) return
  // 只删数据；补选相邻行由 TreeView 的 removalSelection 负责，经 onSelect 回流
  setNodes((prev) => removeNode(prev, selectedId))
}

return (
  <TreeView
    nodes={nodes}
    selectedId={selectedId}
    removalSelection="prefer-next"
    onSelect={(node) => setSelectedId(node.id)}
    renderNode={(node) => <span class="ui-kit-demo__tree-label">{node.label}</span>}
  />
)`,
  },
  {
    id: 'tree-view-lazy-load',
    name: 'TreeView 异步加载',
    description:
      '懒加载演示：展开带 lazy 标记的分支先注入「加载中…」行（进场动画）占位，模拟异步返回后整批替换为真实子级（再次触发进场动画）；展开/折叠状态由 TreeView 内部管理，onExpandedChange 只负责取数，无需受控 expandedIds。',
    category: 'tree',
    importPath: "import { TreeView } from '../../ui/tree-view.tsx'",
    props: [
      { name: 'nodes', type: 'readonly T[]', description: '多根节点列表；子级为空且带 lazy 标记的分支展开时触发加载' },
      { name: 'onExpandedChange', type: '(node: T, expanded: boolean) => void?', description: '展开/折叠回调——懒加载在这里注入「加载中…」行并在异步返回后替换为真实子级' },
      { name: 'selectedId', type: 'string?', description: '受控选中节点 id' },
      { name: 'onSelect', type: '(node: T) => void?', description: '行点击回调' },
      { name: 'renderNode', type: '(node: T, ctx: TreeViewRowContext<T>) => ComponentChildren', description: '渲染行业务内容；「加载中…」行可按 id 前缀特判' },
    ],
    codeExample: `const handleExpandedChange = (node: DemoTreeNode, expanded: boolean) => {
  if (!expanded || node.lazy !== true || node.children?.length) return
  setNodes((prev) => setChildren(prev, node.id, [loadingRow(node.id)])) // 先注入「加载中…」
  setTimeout(() => {
    setNodes((prev) => setChildren(prev, node.id, awaitChildren(node))) // 异步返回真实子级
  }, 600)
}

return (
  <TreeView
    nodes={nodes}
    onExpandedChange={handleExpandedChange}
    renderNode={(node) => <span class="ui-kit-demo__tree-label">{node.label}</span>}
  />
)`,
  },
  {
    id: 'tree-view-big-data',
    name: 'TreeView 大数据量',
    description:
      '大数据量演示：165 行（15 文件夹 × 10 文件）全展开的大树里上方/下方插入、删除选中仍流畅——增删高度动画每帧只做单元素 block 布局（一次测高后纯 px 过渡），成本不随节点数增长；树高固定，超出部分卡片内部滚动。',
    category: 'tree',
    importPath: "import { TreeView } from '../../ui/tree-view.tsx'",
    props: [
      { name: 'nodes', type: 'readonly T[]', description: '多根节点列表；大数据量下增删 diff 依旧只动增量行' },
      { name: 'defaultExpandedIds', type: 'Iterable<string>?', description: '初始展开的节点 id 集合（本演示全展开）' },
      { name: 'selectedId', type: 'string?', description: '受控选中节点 id' },
      { name: 'onSelect', type: '(node: T) => void?', description: '行点击回调' },
      { name: 'renderNode', type: '(node: T, ctx: TreeViewRowContext<T>) => ComponentChildren', description: '渲染行业务内容（标签/附加列）' },
    ],
    codeExample: `const folders = Array.from({ length: 15 }, (_, f) => ({
  id: \`folder-\${f + 1}\`,
  label: \`文件夹 \${f + 1}\`,
  children: Array.from({ length: 10 }, (_, i) => ({
    id: \`folder-\${f + 1}-file-\${i + 1}\`,
    label: \`文件 \${f + 1}-\${i + 1}.txt\`,
  })),
}))

return (
  <TreeView
    nodes={folders}
    defaultExpandedIds={folders.map((n) => n.id)}
    selectedId={selectedId}
    onSelect={(node) => setSelectedId(node.id)}
    renderNode={(node) => <span class="ui-kit-demo__tree-label">{node.label}</span>}
  />
)`,
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
  {
    id: 'mini-window',
    name: '迷你窗',
    description:
      "系统迷你窗（chromeKind='mini'）：尺寸完全由内容撑起，仅关闭键；不可缩放、拖到屏幕边不吸附、双击标题栏不最大化，最小尺寸只保标题栏可显示。文件复制/解压的进度窗即此窗型",
    category: 'window',
    importPath: "openApp('files-op-progress', { documentId, chromeKind: 'mini' })",
    props: [
      { name: 'chromeKind', type: "'mini'", description: '迷你窗形态：内容撑起尺寸，仅关闭键' },
      { name: 'documentId', type: 'string?', description: '会话标识；同 documentId 重复打开会聚焦既有窗' },
    ],
    codeExample: `const { openApp } = useOs()

<Button
  tone="primary"
  onClick={() => openApp('files-op-progress', { chromeKind: 'mini' })}
>
  打开迷你窗
</Button>`,
  },
  {
    id: 'icon',
    name: 'Icon 图标库',
    description:
      'Material Symbols 图标浏览器：搜索、字体族、填充开关和字重与左侧类目、右侧网格同卡；侧栏只列出当前字体族下有图标的类目。目录按题材分类（安卓是其中一类，不是整库限定平台），网格虚拟滚动，点击格复制名字',
    category: 'icons',
    wide: true,
    importPath: "import { Icon } from '../../ui/icon.tsx'",
    props: [
      { name: 'name', type: 'string', description: 'ligature 名，如 "delete"；全目录见 fonts.google.com/icons' },
      { name: 'family', type: "'outlined' | 'rounded' | 'sharp'", description: '字体族轮廓风格，默认 rounded' },
      { name: 'fill', type: 'boolean?', description: 'FILL 轴：描边（默认）/ 填充实心' },
      { name: 'weight', type: 'number?', description: 'wght 轴 100–700，默认 400' },
      { name: 'grade', type: 'number?', description: 'GRAD 轴 -25–200，默认 0' },
      { name: 'size', type: 'number?', description: 'font-size 像素值，默认 24' },
      { name: 'label', type: 'string?', description: '语义化标签；缺省时 aria-hidden 仅作装饰' },
    ],
    codeExample: `<Icon name="delete" />
<Icon name="add" family="sharp" fill weight={600} size={18} />
{/* 前导图标；仅图标无文字时 Button 自动渲染为方形图标按钮 */}
<Button icon={<Icon name="add" size={13} />}>新建</Button>
<Button icon={<Icon name="close" size={13} />} aria-label="关闭" />`,
  },
  {
    id: 'icon-combo',
    name: 'Icon × 组件组合',
    description:
      'Icon 与 kit 组件的组合示范：Button 的 icon 属性传前导图标（仅图标无文字自动成方钮）、List 的 leading 槽放图标；图标颜色随容器文字色（currentColor）',
    category: 'icons',
    importPath: "import { Icon } from '../../ui/icon.tsx'",
    props: [
      { name: 'Button · icon', type: 'ComponentChildren', description: '前导图标内容；无文字时自动渲染为 26×26 方钮' },
      { name: 'ListItem · leading', type: 'ComponentChildren', description: '行首图标/头像位' },
    ],
    codeExample: `<Button icon={<Icon name="add" size={13} />}>新建</Button>
<Button icon={<Icon name="close" size={13} />} aria-label="关闭" />
<ListItem leading={<Icon name="cloud" size={17} />} label="iCloud 云盘" value="已开启" />`,
  },
]

export const COMPONENT_CATEGORIES = [
  { id: 'list-showcase', name: 'List 实战' },
  { id: 'form', name: '表单控件' },
  { id: 'icons', name: '图标' },
  { id: 'settings', name: '设置组件' },
  { id: 'navigation', name: '导航交互' },
  { id: 'tree', name: '树动效' },
  { id: 'picker', name: '选择器' },
  { id: 'other', name: '其他' },
  { id: 'window', name: '窗口系统' },
] as const
