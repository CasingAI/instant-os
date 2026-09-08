import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import { UI_COMPONENTS, COMPONENT_CATEGORIES } from './ui-kit-components.ts'
import type { ComponentDemo, ComponentDemoBlock } from './ui-kit-components.ts'
import { PageCurlDemo } from './page-curl-demo.tsx'
import pageCurlSource from './page-curl-demo.tsx?raw'
import { Nav, useNav } from '../../ui/nav.tsx'
import { PopNav, PopNavTrigger } from '../../ui/pop-nav.tsx'
import { List, ListSection } from '../../ui/list.tsx'
import { ListItem } from '../../ui/list-item.tsx'
import { Button } from '../../ui/button.tsx'
import { Icon } from '../../ui/icon.tsx'
import { DarkMode } from '../../ui/theme.tsx'
import '../settings/settings.css'
import '../../ui/nav-back.css'
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
    <article class="ui-kit__demo-block" id={`demo-${component.id}-${demo.id}`}>
      <header class="ui-kit__demo-block-header">
        <h3 class="ui-kit__demo-block-title">{demo.title}</h3>
        {demo.description && <p class="ui-kit__demo-block-desc">{demo.description}</p>}
      </header>
      <div class="ui-kit__demo-block-render">
        <DemoRenderer componentId={component.id} demoId={demo.id} />
      </div>
      <div class="ui-kit__demo-block-footer">
        <Button onClick={() => setShowCode(!showCode)}>
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

function ComponentPage({
  component,
  shellRef,
}: {
  component: ComponentDemo
  shellRef: (node: HTMLDivElement | null) => void
}) {
  const [copiedImport, setCopiedImport] = useState(false)

  const handleCopyImport = () => {
    navigator.clipboard.writeText(component.importPath).then(() => {
      setCopiedImport(true)
      setTimeout(() => setCopiedImport(false), 2000)
    })
  }

  return (
    <div class="ui-kit__page-shell" ref={shellRef}>
      <article class="ui-kit__page">
        <header class="ui-kit__page-header">
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
          <section class="ui-kit__section" id="api">
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
    </div>
  )
}

type AnchorEntry = { id: string; label: string }

/** 跳转落点的顶部呼吸空间 */
const ANCHOR_SCROLL_OFFSET = 20

/** 详情页锚点项：各 demo 标题 + 有 props 时的 API */
function useAnchorEntries(component: ComponentDemo): AnchorEntry[] {
  return useMemo<AnchorEntry[]>(
    () => [
      ...component.demos.map((demo) => ({
        id: `demo-${component.id}-${demo.id}`,
        label: demo.title,
      })),
      ...(component.props.length > 0 ? [{ id: 'api', label: 'API' }] : []),
    ],
    [component],
  )
}

/** 平滑跳到某锚点小节（视口落点留顶部呼吸空间） */
function jumpToAnchor(getContainer: () => HTMLElement | null, entry: AnchorEntry) {
  const container = getContainer()
  const el = document.getElementById(entry.id)
  if (!container || !el) return
  const top =
    el.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop -
    ANCHOR_SCROLL_OFFSET
  container.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' })
}

/** 页内锚点目录（antd 式 TOC）：标题栏 actions 槽的按钮 → PopNav 弹窗承载。
 * 原来右侧固定 148px 的吸附列让位给正文；弹窗是标准 PopNav（默认 320×280、
 * 锚定按钮箭头跟随、hide 不 destroy），点条目跳小节并收起。 */
function TocPopNav({
  component,
  getContainer,
}: {
  component: ComponentDemo
  getContainer: () => HTMLElement | null
}) {
  const [open, setOpen] = useState(false)
  const tocNav = useNav({ narrowPageForState: () => 'toc' })
  const entries = useAnchorEntries(component)

  return (
    <PopNav
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      ariaLabel="页内导航"
      controller={tocNav}
      frames={[]}
      renderPage={() => (
        <Nav.Page title="页内导航">
          <List
            variant="plain"
            onSelect={(id) => {
              const entry = entries.find((item) => item.id === id)
              if (entry) {
                jumpToAnchor(getContainer, entry)
                setOpen(false)
              }
            }}
          >
            {entries.map((entry) => (
              <ListItem key={entry.id} id={entry.id} label={entry.label} />
            ))}
          </List>
        </Nav.Page>
      )}
    >
      <PopNavTrigger>
        <Button icon={<Icon name="format_list_bulleted" />} title="页内导航" aria-label="页内导航" pressed={open} />
      </PopNavTrigger>
    </PopNav>
  )
}

export function UiKitApp() {
  useAppMenuBar('ui-kit', [])
  // 单一真源是选中的组件：窄屏子页与分栏详情帧都从它派生，
  // 分栏切回子页栈的落点也由它推导。
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  // 整窗亮暗：所有组件子页共享同一开关（切页后状态保持），作用域包住
  // 整个 Nav——左右两栏与转场条带一起翻。很多组件尚未适配暗色，翻转后
  // 观感参差属预期，不影响页面体系标准件。
  const [demoDark, setDemoDark] = useState(false)

  // 锚点量测的滚动容器是 Page 的正文（.page__body）；从详情页页面壳向上取，
  // 避免依赖调用时 DOM 是否已插入。挂在这一层让 header 里的锚点按钮也能拿到。
  const shellRef = useRef<HTMLDivElement | null>(null)
  const getScrollContainer = useCallback(
    () => (shellRef.current?.closest('.page__body') as HTMLElement | null) ?? null,
    [],
  )

  const nav = useNav({
    split: true,
    narrowPageForState: () => (selectedId ? 'detail' : 'list'),
    listPage: 'list',
  })
  const { narrowLayout } = nav

  // 宽屏详情帧要有内容：未选中时自动选首个组件（services 同款）。窄屏首屏
  // 仍停在列表页——初始页在挂载时已由 narrowPageForState 定为 list。
  useEffect(() => {
    setSelectedId((current) => current ?? UI_COMPONENTS[0]?.id)
  }, [])

  const sections = useMemo(() => buildCategorySections(), [])

  const selectedComponent = selectedId
    ? UI_COMPONENTS.find((comp) => comp.id === selectedId)
    : undefined

  const handleSelect = (id: string): void => {
    setSelectedId(id)
    if (nav.narrowLayout && nav.page === 'list') {
      nav.navigate('detail', 'push')
    }
  }

  // ── 页面渲染：外壳统一由 <Nav.Page> 绘制，返回键显隐与形变淡入淡出由
  // Nav 统一编排（应用只声明域事实：详情页有上一级「组件库」）──

  const renderListPage = () => (
    <Nav.Page
      title="组件库"
      // 整窗亮暗开关放根列表页标题栏：左栏宽屏常驻、窄屏即根页，任何形态都可达
      actions={
        <Button
          icon={<Icon name={demoDark ? 'light_mode' : 'dark_mode'} />}
          title={demoDark ? '切换亮色' : '切换暗色'}
          aria-label={demoDark ? '切换亮色' : '切换暗色'}
          onClick={() => setDemoDark((v) => !v)}
        />
      }
    >
      <div class="ui-kit__list">
        <List variant="plain" selectedId={selectedId} onSelect={handleSelect}>
          {sections.map((section) => (
            <ListSection key={section.id} id={section.id} title={section.name}>
              {section.components.map((comp) => (
                <ListItem key={comp.id} id={comp.id} label={comp.name} badge={comp.badge} />
              ))}
            </ListSection>
          ))}
        </List>
      </div>
    </Nav.Page>
  )

  const renderDetailPage = () => {
    if (!selectedComponent) {
      return (
        <Nav.Page title="组件库">
          <div class="ui-kit__page-shell ui-kit__page-shell--empty">选择一个组件查看文档。</div>
        </Nav.Page>
      )
    }
    return (
      <Nav.Page
        key={selectedComponent.id}
        title={selectedComponent.name}
        backLabel="组件库"
        onBack={() => nav.navigate('list', 'pop')}
        actions={
          <TocPopNav
            key={selectedComponent.id}
            component={selectedComponent}
            getContainer={getScrollContainer}
          />
        }
      >
        <ComponentPage
          key={selectedComponent.id}
          component={selectedComponent}
          shellRef={(node) => {
            shellRef.current = node
          }}
        />
      </Nav.Page>
    )
  }

  const renderPage = (target: string) => {
    if (target === 'detail') {
      return renderDetailPage()
    }
    return renderListPage()
  }

  return (
    <DarkMode disabled={!demoDark}>
      {/* 详情帧静置不带返回（左栏列表即它的上级），A 型形变（窄→宽）顶帧
          临时挂回随滑轨淡出——由 Nav 统一编排。 */}
      <Nav
        controller={nav}
        class={`ui-kit${narrowLayout ? ' ui-kit--narrow' : ''}`}
        frames={['detail']}
        renderPage={renderPage}
        listRatio={0.34}
      />
    </DarkMode>
  )
}
