import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useOs } from '../../os/os-context.tsx'
import { IosSwitch } from '../../ui/ios-switch.tsx'
import { IosCheckToggle } from '../../ui/ios-check-toggle.tsx'
import { Checkbox } from '../../ui/checkbox.tsx'
import { Button } from '../../ui/button.tsx'
import { Icon, type IconFamily } from '../../ui/icon.tsx'
import { PageButtonGroup } from '../../ui/page-button-group.tsx'
import { PageActionButton } from '../../ui/page-action-button.tsx'
import { Popover } from '../../ui/popover.tsx'
import { IosTextField } from '../../ui/ios-text-field.tsx'
import { IosRangeSlider, type IosRangeSliderMark } from '../../ui/ios-range-slider.tsx'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { List, ListSection } from '../../ui/list.tsx'
import { groupByIndexLetter } from '../../ui/list-index.ts'
import { ListItem } from '../../ui/list-item.tsx'
import { SegmentedControl } from '../../ui/segmented-control.tsx'
import { SettingsChoiceField } from '../../ui/settings-choice-field.tsx'
import { SettingsNavRow } from '../../ui/settings-nav-row.tsx'
import { SettingsCheckRow } from '../../ui/settings-check-row.tsx'
import { SettingsSwitchRow } from '../../ui/settings-switch-row.tsx'
import { SettingsStepperRow } from '../../ui/settings-stepper-row.tsx'
import { SettingsInlineInputRow } from '../../ui/settings-inline-input-row.tsx'
import { DocumentTabBar, type DocumentTabItem } from '../../ui/document-tab-bar.tsx'
import { AdaptiveActionMenu, type AdaptiveActionMenuItem } from '../../ui/adaptive-action-menu.tsx'
import { EmojiPickerPopover } from '../../ui/emoji-picker-popover.tsx'
import { FixedRowVirtualList } from '../../ui/fixed-row-virtual-list.tsx'
import { AiModelCapabilityTags } from '../../ui/ai-model-capability-tags.tsx'
import { HelpHint } from '../../ui/help-hint.tsx'
import { WindowModal } from '../../window/window-modal.tsx'
import { TreeView, type TreeViewRemovalSelection } from '../../ui/tree-view.tsx'
import { formatStorageSize } from '../../os/format-storage-size.ts'
import { ICON_RECOMMENDED, ICON_RECOMMENDED_NAMES } from './icon-recommended.ts'
import '../settings/settings.css'
import '../../ui/ios-nav-back.css'

function DemoVariants({ children }: { children: preact.ComponentChildren }) {
  return <div class="ui-kit-demo__variants">{children}</div>
}

function DemoVariant({
  label,
  children,
  wide,
}: {
  label: string
  children: preact.ComponentChildren
  wide?: boolean
}) {
  return (
    <div class={`ui-kit-demo__variant${wide ? ' ui-kit-demo__variant--wide' : ''}`}>
      <div class="ui-kit-demo__variant-label">{label}</div>
      {children}
    </div>
  )
}

function SettingsGroup({ children }: { children: preact.ComponentChildren }) {
  return <List class="ui-kit-demo__settings-group">{children}</List>
}

export function IosSwitchDemo() {
  const [a, setA] = useState(true)
  const [b, setB] = useState(false)
  const [c, setC] = useState(true)

  return (
    <DemoVariants>
      <DemoVariant label="开启">
        <IosSwitch checked={a} onChange={setA} label="开启状态" />
      </DemoVariant>
      <DemoVariant label="关闭">
        <IosSwitch checked={b} onChange={setB} label="关闭状态" />
      </DemoVariant>
      <DemoVariant label="成对对比">
        <div class="ui-kit-demo__row">
          <IosSwitch checked={c} onChange={setC} label="A" />
          <IosSwitch checked={!c} onChange={(next) => setC(!next)} label="B" />
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}

export function CheckboxDemo() {
  const [a, setA] = useState(false)
  const [b, setB] = useState(true)

  return (
    <DemoVariants>
      <DemoVariant label="未勾选 / 已勾选">
        <div class="ui-kit-demo__row">
          <Checkbox checked={a} onChange={setA} label="选项" />
          <Checkbox checked={b} onChange={setB} label="选项" />
        </div>
      </DemoVariant>
      <DemoVariant label="禁用">
        <div class="ui-kit-demo__row">
          <Checkbox checked={false} onChange={() => {}} disabled label="未勾选" />
          <Checkbox checked onChange={() => {}} disabled label="已勾选" />
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}

export function IosCheckToggleDemo() {
  const [a, setA] = useState(true)
  const [b, setB] = useState(false)
  const [c, setC] = useState(true)
  const [d, setD] = useState(false)

  return (
    <DemoVariants>
      <DemoVariant label="默认 · 选中">
        <div class="ui-kit-demo__row ui-kit-demo__row--labeled">
          <IosCheckToggle checked={a} onChange={setA} label="选中" />
          <span class="ui-kit-demo__hint">选中</span>
        </div>
      </DemoVariant>
      <DemoVariant label="默认 · 未选">
        <div class="ui-kit-demo__row ui-kit-demo__row--labeled">
          <IosCheckToggle checked={b} onChange={setB} label="未选" />
          <span class="ui-kit-demo__hint">未选</span>
        </div>
      </DemoVariant>
      <DemoVariant label="small">
        <div class="ui-kit-demo__row">
          <IosCheckToggle checked={c} onChange={setC} label="小尺寸选中" size="small" />
          <IosCheckToggle checked={d} onChange={setD} label="小尺寸未选" size="small" />
        </div>
      </DemoVariant>
      <DemoVariant label="disabled">
        <div class="ui-kit-demo__row">
          <IosCheckToggle checked={true} label="禁用选中" disabled />
          <IosCheckToggle checked={false} label="禁用未选" disabled />
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}

export function ButtonDemo() {
  return (
    <DemoVariants>
      <DemoVariant label="色调" wide>
        <div class="ui-kit-demo__row">
          <Button>次要</Button>
          <Button tone="primary">主要</Button>
          <Button tone="danger">危险</Button>
        </div>
      </DemoVariant>
      <DemoVariant label="borderless · 按住看光晕叠在内容上方" wide>
        <div class="ui-kit-demo__row">
          <Button variant="borderless">次要</Button>
          <Button variant="borderless" tone="primary">主要</Button>
          <Button variant="borderless" tone="danger">危险</Button>
          <Button variant="borderless" icon="←" title="后退" />
          <Button variant="borderless" disabled>
            禁用
          </Button>
        </div>
      </DemoVariant>
      <DemoVariant label="图标 / icon+文字">
        <div class="ui-kit-demo__row">
          <Button icon="←" title="后退" />
          <Button icon="→" title="前进" />
          {/* showBothIconAndText 是受控例外：仅演示能力，实际页面未经用户要求不得使用 */}
          <Button icon="＋" showBothIconAndText>新建</Button>
          <Button disabled>
            禁用
          </Button>
        </div>
      </DemoVariant>
      <DemoVariant label="主题色（CSS 变量）" wide>
        <div
          class="ui-kit-demo__row"
          style={{
            '--ios-button-color': '#c77400',
            '--ios-button-color-active': '#9a5c00',
            '--ios-button-bg': 'linear-gradient(180deg, #fff 0%, #e9dfd0 100%)',
            '--ios-button-bg-active': 'linear-gradient(180deg, #e9dfd0 0%, #ddd2c0 100%)',
            '--ios-button-border': '1px solid #b8a88e',
            '--ios-button-radius': '6px',
            '--ios-button-shadow':
              'inset 0 1px 0 rgba(255, 255, 255, 0.8), 0 1px 2px rgba(0, 0, 0, 0.12)',
            '--ios-button-shadow-active': 'inset 0 1px 2px rgba(0, 0, 0, 0.14)',
            '--ios-button-text-shadow': '0 1px 0 rgba(255, 255, 255, 0.8)',
          }}
        >
          <Button>编辑</Button>
          <Button>书城</Button>
          <Button disabled>
            刷新
          </Button>
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}

export function PageButtonGroupDemo() {
  // 挤压沙盒：滑杆控制容器宽，PageButtonGroup 自带 ResizeObserver 实时多级解压
  const [sandboxWidth, setSandboxWidth] = useState(340)
  const [dualSandboxWidth, setDualSandboxWidth] = useState(340)

  return (
    <DemoVariants>
      <DemoVariant label="色调 / 选中态" wide>
        <div class="ui-kit-demo__row">
          <PageButtonGroup>
            <PageActionButton activated>收藏</PageActionButton>
            <PageActionButton>标记已读</PageActionButton>
            <PageActionButton>分享</PageActionButton>
            <PageActionButton tone="danger">删除</PageActionButton>
          </PageButtonGroup>
        </div>
      </DemoVariant>
      <DemoVariant label="状态" wide>
        <div class="ui-kit-demo__row">
          <PageButtonGroup>
            <PageActionButton busy>提交中</PageActionButton>
            <PageActionButton disabled>不可用</PageActionButton>
            <PageActionButton icon="＋" aria-label="添加" />
          </PageButtonGroup>
        </div>
      </DemoVariant>
      <DemoVariant label="icon + 文字（放不下退化为图标）" wide>
        <div class="ui-kit-demo__sandbox" style={{ width: `${dualSandboxWidth}px` }}>
          <PageButtonGroup>
            <PageActionButton icon={<Icon name="favorite" size={13} />}>收藏</PageActionButton>
            <PageActionButton icon={<Icon name="download" size={13} />}>下载</PageActionButton>
            <PageActionButton>分享</PageActionButton>
            <PageActionButton tone="danger">删除</PageActionButton>
          </PageButtonGroup>
        </div>
        <div class="ui-kit-demo__sandbox-controls">
          <input
            class="ui-kit-demo__sandbox-slider"
            type="range"
            min={90}
            max={380}
            value={dualSandboxWidth}
            onInput={(e) => setDualSandboxWidth(Number(e.currentTarget.value))}
          />
          <span class="ui-kit-demo__sandbox-width">{dualSandboxWidth}px</span>
        </div>
      </DemoVariant>
      <DemoVariant label="挤压沙盒（拖滑杆收窄容器）" wide>
        <div class="ui-kit-demo__sandbox" style={{ width: `${sandboxWidth}px` }}>
          <PageButtonGroup>
            <PageActionButton activated>收藏</PageActionButton>
            <PageActionButton>标记已读</PageActionButton>
            <PageActionButton>分享</PageActionButton>
            <PageActionButton>导出备份</PageActionButton>
          </PageButtonGroup>
        </div>
        <div class="ui-kit-demo__sandbox-controls">
          <input
            class="ui-kit-demo__sandbox-slider"
            type="range"
            min={90}
            max={380}
            value={sandboxWidth}
            onInput={(e) => setSandboxWidth(Number(e.currentTarget.value))}
          />
          <span class="ui-kit-demo__sandbox-width">{sandboxWidth}px</span>
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}

export function IosTextFieldDemo() {
  const [value, setValue] = useState('示例文本')
  const [dictationValue, setDictationValue] = useState('')

  return (
    <DemoVariants>
      <DemoVariant label="基础" wide>
        <IosTextField
          value={value}
          placeholder="请输入…"
          onInput={(event) => setValue((event.target as HTMLInputElement).value)}
        />
      </DemoVariant>
      <DemoVariant label="禁用" wide>
        <IosTextField value="不可编辑" disabled />
      </DemoVariant>
      <DemoVariant label="语音听写（需开启开发者选项 → 语音实验室）" wide>
        <IosTextField
          value={dictationValue}
          placeholder="长按空格说话，松手插入…"
          onInput={(event) =>
            setDictationValue((event.target as HTMLInputElement).value)
          }
        />
      </DemoVariant>
    </DemoVariants>
  )
}

export function IosRangeSliderDemo() {
  const [basic, setBasic] = useState(30)
  const [withMarks, setWithMarks] = useState(25)
  const [memory, setMemory] = useState(1024)
  const [disk, setDisk] = useState(512)
  const [disabledVal, setDisabledVal] = useState(60)

  const percentMarks: IosRangeSliderMark[] = [
    { value: 0, label: '0%' },
    { value: 25, label: '25%' },
    { value: 50, label: '50%' },
    { value: 75, label: '75%' },
    { value: 100, label: '100%' },
  ]

  const memoryMarks: IosRangeSliderMark[] = [
    { value: 512, label: '512M' },
    { value: 1024, label: '1G' },
    { value: 1536, label: '1.5G' },
    { value: 2032, label: '2G' },
  ]

  const diskMarks: IosRangeSliderMark[] = [
    { value: 256, label: '256M' },
    { value: 512, label: '512M' },
    { value: 1024, label: '1G' },
    { value: 2048, label: '2G' },
  ]

  return (
    <DemoVariants>
      <DemoVariant label="基础" wide>
        <IosRangeSlider
          value={basic}
          min={0}
          max={100}
          step={1}
          onChange={setBasic}
        />
      </DemoVariant>

      <DemoVariant label="带标签 + 后缀 + 刻度" wide>
        <IosRangeSlider
          label="音量"
          value={withMarks}
          min={0}
          max={100}
          step={1}
          suffix="%"
          marks={percentMarks}
          onChange={setWithMarks}
        />
      </DemoVariant>

      <DemoVariant label="禁用" wide>
        <IosRangeSlider
          value={disabledVal}
          min={0}
          max={100}
          step={1}
          disabled
          onChange={setDisabledVal}
        />
      </DemoVariant>

      <DemoVariant label="业务场景：虚拟机内存 (16–2032 MB / step 16)" wide>
        <IosRangeSlider
          label="内存"
          value={memory}
          min={16}
          max={2032}
          step={16}
          suffix="MB"
          marks={memoryMarks}
          onChange={setMemory}
        />
      </DemoVariant>

      <DemoVariant label="业务场景：新建空盘容量 (16–2048 MB / step 16)" wide>
        <IosRangeSlider
          label="容量"
          value={disk}
          min={16}
          max={2048}
          step={16}
          suffix="MB"
          marks={diskMarks}
          onChange={setDisk}
        />
      </DemoVariant>
    </DemoVariants>
  )
}

export function SegmentedControlDemo() {
  const [basic, setBasic] = useState('day')
  const [badge, setBadge] = useState('all')
  const [many, setMany] = useState('a')

  return (
    <DemoVariants>
      <DemoVariant label="基础两段" wide>
        <SegmentedControl
          value={basic}
          items={[
            { id: 'day', label: '日' },
            { id: 'week', label: '周' },
            { id: 'month', label: '月' },
          ]}
          onChange={setBasic}
          ariaLabel="时间范围"
        />
      </DemoVariant>
      <DemoVariant label="徽章 + 脏点" wide>
        <SegmentedControl
          value={badge}
          items={[
            { id: 'all', label: '全部', badge: 12 },
            { id: 'unread', label: '未读', badge: 3, dirty: true },
            { id: 'starred', label: '星标' },
          ]}
          onChange={setBadge}
          ariaLabel="消息分类"
        />
      </DemoVariant>
      <DemoVariant label="四段" wide>
        <SegmentedControl
          value={many}
          items={[
            { id: 'a', label: '概览' },
            { id: 'b', label: '详情' },
            { id: 'c', label: '日志' },
            { id: 'd', label: '设置' },
          ]}
          onChange={setMany}
          ariaLabel="页面分段"
        />
      </DemoVariant>
    </DemoVariants>
  )
}

export function SettingsChoiceFieldDemo() {
  const [theme, setTheme] = useState('auto')
  const [lang, setLang] = useState('zh')
  const [region, setRegion] = useState('cn')
  const [sort, setSort] = useState('name')
  const [narrow, setNarrow] = useState('medium')

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
  const sizeOptions = [
    { id: 'small', label: '小' },
    { id: 'medium', label: '中' },
    { id: 'large', label: '大' },
  ]

  return (
    <DemoVariants>
      <DemoVariant label="内置 (form)">
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
      </DemoVariant>

      <DemoVariant label="内置 (list)">
        <SettingsChoiceField
          label="语言"
          value={lang}
          options={langOptions}
          onChange={setLang}
          wideLayout={true}
          presentation="list"
        />
      </DemoVariant>

      <DemoVariant label="窄屏布局">
        <SettingsChoiceField
          label="字号"
          value={narrow}
          options={sizeOptions}
          onChange={setNarrow}
          wideLayout={false}
          presentation="list"
        />
      </DemoVariant>

      <DemoVariant label="自定义 children">
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
              class="ui-kit-demo__custom-trigger"
            >
              🌍 {displayValue}
              <span class="ui-kit-demo__custom-trigger-caret">{open ? '▲' : '▼'}</span>
            </button>
          )}
        </SettingsChoiceField>
      </DemoVariant>

      <DemoVariant label="自定义 + dark">
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
              class="ui-kit-demo__custom-trigger ui-kit-demo__custom-trigger--accent"
            >
              {displayValue}
              <span class="ui-kit-demo__custom-trigger-caret">{open ? '▲' : '▼'}</span>
            </button>
          )}
        </SettingsChoiceField>
      </DemoVariant>
    </DemoVariants>
  )
}

export function ListDemo() {
  const files = [
    { id: 'f1', name: '季度报告.pdf', size: '2.4 MB' },
    { id: 'f2', name: '设计稿.sketch', size: '18.7 MB' },
    { id: 'f3', name: '会议记录.md', size: '12 KB' },
    { id: 'f4', name: '素材包.zip', size: '148 MB' },
  ]
  const [tapped, setTapped] = useState<string | null>(null)

  return (
    <DemoVariants>
      <DemoVariant label="节标题 / 脚注（导航行可点：hover / 按下 / 点闪）" wide>
        <List title="通用" footnote="重置网络设置将清除已保存的 Wi-Fi 密码。">
          <ListItem
            label="关于本机"
            value="iOS 6.1.4"
            accessory="disclosure"
            onClick={() => setTapped('关于本机')}
          />
          <ListItem
            label="软件更新"
            value="已是最新"
            accessory="disclosure"
            onClick={() => setTapped('软件更新')}
          />
        </List>
        {tapped && <p class="ui-kit-demo__status">已点按：{tapped}</p>}
      </DemoVariant>
      <DemoVariant label="表头 + 限高滚动区（数据行无 onClick：零反馈）" wide>
        <List head={<><span>文件</span><span>大小</span></>} scrollable>
          {files.map((file) => (
            <ListItem key={file.id} label={file.name} value={file.size} />
          ))}
        </List>
      </DemoVariant>
    </DemoVariants>
  )
}

export function ListItemDemo() {
  const leading = (emoji: string, color: string) => (
    <span
      style={{
        width: '26px',
        height: '26px',
        borderRadius: '6px',
        background: color,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '14px',
      }}
    >
      {emoji}
    </span>
  )
  const [tapped, setTapped] = useState<string | null>(null)

  return (
    <DemoVariants>
      <DemoVariant label="槽位：值 / 副标题 / 图标 / 徽章 / extra（可点行有 hover/按下反馈，信息行零反馈）" wide>
        <List>
          <ListItem label="网络" value="Wi-Fi" accessory="disclosure" onClick={() => setTapped('网络')} />
          <ListItem
            label="面容解锁"
            subtitle="抬起唤醒并注视屏幕以解锁"
            accessory="disclosure"
            onClick={() => setTapped('面容解锁')}
          />
          <ListItem leading={leading('🎵', '#fa5c8f')} label="音乐" value="128 GB" />
          <ListItem label="测试通道" badge="BETA" value="已加入" />
          <ListItem label="上次备份" extra={<span class="list-item__value">2 分钟前</span>} />
        </List>
        {tapped && <p class="ui-kit-demo__status">已点按：{tapped}</p>}
      </DemoVariant>
      <DemoVariant label="配件：蓝色 ⓘ 详情钮（点击不触发行）">
        <List>
          <ListItem
            label="iCloud 云盘"
            value="已开启"
            accessory="detail"
            onClick={() => setTapped('iCloud 云盘')}
          />
          <ListItem
            label="查找我的 iPhone"
            value="关闭"
            accessory="detail"
            onClick={() => setTapped('查找我的 iPhone')}
          />
        </List>
      </DemoVariant>
    </DemoVariants>
  )
}

export function ListSelectionDemo() {
  const [selectedId, setSelectedId] = useState('icloud')

  const accounts = [
    { id: 'icloud', label: 'iCloud', value: 'john@example.com' },
    { id: 'exchange', label: 'Exchange', value: 'work@example.com' },
    { id: 'gmail', label: 'Gmail', value: 'john@gmail.com' },
    { id: 'qq', label: 'QQ 邮箱', value: 'john@qq.com' },
  ]

  return (
    <DemoVariants>
      <DemoVariant label="selectedId/onSelect + accessory 勾随选中" wide>
        <List selectedId={selectedId} onSelect={setSelectedId}>
          {accounts.map((account) => (
            <ListItem
              key={account.id}
              id={account.id}
              label={account.label}
              value={account.value}
              accessory="check"
            />
          ))}
        </List>
        <p class="ui-kit-demo__status">当前选中：{selectedId}</p>
      </DemoVariant>
    </DemoVariants>
  )
}

export function ListControlsDemo() {
  const [wifi, setWifi] = useState(true)
  const [autoDownload, setAutoDownload] = useState(false)
  const [home, setHome] = useState('https://')

  return (
    <DemoVariants>
      <DemoVariant label="control 槽（点控件不触发行）/ 整行点按勾选" wide>
        <List>
          <ListItem
            label="Wi-Fi"
            value={wifi ? '已开启' : '关闭'}
            control={<IosSwitch checked={wifi} onChange={setWifi} label="Wi-Fi" />}
          />
          <ListItem
            label="主页"
            control={
              <IosTextField
                value={home}
                onInput={(event) => setHome(event.currentTarget.value)}
                placeholder="https://"
              />
            }
          />
          <ListItem
            label="自动下载"
            selected={autoDownload}
            accessory="check"
            onClick={() => setAutoDownload(!autoDownload)}
          />
        </List>
      </DemoVariant>
    </DemoVariants>
  )
}

export function ListIndexDemo() {
  // 平铺名单 → groupByIndexLetter 自动归节排序。姓氏模式修正默认词典的姓氏读音
  // （曾小贤→Z、单雄信→S、仇英→Q）；List 组件只按 DOM 顺序收集节，「标签非降序」
  // 这条排序契约由数据侧的输出保证（A-Z 升序、# 沉底、组内按全拼）
  const names = [
    '0 元秒杀',
    '12306 客服',
    '24 便利店',
    '3M 便利贴',
    '4S 店小哥',
    '58 同城',
    '618 大促',
    '7-11 便当',
    '8 折优惠券',
    '9 键输入法',
    '阿福',
    '安琪',
    '敖丙',
    '艾克',
    '白露',
    '包拯',
    '百晓生',
    '北岛',
    '毕加索',
    '曹操',
    '陈皮',
    '蔡文姬',
    '晁盖',
    '车晓',
    '丁丁',
    '大卫',
    '貂蝉',
    '杜甫',
    '董卓',
    '恩雅',
    '耳东',
    '范闲',
    '飞白',
    '方鸿',
    '冯程程',
    '傅雷',
    '关雎',
    '归海',
    '高渐离',
    '郭靖',
    '顾城',
    '韩非',
    '何晏',
    '胡杨',
    '华佗',
    '黄盖',
    '花木兰',
    'Ivy',
    '建安',
    '九斤',
    '姜子牙',
    '金铃儿',
    '贾宝玉',
    '纪晓岚',
    '快雪',
    '凯风',
    '孔明',
    '柯南',
    '李白',
    '林徽',
    '柳如是',
    '刘备',
    '陆游',
    '鲁智深',
    '马良',
    '木心',
    '毛遂',
    '孟姜女',
    '米芾',
    '南音',
    '妞妞',
    '倪妮',
    '聂小倩',
    '牛皋',
    '欧阳',
    'Olivia',
    '潘安',
    '彭小满',
    '萍聚',
    '皮皮',
    '仇英',
    '钱塘',
    '青梅',
    '秦筝',
    '乔峰',
    '屈原',
    '任盈盈',
    '若曦',
    '阮小二',
    '单雄信',
    '苏轼',
    '石秀',
    '史湘云',
    '孙悟空',
    '宋江',
    '沈眉庄',
    '施小雅',
    '唐寅',
    '陶朱',
    '汤唯',
    '铁拐李',
    'Una',
    'Vivian',
    '王维',
    '吴刚',
    '魏征',
    '温宁',
    '徐霞',
    '薛涛',
    '夏侯惇',
    '谢小楼',
    '项少龙',
    '颜回',
    '虞姬',
    '严守一',
    '余则成',
    '杨过',
    '叶问',
    '张良',
    '庄周',
    '赵子龙',
    '郑和',
    '周瑜',
    '朱迪',
    '曾小贤',
  ]
  const groups = groupByIndexLetter(names, (name) => name, { surname: true })

  // 可调高度变体：滑杆经 CSS 变量驱动滚动体 max-height，List 内部的 ResizeObserver 会实时重算压缩档
  const [bodyHeight, setBodyHeight] = useState(280)

  // 分类数量滑杆变体：超市分类名池先按拼音归组排序（扁平化后仍保持拼音序，字母档
  // 不会触发排序契约告警），滑杆取前 N——默认 280px 高度下 N≤12 首字档、
  // 13~21 字母档、≥22 采样档，一杆看全三档
  const CATEGORY_POOL = [
    '水果类',
    '蔬菜类',
    '肉禽蛋',
    '海鲜水产',
    '粮油调味',
    '酒水饮料',
    '乳制品',
    '烘焙面点',
    '休闲零食',
    '糖果巧克力',
    '方便速食',
    '罐头腌渍',
    '茶叶咖啡',
    '个人护理',
    '美容护肤',
    '口腔护理',
    '纸品清洁',
    '家庭清洁',
    '厨房用品',
    '小家电',
    '数码配件',
    '文具玩具',
    '母婴用品',
    '宠物用品',
    '内衣袜子',
    '男装',
    '女装',
    '童装童鞋',
    '鞋靴箱包',
    '床上用品',
    '家居收纳',
    '绿植园艺',
    '五金工具',
    '汽车用品',
    '医药保健',
    '节令礼品',
  ]
  const sortedCategories = groupByIndexLetter(CATEGORY_POOL, (cat) => cat).flatMap(
    (group) => group.items,
  )
  const [catCount, setCatCount] = useState(8)

  const renderCategorySections = () =>
    sortedCategories.slice(0, catCount).map((cat) => (
      <ListSection key={cat} id={`cat-${cat}`} title={cat}>
        <ListItem label={`${cat}·精选`} value="详情" accessory="disclosure" onClick={() => {}} />
        <ListItem label={`${cat}·促销`} value="详情" accessory="disclosure" onClick={() => {}} />
        <ListItem label={`${cat}·新品`} value="详情" accessory="disclosure" onClick={() => {}} />
      </ListSection>
    ))

  const renderSections = () =>
    groups.map((group) => (
      <ListSection key={group.label} id={group.label} title={group.label}>
        {group.items.map((name) => (
          <ListItem key={name} label={name} value="详情" accessory="disclosure" onClick={() => {}} />
        ))}
      </ListSection>
    ))

  // 姓氏模式对比用的小名单：默认词典按普通话默认读音归组（曾→C/单→D/仇→C），
  // surname 开启才按姓氏读音（曾→Z/单→S/仇→Q）
  const MINI_NAMES = ['曾小明', '单雄信', '仇英']
  const renderMiniGroups = (surname: boolean) =>
    groupByIndexLetter(MINI_NAMES, (name) => name, { surname }).map((group) => (
      <ListSection
        key={`${surname}-${group.label}`}
        id={`${surname}-${group.label}`}
        title={group.label}
      >
        {group.items.map((name) => (
          <ListItem key={name} label={name} accessory="disclosure" />
        ))}
      </ListSection>
    ))

  return (
    <DemoVariants>
      <DemoVariant label="分类数量滑杆：三档全自动——节少条上显示标题首字（水果类→水），节多降为拼音首字母（水果类→S），再多槽位放不下走隔位采样" wide>
        <IosRangeSlider
          value={catCount}
          min={4}
          max={36}
          step={1}
          suffix="节"
          label="分类数量"
          marks={[
            { value: 12, label: '首字上限' },
            { value: 22, label: '采样' },
          ]}
          onChange={setCatCount}
        />
        <List indexBar scrollable>{renderCategorySections()}</List>
      </DemoVariant>
      <DemoVariant label="拖滑杆调高度：索引条实时在 全字母 / 隔位采样 之间切换" wide>
        <div
          class="ui-kit-demo__index-height-host"
          style={{ ['--ui-kit-demo-index-height' as string]: `${bodyHeight}px` }}
        >
          <IosRangeSlider
            value={bodyHeight}
            min={120}
            max={600}
            step={10}
            suffix="px"
            label="滚动体高度"
            marks={[
              { value: 280, label: '默认' },
              { value: 440, label: '全字母' },
            ]}
            onChange={setBodyHeight}
          />
          <List indexBar scrollable bodyClass="ui-kit-demo__list-body-variable">
            {renderSections()}
          </List>
        </div>
      </DemoVariant>
      <DemoVariant label="空间充足：27 格全字母（440px）" wide>
        <List indexBar scrollable bodyClass="ui-kit-demo__list-body-tall">
          {renderSections()}
        </List>
      </DemoVariant>
      <DemoVariant label="空间不足：只渲染采样字母（触点按全节等比映射）">
        <List indexBar scrollable>{renderSections()}</List>
      </DemoVariant>
      <DemoVariant label="节标题悬停：滚到滚动体顶部即钉住、被下一节顶走（无索引条）">
        <List scrollable>{renderSections()}</List>
      </DemoVariant>
      <DemoVariant label="词组节标题：左侧完整词组，节少时条上自动显示标题首字（水果类→水、蔬菜类→蔬），同条标签语言统一；id 只做锚点可任意命名">
        <List indexBar scrollable>
          <ListSection id="fruit" title="水果类">
            <ListItem label="苹果" value="详情" accessory="disclosure" onClick={() => {}} />
            <ListItem label="香蕉" value="详情" accessory="disclosure" onClick={() => {}} />
            <ListItem label="脐橙" value="详情" accessory="disclosure" onClick={() => {}} />
            <ListItem label="葡萄" value="详情" accessory="disclosure" onClick={() => {}} />
          </ListSection>
          <ListSection id="veg" title="蔬菜类">
            <ListItem label="白菜" value="详情" accessory="disclosure" onClick={() => {}} />
            <ListItem label="菠菜" value="详情" accessory="disclosure" onClick={() => {}} />
            <ListItem label="青椒" value="详情" accessory="disclosure" onClick={() => {}} />
            <ListItem label="茄子" value="详情" accessory="disclosure" onClick={() => {}} />
          </ListSection>
        </List>
      </DemoVariant>
      <DemoVariant label="indexLabel 显式覆盖：显式值任何档位原样上条（可与首字/拼音都无关，派生不准时兜底）">
        <List indexBar scrollable>
          <ListSection id="clearance" title="清仓特惠" indexLabel="C">
            <ListItem label="库存尾货" value="详情" accessory="disclosure" onClick={() => {}} />
          </ListSection>
          <ListSection id="hot" title="热销单品" indexLabel="H">
            <ListItem label="本周销冠" value="详情" accessory="disclosure" onClick={() => {}} />
          </ListSection>
          <ListSection id="new-arrival" title="新品上架" indexLabel="N">
            <ListItem label="首发开售" value="详情" accessory="disclosure" onClick={() => {}} />
          </ListSection>
        </List>
      </DemoVariant>
      <DemoVariant label="姓氏模式对比：默认词典把多音姓按默认读音归组（曾→C/单→D/仇→C），surname 显式开启才按姓氏读音（曾→Z/单→S/仇→Q）；普通词勿开（曾经沧海→zeng…）">
        <List title="默认词典">
          {renderMiniGroups(false)}
        </List>
        <List title="surname: true（人名列表用）">
          {renderMiniGroups(true)}
        </List>
      </DemoVariant>
      <DemoVariant label="乱序数据：条上字母乱序（M→A→Z），跳转仍工作但语义错乱，dev 控制台出排序契约告警（生产静默）——数据侧应 groupByIndexLetter 归组或修正节顺序">
        <List indexBar scrollable>
          <ListSection id="demo-m" title="M">
            <ListItem label="马良" value="详情" accessory="disclosure" onClick={() => {}} />
            <ListItem label="米芾" value="详情" accessory="disclosure" onClick={() => {}} />
          </ListSection>
          <ListSection id="demo-a" title="A">
            <ListItem label="阿福" value="详情" accessory="disclosure" onClick={() => {}} />
            <ListItem label="安琪" value="详情" accessory="disclosure" onClick={() => {}} />
          </ListSection>
          <ListSection id="demo-z" title="Z">
            <ListItem label="张良" value="详情" accessory="disclosure" onClick={() => {}} />
          </ListSection>
        </List>
      </DemoVariant>
    </DemoVariants>
  )
}

export function ListEditingDemo() {
  const INITIAL_SHOPPING = [
    { id: 'milk', label: '牛奶', qty: '×2' },
    { id: 'eggs', label: '鸡蛋', qty: '×12' },
    { id: 'bread', label: '吐司', qty: '×1' },
    { id: 'coffee', label: '咖啡豆', qty: '×1' },
    { id: 'apple', label: '苹果', qty: '×6' },
    { id: 'yogurt', label: '酸奶', qty: '×4' },
    { id: 'tissue', label: '纸巾', qty: '×1' },
    { id: 'detergent', label: '洗衣液', qty: '×1' },
  ]
  const [editing, setEditing] = useState(false)
  const [shopping, setShopping] = useState(INITIAL_SHOPPING)

  const reorder = (fromId: string, toId: string) => {
    setShopping((prev) => {
      const from = prev.findIndex((it) => it.id === fromId)
      const to = prev.findIndex((it) => it.id === toId)
      if (from < 0 || to < 0) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  return (
    <DemoVariants>
      <DemoVariant label="「编辑」进出：减号删除 / 把手重排" wide>
        <div class="ui-kit-demo__row">
          <Button onClick={() => setEditing(!editing)}>
            {editing ? '完成' : '编辑'}
          </Button>
          {!editing && shopping.length !== INITIAL_SHOPPING.length && (
            <Button onClick={() => setShopping(INITIAL_SHOPPING)}>
              还原清单
            </Button>
          )}
        </div>
        <List
          editing={editing}
          onDelete={(id) => setShopping((prev) => prev.filter((it) => it.id !== id))}
          onReorder={reorder}
        >
          {shopping.map((item) => (
            <ListItem key={item.id} id={item.id} label={item.label} value={item.qty} />
          ))}
        </List>
        {shopping.length === 0 && <p class="list__footnote">清单已清空</p>}
      </DemoVariant>
    </DemoVariants>
  )
}

type PlainThread = {
  id: string
  label: string
  trailing: string
  subtitle: string
  preview: string
  unread: boolean
}

const PLAIN_THREADS: PlainThread[] = [
  {
    id: 't1',
    label: '设计组',
    trailing: '10:24',
    subtitle: 'Q3 视觉规范终稿',
    preview: '打印样张已经寄出，收到后请确认色差再回签。',
    unread: true,
  },
  {
    id: 't2',
    label: 'John Doe',
    trailing: '昨天',
    subtitle: 'Re: instant-app 发版计划',
    preview: '周四上午十点窗口，改动冻结提前到周三晚。',
    unread: false,
  },
  {
    id: 't3',
    label: 'GitHub',
    trailing: '周二',
    subtitle: '[instant-app] PR #42 已合并',
    preview: 'fix(ui): flat 引擎进退窗口 header 下边框在动画中变深。',
    unread: false,
  },
  {
    id: 't4',
    label: '机场快线',
    trailing: '9月1日',
    subtitle: '行程提醒',
    preview: '您预订的 9 月 3 日 08:30 班次即将出发。',
    unread: false,
  },
  {
    id: 't5',
    label: '账单中心',
    trailing: '8月30日',
    subtitle: '8 月账单已出',
    preview: '本期应缴 ¥42.00，点击查看明细。',
    unread: false,
  },
]

export function ListPlainVariantDemo() {
  const [variant, setVariant] = useState<'grouped' | 'plain'>('plain')
  const [selectedId, setSelectedId] = useState('t2')

  return (
    <DemoVariants>
      <DemoVariant label="variant 现场切换：同一组件同一份数据，传参换装（plain 专属槽位 trailing/preview/unread 在 grouped 下忽略）" wide>
        <SegmentedControl
          ariaLabel="List 变体"
          value={variant}
          onChange={setVariant}
          items={[
            { id: 'grouped', label: 'grouped 设置' },
            { id: 'plain', label: 'plain 邮件' },
          ]}
        />
        <List variant={variant} selectedId={selectedId} onSelect={setSelectedId}>
          {PLAIN_THREADS.map((thread) => (
            <ListItem
              key={thread.id}
              id={thread.id}
              label={thread.label}
              trailing={thread.trailing}
              subtitle={thread.subtitle}
              preview={thread.preview}
              unread={thread.unread}
              accessory="check"
            />
          ))}
        </List>
        <p class="ui-kit-demo__status">
          当前变体：{variant} · 选中：{selectedId}
        </p>
      </DemoVariant>
    </DemoVariants>
  )
}

export function ListPlainEditingDemo() {
  const [editing, setEditing] = useState(false)
  const [threads, setThreads] = useState(PLAIN_THREADS)

  const reorder = (fromId: string, toId: string) => {
    setThreads((prev) => {
      const from = prev.findIndex((it) => it.id === fromId)
      const to = prev.findIndex((it) => it.id === toId)
      if (from < 0 || to < 0) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  return (
    <DemoVariants>
      <DemoVariant label="「编辑」进出：减号删除 / 把手重排（plain 分支与 grouped 共用同一套机制）" wide>
        <div class="ui-kit-demo__row">
          <Button onClick={() => setEditing(!editing)}>
            {editing ? '完成' : '编辑'}
          </Button>
          {!editing && threads.length !== PLAIN_THREADS.length && (
            <Button onClick={() => setThreads(PLAIN_THREADS)}>
              还原列表
            </Button>
          )}
        </div>
        <List
          variant="plain"
          editing={editing}
          onDelete={(id) => setThreads((prev) => prev.filter((it) => it.id !== id))}
          onReorder={reorder}
        >
          {threads.map((thread) => (
            <ListItem
              key={thread.id}
              id={thread.id}
              label={thread.label}
              trailing={thread.trailing}
              subtitle={thread.subtitle}
              preview={thread.preview}
              unread={thread.unread}
            />
          ))}
        </List>
        {threads.length === 0 && <p class="ui-kit-demo__status">列表已清空</p>}
      </DemoVariant>
    </DemoVariants>
  )
}

export function SettingsNavRowDemo() {
  const [account, setAccount] = useState('user@example.com')
  const [clicked, setClicked] = useState(false)

  return (
    <DemoVariants>
      <DemoVariant label="普通导航" wide>
        <SettingsGroup>
          <SettingsNavRow
            label="账号设置"
            value={account}
            onClick={() => {
              setClicked(true)
              setAccount(account === 'user@example.com' ? '已进入' : 'user@example.com')
            }}
          />
          <SettingsNavRow label="存储空间" value="12.4 GB" onClick={() => setClicked(true)} />
          <SettingsNavRow label="关于本机" value="" onClick={() => setClicked(true)} />
        </SettingsGroup>
        {clicked && <p class="ui-kit-demo__status">已点击导航行</p>}
      </DemoVariant>
      <DemoVariant label="密钥掩码" wide>
        <SettingsGroup>
          <SettingsNavRow
            label="API Key"
            value=""
            secretLength={24}
            onClick={() => undefined}
          />
          <SettingsNavRow label="未设置密钥" value="未设置" onClick={() => undefined} />
        </SettingsGroup>
      </DemoVariant>
      <DemoVariant label="禁用">
        <SettingsGroup>
          <SettingsNavRow label="不可用" value="—" disabled onClick={() => undefined} />
        </SettingsGroup>
      </DemoVariant>
    </DemoVariants>
  )
}

export function SettingsSwitchRowDemo() {
  const [notifications, setNotifications] = useState(true)
  const [sounds, setSounds] = useState(false)
  const [badge, setBadge] = useState(true)

  return (
    <DemoVariants>
      <DemoVariant label="开关组合" wide>
        <SettingsGroup>
          <SettingsSwitchRow
            label="启用通知"
            checked={notifications}
            onChange={setNotifications}
          />
          <SettingsSwitchRow label="提示音" checked={sounds} onChange={setSounds} />
          <SettingsSwitchRow label="角标" checked={badge} onChange={setBadge} />
        </SettingsGroup>
      </DemoVariant>
    </DemoVariants>
  )
}

export function SettingsStepperRowDemo() {
  const [fontSize, setFontSize] = useState(13)
  const [retries, setRetries] = useState(10)
  const [concurrency, setConcurrency] = useState(5)

  return (
    <DemoVariants>
      <DemoVariant label="点击弹出步进" wide>
        <div class="settings" style={{ position: 'relative', minHeight: 220 }}>
          <SettingsGroup>
            <SettingsStepperRow
              label="字号"
              value={fontSize}
              min={10}
              max={24}
              onChange={setFontSize}
            />
            <SettingsStepperRow
              label="空闲重试"
              value={retries}
              min={0}
              max={50}
              onChange={setRetries}
            />
            <SettingsStepperRow
              label="并发上限"
              value={concurrency}
              min={1}
              max={20}
              onChange={setConcurrency}
            />
          </SettingsGroup>
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}

export function SettingsCheckRowDemo() {
  const [vision, setVision] = useState(true)
  const [speech, setSpeech] = useState(false)
  const [tts, setTts] = useState(false)

  return (
    <DemoVariants>
      <DemoVariant label="可切换勾选" wide>
        <SettingsGroup>
          <SettingsCheckRow label="图像识别" checked={vision} onChange={setVision} />
          <SettingsCheckRow label="语音识别" checked={speech} onChange={setSpeech} />
          <SettingsCheckRow label="语音合成" checked={tts} onChange={setTts} />
        </SettingsGroup>
      </DemoVariant>
      <DemoVariant label="禁用 / 锁定项" wide>
        <SettingsGroup>
          <SettingsCheckRow
            label="文本"
            checked
            disabled
            onChange={() => undefined}
          />
          <SettingsCheckRow
            label="语音识别"
            checked={false}
            disabled
            onChange={() => undefined}
          />
          <SettingsCheckRow
            label="语音合成"
            checked={false}
            disabled
            onChange={() => undefined}
          />
        </SettingsGroup>
        <p class="ui-kit-demo__status">禁用项使用灰底灰字，勾也为灰色</p>
      </DemoVariant>
    </DemoVariants>
  )
}

export function SettingsInlineInputRowDemo() {
  const [name, setName] = useState('Instant')
  const [url, setUrl] = useState('https://example.com')
  const [secret, setSecret] = useState('')

  return (
    <DemoVariants>
      <DemoVariant label="文本 / URL / 密码" wide>
        <SettingsGroup>
          <SettingsInlineInputRow label="显示名称" value={name} onChange={setName} placeholder="名称" />
          <SettingsInlineInputRow
            label="服务地址"
            value={url}
            onChange={setUrl}
            type="url"
            placeholder="https://"
          />
          <SettingsInlineInputRow
            label="密钥"
            value={secret}
            onChange={setSecret}
            type="password"
            placeholder="可选"
          />
        </SettingsGroup>
      </DemoVariant>
    </DemoVariants>
  )
}

export function DocumentTabBarDemo() {
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

export function AdaptiveActionMenuDemo() {
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

export function AdaptiveSplitNavDemo() {
  const { openApp } = useOs()
  return (
    <div class="ui-kit-demo__app-launch">
      <p class="ui-kit-demo__status">
        布局原语，需整应用承载：拖窗口边缘跨过宽度阈值形态即时跟随，松手或双击标题栏播完整滑轨形变。分栏宽度 ≤640 时左右栏固定 50/50（紧凑档），≥700 恢复 listRatio 比例。
      </p>
      <Button tone="primary" onClick={() => openApp('nav-kit-demo')}>
        打开「导航组件演示」应用
      </Button>
    </div>
  )
}

export function WindowModalDemo() {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [dangerOpen, setDangerOpen] = useState(false)
  const [wideOpen, setWideOpen] = useState(false)
  const [chromeOpen, setChromeOpen] = useState(false)
  const [result, setResult] = useState('')

  return (
    <DemoVariants>
      <DemoVariant label="确认对话框">
        <button
          type="button"
          class="ui-kit-demo__ghost-btn ui-kit-demo__ghost-btn--accent"
          onClick={() => setConfirmOpen(true)}
        >
          打开确认框
        </button>
        <WindowModal
          open={confirmOpen}
          title="确认操作"
          onClose={() => {
            setResult('已取消')
            setConfirmOpen(false)
          }}
          actions={[
            {
              label: '取消',
              onClick: () => {
                setResult('已取消')
                setConfirmOpen(false)
              },
            },
            {
              label: '确认',
              tone: 'primary',
              onClick: () => {
                setResult('已确认')
                setConfirmOpen(false)
              },
            },
          ]}
        >
          <p>确定要执行此操作吗？</p>
        </WindowModal>
      </DemoVariant>

      <DemoVariant label="危险操作">
        <button type="button" class="ui-kit-demo__ghost-btn" onClick={() => setDangerOpen(true)}>
          打开删除确认
        </button>
        <WindowModal
          open={dangerOpen}
          title="删除项目"
          role="alertdialog"
          onClose={() => setDangerOpen(false)}
          actions={[
            { label: '取消', onClick: () => setDangerOpen(false) },
            {
              label: '删除',
              tone: 'danger',
              onClick: () => {
                setResult('已删除')
                setDangerOpen(false)
              },
            },
          ]}
        >
          <p>此操作无法撤销。</p>
        </WindowModal>
      </DemoVariant>

      <DemoVariant label="宽对话框">
        <button type="button" class="ui-kit-demo__ghost-btn" onClick={() => setWideOpen(true)}>
          打开宽对话框
        </button>
        <WindowModal
          open={wideOpen}
          title="详细说明"
          wide
          scrollBody
          onClose={() => setWideOpen(false)}
          actions={[{ label: '关闭', tone: 'primary', onClick: () => setWideOpen(false) }]}
        >
          <p>wide + scrollBody 适合较长说明或表单内容。</p>
          <p style={{ marginTop: 8, color: '#666' }}>
            可在此处放置多段文字、列表或设置表单。
          </p>
        </WindowModal>
      </DemoVariant>

      <DemoVariant label="左对齐标题栏 + 副标题 + 关闭钮">
        <button type="button" class="ui-kit-demo__ghost-btn" onClick={() => setChromeOpen(true)}>
          打开历史记录风格
        </button>
        <WindowModal
          open={chromeOpen}
          title="历史记录"
          subtitle="72 个页面"
          titleAlign="left"
          showCloseButton
          onClose={() => setChromeOpen(false)}
          actions={[
            {
              label: '清空历史记录',
              tone: 'danger',
              onClick: () => setChromeOpen(false),
            },
          ]}
        >
          <p class="window-modal__message">浏览历史列表示例内容。</p>
        </WindowModal>
      </DemoVariant>

      {result && (
        <DemoVariant label="结果" wide>
          <p class="ui-kit-demo__status">结果: {result}</p>
        </DemoVariant>
      )}
    </DemoVariants>
  )
}

/** 迷你窗：打开一扇真实窗（files-op-progress 空态只有一行字），看内容撑起尺寸 */
export function MiniWindowDemo() {
  const { openApp } = useOs()
  return (
    <div class="ui-kit-demo__app-launch">
      <p class="ui-kit-demo__status">
        点按后打开一扇真实迷你窗（进度应用空态，只有一行字）：窗口就只有一行正文加标题栏那么大；
        可拖动移动，边缘无缩放手柄，拖到屏幕边不吸附，双击标题栏不最大化。
      </p>
      <Button tone="primary" onClick={() => openApp('files-op-progress', { chromeKind: 'mini' })}>
        打开迷你窗
      </Button>
    </div>
  )
}

export function IosNavBackButtonDemo() {
  const [page, setPage] = useState<'list' | 'detail'>('detail')

  return (
    <DemoVariants>
      <DemoVariant label="返回导航">
        {page === 'detail' ? (
          <div class="ui-kit-demo__nav-chrome">
            <IosNavBackButton label="设置" onClick={() => setPage('list')} />
            <span class="ui-kit-demo__nav-title">账号</span>
          </div>
        ) : (
          <div class="ui-kit-demo__nav-chrome">
            <span class="ui-kit-demo__nav-title">设置</span>
            <button type="button" class="ui-kit-demo__ghost-btn" onClick={() => setPage('detail')}>
              进入子页
            </button>
          </div>
        )}
      </DemoVariant>
      <DemoVariant label="禁用">
        <IosNavBackButton label="返回" onClick={() => undefined} disabled />
      </DemoVariant>
    </DemoVariants>
  )
}

export function EmojiPickerPopoverDemo() {
  const [emoji, setEmoji] = useState('🐱')
  const [custom, setCustom] = useState('🚀')

  return (
    <DemoVariants>
      <DemoVariant label="默认触发器">
        <EmojiPickerPopover value={emoji} onChange={setEmoji} triggerLabel="选择图标" />
      </DemoVariant>
      <DemoVariant label="自定义触发器内容">
        <EmojiPickerPopover value={custom} onChange={setCustom}>
          <span class="ui-kit-demo__emoji-trigger">
            <span aria-hidden="true">{custom}</span>
            更换表情
          </span>
        </EmojiPickerPopover>
      </DemoVariant>
    </DemoVariants>
  )
}

export function AiModelCapabilityTagsDemo() {
  const [caps, setCaps] = useState<Array<'text' | 'vision'>>(['text', 'vision'])

  return (
    <DemoVariants>
      <DemoVariant label="只读展示">
        <AiModelCapabilityTags capabilities={['text', 'speech-recognition']} />
      </DemoVariant>
      <DemoVariant label="可编辑视觉能力">
        <AiModelCapabilityTags
          capabilities={caps}
          visionEditable
          onVisionChange={(supportsVision) =>
            setCaps(supportsVision ? ['text', 'vision'] : ['text'])
          }
        />
      </DemoVariant>
    </DemoVariants>
  )
}

export function PopoverDemo() {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLSpanElement>(null)

  return (
    <DemoVariants>
      <DemoVariant label="锚定气泡（箭头跟随触发器）" wide>
        <div class="ui-kit-demo__row">
          <span ref={anchorRef}>
            <Button onClick={() => setOpen(!open)}>
              {open ? '关闭气泡' : '打开气泡'}
            </Button>
          </span>
          <Popover
            open={open}
            anchorRef={anchorRef}
            onClose={() => setOpen(false)}
            ariaLabel="示例气泡"
          >
            我是带箭头的气泡：靠近视口底部自动向上翻，超出视口自动夹紧，箭头始终指向触发器。
          </Popover>
        </div>
      </DemoVariant>
      <DemoVariant label="窄窗自适应">
        <span class="ui-kit-demo__hint">把窗口拖窄到 520px 以下，上面的气泡会变成居中模态对话框</span>
      </DemoVariant>
    </DemoVariants>
  )
}

export function HelpHintDemo() {
  return (
    <DemoVariants>
      <DemoVariant label="行内提示">
        <div class="ui-kit-demo__row ui-kit-demo__row--labeled">
          <span class="ui-kit-demo__hint">机会压缩</span>
          <HelpHint
            text="开启后尽量以稀疏分块存储：缺席的全零块不落库，写入全零自动打洞"
            label="机会压缩说明"
          />
        </div>
      </DemoVariant>
      <DemoVariant label="长文案（视口边缘自动翻转 / 夹紧）">
        <HelpHint text="这是一段较长的说明文字，用于验证气泡在窗口边缘的定位：靠近视口底部时自动向上弹出，宽度超出视口时自动收窄夹紧。" />
      </DemoVariant>
    </DemoVariants>
  )
}

type DemoTreeNode = {
  id: string
  label: string
  size: number
  children?: DemoTreeNode[]
  /** 懒加载分支：展开时由 onExpandedChange 异步注入子级 */
  lazy?: boolean
}

const DEMO_TREE: DemoTreeNode[] = [
  {
    id: 'photos',
    label: '照片',
    size: 2_400_000_000,
    children: [
      { id: 'photos-2024', label: '2024 年', size: 1_100_000_000 },
      {
        id: 'photos-2025',
        label: '2025 年',
        size: 1_300_000_000,
        children: [
          { id: 'photos-2025-08', label: '八月', size: 420_000_000 },
          { id: 'photos-2025-09', label: '九月', size: 880_000_000 },
        ],
      },
    ],
  },
  {
    id: 'downloads',
    label: '下载',
    size: 860_000_000,
    children: [
      { id: 'downloads-iso', label: '系统镜像', size: 640_000_000 },
      { id: 'downloads-misc', label: '其他', size: 220_000_000 },
    ],
  },
  { id: 'documents', label: '文稿', size: 150_000_000 },
]

export function TreeViewDemo() {
  const [selectedId, setSelectedId] = useState<string | undefined>('photos-2025-08')

  return (
    <DemoVariants>
      <DemoVariant label="展开 / 折叠 / 选中" wide>
        <div class="ui-kit-demo__tree">
          <TreeView
            nodes={DEMO_TREE}
            defaultExpandedIds={['photos', 'photos-2025', 'downloads']}
            selectedId={selectedId}
            onSelect={(node) => setSelectedId(node.id)}
            renderNode={(node) => (
              <>
                <span class="ui-kit-demo__tree-label">{node.label}</span>
                <span class="ui-kit-demo__tree-size">{formatStorageSize(node.size)}</span>
              </>
            )}
          />
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}

/** 增删动画演示的共用状态机：nodes 派生更新 + 选中态，四个动作全部数据驱动。 */
function useTreePlayground(initialNodes: DemoTreeNode[] | (() => DemoTreeNode[]), initialSelectedId?: string) {
  const [nodes, setNodes] = useState<DemoTreeNode[]>(initialNodes)
  const [selectedId, setSelectedId] = useState<string | undefined>(initialSelectedId)
  const seqRef = useRef(0)

  const makeNode = (): DemoTreeNode => {
    const n = ++seqRef.current
    return { id: `new-${n}`, label: `新项目 ${n}`, size: 12_000_000 * n }
  }

  const insertAbove = () => {
    const node = makeNode()
    setNodes((prev) => insertNodeAround(prev, selectedId, node, -1))
    setSelectedId(node.id)
  }

  const insertBelow = () => {
    const node = makeNode()
    setNodes((prev) => insertNodeAround(prev, selectedId, node, 1))
    setSelectedId(node.id)
  }

  const insertChild = () => {
    const node = makeNode()
    setNodes((prev) => insertNodeInto(prev, selectedId, node))
    setSelectedId(node.id)
  }

  const deleteSelected = () => {
    if (!selectedId) return
    // 只删数据；选中走向交给 TreeView 的 removalSelection（经 onSelect 回流），
    // 'none' 时残留 id 不高亮，视觉等同清空
    setNodes((prev) => removeNodeById(prev, selectedId))
  }

  return { nodes, selectedId, setSelectedId, insertAbove, insertBelow, insertChild, deleteSelected }
}

/** 增删动效演示的操作按钮行（上方/下方/子级插入 + 删除选中）。 */
function TreePlaygroundActions({
  insertAbove,
  insertBelow,
  insertChild,
  deleteSelected,
  disabled,
}: {
  insertAbove: () => void
  insertBelow: () => void
  insertChild: () => void
  deleteSelected: () => void
  disabled: boolean
}) {
  return (
    <div class="ui-kit-demo__tree-actions">
      <button type="button" class="ui-kit-demo__ghost-btn" onClick={insertAbove}>
        上方插入
      </button>
      <button type="button" class="ui-kit-demo__ghost-btn" onClick={insertBelow}>
        下方插入
      </button>
      <button type="button" class="ui-kit-demo__ghost-btn" onClick={insertChild}>
        插入到选中项下
      </button>
      <button
        type="button"
        class="ui-kit-demo__ghost-btn ui-kit-demo__ghost-btn--accent"
        onClick={deleteSelected}
        disabled={disabled}
      >
        删除选中
      </button>
    </div>
  )
}

/** 删除选中后的补选策略三档（TreeView 的 removalSelection）。 */
const REMOVAL_SELECTION_ITEMS: readonly { id: TreeViewRemovalSelection; label: string }[] = [
  { id: 'none', label: '不自动选中' },
  { id: 'prefer-previous', label: '优先前一个' },
  { id: 'prefer-next', label: '优先后一个' },
]

export function TreeViewInteractiveDemo() {
  const { nodes, selectedId, setSelectedId, insertAbove, insertBelow, insertChild, deleteSelected } =
    useTreePlayground(DEMO_TREE, 'photos-2025-08')
  const [removalSelection, setRemovalSelection] = useState<TreeViewRemovalSelection>('prefer-next')

  return (
    <DemoVariants>
      <DemoVariant label="上方 / 下方插入选中行、插入到选中项下、删除选中（行高展开收起 + 淡入淡出）；删除后按补选策略自动选中相邻行" wide>
        <div class="ui-kit-demo__tree">
          <TreeView
            nodes={nodes}
            defaultExpandedIds={['photos', 'photos-2025', 'downloads']}
            selectedId={selectedId}
            removalSelection={removalSelection}
            onSelect={(node) => setSelectedId(node.id)}
            renderNode={(node) => (
              <>
                <span class="ui-kit-demo__tree-label">{node.label}</span>
                <span class="ui-kit-demo__tree-size">{formatStorageSize(node.size)}</span>
              </>
            )}
          />
        </div>
        <div class="ui-kit-demo__tree-actions">
          <SegmentedControl
            value={removalSelection}
            items={REMOVAL_SELECTION_ITEMS}
            onChange={setRemovalSelection}
            ariaLabel="删除选中后的补选策略"
          />
        </div>
        <TreePlaygroundActions
          insertAbove={insertAbove}
          insertBelow={insertBelow}
          insertChild={insertChild}
          deleteSelected={deleteSelected}
          disabled={!selectedId}
        />
      </DemoVariant>
    </DemoVariants>
  )
}

/** 懒加载演示：lazy 标记的分支展开时先注入「加载中…」行（进场动画），模拟异步返回后替换为真实子级。 */
const LAZY_TREE: DemoTreeNode[] = [
  {
    id: 'nas',
    label: 'NAS 共享',
    size: 4_800_000_000,
    children: [
      { id: 'nas-docs', label: '文档', size: 920_000_000, lazy: true },
      { id: 'nas-music', label: '音乐', size: 1_200_000_000, lazy: true },
      {
        id: 'nas-photos',
        label: '照片',
        size: 2_600_000_000,
        children: [
          { id: 'nas-photos-2025', label: '2025 年', size: 800_000_000 },
          { id: 'nas-photos-2024', label: '2024 年', size: 1_100_000_000 },
        ],
      },
    ],
  },
]

/** 模拟异步返回的子级（按父节点生成固定三条）。 */
function loadChildrenFor(node: DemoTreeNode): DemoTreeNode[] {
  return [
    { id: `${node.id}-sub1`, label: `${node.label} · 归档`, size: 210_000_000 },
    { id: `${node.id}-sub2`, label: `${node.label} · 进行中`, size: 96_000_000 },
    { id: `${node.id}-sub3`, label: `${node.label} · 已分享`, size: 44_000_000 },
  ]
}

export function TreeViewLazyLoadDemo() {
  const [nodes, setNodes] = useState<DemoTreeNode[]>(LAZY_TREE)
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const loadTimerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (loadTimerRef.current !== undefined) window.clearTimeout(loadTimerRef.current)
    }
  }, [])

  const handleExpandedChange = (node: DemoTreeNode, expanded: boolean) => {
    if (!expanded || node.lazy !== true) return
    const firstChild = node.children?.[0]
    // 已有真实子级（含已加载完成）就不再重复加载；「加载中…」行是唯一子级时继续等待
    if (node.children && node.children.length > 0 && firstChild && !firstChild.id.startsWith('loading:')) {
      return
    }
    if (loadTimerRef.current !== undefined) window.clearTimeout(loadTimerRef.current)
    setNodes((prev) =>
      replaceNodeChildren(prev, node.id, [{ id: `loading:${node.id}`, label: '加载中…', size: 0 }]),
    )
    loadTimerRef.current = window.setTimeout(() => {
      loadTimerRef.current = undefined
      setNodes((prev) => replaceNodeChildren(prev, node.id, loadChildrenFor(node)))
    }, 700)
  }

  return (
    <DemoVariants>
      <DemoVariant label="展开分支触发异步加载：先出「加载中…」行，数据返回后替换为真实子级（两种进场动画都能看到）" wide>
        <div class="ui-kit-demo__tree">
          <TreeView
            nodes={nodes}
            selectedId={selectedId}
            onSelect={(node) => setSelectedId(node.id)}
            onExpandedChange={handleExpandedChange}
            renderNode={(node) =>
              node.id.startsWith('loading:') ? (
                <span class="ui-kit-demo__tree-label ui-kit-demo__tree-loading">加载中…</span>
              ) : (
                <>
                  <span class="ui-kit-demo__tree-label">{node.label}</span>
                  <span class="ui-kit-demo__tree-size">{formatStorageSize(node.size)}</span>
                </>
              )
            }
          />
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}

/** 大数据量演示：15 个文件夹 × 10 个文件 = 165 行，全部默认展开，验证增删动画不随节点数变贵。 */
function buildBigTree(): DemoTreeNode[] {
  const folders: DemoTreeNode[] = []
  for (let f = 1; f <= 15; f++) {
    const files: DemoTreeNode[] = []
    for (let i = 1; i <= 10; i++) {
      files.push({ id: `folder-${f}-file-${i}`, label: `文件 ${f}-${i}.txt`, size: 1_000_000 + i * 100_000 })
    }
    folders.push({ id: `folder-${f}`, label: `文件夹 ${f}`, size: 800_000_000, children: files })
  }
  return folders
}

export function TreeViewBigDataDemo() {
  const { nodes, selectedId, setSelectedId, insertAbove, insertBelow, insertChild, deleteSelected } =
    useTreePlayground(buildBigTree, 'folder-1')
  const allFolderIds = Array.from({ length: 15 }, (_, i) => `folder-${i + 1}`)

  return (
    <DemoVariants>
      <DemoVariant label="160+ 行大树里上方 / 下方插入、删除选中仍流畅（删除后自动补选相邻行；树高固定，超出部分内部滚动）" wide>
        <div class="ui-kit-demo__tree">
          <TreeView
            nodes={nodes}
            defaultExpandedIds={allFolderIds}
            selectedId={selectedId}
            removalSelection="prefer-next"
            onSelect={(node) => setSelectedId(node.id)}
            renderNode={(node) => (
              <>
                <span class="ui-kit-demo__tree-label">{node.label}</span>
                <span class="ui-kit-demo__tree-size">{formatStorageSize(node.size)}</span>
              </>
            )}
          />
        </div>
        <TreePlaygroundActions
          insertAbove={insertAbove}
          insertBelow={insertBelow}
          insertChild={insertChild}
          deleteSelected={deleteSelected}
          disabled={!selectedId}
        />
      </DemoVariant>
    </DemoVariants>
  )
}

/** 递归查找节点（判断「选中节点是否已有子级」、插入前确认目标存在用）。 */
function findNodeById(nodes: DemoTreeNode[], id: string): DemoTreeNode | undefined {
  for (const item of nodes) {
    if (item.id === id) return item
    if (item.children) {
      const found = findNodeById(item.children, id)
      if (found) return found
    }
  }
  return undefined
}

/** 在 targetId 所在兄弟列表的 offset 偏移处插入（-1 上方、1 下方）；targetId 缺省/不存在则追加根层末尾。 */
function insertNodeAround(
  nodes: DemoTreeNode[],
  targetId: string | undefined,
  node: DemoTreeNode,
  offset: -1 | 1,
): DemoTreeNode[] {
  if (targetId === undefined || !findNodeById(nodes, targetId)) return [...nodes, node]
  const walk = (list: DemoTreeNode[]): DemoTreeNode[] => {
    const idx = list.findIndex((item) => item.id === targetId)
    if (idx !== -1) {
      const at = offset === -1 ? idx : idx + 1
      return [...list.slice(0, at), node, ...list.slice(at)]
    }
    return list.map((item) => (item.children ? { ...item, children: walk(item.children) } : item))
  }
  return walk(nodes)
}

/** 在 targetId 节点下追加（targetId 缺省则追加到根层末尾），演示子级插入动画。 */
function insertNodeInto(
  nodes: DemoTreeNode[],
  targetId: string | undefined,
  node: DemoTreeNode,
): DemoTreeNode[] {
  if (targetId === undefined) return [...nodes, node]
  return nodes.map((item) => {
    if (item.id === targetId) return { ...item, children: [...(item.children ?? []), node] }
    if (item.children) return { ...item, children: insertNodeInto(item.children, targetId, node) }
    return item
  })
}

/** 递归替换 targetId 节点的 children（懒加载注入「加载中…」/真实子级用）。 */
function replaceNodeChildren(
  nodes: DemoTreeNode[],
  targetId: string,
  children: DemoTreeNode[],
): DemoTreeNode[] {
  return nodes.map((item) => {
    if (item.id === targetId) return { ...item, children }
    if (item.children) return { ...item, children: replaceNodeChildren(item.children, targetId, children) }
    return item
  })
}

/** 递归删除 targetId 节点，演示收起动画。 */
function removeNodeById(nodes: DemoTreeNode[], targetId: string): DemoTreeNode[] {
  const filtered = nodes.filter((item) => item.id !== targetId)
  return filtered.map((item) =>
    item.children ? { ...item, children: removeNodeById(item.children, targetId) } : item,
  )
}

type MaterialIconCatalogModule = typeof import('./material-icon-catalog.generated.ts')
type MaterialIconRow = MaterialIconCatalogModule['MATERIAL_ICONS'][number]

const ICON_FAMILY_ITEMS = [
  { id: 'outlined', label: 'Outlined' },
  { id: 'rounded', label: 'Rounded' },
  { id: 'sharp', label: 'Sharp' },
] as const

/** 生成脚本已把 Google 原始类目归并为规范类目，这里只做显示层中文名；未命中的显示原文。Android 是题材类目（设备/系统相关图标），不是整库平台限定。 */
const ICON_CATEGORY_CN: Record<string, string> = {
  'Action': '操作',
  'Alert': '提醒',
  'Android': '安卓',
  'Audio & Video': '音视频',
  'Business': '商务',
  'Communication': '通讯',
  'Content': '内容',
  'Device': '设备',
  'Editor': '文本编辑',
  'Files': '文件',
  'Hardware': '硬件',
  'Home': '家居',
  'Images': '图像',
  'Maps': '地图',
  'Navigation': '导航',
  'Notification': '通知',
  'Places': '地点',
  'Privacy': '隐私',
  'Search': '搜索',
  'Social': '社交',
  'Text': '文本',
  'Toggle': '开关',
  'Transit': '交通',
  'Travel': '旅行',
}

const ICON_GRID_ROW_HEIGHT = 70
const ICON_GRID_CELL_WIDTH = 86
/** 与 `.ui-kit-demo__icon-row` 左右 padding 同值 */
const ICON_GRID_ROW_INSET = 6
const ICON_GRID_OVERSCAN = 3

/** 推荐名单查集：iOS 6 系统界面符号精选（名单与语义见 icon-recommended.ts） */
const ICON_RECOMMENDED_SET = new Set(ICON_RECOMMENDED_NAMES)

/** 目录数据 ~1.9MB，随本卡片动态 import 单独成 chunk，其余 demo 不为其买单。 */
export function IconDemo() {
  const [catalog, setCatalog] = useState<MaterialIconCatalogModule | null>(null)
  const [family, setFamily] = useState<IconFamily>('rounded')
  const [fill, setFill] = useState(false)
  const [weight, setWeight] = useState(400)
  const [query, setQuery] = useState('')
  /** null=全部；''=未分类；ICON_RECOMMENDED=推荐（iOS 6 系统符号精选）；其余为规范类目名。默认落在推荐。 */
  const [category, setCategory] = useState<string | null>(ICON_RECOMMENDED)
  const [copied, setCopied] = useState<string | null>(null)
  const [gridWidth, setGridWidth] = useState(0)
  const gridAreaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    import('./material-icon-catalog.generated.ts').then((mod) => {
      if (alive) setCatalog(mod)
    })
    return () => {
      alive = false
    }
  }, [])

  // gridarea 随 catalog 加载才挂载，跟随 catalog 重挂测量
  useLayoutEffect(() => {
    const el = gridAreaRef.current
    if (!catalog || !el) return
    const measure = () => setGridWidth(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [catalog])

  const rows = catalog?.MATERIAL_ICONS ?? null
  const normalizedQuery = query.trim().toLowerCase()
  const searching = normalizedQuery.length > 0

  // 当前字体族缺字形的图标直接不进目录，避免渲染出 ligature 原文
  const supportedRows = useMemo(() => {
    if (!rows) return null
    return rows.filter((row) => !row[3] || !row[3].split(',').includes(family))
  }, [rows, family])

  const categoryStats = useMemo(() => {
    const counts = new Map<string, number>()
    let uncategorized = 0
    if (!catalog || !supportedRows) return { counts, uncategorized, total: 0 }
    for (const cat of catalog.MATERIAL_ICON_CATEGORIES) counts.set(cat, 0)
    for (const row of supportedRows) {
      const cats = row[1] ? row[1].split(',') : []
      if (cats.length === 0) uncategorized++
      for (const cat of cats) counts.set(cat, (counts.get(cat) ?? 0) + 1)
    }
    return { counts, uncategorized, total: supportedRows.length }
  }, [catalog, supportedRows])

  // 推荐徽标数与其它徽标一样随字体族联动（名单本身三族全可用，此处仍按 supportedRows 现算以防名单日后收录缺字形图标）
  const recommendedCount = useMemo(() => {
    if (!supportedRows) return 0
    return supportedRows.filter((row) => ICON_RECOMMENDED_SET.has(row[0])).length
  }, [supportedRows])

  const visibleCategories = useMemo(() => {
    if (!catalog) return []
    return catalog.MATERIAL_ICON_CATEGORIES.filter((cat) => (categoryStats.counts.get(cat) ?? 0) > 0)
  }, [catalog, categoryStats])

  useEffect(() => {
    if (category === null) return
    if (category === ICON_RECOMMENDED) {
      // 哨兵不在 categoryStats.counts 里，必须走自己的空判断，否则会被下面的通用检查弹回全部
      if (recommendedCount === 0) setCategory(null)
      return
    }
    if (category === '') {
      if (categoryStats.uncategorized === 0) setCategory(null)
      return
    }
    if ((categoryStats.counts.get(category) ?? 0) === 0) setCategory(null)
  }, [category, categoryStats, recommendedCount])

  const filtered = useMemo(() => {
    if (!supportedRows) return null
    if (searching) {
      return supportedRows.filter((row) => `${row[0]} ${row[2]}`.includes(normalizedQuery))
    }
    if (category === null) return supportedRows
    if (category === ICON_RECOMMENDED) {
      return supportedRows.filter((row) => ICON_RECOMMENDED_SET.has(row[0]))
    }
    if (category === '') return supportedRows.filter((row) => !row[1])
    return supportedRows.filter((row) => row[1].split(',').includes(category))
  }, [supportedRows, searching, normalizedQuery, category])

  // 虚拟滚动按行喂：列数随容器宽度变化时整表重切；格宽固定，余数不进格子
  const columns = Math.max(1, Math.floor((gridWidth - ICON_GRID_ROW_INSET * 2) / ICON_GRID_CELL_WIDTH))
  const iconRows = useMemo(() => {
    if (!filtered || columns < 1) return []
    const result: MaterialIconRow[][] = []
    for (let i = 0; i < filtered.length; i += columns) {
      result.push(filtered.slice(i, i + columns))
    }
    return result
  }, [filtered, columns])

  const copyName = (name: string) => {
    navigator.clipboard.writeText(name).then(() => {
      setCopied(name)
      setTimeout(() => setCopied((current) => (current === name ? null : current)), 1200)
    }, () => {})
  }

  if (!catalog || !filtered) {
    return (
      <DemoVariants>
        <DemoVariant label="Icon 图标库" wide>
          <span class="ui-kit-demo__hint">加载图标目录…</span>
        </DemoVariant>
      </DemoVariants>
    )
  }

  const fmt = (n: number) => n.toLocaleString()
  const catClass = (value: string | null) =>
    `ui-kit-demo__icon-cat${!searching && category === value ? ' ui-kit-demo__icon-cat--active' : ''}`
  const renderCell = (row: MaterialIconRow) => (
    <button
      key={row[0]}
      type="button"
      class="ui-kit-demo__icon-cell"
      title={row[0]}
      onClick={() => copyName(row[0])}
    >
      <Icon name={row[0]} family={family} fill={fill} weight={weight} size={22} />
      <span class="ui-kit-demo__icon-name">{row[0]}</span>
    </button>
  )
  const renderRow = (row: MaterialIconRow[]) => (
    <div class="ui-kit-demo__icon-row" style={{ gridTemplateColumns: `repeat(${columns}, ${ICON_GRID_CELL_WIDTH}px)` }}>
      {row.map(renderCell)}
    </div>
  )
  const viewLabel = searching
    ? `搜索结果 · ${fmt(filtered.length)}`
    : category === null
      ? `全部 · ${fmt(categoryStats.total)}`
      : category === ICON_RECOMMENDED
        ? `推荐（iOS 6 系统符号） · ${fmt(recommendedCount)}`
        : category === ''
          ? '未分类'
          : `${ICON_CATEGORY_CN[category] ?? category}（${category}）`

  return (
    <DemoVariants>
      <DemoVariant label={viewLabel} wide>
        <div class="ui-kit-demo__icon-panel">
          <div class="ui-kit-demo__icon-toolbar">
            <div class="ui-kit-demo__icon-search">
              <IosTextField
                type="search"
                placeholder="搜索图标名或标签，如 trash…"
                value={query}
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </div>
            <SegmentedControl
              value={family}
              items={ICON_FAMILY_ITEMS}
              onChange={setFamily}
              ariaLabel="Material Symbols 字体族"
            />
            <div class="ui-kit-demo__icon-fill">
              <span class="ui-kit-demo__label">填充</span>
              <IosSwitch checked={fill} onChange={setFill} label="填充" />
            </div>
            <div class="ui-kit-demo__icon-slider">
              <span class="ui-kit-demo__label">字重</span>
              <IosRangeSlider
                value={weight}
                min={100}
                max={700}
                step={100}
                onChange={setWeight}
              />
            </div>
            {copied ? <span class="ui-kit-demo__icon-copied">已复制 {copied}</span> : undefined}
          </div>
          <div class="ui-kit-demo__icon-browser">
            <nav class="ui-kit-demo__icon-cats" aria-label="图标分类">
              <button
                type="button"
                class={catClass(ICON_RECOMMENDED)}
                onClick={() => setCategory(ICON_RECOMMENDED)}
              >
                <span class="ui-kit-demo__icon-cat-name">推荐</span>
                <span class="ui-kit-demo__icon-cat-count">{fmt(recommendedCount)}</span>
              </button>
              <button type="button" class={catClass(null)} onClick={() => setCategory(null)}>
                <span class="ui-kit-demo__icon-cat-name">全部</span>
                <span class="ui-kit-demo__icon-cat-count">{fmt(categoryStats.total)}</span>
              </button>
              {visibleCategories.map((cat) => (
                <button key={cat} type="button" class={catClass(cat)} onClick={() => setCategory(cat)}>
                  <span class="ui-kit-demo__icon-cat-name">{ICON_CATEGORY_CN[cat] ?? cat}</span>
                  <span class="ui-kit-demo__icon-cat-count">{fmt(categoryStats.counts.get(cat) ?? 0)}</span>
                </button>
              ))}
              {categoryStats.uncategorized > 0 ? (
                <button type="button" class={catClass('')} onClick={() => setCategory('')}>
                  <span class="ui-kit-demo__icon-cat-name">未分类</span>
                  <span class="ui-kit-demo__icon-cat-count">{fmt(categoryStats.uncategorized)}</span>
                </button>
              ) : undefined}
            </nav>
            <div class="ui-kit-demo__icon-gridarea" ref={gridAreaRef}>
              {iconRows.length > 0 ? (
                <FixedRowVirtualList
                  className="fixed-row-virtual-list ui-kit-demo__icon-scroller"
                  items={iconRows}
                  rowHeight={ICON_GRID_ROW_HEIGHT}
                  overscan={ICON_GRID_OVERSCAN}
                  itemKey={(row) => row[0][0]}
                  renderItem={renderRow}
                />
              ) : (
                <div class="ui-kit-demo__icon-empty">无匹配图标</div>
              )}
            </div>
          </div>
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}

/** 内凹演示用的图标名，三个画法共用同一排便于对照 */
const INSET_ICON_NAMES = ['home', 'favorite', 'star', 'delete', 'settings', 'lock']

const INSET_FILTER_ID = 'ui-kit-icon-inset'

/**
 * Icon 内凹效果演示：CSS 没有原生文字内阴影（text-shadow 只有外阴影，box-shadow inset 只作用于盒子），
 * 本卡对比两种画法——SVG 滤镜在字形 alpha 上挖顶/底缘月牙环填色叠回，是真·内阴影；
 * background-clip: text 塞渐变只是明暗模拟。深度/浓度/字重滑杆联动全部变体。
 */
export function IconInsetDemo() {
  const [depth, setDepth] = useState(1.25)
  const [strength, setStrength] = useState(0.45)
  const [weight, setWeight] = useState(400)
  // 渐变画法的暗端随浓度加深、随深度拉长，与滤镜画法共用同一组手感参数
  const simStyle: preact.JSX.CSSProperties = {
    background: `linear-gradient(180deg, rgba(0, 0, 0, ${(strength + 0.2).toFixed(2)}) 0%, rgba(0, 0, 0, ${(
      strength * 0.5 + 0.08
    ).toFixed(2)}) ${(45 - depth * 6).toFixed(0)}%, rgba(255, 255, 255, ${Math.min(1, strength * 1.5).toFixed(
      2,
    )}) 100%)`,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
  }
  // 卡片 demo 区是横向 flex，必须像 IconComboDemo 一样收成单一纵向根
  return (
    <div class="ui-kit-demo__icon-panel">
      <svg class="ui-kit-demo__inset-defs" aria-hidden="true">
        <filter
          id={INSET_FILTER_ID}
          x="-40%"
          y="-40%"
          width="180%"
          height="180%"
          color-interpolation-filters="sRGB"
        >
          {/* 顶缘内阴影：字形副本向下错位模糊后盖不住的顶缘月牙挖出来填深色 */}
          <feOffset in="SourceAlpha" dx="0" dy={depth} result="inset-off-down" />
          <feGaussianBlur in="inset-off-down" stdDeviation={depth * 0.6} result="inset-blur-down" />
          <feComposite in="SourceAlpha" in2="inset-blur-down" operator="out" result="inset-ring-down" />
          <feFlood flood-color="#000000" flood-opacity={strength} result="inset-color-down" />
          <feComposite in="inset-color-down" in2="inset-ring-down" operator="in" result="inset-shadow" />
          {/* 底缘内高光：副本向上错位，底缘月牙填亮色 */}
          <feOffset in="SourceAlpha" dx="0" dy={-depth * 0.7} result="inset-off-up" />
          <feGaussianBlur in="inset-off-up" stdDeviation={depth * 0.4} result="inset-blur-up" />
          <feComposite in="SourceAlpha" in2="inset-blur-up" operator="out" result="inset-ring-up" />
          <feFlood
            flood-color="#ffffff"
            flood-opacity={Math.min(1, strength * 1.7)}
            result="inset-color-up"
          />
          <feComposite in="inset-color-up" in2="inset-ring-up" operator="in" result="inset-light" />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="inset-light" />
            <feMergeNode in="inset-shadow" />
          </feMerge>
        </filter>
      </svg>
      <div class="ui-kit-demo__inset-controls" style={{ flex: '0 0 auto' }}>
        <label class="ui-kit-demo__inset-control">
          <span class="ui-kit-demo__label">深度</span>
          <IosRangeSlider value={depth} min={0.5} max={3} step={0.25} onChange={setDepth} />
        </label>
        <label class="ui-kit-demo__inset-control">
          <span class="ui-kit-demo__label">浓度</span>
          <IosRangeSlider value={strength} min={0.15} max={0.8} step={0.05} onChange={setStrength} />
        </label>
        <label class="ui-kit-demo__inset-control">
          <span class="ui-kit-demo__label">字重</span>
          <IosRangeSlider value={weight} min={100} max={700} step={100} onChange={setWeight} />
        </label>
      </div>
      <DemoVariants>
        <DemoVariant label="SVG 滤镜 · 真·内阴影">
          <div class="ui-kit-demo__inset-row">
            {INSET_ICON_NAMES.map((name) => (
              <div key={name} class="ui-kit-demo__inset-plate" title={name}>
                <Icon name={name} size={26} weight={weight} style={{ filter: `url(#${INSET_FILTER_ID})` }} />
              </div>
            ))}
          </div>
          <span class="ui-kit-demo__hint">
            字形 alpha 副本错位+模糊后与原字形相减，挖出顶缘月牙填深色、底缘月牙填亮色叠回——偏移和模糊可调，凹坑感来自投影落在坑壁
          </span>
        </DemoVariant>
        <DemoVariant label="background-clip: text 渐变 · 明暗模拟">
          <div class="ui-kit-demo__inset-row">
            {INSET_ICON_NAMES.map((name) => (
              <div key={name} class="ui-kit-demo__inset-plate" title={name}>
                <Icon name={name} size={26} weight={weight} style={simStyle} />
              </div>
            ))}
          </div>
          <span class="ui-kit-demo__hint">
            渐变透过字形上暗下亮，凑近看没有「投影落在坑壁」的立体感，但零滤镜开销
          </span>
        </DemoVariant>
        <DemoVariant label="深色键帽 · 同一滤镜直接复用">
          <div class="ui-kit-demo__inset-row">
            {INSET_ICON_NAMES.map((name) => (
              <div key={name} class="ui-kit-demo__inset-plate ui-kit-demo__inset-plate--dark" title={name}>
                <Icon name={name} size={26} weight={weight} style={{ filter: `url(#${INSET_FILTER_ID})` }} />
              </div>
            ))}
          </div>
          <span class="ui-kit-demo__hint">滤镜作用于渲染后的字形 alpha，换底色只需改容器文字色</span>
        </DemoVariant>
      </DemoVariants>
    </div>
  )
}

/** 图标与 kit 组件的组合示范：Button 仅图标与 icon+文字同显（showBothIconAndText，受控例外）、List 行首图标，顶部滑杆统一调整套卡图标字重。 */
export function IconComboDemo() {
  const [weight, setWeight] = useState(400)
  // 卡片 demo 区是横向 flex，必须像 IconDemo 一样收成单一纵向根，滑杆行和变体区才不会并排
  return (
    <div class="ui-kit-demo__icon-panel">
      <div class="ui-kit-demo__icon-slider" style={{ flex: '0 0 auto' }}>
        <span class="ui-kit-demo__label">字重</span>
        <IosRangeSlider value={weight} min={100} max={700} step={100} onChange={setWeight} />
      </div>
      <DemoVariants>
        <DemoVariant label="Button · 仅图标（无文字）">
          <div class="ui-kit-demo__row">
            <Button icon={<Icon name="chevron_left" size={14} weight={weight} />} title="后退" aria-label="后退" />
            <Button icon={<Icon name="chevron_right" size={14} weight={weight} />} title="前进" aria-label="前进" />
            <Button
              tone="primary"
              icon={<Icon name="add" size={14} weight={weight} />}
              title="新建"
              aria-label="新建"
            />
            <Button
              tone="danger"
              icon={<Icon name="delete" size={13} weight={weight} />}
              title="删除"
              aria-label="删除"
            />
          </div>
        </DemoVariant>
        {/* showBothIconAndText 是受控例外：仅演示能力，实际页面未经用户要求不得使用 */}
        <DemoVariant label="Button · icon + 文字（showBothIconAndText）">
          <div class="ui-kit-demo__row">
            <Button icon={<Icon name="add" size={14} weight={weight} />} showBothIconAndText>
              新建
            </Button>
            <Button
              tone="primary"
              icon={<Icon name="cloud_download" size={14} weight={weight} />}
              showBothIconAndText
            >
              下载
            </Button>
          </div>
        </DemoVariant>
        <DemoVariant label="List · leading 槽" wide>
          <List class="ui-kit-demo__settings-group">
            <ListItem
              id="icon-combo-icloud"
              leading={<Icon name="cloud" size={17} weight={weight} />}
              label="iCloud 云盘"
              value="已开启"
              accessory="disclosure"
            />
            <ListItem
              id="icon-combo-trash"
              leading={<Icon name="delete" size={17} weight={weight} />}
              label="最近删除"
              value="3 项"
              accessory="disclosure"
            />
          </List>
        </DemoVariant>
      </DemoVariants>
    </div>
  )
}

