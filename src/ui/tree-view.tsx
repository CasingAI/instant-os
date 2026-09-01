import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import {
  buildTreeParentMap,
  collectTreeIds,
  flattenVisibleTree,
  nodeHasDescendant,
  type TreeViewNodeLike,
} from './tree-view-model.ts'
import './tree-view.css'

export type { TreeViewNodeLike } from './tree-view-model.ts'

/** 增删行动画时长见 tree-view.css（220ms）；清空包裹层的定时器多留 30ms 余量 */
const ROW_ANIMATION_CLEAR_MS = 250

/** 被删节点的快照：数据已不在 nodes 里，动画期间按它渲染，还原原位收起 */
type LeavingEntry<T extends TreeViewNodeLike<T>> = {
  /** 移除前所在父节点 id（null = 根层） */
  parentId: string | null
  /** 移除前在兄弟列表中的下标（splice 回原位用） */
  index: number
  node: T
}

export type TreeViewRowContext<T extends TreeViewNodeLike<T>> = {
  depth: number
  expanded: boolean
  selected: boolean
  hasChildren: boolean
  /** 切换本节点展开态（已 stopPropagation，不会触发行选中） */
  toggle: () => void
}

export type TreeViewProps<T extends TreeViewNodeLike<T>> = {
  /** 多根节点列表 */
  nodes: readonly T[]
  /** 初始展开的节点 id 集合（展开态由组件内部管理，非受控） */
  defaultExpandedIds?: Iterable<string>
  /** 受控选中节点 id */
  selectedId?: string
  onSelect?: (node: T) => void
  /** 展开/折叠变化回调（为懒加载树预留：展开时才取 children） */
  onExpandedChange?: (node: T, expanded: boolean) => void
  /** 渲染行业务内容（图标、标签、附加列等），chevron 与缩进由组件提供 */
  renderNode: (node: T, ctx: TreeViewRowContext<T>) => ComponentChildren
  /** 每级缩进像素，默认 28 */
  indent?: number
  /** 透传到容器 <div>（用于宿主自己的滚动/尺寸样式） */
  className?: string
  /** 容器无障碍标签 */
  ariaLabel?: string
}

/**
 * 通用折叠树：递归渲染 + 展开态管理 + 单选高亮 + 键盘导航。
 * 结构部分（chevron、缩进、选中态、树语义角色）由组件负责，行内容经 renderNode 注入。
 * 交互：
 * - 单击选中；双击有子节点时展开/收起
 * - ↑/↓ 在可见节点间移动选中；→ 展开（已展开则进入第一个子节点）；← 收起（已收起则回到父节点）
 * - Home/End 跳到首/末可见节点；Enter 等同点击选中
 * - 折叠分支导致选中项隐身时，选中项自动移到该分支根节点
 */
export function TreeView<T extends TreeViewNodeLike<T>>({
  nodes,
  defaultExpandedIds,
  selectedId,
  onSelect,
  onExpandedChange,
  renderNode,
  indent = 28,
  className,
  ariaLabel,
}: TreeViewProps<T>): preact.JSX.Element {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(defaultExpandedIds ?? []),
  )
  const [focusId, setFocusId] = useState<string | undefined>(undefined)
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  // 增删动画状态：entering 行外包高度展开层；leaving 行数据已删，用上一轮快照保位收起
  const [enteringIds, setEnteringIds] = useState<ReadonlySet<string>>(new Set())
  const [leavingEntries, setLeavingEntries] = useState<readonly LeavingEntry<T>[]>([])
  const isFirstDiffRef = useRef(true)
  const prevNodesRef = useRef<readonly T[]>([])
  const rootRef = useRef<HTMLDivElement>(null)

  const visible = useMemo(() => flattenVisibleTree(nodes, expandedIds), [nodes, expandedIds])

  const parentMap = useMemo(() => buildTreeParentMap(nodes), [nodes])

  // 数据增删 diff：必须用 useLayoutEffect 在绘制前补帧——用 useEffect/useState 流程
  // 会出现「被删行先消失一帧 → 闪回 → 再收起」的跳变，layout effect 让用户只看到动画首帧
  useLayoutEffect(() => {
    if (isFirstDiffRef.current) {
      isFirstDiffRef.current = false
      prevNodesRef.current = nodes
      return
    }
    const prevNodes = prevNodesRef.current
    prevNodesRef.current = nodes

    const prevById = buildNodeById(prevNodes)
    const prevIds = new Set(prevById.keys())
    const currIds = new Set(collectTreeIds(nodes))
    const prevParentMap = buildTreeParentMap(prevNodes)
    const prevChildrenIds = buildChildrenIds(prevNodes)

    // 顶层过滤：父节点同为新增/删除的子节点由父级包裹层一次性动画，不再单独包（避免嵌套双重动画）
    const freshTop: string[] = []
    for (const id of currIds) {
      if (prevIds.has(id)) continue
      const parent = parentMap.get(id)
      if (parent && currIds.has(parent.id)) continue
      freshTop.push(id)
    }
    const removedTopIds: string[] = []
    for (const id of prevIds) {
      if (currIds.has(id)) continue
      const parent = prevParentMap.get(id)
      if (parent && !currIds.has(parent.id)) continue
      removedTopIds.push(id)
    }

    if (freshTop.length > 0) setEnteringIds(new Set(freshTop))
    if (removedTopIds.length > 0) {
      setLeavingEntries(
        removedTopIds.map((id) => {
          const parent = prevParentMap.get(id)
          const parentId = parent?.id ?? null
          return {
            parentId,
            index: (prevChildrenIds.get(parentId) ?? []).indexOf(id),
            node: prevById.get(id)!,
          }
        }),
      )
    }
    // 每轮都重置清空定时器：动画播放中出现无变化的刷新（如磁盘工具周期扫描）时
    // 上一轮的包裹层仍会按时卸载，不会残留
    const timer = setTimeout(() => {
      setEnteringIds(new Set())
      setLeavingEntries([])
    }, ROW_ANIMATION_CLEAR_MS)
    return () => clearTimeout(timer)
  }, [nodes, parentMap])

  // 增删高度动画：包裹层高度在提交后由 JS 一次性测出自然高（scrollHeight）再写死 px，
  // 交给 CSS height 过渡——每帧只是单元素 block 高度布局；若沿用 0fr↔auto 的 grid 轨道动画，
  // 每帧都要重解嵌套 grid 轨道（多层嵌套/大树时掉帧明显，macOS 尤其）。opacity 淡入淡出仍纯合成。
  // 用 data-tree-anim-set 守卫：每个包裹层只配置一次，动画期间无关重渲染不会重写高度打断过渡。
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const wrappers = root.querySelectorAll<HTMLDivElement>('.tree-view__enter, .tree-view__leave')
    for (const el of wrappers) {
      if (el.dataset.treeAnimSet === '1') continue
      el.dataset.treeAnimSet = '1'
      const height = el.scrollHeight
      if (el.classList.contains('tree-view__leave')) {
        // 先钉住自然高度（留出过渡的明确起点像素），再收到 0 触发 h→0 过渡
        el.style.height = `${height}px`
        void el.offsetHeight
        el.style.height = '0px'
      } else {
        // 起点是 CSS 里的 height:0；先回读一次把 0 记为既有计算值，再写自然高触发 0→h 过渡
        // （否则同步内联改写可能被并入同一次样式重算而直接跳到终态、动画不播）
        void el.offsetHeight
        el.style.height = `${height}px`
      }
    }
  }, [enteringIds, leavingEntries])

  // leaving 记录按父节点分组，供各层渲染时 splice 回原位
  const leavingByParent = useMemo(() => {
    const map = new Map<string | null, LeavingEntry<T>[]>()
    for (const entry of leavingEntries) {
      const list = map.get(entry.parentId)
      if (list) list.push(entry)
      else map.set(entry.parentId, [entry])
    }
    return map
  }, [leavingEntries])

  // 键盘光标 = 选中态（app 受控）；未选中/失效时退到第一个可见节点保证树有 Tab 停靠点
  const activeId = selectedId ?? focusId
  const effectiveActiveId = visible.some((node) => node.id === activeId)
    ? activeId
    : visible[0]?.id

  const focusRow = useCallback((id: string) => {
    rowRefs.current.get(id)?.focus()
  }, [])

  const selectNode = useCallback(
    (node: T) => {
      onSelect?.(node)
      setFocusId(node.id)
    },
    [onSelect],
  )

  const handleToggle = useCallback(
    (node: T) => {
      const wasExpanded = expandedIds.has(node.id)
      setExpandedIds((prev) => {
        const next = new Set(prev)
        if (next.has(node.id)) next.delete(node.id)
        else next.add(node.id)
        return next
      })
      onExpandedChange?.(node, !wasExpanded)
      // 折叠分支导致选中项隐身时，选中项自动移到该分支根（保持「当前项始终可见」）
      if (wasExpanded) {
        const active = selectedId ?? focusId
        if (active !== undefined && active !== node.id && nodeHasDescendant(node, active)) {
          selectNode(node)
        }
      }
    },
    [expandedIds, onExpandedChange, selectedId, focusId, selectNode],
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (visible.length === 0) return
      const currentIndex = visible.findIndex((node) => node.id === effectiveActiveId)
      const moveSelection = (index: number): void => {
        const target = visible[index]
        if (!target) return
        selectNode(target)
        focusRow(target.id)
      }
      switch (event.key) {
        case 'ArrowDown': {
          event.preventDefault()
          moveSelection(currentIndex === -1 ? 0 : Math.min(visible.length - 1, currentIndex + 1))
          break
        }
        case 'ArrowUp': {
          event.preventDefault()
          moveSelection(currentIndex === -1 ? visible.length - 1 : Math.max(0, currentIndex - 1))
          break
        }
        case 'ArrowRight': {
          if (currentIndex === -1) break
          event.preventDefault()
          const node = visible[currentIndex]
          const children = node?.children
          if (node && children && children.length > 0) {
            if (expandedIds.has(node.id)) moveSelection(currentIndex + 1)
            else handleToggle(node)
          }
          break
        }
        case 'ArrowLeft': {
          if (currentIndex === -1) break
          event.preventDefault()
          const node = visible[currentIndex]
          if (!node) break
          if (expandedIds.has(node.id)) {
            handleToggle(node)
          } else {
            const parent = parentMap.get(node.id)
            if (parent) moveSelection(visible.findIndex((n) => n.id === parent.id))
          }
          break
        }
        case 'Home': {
          event.preventDefault()
          moveSelection(0)
          break
        }
        case 'End': {
          event.preventDefault()
          moveSelection(visible.length - 1)
          break
        }
        case 'Enter': {
          if (currentIndex === -1) {
            moveSelection(0)
          } else {
            const node = visible[currentIndex]
            if (node) selectNode(node)
          }
          break
        }
      }
    },
    [visible, effectiveActiveId, selectNode, focusRow, expandedIds, handleToggle, parentMap],
  )

  const registerRow = useCallback((id: string, element: HTMLDivElement | null) => {
    if (element) rowRefs.current.set(id, element)
    else rowRefs.current.delete(id)
  }, [])

  return (
    <div
      ref={rootRef}
      class={`tree-view${className ? ` ${className}` : ''}`}
      role="tree"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
    >
      {mergeRowChildren(nodes, leavingByParent.get(null) ?? []).map(({ node, leaving }) =>
        leaving ? (
          <div class="tree-view__leave" aria-hidden="true" key={`leave:${node.id}`}>
            <TreeItemRow
              node={node}
              depth={0}
              expandedIds={expandedIds}
              selectedId={selectedId}
              activeId={effectiveActiveId}
              onSelect={onSelect}
              onToggle={handleToggle}
              onFocusRow={focusRow}
              registerRow={registerRow}
              renderNode={renderNode}
              indent={indent}
              enteringIds={enteringIds}
              leavingByParent={leavingByParent}
            />
          </div>
        ) : (
          <TreeItemRow
            key={node.id}
            node={node}
            depth={0}
            expandedIds={expandedIds}
            selectedId={selectedId}
            activeId={effectiveActiveId}
            onSelect={onSelect}
            onToggle={handleToggle}
            onFocusRow={focusRow}
            registerRow={registerRow}
            renderNode={renderNode}
            indent={indent}
            enteringIds={enteringIds}
            leavingByParent={leavingByParent}
          />
        ),
      )}
    </div>
  )
}

function TreeItemRow<T extends TreeViewNodeLike<T>>({
  node,
  depth,
  expandedIds,
  selectedId,
  activeId,
  onSelect,
  onToggle,
  onFocusRow,
  registerRow,
  renderNode,
  indent,
  enteringIds,
  leavingByParent,
}: {
  node: T
  depth: number
  expandedIds: ReadonlySet<string>
  selectedId?: string
  activeId?: string
  onSelect?: (node: T) => void
  onToggle: (node: T) => void
  onFocusRow: (id: string) => void
  registerRow: (id: string, element: HTMLDivElement | null) => void
  renderNode: (node: T, ctx: TreeViewRowContext<T>) => ComponentChildren
  indent: number
  enteringIds: ReadonlySet<string>
  leavingByParent: ReadonlyMap<string | null, readonly LeavingEntry<T>[]>
}): preact.JSX.Element {
  const hasChildren = (node.children?.length ?? 0) > 0
  const expanded = expandedIds.has(node.id)
  const selected = node.id === selectedId
  const isActiveRow = node.id === activeId
  const entering = enteringIds.has(node.id)
  const leavingChildren = leavingByParent.get(node.id) ?? []
  // 有新行/被删行时分支包裹层也要在（否则删光子级后父分支塌掉，离场行无处渲染）
  const branchVisible = hasChildren || leavingChildren.length > 0

  const row = (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-expanded={hasChildren ? expanded : undefined}
      tabIndex={isActiveRow ? 0 : -1}
      class={`tree-view__row${selected ? ' tree-view__row--selected' : ''}`}
      ref={(element) => registerRow(node.id, element)}
      onClick={() => {
        onFocusRow(node.id)
        onSelect?.(node)
      }}
      onDblClick={() => {
        if (hasChildren) onToggle(node)
      }}
    >
      {hasChildren ? (
        /* 左侧整块（缩进空白 + 箭头列）都是展开/收起命中区；
           不进 Tab 序、点击不抢焦点——键盘用 ←/→ 与双击操作 */
        <button
          type="button"
          class="tree-view__chevron-btn"
          style={{ paddingLeft: `${6 + depth * indent}px` }}
          tabIndex={-1}
          aria-label={expanded ? '折叠' : '展开'}
          onClick={(event) => {
            event.stopPropagation()
            onToggle(node)
          }}
          onDblClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.preventDefault()}
        >
          <span
            class={`tree-view__chevron${expanded ? ' tree-view__chevron--open' : ''}`}
            aria-hidden="true"
          >
            <svg viewBox="0 0 8 8" width="8" height="8" fill="currentColor">
              <path
                d="M1.5 1l2.5 3-2.5 3"
                fill="none"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>
        </button>
      ) : (
        <span
          class="tree-view__chevron-placeholder"
          style={{ paddingLeft: `${6 + depth * indent}px` }}
          aria-hidden="true"
        />
      )}
      {renderNode(node, { depth, expanded, selected, hasChildren, toggle: () => onToggle(node) })}
    </div>
  )

  return (
    <>
      {entering ? <div class="tree-view__enter">{row}</div> : row}
      {branchVisible ? (
        /* children 常驻 DOM 的包裹层：grid-template-rows 0fr↔1fr 过渡实现滑出/滑入；
           收起动画播完后由 CSS 延迟 visibility 隐藏（读屏跳过折叠内容） */
        <div class={`tree-view__branch${expanded ? ' tree-view__branch--open' : ''}`}>
          <div class="tree-view__branch-inner">
            {mergeRowChildren(node.children ?? [], leavingChildren).map(({ node: child, leaving }) =>
              leaving ? (
                <div class="tree-view__leave" aria-hidden="true" key={`leave:${child.id}`}>
                  <TreeItemRow
                    node={child}
                    depth={depth + 1}
                    expandedIds={expandedIds}
                    selectedId={selectedId}
                    activeId={activeId}
                    onSelect={onSelect}
                    onToggle={onToggle}
                    onFocusRow={onFocusRow}
                    registerRow={registerRow}
                    renderNode={renderNode}
                    indent={indent}
                    enteringIds={enteringIds}
                    leavingByParent={leavingByParent}
                  />
                </div>
              ) : (
                <TreeItemRow
                  key={child.id}
                  node={child}
                  depth={depth + 1}
                  expandedIds={expandedIds}
                  selectedId={selectedId}
                  activeId={activeId}
                  onSelect={onSelect}
                  onToggle={onToggle}
                  onFocusRow={onFocusRow}
                  registerRow={registerRow}
                  renderNode={renderNode}
                  indent={indent}
                  enteringIds={enteringIds}
                  leavingByParent={leavingByParent}
                />
              ),
            )}
          </div>
        </div>
      ) : undefined}
    </>
  )
}

/** 深度优先收集 节点 id → 节点 快照映射（删除动画保位渲染用）。 */
function buildNodeById<T extends TreeViewNodeLike<T>>(nodes: readonly T[]): Map<string, T> {
  const map = new Map<string, T>()
  const walk = (list: readonly T[]): void => {
    for (const node of list) {
      map.set(node.id, node)
      const children = node.children
      if (children && children.length > 0) walk(children)
    }
  }
  walk(nodes)
  return map
}

/** 每层（含根层 null）的「有序 id 列表」，记录上一轮兄弟顺序，删除行据此还原原位。 */
function buildChildrenIds<T extends TreeViewNodeLike<T>>(
  nodes: readonly T[],
): Map<string | null, string[]> {
  const map = new Map<string | null, string[]>()
  map.set(null, nodes.map((node) => node.id))
  const walk = (list: readonly T[]): void => {
    for (const node of list) {
      const children = node.children ?? []
      map.set(node.id, children.map((child) => child.id))
      if (children.length > 0) walk(children)
    }
  }
  walk(nodes)
  return map
}

/** 当前子级与「正在离场」的子级按旧下标合并成渲染序列（leaving 项可读性上是纯视觉行）。 */
function mergeRowChildren<T extends TreeViewNodeLike<T>>(
  current: readonly T[],
  leaving: readonly LeavingEntry<T>[],
): Array<{ node: T; leaving: boolean }> {
  const items = current.map((node) => ({ node, leaving: false }))
  // 按下标降序 splice 回原位：单条删除精确复原；多条同时删且新旧有交错时顺序为近似
  for (const entry of [...leaving].sort((a, b) => b.index - a.index)) {
    items.splice(Math.min(entry.index, items.length), 0, { node: entry.node, leaving: true })
  }
  return items
}