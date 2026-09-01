import { useEffect, useRef, useState } from 'preact/hooks'
import { IosSwitch } from '../../ui/ios-switch.tsx'
import { IosCheckToggle } from '../../ui/ios-check-toggle.tsx'
import { Checkbox } from '../../ui/checkbox.tsx'
import { IosButton } from '../../ui/ios-button.tsx'
import { Popover } from '../../ui/popover.tsx'
import { IosTextField } from '../../ui/ios-text-field.tsx'
import { IosRangeSlider, type IosRangeSliderMark } from '../../ui/ios-range-slider.tsx'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
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
import { AiModelCapabilityTags } from '../../ui/ai-model-capability-tags.tsx'
import { HelpHint } from '../../ui/help-hint.tsx'
import { WindowModal } from '../../window/window-modal.tsx'
import { TreeView, type TreeViewRemovalSelection } from '../../ui/tree-view.tsx'
import { formatStorageSize } from '../../os/format-storage-size.ts'
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
  return <div class="settings__list ui-kit-demo__settings-group">{children}</div>
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

export function IosButtonDemo() {
  return (
    <DemoVariants>
      <DemoVariant label="色调" wide>
        <div class="ui-kit-demo__row">
          <IosButton>次要</IosButton>
          <IosButton tone="primary">主要</IosButton>
          <IosButton tone="danger">危险</IosButton>
        </div>
      </DemoVariant>
      <DemoVariant label="compact / icon">
        <div class="ui-kit-demo__row">
          <IosButton size="compact">紧凑</IosButton>
          <IosButton icon size="compact" title="后退">
            ←
          </IosButton>
          <IosButton icon size="compact" title="前进">
            →
          </IosButton>
          <IosButton size="compact" disabled>
            禁用
          </IosButton>
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
            '--ios-button-compact-min-width': '64px',
          }}
        >
          <IosButton size="compact">编辑</IosButton>
          <IosButton size="compact">书城</IosButton>
          <IosButton size="compact" disabled>
            刷新
          </IosButton>
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
            <IosButton size="compact" onClick={() => setOpen(!open)}>
              {open ? '关闭气泡' : '打开气泡'}
            </IosButton>
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
