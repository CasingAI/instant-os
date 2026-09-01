import { useCallback, useMemo, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import {
  buildTreeParentMap,
  flattenVisibleTree,
  nodeHasDescendant,
  type TreeViewNodeLike,
} from './tree-view-model.ts'
import './tree-view.css'

export type { TreeViewNodeLike } from './tree-view-model.ts'

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

  const visible = useMemo(() => flattenVisibleTree(nodes, expandedIds), [nodes, expandedIds])

  const parentMap = useMemo(() => buildTreeParentMap(nodes), [nodes])

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
    <div class={`tree-view${className ? ` ${className}` : ''}`} role="tree" aria-label={ariaLabel} onKeyDown={handleKeyDown}>
      {nodes.map((node) => (
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
        />
      ))}
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
}): preact.JSX.Element {
  const hasChildren = (node.children?.length ?? 0) > 0
  const expanded = expandedIds.has(node.id)
  const selected = node.id === selectedId
  const isActiveRow = node.id === activeId

  return (
    <>
      <div
        role="treeitem"
        aria-selected={selected}
        aria-expanded={hasChildren ? expanded : undefined}
        tabIndex={isActiveRow ? 0 : -1}
        class={`tree-view__row${selected ? ' tree-view__row--selected' : ''}`}
        style={{ paddingLeft: `${6 + depth * indent}px` }}
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
          <button
            type="button"
            class="tree-view__chevron-btn"
            aria-label={expanded ? '折叠' : '展开'}
            onClick={(event) => {
              event.stopPropagation()
              onToggle(node)
            }}
            onDblClick={(event) => event.stopPropagation()}
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
          <span class="tree-view__chevron-placeholder" aria-hidden="true" />
        )}
        {renderNode(node, { depth, expanded, selected, hasChildren, toggle: () => onToggle(node) })}
      </div>
      {hasChildren && expanded
        ? node.children!.map((child) => (
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
            />
          ))
        : undefined}
    </>
  )
}