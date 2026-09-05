import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import { UI_COMPONENTS, COMPONENT_CATEGORIES } from './ui-kit-components.ts'
import type { ComponentDemo, ComponentDemoBlock } from './ui-kit-components.ts'
import { PageCurlDemo } from './page-curl-demo.tsx'
import pageCurlSource from './page-curl-demo.tsx?raw'
import { List, ListSection } from '../../ui/list.tsx'
import { ListItem } from '../../ui/list-item.tsx'
import { IosTextField } from '../../ui/ios-text-field.tsx'
import { Button } from '../../ui/button.tsx'
import { useAppNarrowLayout } from '../../ui/use-app-narrow-layout.ts'
import '../settings/settings.css'
import '../../ui/ios-nav-back.css'
import './ui-kit.css'

type CategorySection = {
  id: string
  name: string
  components: ComponentDemo[]
}

/** 示例组件（懒加载）与示例源码（?raw 字符串）按同一路径键配对：./demos/<组件id>/<示例id>.tsx */
const demoLoaders = import.meta.glob<{ default: () => preact.JSX.Element }>('./demos/**/*.tsx')
const demoSources = import.meta.glob<string>('./demos/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** demos/ 约定之外的例外：page-curl 是未提交的进行中文件，原地引用，不迁入 demos/ */
const STATIC_DEMO_COMPONENTS: Record<string, () => preact.JSX.Element> = {
  'page-curl/basic': () => <PageCurlDemo />,
}

const STATIC_DEMO_SOURCES: Record<string, string> = {
  'page-curl/basic': pageCurlSource,
}

if (import.meta.env.DEV) {
  const referenced = new Set<string>()
  for (const comp of UI_COMPONENTS) {
    for (const demo of comp.demos) {
      const key = `./demos/${comp.id}/${demo.id}.tsx`
      referenced.add(key)
      if (!demoLoaders[key] && !STATIC_DEMO_COMPONENTS[`${comp.id}/${demo.id}`]) {
        console.error(`[ui-kit] 缺少示例文件: ${key}`)
      }
      if (!demoSources[key] && !STATIC_DEMO_SOURCES[`${comp.id}/${demo.id}`]) {
        console.error(`[ui-kit] 缺少示例源码: ${key}`)
      }
    }
  }
  for (const key of Object.keys(demoLoaders)) {
    if (!referenced.has(key)) console.warn(`[ui-kit] 示例文件未被任何组件引用: ${key}`)
  }
}

function buildCategorySections(): CategorySection[] {
  return COMPONENT_CATEGORIES.map((category) => ({
    id: category.id,
    name: category.name,
    components: UI_COMPONENTS.filter((comp) => comp.category === category.id),
  })).filter((section) => section.components.length > 0)
}

function DemoRenderer({ componentId, demoId }: { componentId: string; demoId: string }) {
  const staticComp = STATIC_DEMO_COMPONENTS[`${componentId}/${demoId}`]
  const loader = demoLoaders[`./demos/${componentId}/${demoId}.tsx`]
  const [Comp, setComp] = useState<(() => preact.JSX.Element) | null>(() => staticComp ?? null)

  useEffect(() => {
    if (staticComp) {
      setComp(() => staticComp)
      return
    }
    if (!loader) return
    let alive = true
    loader().then((mod) => {
      if (alive) setComp(() => mod.default)
    })
    return () => {
      alive = false
    }
  }, [staticComp, loader])

  if (!Comp) {
    return <div class="ui-kit__demo-placeholder">加载中…</div>
  }
  return <Comp />
}

function DemoBlock({ component, demo }: { component: ComponentDemo; demo: ComponentDemoBlock }) {
  const [showCode, setShowCode] = useState(false)
  const [copied, setCopied] = useState(false)

  const source =
    STATIC_DEMO_SOURCES[`${component.id}/${demo.id}`] ??
    demoSources[`./demos/${component.id}/${demo.id}.tsx`]

  const handleCopy = () => {
    if (!source) return
    navigator.clipboard.writeText(source).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <article class="ui-kit__demo-block">
      <header class="ui-kit__demo-block-header">
        <h3 class="ui-kit__demo-block-title">{demo.title}</h3>
        {demo.description && <p class="ui-kit__demo-block-desc">{demo.description}</p>}
      </header>
      <div class="ui-kit__demo-block-render">
        <DemoRenderer componentId={component.id} demoId={demo.id} />
      </div>
      <div class="ui-kit__demo-block-footer">
        <Button variant="borderless" onClick={() => setShowCode(!showCode)}>
          {showCode ? '收起代码' : '查看代码'}
        </Button>
      </div>
      {showCode && (
        <div class="ui-kit__code">
          <div class="ui-kit__code-header">
            <span class="ui-kit__code-file">{component.id}/{demo.id}.tsx</span>
            <Button onClick={handleCopy} disabled={copied || !source}>
              {copied ? '已复制' : '复制'}
            </Button>
          </div>
          <pre class="ui-kit__code-block">
            <code>{source ?? '// 源码缺失'}</code>
          </pre>
        </div>
      )}
    </article>
  )
}

function ComponentPage({ component }: { component: ComponentDemo }) {
  const [copiedImport, setCopiedImport] = useState(false)

  const handleCopyImport = () => {
    navigator.clipboard.writeText(component.importPath).then(() => {
      setCopiedImport(true)
      setTimeout(() => setCopiedImport(false), 2000)
    })
  }

  return (
    <article class="ui-kit__page">
      <header class="ui-kit__page-header">
        <h2 class="ui-kit__page-title">{component.name}</h2>
        <p class="ui-kit__page-desc">{component.description}</p>
        <div class="ui-kit__page-import">
          <code class="ui-kit__page-import-path">{component.importPath}</code>
          <Button onClick={handleCopyImport} disabled={copiedImport}>
            {copiedImport ? '已复制' : '复制'}
          </Button>
        </div>
      </header>

      <section class="ui-kit__section">
        <h3 class="ui-kit__section-title">代码演示</h3>
        <div class="ui-kit__demo-list">
          {component.demos.map((demo) => (
            <DemoBlock key={demo.id} component={component} demo={demo} />
          ))}
        </div>
      </section>

      {component.props.length > 0 && (
        <section class="ui-kit__section">
          <h3 class="ui-kit__section-title">API</h3>
          <div class="ui-kit__api">
            <table class="ui-kit__api-table">
              <thead>
                <tr>
                  <th>属性</th>
                  <th>说明</th>
                  <th>类型</th>
                  <th>默认值</th>
                </tr>
              </thead>
              <tbody>
                {component.props.map((prop) => (
                  <tr key={prop.name}>
                    <td class="ui-kit__api-name">{prop.name}</td>
                    <td class="ui-kit__api-desc">{prop.description}</td>
                    <td class="ui-kit__api-type">{prop.type}</td>
                    <td class="ui-kit__api-default">{prop.defaultValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </article>
  )
}

export function UiKitApp() {
  const appId = 'ui-kit'
  // 窄屏检测走系统 hook（进入 ≤600 / 退出 >660 滞回），与其它应用同一惯例
  const { hostRef, narrowLayout } = useAppNarrowLayout({ enterWidth: 600, exitWidth: 660 })
  const contentRef = useRef<HTMLElement>(null)
  const [query, setQuery] = useState('')

  const sections = useMemo(() => buildCategorySections(), [])
  const [activeComponentId, setActiveComponentId] = useState(
    () => sections[0]?.components[0]?.id ?? '',
  )

  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sections
    return sections
      .map((section) => ({
        ...section,
        components: section.components.filter(
          (comp) =>
            comp.name.toLowerCase().includes(q) || comp.description.toLowerCase().includes(q),
        ),
      }))
      .filter((section) => section.components.length > 0)
  }, [sections, query])

  const activeComponent =
    UI_COMPONENTS.find((comp) => comp.id === activeComponentId) ?? UI_COMPONENTS[0]

  useAppMenuBar(appId, [])

  useLayoutEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [activeComponentId])

  return (
    <div ref={hostRef} class={`ui-kit${narrowLayout ? ' ui-kit--narrow' : ''}`}>
      <nav class="ui-kit__sidebar" aria-label="组件导航">
        <div class="ui-kit__search">
          <IosTextField
            type="search"
            class="ui-kit__search-input"
            placeholder="搜索组件…"
            aria-label="搜索组件"
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
        {filteredSections.length > 0 ? (
          <List selectedId={activeComponentId} onSelect={setActiveComponentId}>
            {filteredSections.map((section) => (
              <ListSection key={section.id} id={section.id} title={section.name}>
                {section.components.map((comp) => (
                  <ListItem key={comp.id} id={comp.id} label={comp.name} />
                ))}
              </ListSection>
            ))}
          </List>
        ) : (
          <p class="ui-kit__sidebar-empty">无匹配组件</p>
        )}
      </nav>

      <main class="ui-kit__content" ref={contentRef}>
        {activeComponent && <ComponentPage key={activeComponent.id} component={activeComponent} />}
      </main>
    </div>
  )
}
