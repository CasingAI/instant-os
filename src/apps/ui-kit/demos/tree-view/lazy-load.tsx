import { useEffect, useRef, useState } from 'preact/hooks'
import { TreeView } from '../../../../ui/tree-view.tsx'
import { formatStorageSize } from '../../../../os/format-storage-size.ts'
import {
  DemoVariants,
  DemoVariant,
  replaceNodeChildren,
  type DemoTreeNode,
} from '../../ui-kit-demo-shared.tsx'

/** 懒加载演示：lazy 标记的分支展开时先注入「加载中…」行（进场动画），模拟异步返回后替换为真实子级。 */
const LAZY_TREE: DemoTreeNode[] = [
  {
    id: 'nas',
    label: 'NAS 共享',
    size: 4_800_000_000,
    children: [
      { id: 'nas-docs', label: '文档', size: 920_000_000, lazy: true },
      { id: 'nas-music', label: '音乐', size: 1_200_000_000, lazy: true },
      {
        id: 'nas-photos',
        label: '照片',
        size: 2_600_000_000,
        children: [
          { id: 'nas-photos-2025', label: '2025 年', size: 800_000_000 },
          { id: 'nas-photos-2024', label: '2024 年', size: 1_100_000_000 },
        ],
      },
    ],
  },
]

/** 模拟异步返回的子级（按父节点生成固定三条）。 */
function loadChildrenFor(node: DemoTreeNode): DemoTreeNode[] {
  return [
    { id: `${node.id}-sub1`, label: `${node.label} · 归档`, size: 210_000_000 },
    { id: `${node.id}-sub2`, label: `${node.label} · 进行中`, size: 96_000_000 },
    { id: `${node.id}-sub3`, label: `${node.label} · 已分享`, size: 44_000_000 },
  ]
}

export default function TreeViewLazyLoadDemo() {
  const [nodes, setNodes] = useState<DemoTreeNode[]>(LAZY_TREE)
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const loadTimerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (loadTimerRef.current !== undefined) window.clearTimeout(loadTimerRef.current)
    }
  }, [])

  const handleExpandedChange = (node: DemoTreeNode, expanded: boolean) => {
    if (!expanded || node.lazy !== true) return
    const firstChild = node.children?.[0]
    // 已有真实子级（含已加载完成）就不再重复加载；「加载中…」行是唯一子级时继续等待
    if (node.children && node.children.length > 0 && firstChild && !firstChild.id.startsWith('loading:')) {
      return
    }
    if (loadTimerRef.current !== undefined) window.clearTimeout(loadTimerRef.current)
    setNodes((prev) =>
      replaceNodeChildren(prev, node.id, [{ id: `loading:${node.id}`, label: '加载中…', size: 0 }]),
    )
    loadTimerRef.current = window.setTimeout(() => {
      loadTimerRef.current = undefined
      setNodes((prev) => replaceNodeChildren(prev, node.id, loadChildrenFor(node)))
    }, 700)
  }

  return (
    <DemoVariants>
      <DemoVariant label="展开分支触发异步加载：先出「加载中…」行，数据返回后替换为真实子级（两种进场动画都能看到）" wide>
        <div class="ui-kit-demo__tree">
          <TreeView
            nodes={nodes}
            selectedId={selectedId}
            onSelect={(node) => setSelectedId(node.id)}
            onExpandedChange={handleExpandedChange}
            renderNode={(node) =>
              node.id.startsWith('loading:') ? (
                <span class="ui-kit-demo__tree-label ui-kit-demo__tree-loading">加载中…</span>
              ) : (
                <>
                  <span class="ui-kit-demo__tree-label">{node.label}</span>
                  <span class="ui-kit-demo__tree-size">{formatStorageSize(node.size)}</span>
                </>
              )
            }
          />
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}
