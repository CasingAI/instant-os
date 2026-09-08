export type ComponentProp = {
  name: string
  type: string
  description: string
  defaultValue: string
}

/** 单个示例块：源码文件按约定位于 ./demos/<组件id>/<示例id>.tsx，源码即文件本身 */
export type ComponentDemoBlock = {
  id: string
  title: string
  description?: string
}

export type ComponentDemo = {
  id: string
  name: string
  description: string
  /** 名称旁徽章文本（如「已弃用」），组件列表页 List 行展示 */
  badge?: string
  category: 'data-display' | 'form' | 'icons' | 'settings' | 'navigation' | 'picker' | 'other' | 'window' | 'page-curl'
  importPath: string
  /** 何时使用（antd 式）：空则组件页不渲染该节 */
  whenToUse?: string
  demos: ComponentDemoBlock[]
  props: ComponentProp[]
}

export const UI_COMPONENTS: ComponentDemo[] = [
  {
    id: 'switch',
    name: 'Switch',
    description: 'ON/OFF 滑块开关；可单独使用，也可嵌在设置行里',
    category: 'form',
    importPath: "import { Switch } from '../../ui/switch.tsx'",
    demos: [
      { id: 'basic', title: '基础用法', description: '受控开关：点按切换 ON / OFF，label 兼作无障碍标签' },
    ],
    props: [
      { name: 'checked', type: 'boolean', description: '开关状态', defaultValue: '—' },
      { name: 'onChange', type: '(checked: boolean) => void', description: '状态变化回调', defaultValue: '—' },
      { name: 'label', type: 'string', description: '无障碍标签', defaultValue: '—' },
    ],
  },
  {
    id: 'check-toggle',
    name: 'CheckToggle',
    badge: '已弃用',
    description: '已弃用。复选框；支持 default / small 尺寸与 disabled',
    category: 'form',
    importPath: "import { CheckToggle } from '../../ui/check-toggle.tsx'",
    demos: [
      { id: 'basic', title: '基础用法', description: 'default / small 两种尺寸与禁用态' },
    ],
    props: [
      { name: 'checked', type: 'boolean', description: '选中状态', defaultValue: '—' },
      { name: 'onChange', type: '(checked: boolean) => void', description: '状态变化回调', defaultValue: '—' },
      { name: 'label', type: 'string', description: '无障碍标签', defaultValue: '—' },
      { name: 'size', type: "'default' | 'small'", description: '尺寸', defaultValue: "'default'" },
      { name: 'disabled', type: 'boolean?', description: '是否禁用', defaultValue: 'false' },
    ],
  },
  {
    id: 'checkbox',
    name: 'Checkbox',
    description:
      'macOS Aqua 风格方形勾选框；勾选态固定系统蓝，用于窗口弹窗等 Mac 风格界面（如重名冲突的「应用到全部」）',
    category: 'form',
    importPath: "import { Checkbox } from '../../ui/checkbox.tsx'",
    demos: [
      { id: 'basic', title: '基础用法', description: '未选 / 已选与禁用态；勾选态固定系统蓝' },
    ],
    props: [
      { name: 'checked', type: 'boolean', description: '勾选状态', defaultValue: '—' },
      { name: 'onChange', type: '(checked: boolean) => void', description: '状态变化回调', defaultValue: '—' },
      { name: 'label', type: 'string?', description: '可见文字，兼作无障碍标签', defaultValue: '—' },
      { name: 'ariaLabel', type: 'string?', description: '无可见文字时的无障碍标签', defaultValue: '—' },
      { name: 'disabled', type: 'boolean?', description: '是否禁用', defaultValue: 'false' },
    ],
  },
  {
    id: 'button',
    name: 'Button',
    description:
      'iOS 6 拟物按钮；secondary / primary / danger，单一规格（28px 高、min-width 48、padding 0 8px、字重 400）；variant 选形态——filled 实体按钮（默认）或 borderless 裸文字/图标单一类型（无底无边，darkMode 控暗底白字/浅底深字两形态，tone 传入不生效，按住时一团光晕垫在内容之下，松手即熄）；icon 与文字默认互斥——传入 icon 即只渲染图标，children 文字不再显示、转作无障碍名回退；确需图标+文字同显时用 showBothIconAndText（受控例外，未经用户要求一般不启用）。可在父级覆盖 --ios-button-* CSS 变量换皮（与 NavBackButton 相同）',
    category: 'form',
    importPath: "import { Button } from '../../ui/button.tsx'",
    demos: [
      { id: 'basic', title: '基础形态', description: 'filled 三种色调、borderless 明暗两形态纯文字/图标（切背景看 darkMode、按住看光晕）、图标钮与 icon+文字受控例外、busy 加载态' },
      { id: 'theme', title: 'CSS 变量换肤', description: '父级覆盖 --ios-button-* 变量整体换皮' },
    ],
    props: [
      { name: 'tone', type: "'secondary' | 'primary' | 'danger'", description: '按钮色调（仅 filled 生效；borderless 传入不生效），默认 secondary', defaultValue: "'secondary'" },
      { name: 'variant', type: "'filled' | 'borderless'?", description: '形态：filled 实体按钮（默认）；borderless 单一类型裸内容（明暗两形态见 darkMode，tone 不生效），按下光晕垫于内容之下', defaultValue: "'filled'" },
      { name: 'darkMode', type: 'boolean?', description: '仅 borderless 生效：暗底白字形态（默认）；false 翻浅底深字，光晕与按下投影同步翻转', defaultValue: 'true' },
      { name: 'icon', type: 'ComponentChildren?', description: '图标内容；与文字互斥，传入即只显示图标，文字转作无障碍名', defaultValue: '—' },
      { name: 'showBothIconAndText', type: 'boolean?', description: '受控例外：icon 与文字并排同显；仅当用户明确要求时才启用，未经要求一般不传', defaultValue: 'false' },
      { name: 'disabled', type: 'boolean?', description: '是否禁用', defaultValue: 'false' },
      { name: 'busy', type: 'boolean?', description: '异步进行中：菊花转圈覆盖在原内容之上（原内容隐形占位，按钮尺寸不变），标记 aria-busy；无障碍名从 children 回退', defaultValue: 'false' },
      { name: 'type', type: "'button' | 'submit' | 'reset'", description: '原生 button type', defaultValue: "'button'" },
      { name: 'aria-label', type: 'string?', description: '无障碍标签', defaultValue: '—' },
      { name: 'onClick', type: '() => void', description: '点击回调', defaultValue: '—' },
    ],
  },
  {
    id: 'page-button-group',
    name: 'Button Group',
    description:
      '页头按钮组：PageButtonGroup 内放 PageActionButton 成组使用，空间不足自动多级解压——先收边距、再收间距，接着图标方钮 28→20 连续收缩（图标随盒等比缩放），然后带 icon 的双态按钮（icon+文字）整钮退化为图标方钮把文字空间让出来，最后纯文字按钮连续压扁，任何宽度都不折行（解压机制只识别 PageActionButton）',
    category: 'form',
    importPath:
      "import { PageButtonGroup } from '../../ui/page-button-group.tsx'\nimport { PageActionButton } from '../../ui/page-action-button.tsx'",
    demos: [
      { id: 'basic', title: '基础用法', description: '成组、色调、激活态、busy 与图标方钮' },
      { id: 'sandbox', title: '挤压沙盒', description: '拖滑杆收窄容器，看多级解压：图标方钮收缩 → 双态退化为图标 → 文字压扁' },
    ],
    props: [
      { name: 'children', type: 'ComponentChildren', description: 'PageButtonGroup：组内放置 PageActionButton', defaultValue: '—' },
      { name: 'tone', type: "'plain' | 'default' | 'danger'", description: 'PageActionButton 色调，默认 plain', defaultValue: "'plain'" },
      { name: 'activated', type: 'boolean?', description: '持久选中态（如「已收藏」），蓝底白字', defaultValue: 'false' },
      { name: 'icon', type: 'ComponentChildren?', description: '仅 icon → 方钮（组内 28→20 收缩）；icon+文字 → 双态按钮：宽时文字、组内放不下整钮退化为方钮', defaultValue: '—' },
      { name: 'disabled', type: 'boolean?', description: '是否禁用', defaultValue: 'false' },
      { name: 'busy', type: 'boolean?', description: '提交中：文字前显示转圈', defaultValue: 'false' },
      { name: 'aria-label', type: 'string?', description: '无障碍标签', defaultValue: '—' },
      { name: 'onClick', type: '() => void', description: '点击回调', defaultValue: '—' },
    ],
  },
  {
    id: 'input',
    name: 'Input',
    description:
      '内凹文本输入框；属性与原生 input 一致。Input.TextArea 为多行文本域。开启「语音实验室」后可长按空格语音听写',
    category: 'form',
    importPath: "import { Input } from '../../ui/input.tsx'",
    demos: [
      { id: 'basic', title: '基础用法', description: '单行输入、多行文本域、禁用与语音听写（需开启开发者选项 → 语音实验室）' },
    ],
    props: [
      { name: 'value', type: 'string', description: '输入值', defaultValue: '—' },
      { name: 'placeholder', type: 'string?', description: '占位文案', defaultValue: '—' },
      { name: 'disabled', type: 'boolean?', description: '是否禁用', defaultValue: 'false' },
      { name: 'onInput', type: '(event) => void', description: '输入回调', defaultValue: '—' },
      {
        name: 'voiceDictation',
        type: 'boolean?',
        description:
          '长按空格语音听写；undefined 跟随开发者选项「语音实验室」，false 强制关闭',
        defaultValue: '跟随开发者选项「语音实验室」',
      },
      { name: '<Input.TextArea>', type: 'TextAreaProps', description: '多行文本域变体；props 与原生 textarea 一致', defaultValue: '—' },
      { name: 'rows', type: 'number?', description: 'TextArea：可见行数', defaultValue: '—' },
    ],
  },
  {
    id: 'slider',
    name: 'Slider',
    description: '数值滑块；左侧数字输入，右侧水平拖块，支持刻度点、标签与单位后缀',
    category: 'form',
    importPath: "import { Slider, type SliderMark } from '../../ui/slider.tsx'",
    demos: [
      { id: 'basic', title: '基础用法', description: '拖块 + 数字输入、标签后缀与刻度、禁用' },
      { id: 'scenarios', title: '业务场景', description: '虚拟机内存与新建空盘容量：非 0 起点的大范围刻度' },
    ],
    props: [
      { name: 'value', type: 'number', description: '当前值', defaultValue: '—' },
      { name: 'min', type: 'number', description: '最小值', defaultValue: '—' },
      { name: 'max', type: 'number', description: '最大值', defaultValue: '—' },
      { name: 'step', type: 'number', description: '步进，值会按 step 吸附', defaultValue: '—' },
      { name: 'label', type: 'string?', description: '左侧标签', defaultValue: '—' },
      { name: 'suffix', type: 'string?', description: '数值后缀，如 MB / %', defaultValue: '—' },
      { name: 'disabled', type: 'boolean?', description: '是否禁用', defaultValue: 'false' },
      { name: 'marks', type: 'SliderMark[]?', description: '刻度点；value 在范围内即可，会被自动吸附到 step', defaultValue: '—' },
      { name: 'onChange', type: '(value: number) => void', description: '值变化回调', defaultValue: '—' },
    ],
  },
  {
    id: 'segmented-control',
    name: 'SegmentedControl',
    description: '分段选择器；支持徽章数量与脏状态小橙点。分段最小宽度随自身文字，富余空间才均分，容器放不下时整条让位换行，不出省略号',
    category: 'form',
    importPath: "import { SegmentedControl } from '../../ui/segmented-control.tsx'",
    demos: [
      { id: 'basic', title: '基础用法', description: '分段切换、徽章与脏状态小橙点、四段' },
    ],
    props: [
      { name: 'value', type: 'string', description: '当前选中值', defaultValue: '—' },
      { name: 'items', type: 'SegmentedControlItem[]', description: '选项列表', defaultValue: '—' },
      { name: 'onChange', type: '(id: string) => void', description: '选择变化回调', defaultValue: '—' },
      { name: 'ariaLabel', type: 'string', description: '无障碍标签', defaultValue: '—' },
    ],
  },
  {
    id: 'settings-choice-field',
    name: 'SettingsChoiceField',
    badge: '已弃用',
    description: '已弃用。设置选项字段；form / list 内置触发器，或 children 自定义；支持宽窄屏与 dark',
    category: 'settings',
    importPath: "import { SettingsChoiceField } from '../../ui/settings-choice-field.tsx'",
    demos: [
      { id: 'basic', title: '内置触发器', description: 'form / list 两种内置触发器与窄屏布局' },
      { id: 'custom', title: '自定义触发器', description: 'children 完全接管触发器，可配 dark 深色弹出菜单' },
    ],
    props: [
      { name: 'label', type: 'string', description: '字段标签', defaultValue: '—' },
      { name: 'value', type: 'string', description: '当前值', defaultValue: '—' },
      { name: 'options', type: 'SettingsChoiceOption[]', description: '选项列表', defaultValue: '—' },
      { name: 'onChange', type: '(value: string) => void', description: '变化回调', defaultValue: '—' },
      { name: 'wideLayout', type: 'boolean', description: '是否宽屏布局', defaultValue: '—' },
      { name: 'presentation', type: "'form' | 'list'", description: '内置触发器样式', defaultValue: '—' },
      { name: 'dark', type: 'boolean?', description: '深色弹出菜单', defaultValue: 'false' },
      { name: 'children', type: '(props: SettingsChoiceTriggerProps) => VNode', description: '自定义 trigger 渲染', defaultValue: '—' },
    ],
  },
  {
    id: 'settings-nav-row',
    name: 'SettingsNavRow',
    badge: '已弃用',
    description: '已弃用。设置导航行；右侧值、密钥圆点掩码、禁用态',
    category: 'settings',
    importPath: "import { SettingsNavRow } from '../../ui/settings-nav-row.tsx'",
    demos: [
      { id: 'basic', title: '基础用法', description: '导航行、密钥圆点掩码与禁用态' },
    ],
    props: [
      { name: 'label', type: 'string', description: '左侧标签', defaultValue: '—' },
      { name: 'value', type: 'string', description: '右侧显示值', defaultValue: '—' },
      { name: 'onClick', type: '() => void', description: '点击回调', defaultValue: '—' },
      { name: 'disabled', type: 'boolean?', description: '是否禁用', defaultValue: 'false' },
      { name: 'secretLength', type: 'number?', description: '密钥长度；有值时显示圆点掩码', defaultValue: '—' },
    ],
  },
  {
    id: 'settings-switch-row',
    name: 'SettingsSwitchRow',
    badge: '已弃用',
    description: '已弃用。设置开关行；标签 + Switch 组合，常成组出现',
    category: 'settings',
    importPath: "import { SettingsSwitchRow } from '../../ui/settings-switch-row.tsx'",
    demos: [
      { id: 'basic', title: '基础用法', description: '标签 + 开关成组' },
    ],
    props: [
      { name: 'label', type: 'string', description: '标签文本', defaultValue: '—' },
      { name: 'checked', type: 'boolean', description: '开关状态', defaultValue: '—' },
      { name: 'onChange', type: '(checked: boolean) => void', description: '状态变化回调', defaultValue: '—' },
    ],
  },
  {
    id: 'number-selector',
    name: 'NumberSelector',
    description: '设置数字行；点击弹出模态，在模态内用 [−] / 输入 / [+] 调节',
    category: 'settings',
    importPath: "import { NumberSelector } from '../../ui/number-selector.tsx'",
    demos: [
      { id: 'basic', title: '基础用法', description: '点击行弹出步进模态' },
    ],
    props: [
      { name: 'label', type: 'string', description: '左侧标签', defaultValue: '—' },
      { name: 'value', type: 'number', description: '当前值', defaultValue: '—' },
      { name: 'onChange', type: '(value: number) => void', description: '值变化回调', defaultValue: '—' },
      { name: 'min', type: 'number?', description: '最小值', defaultValue: '—' },
      { name: 'max', type: 'number?', description: '最大值', defaultValue: '—' },
      { name: 'step', type: 'number?', description: '步进', defaultValue: '1' },
      { name: 'unit', type: 'string?', description: '单位，显示在右侧当前值旁', defaultValue: '—' },
      { name: 'editable', type: 'boolean?', description: '模态内是否允许直接输入', defaultValue: 'true' },
      { name: 'disabled', type: 'boolean?', description: '是否禁用', defaultValue: 'false' },
    ],
  },
  {
    id: 'settings-check-row',
    name: 'SettingsCheckRow',
    badge: '已弃用',
    description: '已弃用。设置勾选行；左侧标签、右侧无边框勾，整行点按切换；禁用态灰底灰字',
    category: 'settings',
    importPath: "import { SettingsCheckRow } from '../../ui/settings-check-row.tsx'",
    demos: [
      { id: 'basic', title: '基础用法', description: '整行点按切换与禁用锁定' },
    ],
    props: [
      { name: 'label', type: 'string', description: '标签文本', defaultValue: '—' },
      { name: 'checked', type: 'boolean', description: '选中状态', defaultValue: '—' },
      { name: 'onChange', type: '(checked: boolean) => void', description: '状态变化回调', defaultValue: '—' },
      { name: 'disabled', type: 'boolean?', description: '是否禁用（锁定项）', defaultValue: 'false' },
    ],
  },
  {
    id: 'settings-inline-input-row',
    name: 'SettingsInlineInputRow',
    description: '设置内联输入行；文本 / URL / 密码',
    category: 'settings',
    importPath: "import { SettingsInlineInputRow } from '../../ui/settings-inline-input-row.tsx'",
    demos: [
      { id: 'basic', title: '基础用法', description: '文本 / URL / 密码三种输入类型' },
    ],
    props: [
      { name: 'label', type: 'string', description: '左侧标签', defaultValue: '—' },
      { name: 'value', type: 'string', description: '输入值', defaultValue: '—' },
      { name: 'onChange', type: '(value: string) => void', description: '变化回调', defaultValue: '—' },
      { name: 'type', type: "'text' | 'password' | 'url'", description: '输入类型', defaultValue: "'text'" },
      { name: 'placeholder', type: 'string?', description: '占位文案', defaultValue: '—' },
    ],
  },
  {
    id: 'list',
    name: 'List',
    description:
      '设置风格分组列表容器；行内容放 ListItem，支持节标题/脚注、表头滚动区、快速索引条（三档自动显示）与 iOS 6 编辑模式（减号删除 + 把手排序）；scrollable 滚动体内分节标题 sticky 悬停（滚到顶钉住、被下一节顶走）；样式完全自有（--list-* token）；行触达四态同 iOS 6 原版，且反馈只属于可点行（有 onClick / 受 onSelect 管）——hover 淡灰、按下蓝渐变反白硬切、点闪保持 0.5s 后淡出（deselectRow 式）、选中持久蓝底（编辑模式暂停）；variant="plain" 切换为邮件/短信式通栏列表（独立 plain-list.css，选中/编辑/重排机制共用）',
    category: 'data-display',
    importPath: "import { List, ListSection } from '../../ui/list.tsx'",
    demos: [
      { id: 'basic', title: '节标题与滚动区', description: '节标题/脚注、表头限高滚动区；可点行有触达反馈，信息行零反馈' },
      { id: 'selection', title: '受控单选', description: 'selectedId/onSelect + selectionTone="check"，点击自动上报、accessory 勾随选中（只显勾，无持久蓝底）' },
      { id: 'multi-selection', title: '受控多选', description: 'selectedIds/onSelect + selectionTone="check"，点行切换勾、多行同选（只显勾，无持久蓝底）' },
      { id: 'controls', title: '控件行', description: 'control 槽放 Switch / Input（点控件不触发行）；纯勾选行用整行点按切换' },
      { id: 'choice', title: '选择行', description: 'ListItem 传 options 即选择行：右侧显示当前值，宽容器点行弹选择菜单、窄容器点行走跳转回调（onChoiceNavigate），List 自动判定或 choiceLayout 强制' },
      { id: 'index', title: '快速索引条', description: '条上文字三档自动：标题首字 → 拼音首字母 → 隔位采样；含姓氏模式与乱序告警演示' },
      { id: 'editing', title: '编辑模式', description: '「编辑」进出：减号删除、把手重排' },
      { id: 'plain-variant', title: 'plain 变体换装', description: '同一组件同一份数据，传参即换装：grouped ↔ plain 现场切换' },
      { id: 'plain-editing', title: 'plain 编辑模式', description: 'plain 分支与 grouped 共用同一套编辑机制' },
    ],
    props: [
      { name: 'children', type: 'ComponentChildren', description: '列表行（ListItem / ListSection / 行组件）', defaultValue: '—' },
      { name: 'class', type: 'string?', description: '追加到容器的修饰类', defaultValue: '—' },
      { name: 'title', type: 'ComponentChildren?', description: '节标题（盒子外上方）', defaultValue: '—' },
      { name: 'footnote', type: 'ComponentChildren?', description: '节脚注（盒子外下方）', defaultValue: '—' },
      { name: 'head', type: 'ComponentChildren?', description: '表头单元格（span 序列），有值时渲染表头行', defaultValue: '—' },
      { name: 'headClass', type: 'string?', description: '追加到表头的附加类', defaultValue: '—' },
      { name: 'scrollable', type: 'boolean?', description: 'children 包进限高滚动区（max-height 280 + overflow auto）', defaultValue: 'false' },
      { name: 'bodyClass', type: 'string?', description: '追加到滚动体的附加类；配合 scrollable 使用', defaultValue: '—' },
      { name: 'indexBar', type: 'boolean?', description: '右缘快速索引条；自动收集子级 ListSection，点击/沿条拖动跳节；条上文字三档自动切换——节少（≤12）显示标题首字、节多降为拼音首字母、槽位放不下再隔位采样。排序契约：组件不排序，节的条上标签须沿列表非降序——数据侧用 groupByIndexLetter 分组排序，dev 下逆序告警', defaultValue: 'false' },
      { name: 'variant', type: "'grouped' | 'plain'?", description: '变体：grouped（默认）为设置分组盒；plain 为邮件/短信式通栏列表（行多行槽 trailing/preview/unread 生效，样式在 plain-list.css）', defaultValue: "'grouped'" },
      { name: 'editing', type: 'boolean?', description: '编辑模式：行出现减号删除钮与拖拽排序把手', defaultValue: 'false' },
      { name: 'selectedId', type: 'string?', description: '受控单选：配合 ListItem 的 id', defaultValue: '—' },
      { name: 'selectedIds', type: 'readonly string[]?', description: '受控多选：配合 ListItem 的 id；onSelect(id) 上报后增删集合成员由调用方负责', defaultValue: '—' },
      { name: 'selectionTone', type: "'highlight' | 'check'?", description: "选中呈现：highlight（默认）持久蓝底反白 + 勾；check 只显示行尾勾，蓝底仅剩按下瞬间反馈", defaultValue: "'highlight'" },
      { name: 'onSelect', type: '(id: string) => void?', description: 'ListItem 点击上报选中', defaultValue: '—' },
      { name: 'onDelete', type: '(id: string) => void?', description: '编辑模式：确认删除某行', defaultValue: '—' },
      { name: 'onReorder', type: '(fromId: string, toId: string) => void?', description: '编辑模式：拖拽重排落定', defaultValue: '—' },
    ],
  },
  {
    id: 'list-item',
    name: 'ListItem',
    description:
      'List 的组合行，同一组件双分支渲染：grouped（默认）为单行 flex 槽位（AntD List.Item 风格）label/subtitle/leading/value/extra/control 自由拼装；plain 为邮件式多行骨架（trailing/preview/unread 专属槽，grouped 忽略）；accessory 配件（箭头/选中勾/蓝 ⓘ）；带 id 即与 List 受控单选、编辑模式结合',
    category: 'data-display',
    importPath: "import { ListItem } from '../../ui/list-item.tsx'",
    demos: [
      { id: 'basic', title: '行槽位与配件', description: 'value/subtitle/leading/badge/extra 自由拼装；ⓘ 配件点击不触发行' },
    ],
    props: [
      { name: 'id', type: 'string?', description: '稳定 id：参与 List 受控单选与编辑模式', defaultValue: '—' },
      { name: 'label', type: 'ComponentChildren?', description: '左侧主标题', defaultValue: '—' },
      { name: 'subtitle', type: 'ComponentChildren?', description: '灰色第二行副标题', defaultValue: '—' },
      { name: 'leading', type: 'ComponentChildren?', description: '左侧图标/头像位', defaultValue: '—' },
      { name: 'trailing', type: 'ComponentChildren?', description: 'plain 专属：首行右上角落位（日期/时间）；grouped 忽略', defaultValue: '—' },
      { name: 'preview', type: 'ComponentChildren?', description: 'plain 专属：末行灰色摘要；grouped 忽略', defaultValue: '—' },
      { name: 'unread', type: 'boolean?', description: 'plain 专属：未读态，标题/副标题置粗；grouped 忽略', defaultValue: 'false' },
      { name: 'value', type: 'ComponentChildren?', description: '右侧值文本（与 extra 二选一）', defaultValue: '—' },
      { name: 'extra', type: 'ComponentChildren?', description: '右侧自定义内容（与 value 二选一）', defaultValue: '—' },
      { name: 'control', type: 'ComponentChildren?', description: '控件槽（Switch 等）；点击不触发行选中', defaultValue: '—' },
      { name: 'accessory', type: "'none' | 'disclosure' | 'check'?", description: '右侧配件；check 跟随选中态', defaultValue: "'none'" },
      { name: 'badge', type: 'string?', description: '名称旁徽章文本，见「节标题/脚注」与 plain 变体演示', defaultValue: "'新'" },
      { name: 'selected', type: 'boolean?', description: '强制选中态；缺省由 List selectedId + id 推导', defaultValue: '—' },
      { name: 'disabled', type: 'boolean?', description: '禁用', defaultValue: 'false' },
      { name: 'onClick', type: '() => void?', description: '有则渲染为 button，否则渲染为 div', defaultValue: '—' },
    ],
  },
  {
    id: 'waterfall',
    name: '瀑布流',
    description:
      '数据驱动的网格集合容器（一期：网格摆法 + 虚拟滚动）：数据驱动 items/renderItem，列数可固定也可按容器宽度自适应（网格 宫格 九宫格 缩略图墙）；只挂可见行，上万条流畅滚动，支持 scrollToIndex；高度由外部容器给（flex 子元素或固定高）。瀑布流（高度由数据给）、分节标题、横滚小节在二期',
    category: 'data-display',
    importPath: "import { Waterfall } from '../../ui/waterfall.tsx'",
    whenToUse:
      '要在限高区域里摆大量等高格子（相册宫格、文件缩略图墙、色块卡片）时；需要瀑布流、分节标题或一节横着滑时暂不适用（二期）',
    demos: [
      { id: 'basic', title: '基础用法', description: 'iOS 设置式壁纸选择宫格：分类切换、固定 3 列；点选蓝勾随选择迁移' },
      { id: 'auto-columns', title: '自适应列数', description: 'App Store 式图文卡片墙：滑杆调卡片宽度（或拖窄窗口），列数随之变化；点按打开提示' },
      { id: 'virtualized', title: '万条虚拟滚动', description: '万张照片墙只挂可见行；卡片点按收藏、按钮跳到任意一项验证 scrollToIndex' },
    ],
    props: [
      { name: 'items', type: 'readonly T[]', description: '条目数据', defaultValue: '—' },
      { name: 'itemKey', type: '(item: T, index: number) => string', description: '条目稳定 key', defaultValue: '—' },
      { name: 'renderItem', type: '(item: T, index: number) => ComponentChildren', description: '单格内容渲染', defaultValue: '—' },
      { name: 'itemHeight', type: 'number?', description: '每格高度 px；行距 = itemHeight + gap', defaultValue: '96' },
      { name: 'columns', type: 'number?', description: '列数；不给则按容器宽度与 minItemWidth 自适应', defaultValue: '自适应' },
      { name: 'minItemWidth', type: 'number?', description: '自适应时每格最小宽度 px', defaultValue: '88' },
      { name: 'gap', type: 'number?', description: '格间距 px：横向行内 grid 列间距，纵向计入行距', defaultValue: '8' },
      { name: 'overscan', type: 'number?', description: '视口外多渲染几行', defaultValue: '3' },
      { name: 'scrollToIndex', type: 'number?', description: '变化时滚动到该条目（视口外就近滚入）', defaultValue: '—' },
      { name: 'empty', type: 'ComponentChildren?', description: 'items 为空时渲染的兜底内容', defaultValue: '—' },
      { name: 'className', type: 'string?', description: '追加到容器的修饰类', defaultValue: '—' },
    ],
  },
  {
    id: 'nav',
    name: 'Nav',
    description: '导航家族：Nav 本体（宽屏「列表 + 帧栈」分栏、窄屏自动回子页栈，宽窄切换以刚性面板滑轨形变）+ Nav.Page（强制页单位：统一标题栏外壳由组件绘制，返回键显隐与形变淡入淡出全系统一份实现）+ Nav.Header / Nav.Flow。平铺单实例：每页 id 一个常驻宿主，窄/宽只是同一份内容的两种角色，窄屏子页与分栏帧共用同一套页 id。分栏宽度 ≤640 时进入紧凑档。页面必须是 <Nav.Page>（运行时强制校验）——用 Nav 的地方外壳必然一个长相。布局原语需整应用承载——点 Demo 里的按钮打开「导航组件演示」',
    category: 'navigation',
    importPath: "import { Nav, useNav } from '../../ui/nav.tsx'",
    demos: [
      { id: 'basic', title: '整应用演示', description: '布局原语需整应用承载，点按钮打开「导航组件演示」应用' },
    ],
    props: [
      { name: 'controller', type: 'NavController', description: 'useNav() 返回的控制器', defaultValue: '—' },
      { name: 'renderPage', type: '(page, ctx) => <Nav.Page>', description: '按页 id 渲染页面实体，一份内容服务窄/宽两种形态（形态差异经 ctx 的 narrowLayout/morphing/morphKind 取舍）', defaultValue: '—' },
      { name: 'frames', type: 'string[]', description: '分栏右栏帧序（页 id，末位最上）；与窄屏子页同一套 id 空间', defaultValue: '—' },
      { name: '<Nav.Page>', type: '{ title?, backLabel?, onBack?, actions?, children }', description: '强制页单位：统一标题栏（返回/标题/操作区）+ 滚动正文；返回键随形态的显隐与淡入淡出由 Nav 编排', defaultValue: '—' },
      { name: '<Nav.Header>', type: 'NavHeaderProps', description: '标题栏本体（无标题特殊页单独取用）', defaultValue: '—' },
      { name: '<Nav.Flow>', type: '{ children }', description: '流程页出口：内嵌 PageStack 子栈的选择器/向导（外壳由子栈的标准件提供）', defaultValue: '—' },
      { name: 'framesResetKey', type: 'string?', description: '帧栈全量重置键（选中条目身份切换时整体替换）', defaultValue: '—' },
      { name: 'narrowPageForState', type: '() => string', description: 'useNav：由领域状态推导当前子页 id', defaultValue: '—' },
      { name: 'listPage', type: 'string?', description: 'useNav：分栏左栏根列表页 id', defaultValue: '—' },
      { name: 'frameAnimationMs', type: 'number?', description: '形变/帧动画时长', defaultValue: '380' },
      { name: 'safeArea', type: 'number | { top?: number; bottom?: number }?', description: '安全区（px）：一个数则顶/底同值，对象则分侧。顶部由标题栏材质向上延伸无缝占满；底部仅暗色页壳处理（加进内容井底边框成 8px + 安全区），亮色不处理。任一侧大于 0 即生效', defaultValue: '—' },
    ],
  },
  {
    id: 'pop-nav',
    name: 'PopNav',
    description:
      '强制 Nav 的大弹出窗：宽高可传（width / height，默认 320×280），内容只能是 Nav 页面；锚定形态把尖裁进整盒、指向触发器（尖端那一侧由 Nav 安全区把壳材质垫进尖里）；下面完整装得下就放下面，装不下而上面装得下就放上面，上下都不够才按屏幕钳制挑更宽敞的一侧；水平整层跟着触发器，伸出宿主窗口也不往里推，只有快飞出屏幕才收；无锚点时视口居中；关闭（外点/Esc）仅隐藏不销毁，Nav 状态保留。内部固定暗色——面板与尖为深蓝壳材质（theme.css --page-shell-bg），内部 Nav 整页按暗色主题渲染，暂不提供对外配置项',
    category: 'navigation',
    importPath: "import { PopNav, PopNavTrigger } from '../../ui/pop-nav.tsx'",
    demos: [
      {
        id: 'basic',
        title: '基础用法',
        description: '锚定弹窗：尖跟随触发器，下面不够就放到上面，水平跟着按钮、伸出窗口不内推，只钳屏幕；翻页后关窗再开仍在原页',
      },
    ],
    props: [
      { name: 'open', type: 'boolean', description: '是否打开', defaultValue: '—' },
      { name: 'width', type: 'number?', description: '面板宽（px），默认 320；仅当屏幕放不下才收窄', defaultValue: '320' },
      { name: 'height', type: 'number?', description: '面板高（px，不含尖），默认 280；仅当屏幕放不下才收短', defaultValue: '280' },
      { name: 'onClose', type: '() => void', description: '关闭通知（外部点按 / Esc）；面板仅隐藏不销毁', defaultValue: '—' },
      { name: 'onOpen', type: '() => void?', description: 'PopNavTrigger 点按时的开窗请求', defaultValue: '—' },
      { name: 'anchorRef', type: 'RefObject<HTMLElement>?', description: '逃生口：直接指定锚点元素（锚点不是 PopNavTrigger 包着的东西时用）', defaultValue: '—' },
      { name: 'ariaLabel', type: 'string?', description: '无障碍标签', defaultValue: '—' },
      { name: '…NavProps', type: 'NavProps', description: 'controller 与 renderPage/frames 原样透传给内部 Nav——页面必须是 <Nav.Page>（统一标题栏外壳，运行时强制），没有塞任意组件的口子', defaultValue: '—' },
      { name: '<PopNavTrigger>', type: 'ComponentChildren', description: '触发器：包住按钮等元素，ref 与点按自动接好，尖指向它；孩子须是原生元素或接 ref 的组件，否则退回透明壳', defaultValue: '—' },
    ],
  },
  {
    id: 'document-tab-bar',
    name: 'DocumentTabBar',
    description: '文档标签栏；脏状态、关闭动画、拥挤时悬停加宽、minTabsToShow',
    category: 'navigation',
    importPath: "import { DocumentTabBar } from '../../ui/document-tab-bar.tsx'",
    demos: [
      { id: 'basic', title: '基础用法', description: '脏状态、关闭动画、长标题与最小数量收起' },
    ],
    props: [
      { name: 'tabs', type: 'DocumentTabItem[]', description: '标签列表', defaultValue: '—' },
      { name: 'activeTabId', type: 'string | undefined', description: '当前激活标签', defaultValue: '—' },
      { name: 'onActivate', type: '(tabId: string) => void', description: '激活回调', defaultValue: '—' },
      { name: 'onClose', type: '(tabId: string) => void', description: '关闭回调', defaultValue: '—' },
      { name: 'minTabsToShow', type: 'number?', description: '低于此数量时隐藏标签栏', defaultValue: '2' },
    ],
  },
  {
    id: 'adaptive-action-menu',
    name: 'AdaptiveActionMenu',
    description: '自适应操作菜单；宽屏下拉，窄屏底部面板',
    category: 'navigation',
    importPath: "import { AdaptiveActionMenu } from '../../ui/adaptive-action-menu.tsx'",
    demos: [
      { id: 'basic', title: '宽窄两种形态', description: '宽屏下拉与窄屏底部面板' },
    ],
    props: [
      { name: 'open', type: 'boolean', description: '是否打开', defaultValue: '—' },
      { name: 'title', type: 'string', description: '菜单标题', defaultValue: '—' },
      { name: 'items', type: 'AdaptiveActionMenuItem[]', description: '菜单项列表', defaultValue: '—' },
      { name: 'narrowLayout', type: 'boolean', description: '是否窄屏布局', defaultValue: '—' },
      { name: 'onClose', type: '() => void', description: '关闭回调', defaultValue: '—' },
      { name: 'mount', type: "'contained' | 'portal'", description: '挂载方式', defaultValue: "'contained'" },
    ],
  },
  {
    id: 'nav-back-button',
    name: 'NavBackButton',
    badge: '已弃用',
    description: '已弃用。返回按钮；用于子页标题栏',
    category: 'navigation',
    importPath: "import { NavBackButton } from '../../ui/nav-back-button.tsx'",
    demos: [
      { id: 'basic', title: '基础用法', description: '子页返回导航与禁用态' },
    ],
    props: [
      { name: 'label', type: 'string', description: '返回目标名称', defaultValue: '—' },
      { name: 'onClick', type: '(event) => void', description: '点击回调', defaultValue: '—' },
      { name: 'disabled', type: 'boolean?', description: '是否禁用', defaultValue: 'false' },
      { name: 'iconSize', type: 'number?', description: '箭头图标尺寸', defaultValue: '13' },
    ],
  },
  {
    id: 'tree-view',
    name: 'TreeView',
    description: '通用折叠树：递归子级、展开/折叠带滑出/滑入动画、增删行带高度展开/收起动画、单选高亮；行内容经 renderNode 注入。支持双击展开/收起与键盘导航（↑/↓ 选中、→/← 展开收起、Home/End/Enter）',
    category: 'navigation',
    importPath: "import { TreeView } from '../../ui/tree-view.tsx'",
    demos: [
      { id: 'basic', title: '展开折叠与选中', description: '滑出/滑入动画、单选高亮；双击展开收起与键盘导航' },
      { id: 'interactive', title: '增删动效', description: '上方/下方/子级插入与删除选中；removalSelection 补选相邻行' },
      { id: 'lazy-load', title: '异步加载', description: '展开先出「加载中…」行，数据返回后替换为真实子级' },
      { id: 'big-data', title: '大数据量', description: '165 行全展开大树里增删依旧流畅' },
    ],
    props: [
      { name: 'nodes', type: 'readonly T[]', description: '多根节点列表（T 需含 id 与 children）', defaultValue: '—' },
      { name: 'defaultExpandedIds', type: 'Iterable<string>?', description: '初始展开的节点 id 集合', defaultValue: '—' },
      { name: 'selectedId', type: 'string?', description: '受控选中节点 id', defaultValue: '—' },
      { name: 'removalSelection', type: `'none' | 'prefer-previous' | 'prefer-next'?`, description: '选中节点被移除后的自动补选：none 不自动选中（默认）；prefer-previous / prefer-next 按「上一轮可见序」优先向前 / 向后选相邻幸存行，一侧到底后反向兜底，经 onSelect 通知宿主', defaultValue: "'none'" },
      { name: 'onSelect', type: '(node: T) => void?', description: '行点击回调', defaultValue: '—' },
      { name: 'onExpandedChange', type: '(node: T, expanded: boolean) => void?', description: '展开/折叠变化回调（供懒加载）', defaultValue: '—' },
      { name: 'renderNode', type: '(node: T, ctx: TreeViewRowContext<T>) => ComponentChildren', description: '渲染行业务内容（图标/标签/附加列）', defaultValue: '—' },
      { name: 'indent', type: 'number?', description: '每级缩进像素', defaultValue: '28' },
      { name: 'className', type: 'string?', description: '透传到容器（宿主滚动/尺寸样式）', defaultValue: '—' },
      { name: 'ariaLabel', type: 'string?', description: '容器无障碍标签', defaultValue: '—' },
    ],
  },
  {
    id: 'emoji-picker-popover',
    name: 'EmojiPickerPopover',
    description: '表情选择弹出层；默认触发器或自定义 children 内容',
    category: 'picker',
    importPath: "import { EmojiPickerPopover } from '../../ui/emoji-picker-popover.tsx'",
    demos: [
      { id: 'basic', title: '基础用法', description: '默认触发器与自定义触发器内容' },
    ],
    props: [
      { name: 'value', type: 'string', description: '当前表情', defaultValue: '—' },
      { name: 'onChange', type: '(emoji: string) => void', description: '选择回调', defaultValue: '—' },
      { name: 'triggerLabel', type: 'string?', description: '默认触发器文案', defaultValue: '—' },
      { name: 'children', type: 'ComponentChildren?', description: '自定义触发器内容', defaultValue: '—' },
      { name: 'disabled', type: 'boolean?', description: '是否禁用', defaultValue: 'false' },
    ],
  },
  {
    id: 'ai-model-capability-tags',
    name: 'AiModelCapabilityTags',
    description: 'AI 模型能力标签；视觉能力可切换编辑',
    category: 'other',
    importPath: "import { AiModelCapabilityTags } from '../../ui/ai-model-capability-tags.tsx'",
    demos: [
      { id: 'basic', title: '基础用法', description: '只读展示与可编辑视觉能力' },
    ],
    props: [
      { name: 'capabilities', type: 'readonly AiModelCapability[]', description: '已启用能力', defaultValue: '—' },
      { name: 'visionEditable', type: 'boolean?', description: '是否允许切换视觉能力', defaultValue: 'false' },
      { name: 'onVisionChange', type: '(supportsVision: boolean) => void?', description: '视觉能力变化回调', defaultValue: '—' },
    ],
  },
  {
    id: 'popover',
    name: 'Popover',
    description:
      '通用锚定气泡；箭头自动跟随锚点，靠近视口底部向上翻、超出视口夹紧；宿主窗口宽 ≤520px 时自动退化为居中模态对话框（「好」按钮关闭）。默认深色外观，内容区按钮默认凹形态',
    category: 'other',
    importPath: "import { Popover } from '../../ui/popover.tsx'",
    demos: [
      { id: 'basic', title: '基础用法', description: '锚定气泡：箭头跟随、越界翻转夹紧；窗口拖窄退化为居中模态' },
    ],
    props: [
      { name: 'open', type: 'boolean', description: '是否打开', defaultValue: '—' },
      { name: 'anchorRef', type: 'RefObject<HTMLElement>', description: '锚点元素；箭头指向它，窄屏判定也以它所在的窗口为准', defaultValue: '—' },
      { name: 'onClose', type: '() => void', description: '关闭回调（外部点按 / Esc / 窄屏按钮）', defaultValue: '—' },
      { name: 'children', type: 'ComponentChildren', description: '气泡内容', defaultValue: '—' },
      { name: 'ariaLabel', type: 'string?', description: '无障碍标签', defaultValue: '—' },
      { name: 'dismissLabel', type: 'string?', description: '窄屏模态关闭按钮文案', defaultValue: "'好'" },
      { name: 'dark', type: 'boolean?', description: '深色外观；默认深色，传 false 用浅色', defaultValue: 'true' },
    ],
  },
  {
    id: 'help-hint',
    name: 'HelpHint',
    description:
      '帮助提示按钮；SVG 矢量「？」圆形按钮，点按经 Popover 弹出说明气泡（带指向箭头；宿主窗口很窄时变居中模态）',
    category: 'other',
    importPath: "import { HelpHint } from '../../ui/help-hint.tsx'",
    demos: [
      { id: 'basic', title: '基础用法', description: '行内「？」按钮弹出说明气泡；长文案验证视口边缘定位' },
    ],
    props: [
      { name: 'text', type: 'string', description: '说明内容，展示在弹出气泡里', defaultValue: '—' },
      { name: 'label', type: 'string?', description: '无障碍标签', defaultValue: "'说明'" },
    ],
  },
  {
    id: 'hud',
    name: 'Hud',
    description:
      'iOS 6 风格 HUD 浮层：深色半透明圆角块 + 转圈/对勾/叉/横条进度与白字，几秒内短操作的进行中/刚完成反馈。useHud() 命令式调用：hud.view 放进组件树任意位置（位置就此定死在所在窗口），hud.show()/hide() 随时收放，连续 show 原地替换内容；默认盖所在窗口的内容区（走 WindowModal 同款浮层根，标题栏不受影响，期间不接受点击），show 传 containerRef 可只盖指定容器；没有全屏形态，浮层根/容器都解析不到就不弹',
    category: 'other',
    importPath: "import { useHud } from '../../ui/hud.tsx'",
    whenToUse:
      '几秒内短操作的进行中/刚完成反馈，不打断、不需要回应。要用户决策的用 WindowModal；可能超时、可取消的长任务用进度窗（如文件 App 的迷你进度窗），不要拿 HUD 长时间盖住窗口',
    demos: [
      { id: 'basic', title: '模拟保存', description: 'show 转圈「保存中…」2 秒 → 对勾「已保存」→ 自动收；期间本窗口点不动' },
      { id: 'modes', title: '五种形态', description: '转圈/纯文字/成功/失败各弹 1.2 秒；进度模式点「模拟下载」跑条到 100% 自动收（途中原地替换内容）' },
      { id: 'background', title: '后台任务完成', description: '任务跑完才 show：无论当时焦点在哪，都弹在自己窗口' },
      { id: 'local', title: '局部遮罩', description: 'containerRef 只盖指定盒子，盒外照常可点' },
    ],
    props: [
      { name: 'view', type: 'ComponentChildren', description: 'HUD 渲染位：放进组件树任意位置，位置就此定死在所在窗口', defaultValue: '—' },
      { name: 'show', type: '(options?: string | HudShowOptions) => void', description: '弹出或替换内容；传字符串等价 { text }', defaultValue: '—' },
      { name: 'hide', type: '() => void', description: '收起（补满 minVisibleMs 后播退出动画再卸载）', defaultValue: '—' },
      { name: 'mode', type: "'spinner' | 'text' | 'success' | 'error' | 'progress'", description: 'show 选项：内容形态', defaultValue: "'spinner'" },
      { name: 'text', type: 'string?', description: 'show 选项：主文案', defaultValue: '—' },
      { name: 'detail', type: 'string?', description: 'show 选项：第二行浅灰小字', defaultValue: '—' },
      { name: 'percent', type: 'number?', description: 'show 选项：progress 模式 0-100，自动 clamp', defaultValue: '—' },
      { name: 'dimBackground', type: 'boolean?', description: 'show 选项：是否暗化背景（遮罩仍在，只是不画暗色）', defaultValue: 'true' },
      { name: 'minVisibleMs', type: 'number?', description: 'show 选项：最短显示毫秒，防成功一闪而过', defaultValue: '0' },
      { name: 'containerRef', type: 'RefObject<HTMLElement>?', description: 'show 选项：只盖指定容器（需非 static 定位）；缺省盖所在窗口', defaultValue: '—' },
      { name: 'ariaLabel', type: 'string?', description: 'show 选项：无障碍标签；缺省用 text', defaultValue: '—' },
    ],
  },
  {
    id: 'window-modal',
    name: 'WindowModal',
    description: '窗口模态对话框；primary / secondary / danger 按钮，支持 wide / scrollBody、标题对齐、副标题与关闭钮',
    category: 'window',
    importPath: "import { WindowModal } from '../../window/window-modal.tsx'",
    demos: [
      { id: 'basic', title: '确认与危险操作', description: '标准确认框与 alertdialog 危险确认' },
      { id: 'wide', title: '宽对话框与标题栏', description: 'wide + scrollBody、左对齐标题、副标题与关闭钮' },
    ],
    props: [
      { name: 'open', type: 'boolean', description: '是否打开', defaultValue: '—' },
      { name: 'title', type: 'string', description: '对话框标题', defaultValue: '—' },
      { name: 'subtitle', type: 'string?', description: '主标题下方的辅助说明', defaultValue: '—' },
      { name: 'titleAlign', type: "'center' | 'left'?", description: '标题对齐方式', defaultValue: "'center'" },
      { name: 'showCloseButton', type: 'boolean?', description: '在标题栏右上角显示关闭按钮', defaultValue: 'false' },
      { name: 'onClose', type: '() => void', description: '关闭回调', defaultValue: '—' },
      { name: 'actions', type: 'WindowModalAction[]?', description: '操作按钮列表', defaultValue: '—' },
      { name: 'headerActions', type: 'WindowModalAction[]?', description: '标题栏右侧操作按钮', defaultValue: '—' },
      { name: 'wide', type: 'boolean?', description: '宽对话框', defaultValue: 'false' },
      { name: 'scrollBody', type: 'boolean?', description: '内容区可滚动', defaultValue: 'false' },
      { name: 'children', type: 'ComponentChildren', description: '内容区域', defaultValue: '—' },
    ],
  },
  {
    id: 'mini-window',
    name: '迷你窗',
    description:
      "系统迷你窗（chromeKind='mini'）：尺寸完全由内容撑起，仅关闭键；不可缩放、拖到屏幕边不吸附、双击标题栏不最大化，最小尺寸只保标题栏可显示。文件复制/解压的进度窗即此窗型",
    category: 'window',
    importPath: "openApp('files-op-progress', { documentId, chromeKind: 'mini' })",
    demos: [
      { id: 'basic', title: '打开真实迷你窗', description: '点按钮打开一扇真实迷你窗（进度应用空态），看内容撑起尺寸' },
    ],
    props: [
      { name: 'chromeKind', type: "'mini'", description: '迷你窗形态：内容撑起尺寸，仅关闭键', defaultValue: '—' },
      { name: 'documentId', type: 'string?', description: '会话标识；同 documentId 重复打开会聚焦既有窗', defaultValue: '—' },
    ],
  },
  {
    id: 'icon',
    name: 'Icon 图标库',
    description:
      'Material Symbols 图标浏览器：搜索、字体族、填充开关和字重与左侧类目、右侧网格同卡；侧栏只列出当前字体族下有图标的类目。目录按题材分类（安卓是其中一类，不是整库限定平台），网格虚拟滚动，点击格复制名字',
    category: 'icons',
    importPath: "import { Icon } from '../../ui/icon.tsx'",
    demos: [
      { id: 'basic', title: '图标库浏览器', description: '搜索、字体族、填充/字重、类目侧栏与虚拟滚动网格；点击格复制名字。侧栏「内置自绘」类目下有 CSS 绘制的 activity-indicator 转圈，不依赖字体' },
      { id: 'combo', title: '与组件组合', description: 'Button 图标钮、icon+文字受控例外、List leading 槽；顶部滑杆统一调字重' },
      { id: 'spinner', title: '转圈图标', description: '内置自绘图标 activity-indicator：iOS 6 风格加载转圈，尺寸随 size、颜色随文字色；size < 20px 自动换紧凑画法（12 根刻度减为 8 根、按比例加粗加长，避免小尺寸细成发丝挤成一团）' },
      { id: 'inset', title: '内凹两种画法', description: 'SVG 滤镜真·内阴影 vs 渐变明暗模拟；深度/浓度/字重滑杆联动' },
    ],
    props: [
      { name: 'name', type: 'string', description: 'ligature 名，如 "delete"；全目录见 fonts.google.com/icons。内置自绘例外："activity-indicator"（iOS 6 风格转圈，CSS 绘制，不占字体）', defaultValue: '—' },
      { name: 'family', type: "'outlined' | 'rounded' | 'sharp'", description: '字体族轮廓风格', defaultValue: "'rounded'" },
      { name: 'fill', type: 'boolean?', description: 'FILL 轴：描边（默认）/ 填充实心', defaultValue: 'false' },
      { name: 'weight', type: 'number?', description: 'wght 轴 100–700', defaultValue: '400' },
      { name: 'grade', type: 'number?', description: 'GRAD 轴 -25–200', defaultValue: '0' },
      { name: 'size', type: 'number?', description: 'font-size 像素值', defaultValue: '24' },
      { name: 'label', type: 'string?', description: '语义化标签；缺省时 aria-hidden 仅作装饰', defaultValue: '—' },
    ],
  },
  {
    id: 'theme',
    name: 'DarkMode',
    description:
      '主题强制作用域壳：包住谁，谁里面的系统页面组件（Page / PageHeader / PageStack 转场 / Nav，均消费同一套 --page-* 变量）整体按指定主题渲染，包外不受影响。缺省强制暗色，disabled 强制亮色——亮色有对称作用域（theme.css 的 [data-theme=\'light\']），暗色祖先里也能抠出亮色块，一壳双向。实现为 display:contents 的 div——不占布局、不打乱调用方的 flex/grid 子项关系，只向子树贡献一个 data-theme 属性，变量经 DOM 树继承生效，无任何 JS 运行时',
    category: 'other',
    importPath: "import { DarkMode } from '../../ui/theme.tsx'",
    whenToUse:
      '需要局部强制主题的场合：亮色应用里放一块暗色页面；暗色应用里放一块亮色页面（disabled）。同一组件可嵌套出任意深度的主题切换（最近的祖先定义生效）。组件里要在 JS 读主题（isDark）的场景当前不支持',
    demos: [
      { id: 'basic', title: '整页亮暗切换', description: '真实 Nav（split 自适应窄屏子页栈）：顶部切换器把整页（列表页、详情帧、返回键全部标准件）在亮暗间强制切换；列表点进子页，返回键与宽窄形变照常工作' },
    ],
    props: [
      { name: 'children', type: 'ComponentChildren', description: '作用域内的内容：系统页面组件整体按指定主题渲染', defaultValue: '—' },
      { name: 'disabled', type: 'boolean?', description: '强制亮色（data-theme="light"）；缺省 false = 强制暗色', defaultValue: 'false' },
    ],
  },
  {
    id: 'page-curl',
    name: '地图卷页 Page Curl',
    description:
      'iOS 6 地图右下角卷页（page curl）的网页复刻对比：同一场景——假地图页从右下角卷起、露出底下设置页——三种实现各跑一遍，纯 CSS 3D 折叠（每帧只写 transform/clip-path，全走合成器）、纯 2D 裁剪镜像（clip-path + matrix 反射 + 假光源，零 3D 零 WebGL）、WebGL 连续卷曲（柱面卷曲网格，每帧只更新一个 uniform，最接近原版观感）。支持拖住右下角跟手卷页、松手弹簧回弹、点击折角开合与自动演示；每档说明写明每帧成本与保真度',
    category: 'page-curl',
    importPath: "import { PageCurlDemo } from './page-curl-demo.tsx'",
    demos: [
      { id: 'basic', title: '三种实现对比', description: 'css3d / clip2d / webgl 三档切换；拖右下角跟手卷页、松手弹簧回弹、点击折角开合与自动演示' },
    ],
    props: [
      {
        name: 'initialVariant',
        type: "'css3d' | 'clip2d' | 'webgl'",
        description: '初始展示的实现方案；默认 css3d，运行中用顶部分段器切换',
        defaultValue: "'css3d'",
      },
    ],
  },
]

export const COMPONENT_CATEGORIES = [
  { id: 'data-display', name: '数据展示' },
  { id: 'form', name: '表单控件' },
  { id: 'icons', name: '图标' },
  { id: 'settings', name: '设置组件' },
  { id: 'navigation', name: '导航交互' },
  { id: 'page-curl', name: '卷页动画' },
  { id: 'picker', name: '选择器' },
  { id: 'other', name: '其他' },
  { id: 'window', name: '窗口系统' },
] as const
