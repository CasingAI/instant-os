import { useState } from 'preact/hooks'
import { IosSwitch } from '../../ui/ios-switch.tsx'
import { IosCheckToggle } from '../../ui/ios-check-toggle.tsx'
import { IosButton } from '../../ui/ios-button.tsx'
import { IosTextField } from '../../ui/ios-text-field.tsx'
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
import { WindowModal } from '../../window/window-modal.tsx'
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
      <DemoVariant label="数字步进" wide>
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
