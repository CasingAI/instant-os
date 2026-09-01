/**
 * TreeView 纯逻辑模型：可见展平 / 父级映射 / 后代判定。
 * 与 UI 解耦，可独立单测（node --experimental-strip-types）。
 */

export type TreeViewNodeLike<T> = {
  id: string
  children?: readonly T[]
}

/** 深度优先展平当前可见节点：折叠分支的子节点不参与序列（键盘导航与焦点依赖此序列）。 */
export function flattenVisibleTree<T extends TreeViewNodeLike<T>>(
  nodes: readonly T[],
  expandedIds: ReadonlySet<string>,
): T[] {
  const visible: T[] = []
  const walk = (list: readonly T[]): void => {
    for (const node of list) {
      visible.push(node)
      const children = node.children
      if (children && children.length > 0 && expandedIds.has(node.id)) walk(children)
    }
  }
  walk(nodes)
  return visible
}

/** 子节点 id → 父节点 的映射（← 键从子级回父级用）。 */
export function buildTreeParentMap<T extends TreeViewNodeLike<T>>(
  nodes: readonly T[],
): Map<string, T> {
  const map = new Map<string, T>()
  const walk = (list: readonly T[]): void => {
    for (const node of list) {
      for (const child of node.children ?? []) {
        map.set(child.id, node)
        walk([child])
      }
    }
  }
  walk(nodes)
  return map
}

/** 深度优先收集整棵树的全部节点 id（不看展开态；插入/删除动画的增删 diff 用）。 */
export function collectTreeIds<T extends TreeViewNodeLike<T>>(nodes: readonly T[]): string[] {
  const ids: string[] = []
  const walk = (list: readonly T[]): void => {
    for (const node of list) {
      ids.push(node.id)
      const children = node.children
      if (children && children.length > 0) walk(children)
    }
  }
  walk(nodes)
  return ids
}

/** node 是否存在 id 为 targetId 的后代（折叠分支导致选中项隐身时判定用）。 */
export function nodeHasDescendant<T extends TreeViewNodeLike<T>>(
  node: T,
  targetId: string,
): boolean {
  const children = node.children
  if (!children) return false
  return children.some((child) => child.id === targetId || nodeHasDescendant(child, targetId))
}