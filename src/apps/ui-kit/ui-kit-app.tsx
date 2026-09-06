import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import { UI_COMPONENTS, COMPONENT_CATEGORIES } from './ui-kit-components.ts'
import type { ComponentDemo, ComponentDemoBlock } from './ui-kit-components.ts'
import { PageCurlDemo } from './page-curl-demo.tsx'
import pageCurlSource from './page-curl-demo.tsx?raw'
import {
  Nav,
  useNav,
  type NavFrameSpec,
} from '../../ui/nav.tsx'
import { List, ListSection } from '../../ui/list.tsx'
import { ListItem } from '../../ui/list-item.tsx'
import { Button } from '../../ui/button.tsx'
import { Icon } from '../../ui/icon.tsx'
import { DarkMode } from '../../ui/theme.tsx'
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

function ComponentPage({ component }: { component: ComponentDemo }) {
  const shellRef = useRef<HTMLDivElement | null>(null)
  // 锚点量测的滚动容器是 Page 的正文（.page__body）；从页面壳向上取，
  // 避免依赖调用时 DOM 是否已插入
  const getScrollContainer = useCallback(
    () => (shellRef.current?.closest('.page__body') as HTMLElement | null) ?? null,
    [],
  )
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

      <AnchorNav component={component} getContainer={getScrollContainer} />
    </div>
  )
}

type AnchorEntry = { id: string; label: string }

/** 锚点越过容器顶部的判定余量与跳转落点的顶部呼吸空间 */
const ANCHOR_TOP_THRESHOLD = 80
const ANCHOR_SCROLL_OFFSET = 20

function AnchorNav({
  component,
  getContainer,
}: {
  component: ComponentDemo
  getContainer: () => HTMLElement | null
}) {
  const entries = useMemo<AnchorEntry[]>(
    () => [
      ...component.demos.map((demo) => ({
        id: `demo-${component.id}-${demo.id}`,
        label: demo.title,
      })),
      ...(component.props.length > 0 ? [{ id: 'api', label: 'API' }] : []),
    ],
    [component],
  )
  const [activeId, setActiveId] = useState(entries[0]?.id ?? '')

  // 每次滚动实时量位置：示例懒加载、代码展开收起改变高度后天然正确
  useEffect(() => {
    const container = getContainer()
    if (!container || entries.length === 0) return
    const measure = () => {
      const containerTop = container.getBoundingClientRect().top
      let current = entries[0].id
      for (const entry of entries) {
        const el = document.getElementById(entry.id)
        if (el && el.getBoundingClientRect().top - containerTop <= ANCHOR_TOP_THRESHOLD) {
          current = entry.id
        }
      }
      // 卷到底时强制点亮最后一条，兜住末尾小节永远够不到阈值的情况
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 1) {
        current = entries[entries.length - 1].id
      }
      setActiveId(current)
    }
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        measure()
      })
    }
    measure()
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [getContainer, entries])

  const handleJump = (entry: AnchorEntry) => {
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

  return (
    <aside class="ui-kit__toc" aria-label="页内导航">
      {entries.map((entry) => (
        <a
          key={entry.id}
          class={`ui-kit__toc-item${activeId === entry.id ? ' ui-kit__toc-item--active' : ''}`}
          href={`#${entry.id}`}
          onClick={(event) => {
            event.preventDefault()
            handleJump(entry)
          }}
        >
          {entry.label}
        </a>
      ))}
    </aside>
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
                <ListItem key={comp.id} id={comp.id} label={comp.name} />
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
        title={selectedComponent.name}
        backLabel="组件库"
        onBack={() => nav.navigate('list', 'pop')}
      >
        <ComponentPage key={selectedComponent.id} component={selectedComponent} />
      </Nav.Page>
    )
  }

  const renderNarrowPage = (target: string) => {
    if (target === 'detail') {
      return renderDetailPage()
    }
    return renderListPage()
  }

  // 分栏帧：详情帧静置不带返回（左栏列表即它的上级），A 型形变（窄→宽）
  // 顶帧临时挂回随滑轨淡出——由 Nav 统一编排。
  const renderWideFrames = (): NavFrameSpec[] => [
    {
      id: 'detail',
      content: renderDetailPage(),
    },
  ]

  return (
    <DarkMode disabled={!demoDark}>
      <Nav
        controller={nav}
        class={`ui-kit${narrowLayout ? ' ui-kit--narrow' : ''}`}
        renderNarrowPage={renderNarrowPage}
        renderWideFrames={renderWideFrames}
        listRatio={0.34}
      />
    </DarkMode>
  )
}
