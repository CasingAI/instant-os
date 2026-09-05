import { useRef, useState } from 'preact/hooks'
import { List } from '../../ui/list.tsx'

/** 示例通用容器：块内网格排布 */
export function DemoVariants({ children }: { children: preact.ComponentChildren }) {
  return <div class="ui-kit-demo__variants">{children}</div>
}

export function DemoVariant({
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

export function SettingsGroup({ children }: { children: preact.ComponentChildren }) {
  return <List class="ui-kit-demo__settings-group">{children}</List>
}

/** list-plain-variant / list-plain-editing 共用的演示数据 */
export type PlainThread = {
  id: string
  label: string
  trailing: string
  subtitle: string
  preview: string
  unread: boolean
}

export const PLAIN_THREADS: PlainThread[] = [
  {
    id: 't1',
    label: '设计组',
    trailing: '10:24',
    subtitle: 'Q3 视觉规范终稿',
    preview: '打印样张已经寄出，收到后请确认色差再回签。',
    unread: true,
  },
  {
    id: 't2',
    label: 'John Doe',
    trailing: '昨天',
    subtitle: 'Re: instant-app 发版计划',
    preview: '周四上午十点窗口，改动冻结提前到周三晚。',
    unread: false,
  },
  {
    id: 't3',
    label: 'GitHub',
    trailing: '周二',
    subtitle: '[instant-app] PR #42 已合并',
    preview: 'fix(ui): flat 引擎进退窗口 header 下边框在动画中变深。',
    unread: false,
  },
  {
    id: 't4',
    label: '机场快线',
    trailing: '9月1日',
    subtitle: '行程提醒',
    preview: '您预订的 9 月 3 日 08:30 班次即将出发。',
    unread: false,
  },
  {
    id: 't5',
    label: '账单中心',
    trailing: '8月30日',
    subtitle: '8 月账单已出',
    preview: '本期应缴 ¥42.00，点击查看明细。',
    unread: false,
  },
]

/** tree-view 系列演示共用的节点模型与初始树 */
export type DemoTreeNode = {
  id: string
  label: string
  size: number
  children?: DemoTreeNode[]
  /** 懒加载分支：展开时由 onExpandedChange 异步注入子级 */
  lazy?: boolean
}

export const DEMO_TREE: DemoTreeNode[] = [
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
export function replaceNodeChildren(
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

/** 增删动画演示的共用状态机：nodes 派生更新 + 选中态，四个动作全部数据驱动。 */
export function useTreePlayground(
  initialNodes: DemoTreeNode[] | (() => DemoTreeNode[]),
  initialSelectedId?: string,
) {
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
export function TreePlaygroundActions({
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
