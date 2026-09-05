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
    description: '复选框；支持 default / small 尺寸与 disabled',
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
      'iOS 6 拟物按钮；secondary / primary / danger，单一规格（28px 高、min-width 48、padding 0 8px、字重 400）；variant 选形态——filled 实体按钮（默认）或 borderless 裸文字/图标（无底无边，按住时一团亮白光晕叠在内容上方，松手即熄，tone 只改文字色）；icon 与文字默认互斥——传入 icon 即只渲染图标，children 文字不再显示、转作无障碍名回退；确需图标+文字同显时用 showBothIconAndText（受控例外，未经用户要求一般不启用）。可在父级覆盖 --ios-button-* CSS 变量换皮（与 IosNavBackButton 相同）',
    category: 'form',
    importPath: "import { Button } from '../../ui/button.tsx'",
    demos: [
      { id: 'basic', title: '基础形态', description: 'filled 三种色调、borderless 裸内容（按住看光晕）、图标钮与 icon+文字受控例外' },
      { id: 'theme', title: 'CSS 变量换肤', description: '父级覆盖 --ios-button-* 变量整体换皮' },
    ],
    props: [
      { name: 'tone', type: "'secondary' | 'primary' | 'danger'", description: '按钮色调，默认 secondary', defaultValue: "'secondary'" },
      { name: 'variant', type: "'filled' | 'borderless'?", description: '形态：filled 实体按钮（默认）；borderless 裸内容，按下亮白光晕叠于内容上方', defaultValue: "'filled'" },
      { name: 'icon', type: 'ComponentChildren?', description: '图标内容；与文字互斥，传入即只显示图标，文字转作无障碍名', defaultValue: '—' },
      { name: 'showBothIconAndText', type: 'boolean?', description: '受控例外：icon 与文字并排同显；仅当用户明确要求时才启用，未经要求一般不传', defaultValue: 'false' },
      { name: 'disabled', type: 'boolean?', description: '是否禁用', defaultValue: 'false' },
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
    id: 'ios-text-field',
    name: 'IosTextField',
    description:
      'iOS 6 内凹文本输入框；属性与原生 input 一致。开启「语音实验室」后可长按空格语音听写',
    category: 'form',
    importPath: "import { IosTextField } from '../../ui/ios-text-field.tsx'",
    demos: [
      { id: 'basic', title: '基础用法', description: '输入、禁用与语音听写（需开启开发者选项 → 语音实验室）' },
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
    ],
  },
  {
    id: 'ios-range-slider',
    name: 'IosRangeSlider',
    description: 'iOS 风格数值滑块；左侧数字输入，右侧水平拖块，支持刻度点、标签与单位后缀',
    category: 'form',
    importPath: "import { IosRangeSlider, type IosRangeSliderMark } from '../../ui/ios-range-slider.tsx'",
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
      { name: 'marks', type: 'IosRangeSliderMark[]?', description: '刻度点；value 在范围内即可，会被自动吸附到 step', defaultValue: '—' },
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
    description: '设置选项字段；form / list 内置触发器，或 children 自定义；支持宽窄屏与 dark',
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
    description: '设置导航行；右侧值、密钥圆点掩码、禁用态',
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
    description: '设置开关行；标签 + Switch 组合，常成组出现',
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
    id: 'settings-stepper-row',
    name: 'SettingsStepperRow',
    description: '设置数字行；点击弹出模态，在模态内用 [−] / 输入 / [+] 调节',
    category: 'settings',
    importPath: "import { SettingsStepperRow } from '../../ui/settings-stepper-row.tsx'",
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
    description: '设置勾选行；左侧标签、右侧无边框勾，整行点按切换；禁用态灰底灰字',
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
      { id: 'selection', title: '受控单选', description: 'selectedId/onSelect，点击自动上报、蓝底高亮、accessory 勾随选中' },
      { id: 'controls', title: '控件行', description: 'control 槽放 Switch / IosTextField（点控件不触发行）；纯勾选行用整行点按切换' },
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
      { name: 'accessory', type: "'none' | 'disclosure' | 'check' | 'detail'?", description: '右侧配件；check 跟随选中态', defaultValue: "'none'" },
      { name: 'badge', type: 'string?', description: '名称旁徽章文本', defaultValue: '—' },
      { name: 'selected', type: 'boolean?', description: '强制选中态；缺省由 List selectedId + id 推导', defaultValue: '—' },
      { name: 'disabled', type: 'boolean?', description: '禁用', defaultValue: 'false' },
      { name: 'onClick', type: '() => void?', description: '有则渲染为 button，否则渲染为 div', defaultValue: '—' },
    ],
  },
  {
    id: 'adaptive-split-nav',
    name: 'AdaptiveSplitNav',
    description: '自适应分栏导航：宽屏「列表 + 帧栈」分栏、窄屏自动回子页栈，宽窄切换以刚性面板滑轨形变交接。分栏宽度 ≤640 时进入紧凑档（左右固定 50/50，listRatio 不参与），≥700 恢复比例。布局原语需整应用承载——点 Demo 里的按钮打开「导航组件演示」',
    category: 'navigation',
    importPath: "import { AdaptiveSplitNav, useAdaptiveSplitNav } from '../../ui/adaptive-split-nav.tsx'",
    demos: [
      { id: 'basic', title: '整应用演示', description: '布局原语需整应用承载，点按钮打开「导航组件演示」应用' },
    ],
    props: [
      { name: 'controller', type: 'AdaptiveSplitNavController', description: 'useAdaptiveSplitNav() 返回的控制器', defaultValue: '—' },
      { name: 'renderNarrowPage', type: '(page: string) => ComponentChildren', description: '窄屏子页栈页面渲染', defaultValue: '—' },
      { name: 'renderWideFrames', type: '() => AdaptiveFrameSpec[]', description: '分栏右栏帧序列（从领域状态派生，末位最上）', defaultValue: '—' },
      { name: 'framesResetKey', type: 'string?', description: '帧栈全量重置键（选中条目身份切换时整体替换）', defaultValue: '—' },
      { name: 'narrowPageForState', type: '() => string', description: 'useAdaptiveSplitNav：由领域状态推导当前子页 id', defaultValue: '—' },
      { name: 'listPage', type: 'string?', description: 'useAdaptiveSplitNav：分栏左栏根列表页 id', defaultValue: '—' },
      { name: 'frameAnimationMs', type: 'number?', description: '形变/帧动画时长', defaultValue: '380' },
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
    id: 'ios-nav-back-button',
    name: 'IosNavBackButton',
    description: 'iOS 风格返回按钮；用于子页标题栏',
    category: 'navigation',
    importPath: "import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'",
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
      '通用锚定气泡；箭头自动跟随锚点，靠近视口底部向上翻、超出视口夹紧；宿主窗口宽 ≤520px 时自动退化为居中模态对话框（「好」按钮关闭）',
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
      { id: 'basic', title: '图标库浏览器', description: '搜索、字体族、填充/字重、类目侧栏与虚拟滚动网格；点击格复制名字' },
      { id: 'combo', title: '与组件组合', description: 'Button 图标钮、icon+文字受控例外、List leading 槽；顶部滑杆统一调字重' },
      { id: 'inset', title: '内凹两种画法', description: 'SVG 滤镜真·内阴影 vs 渐变明暗模拟；深度/浓度/字重滑杆联动' },
    ],
    props: [
      { name: 'name', type: 'string', description: 'ligature 名，如 "delete"；全目录见 fonts.google.com/icons', defaultValue: '—' },
      { name: 'family', type: "'outlined' | 'rounded' | 'sharp'", description: '字体族轮廓风格', defaultValue: "'rounded'" },
      { name: 'fill', type: 'boolean?', description: 'FILL 轴：描边（默认）/ 填充实心', defaultValue: 'false' },
      { name: 'weight', type: 'number?', description: 'wght 轴 100–700', defaultValue: '400' },
      { name: 'grade', type: 'number?', description: 'GRAD 轴 -25–200', defaultValue: '0' },
      { name: 'size', type: 'number?', description: 'font-size 像素值', defaultValue: '24' },
      { name: 'label', type: 'string?', description: '语义化标签；缺省时 aria-hidden 仅作装饰', defaultValue: '—' },
    ],
  },
  {
    id: 'activity-indicator',
    name: 'ActivityIndicator',
    description:
      'iOS 6 风格独立加载转圈（UIActivityIndicatorView）：12 根放射状刻度条错峰明暗形成转动感；纯展示不拦截交互，颜色随文字颜色，可摆放在任意位置',
    category: 'other',
    importPath: "import { ActivityIndicator } from '../../ui/activity-indicator.tsx'",
    whenToUse: '局部区域的进行中提示：列表加载中、内容区刷新、与文字并排的轻量等待标识；需要锁住整个界面的场景请用弹窗，不要用转圈',
    demos: [
      { id: 'basic', title: '基础用法', description: '两档尺寸、spinning 转/停与 hidesWhenStopped 停转即隐藏' },
      { id: 'scenarios', title: '业务场景', description: '点按钮模拟 2 秒加载，转圈与提示文字并排出现' },
    ],
    props: [
      { name: 'spinning', type: 'boolean?', description: '是否转动；停下时刻度静止变暗', defaultValue: 'true' },
      { name: 'size', type: "'small' | 'large'?", description: '尺寸档位，对应 iOS 的 20pt / 37pt', defaultValue: "'small'" },
      { name: 'hidesWhenStopped', type: 'boolean?', description: '停转后整体不渲染（对齐 iOS 默认值 false）', defaultValue: 'false' },
      { name: 'label', type: 'string?', description: '无障碍标签', defaultValue: "'加载中'" },
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
