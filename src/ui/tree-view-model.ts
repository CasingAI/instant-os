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

/** 选中节点随数据被移除后的自动补选行为。 */
export type TreeViewRemovalSelection = 'none' | 'prefer-previous' | 'prefer-next'

/**
 * 选中节点被移除时，按「上一轮可见序」找相邻幸存行（与 ↑/↓ 键盘序一致，不限同层兄弟）。
 * 锚点：选中节点自身；若它藏在被删的折叠分支里（上一轮不可见），沿 prevParentMap 上溯到
 * 第一个「已删且此前可见」的祖先。再从锚点位置按 preference 方向逐行找幸存者，
 * 一侧到底后反向兜底（「优先」语义）；整树无幸存行返回 undefined。
 * 选中节点未被删（仍在 survivorIds）时不动声色返回 undefined，由调用方守卫亦可。
 */
export function findRemovalNeighbor<T extends TreeViewNodeLike<T>>(
  prevVisible: readonly T[],
  prevParentMap: ReadonlyMap<string, T>,
  selectedId: string,
  survivorIds: ReadonlySet<string>,
  preference: Exclude<TreeViewRemovalSelection, 'none'>,
): T | undefined {
  const prevVisibleIds = new Set(prevVisible.map((node) => node.id))

  let anchorId: string | undefined = selectedId
  while (anchorId !== undefined && !(prevVisibleIds.has(anchorId) && !survivorIds.has(anchorId))) {
    anchorId = prevParentMap.get(anchorId)?.id
  }
  if (anchorId === undefined) return undefined

  const anchorIndex = prevVisible.findIndex((node) => node.id === anchorId)
  const step = preference === 'prefer-next' ? 1 : -1
  for (const direction of [step, -step]) {
    for (let i = anchorIndex + direction; i >= 0 && i < prevVisible.length; i += direction) {
      const candidate = prevVisible[i]
      if (survivorIds.has(candidate.id)) return candidate
    }
  }
  return undefined
}