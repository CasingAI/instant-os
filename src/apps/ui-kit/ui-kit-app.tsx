import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useOs } from '../../os/os-context.tsx'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { getAppDefinition } from '../../os/app-registry.tsx'
import { UI_COMPONENTS, COMPONENT_CATEGORIES } from './ui-kit-components.ts'
import type { ComponentDemo } from './ui-kit-components.ts'
import {
  IosSwitchDemo,
  IosCheckToggleDemo,
  IosButtonDemo,
  IosTextFieldDemo,
  SegmentedControlDemo,
  SettingsChoiceFieldDemo,
  SettingsNavRowDemo,
  SettingsCheckRowDemo,
  SettingsSwitchRowDemo,
  SettingsStepperRowDemo,
  SettingsInlineInputRowDemo,
  DocumentTabBarDemo,
  AdaptiveActionMenuDemo,
  WindowModalDemo,
  IosNavBackButtonDemo,
  EmojiPickerPopoverDemo,
  AiModelCapabilityTagsDemo,
} from './ui-kit-demo-instances.tsx'
import './ui-kit.css'

const NARROW_BREAKPOINT = 600

type CategorySection = {
  id: string
  name: string
  components: ComponentDemo[]
}

const DEMO_COMPONENTS: Record<string, () => preact.JSX.Element> = {
  'ios-switch': IosSwitchDemo,
  'ios-check-toggle': IosCheckToggleDemo,
  'ios-button': IosButtonDemo,
  'ios-text-field': IosTextFieldDemo,
  'segmented-control': SegmentedControlDemo,
  'settings-choice-field': SettingsChoiceFieldDemo,
  'settings-nav-row': SettingsNavRowDemo,
  'settings-check-row': SettingsCheckRowDemo,
  'settings-switch-row': SettingsSwitchRowDemo,
  'settings-stepper-row': SettingsStepperRowDemo,
  'settings-inline-input-row': SettingsInlineInputRowDemo,
  'document-tab-bar': DocumentTabBarDemo,
  'adaptive-action-menu': AdaptiveActionMenuDemo,
  'window-modal': WindowModalDemo,
  'ios-nav-back-button': IosNavBackButtonDemo,
  'emoji-picker-popover': EmojiPickerPopoverDemo,
  'ai-model-capability-tags': AiModelCapabilityTagsDemo,
}

function buildCategorySections(): CategorySection[] {
  return COMPONENT_CATEGORIES.map((category) => ({
    id: category.id,
    name: category.name,
    components: UI_COMPONENTS.filter((comp) => comp.category === category.id),
  })).filter((section) => section.components.length > 0)
}

function ComponentCard({ component }: { component: ComponentDemo }) {
  const [showCode, setShowCode] = useState(false)
  const [showProps, setShowProps] = useState(false)
  const [copied, setCopied] = useState(false)

  const DemoComponent = DEMO_COMPONENTS[component.id]

  const handleCopy = () => {
    navigator.clipboard.writeText(component.codeExample).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <article class="ui-kit__card">
      <header class="ui-kit__card-header">
        <h3 class="ui-kit__card-title">{component.name}</h3>
        <p class="ui-kit__card-desc">{component.description}</p>
      </header>

      <div class="ui-kit__card-demo">
        {DemoComponent ? <DemoComponent /> : <div class="ui-kit__card-demo-placeholder">暂无 Demo</div>}
      </div>

      <div class="ui-kit__card-actions">
        <button
          type="button"
          class={`ui-kit__card-toggle${showCode ? ' ui-kit__card-toggle--active' : ''}`}
          onClick={() => setShowCode(!showCode)}
        >
          {showCode ? '隐藏代码' : '查看代码'}
        </button>
        <button
          type="button"
          class={`ui-kit__card-toggle${showProps ? ' ui-kit__card-toggle--active' : ''}`}
          onClick={() => setShowProps(!showProps)}
        >
          {showProps ? '隐藏 Props' : '查看 Props'}
        </button>
      </div>

      {showCode && (
        <div class="ui-kit__card-code">
          <div class="ui-kit__card-code-header">
            <span class="ui-kit__card-code-lang">TypeScript</span>
            <button
              type="button"
              class="ui-kit__card-code-copy"
              onClick={handleCopy}
              disabled={copied}
            >
              {copied ? '已复制' : '复制'}
            </button>
          </div>
          <pre class="ui-kit__card-code-block">
            <code>{`${component.importPath}\n\n${component.codeExample}`}</code>
          </pre>
        </div>
      )}

      {showProps && (
        <div class="ui-kit__card-props">
          <table class="ui-kit__card-props-table">
            <thead>
              <tr>
                <th>属性</th>
                <th>类型</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {component.props.map((prop) => (
                <tr key={prop.name}>
                  <td class="ui-kit__card-props-name">{prop.name}</td>
                  <td class="ui-kit__card-props-type">{prop.type}</td>
                  <td class="ui-kit__card-props-desc">{prop.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  )
}

export function UiKitApp() {
  const { closeWindowsForApp, minimizeWindow, windows } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const appId = 'ui-kit'
  const hostRef = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)

  const definition = getAppDefinition(appId)

  const sections = useMemo(() => buildCategorySections(), [])
  const [activeCategoryId, setActiveCategoryId] = useState(() => sections[0]?.id ?? 'form')

  const activeSection = sections.find((section) => section.id === activeCategoryId) ?? sections[0]

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === appId && !window.minimized)
    return [
      {
        label: definition?.name ?? 'UI 组件库',
        items: [
          ...aboutAppMenuPrefix(`关于 ${definition?.name ?? 'UI 组件库'}`, () => showBuiltinAbout(appId)),
          {
            type: 'action',
            label: `隐藏${definition?.name ?? 'UI 组件库'}`,
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: `退出${definition?.name ?? 'UI 组件库'}`,
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp(appId),
          },
        ],
      },
    ]
  }, [closeWindowsForApp, definition?.name, minimizeWindow, showBuiltinAbout, windows])

  useAppMenuBar(appId, menuBar)

  const measureWidth = useCallback(() => {
    if (!hostRef.current) return
    setNarrow(hostRef.current.clientWidth <= NARROW_BREAKPOINT)
  }, [])

  useLayoutEffect(() => {
    measureWidth()
    const observer = new ResizeObserver(measureWidth)
    if (hostRef.current) {
      observer.observe(hostRef.current)
    }
    return () => observer.disconnect()
  }, [measureWidth])

  return (
    <div ref={hostRef} class={`ui-kit${narrow ? ' ui-kit--narrow' : ''}`}>
      <nav class="ui-kit__sidebar" aria-label="组件分类">
        <ul class="ui-kit__nav">
          {sections.map((section) => (
            <li key={section.id}>
              <button
                type="button"
                class={`ui-kit__nav-item${activeCategoryId === section.id ? ' ui-kit__nav-item--active' : ''}`}
                aria-current={activeCategoryId === section.id ? 'true' : undefined}
                onClick={() => setActiveCategoryId(section.id)}
              >
                {section.name}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main class="ui-kit__content">
        {activeSection && (
          <>
            <header class="ui-kit__content-header">
              <h2 class="ui-kit__content-title">{activeSection.name}</h2>
              <p class="ui-kit__content-desc">
                共 {activeSection.components.length} 个组件
              </p>
            </header>
            <div class="ui-kit__cards">
              {activeSection.components.map((component) => (
                <ComponentCard key={component.id} component={component} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
