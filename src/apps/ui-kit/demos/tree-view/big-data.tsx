import { TreeView } from '../../../../ui/tree-view.tsx'
import { formatStorageSize } from '../../../../os/format-storage-size.ts'
import {
  DemoVariants,
  DemoVariant,
  TreePlaygroundActions,
  useTreePlayground,
  type DemoTreeNode,
} from '../../ui-kit-demo-shared.tsx'

/** 大数据量演示：15 个文件夹 × 10 个文件 = 165 行，全部默认展开，验证增删动画不随节点数变贵。 */
function buildBigTree(): DemoTreeNode[] {
  const folders: DemoTreeNode[] = []
  for (let f = 1; f <= 15; f++) {
    const files: DemoTreeNode[] = []
    for (let i = 1; i <= 10; i++) {
      files.push({ id: `folder-${f}-file-${i}`, label: `文件 ${f}-${i}.txt`, size: 1_000_000 + i * 100_000 })
    }
    folders.push({ id: `folder-${f}`, label: `文件夹 ${f}`, size: 800_000_000, children: files })
  }
  return folders
}

export default function TreeViewBigDataDemo() {
  const { nodes, selectedId, setSelectedId, insertAbove, insertBelow, insertChild, deleteSelected } =
    useTreePlayground(buildBigTree, 'folder-1')
  const allFolderIds = Array.from({ length: 15 }, (_, i) => `folder-${i + 1}`)

  return (
    <DemoVariants>
      <DemoVariant label="160+ 行大树里上方 / 下方插入、删除选中仍流畅（删除后自动补选相邻行；树高固定，超出部分内部滚动）" wide>
        <div class="ui-kit-demo__tree">
          <TreeView
            nodes={nodes}
            defaultExpandedIds={allFolderIds}
            selectedId={selectedId}
            removalSelection="prefer-next"
            onSelect={(node) => setSelectedId(node.id)}
            renderNode={(node) => (
              <>
                <span class="ui-kit-demo__tree-label">{node.label}</span>
                <span class="ui-kit-demo__tree-size">{formatStorageSize(node.size)}</span>
              </>
            )}
          />
        </div>
        <TreePlaygroundActions
          insertAbove={insertAbove}
          insertBelow={insertBelow}
          insertChild={insertChild}
          deleteSelected={deleteSelected}
          disabled={!selectedId}
        />
      </DemoVariant>
    </DemoVariants>
  )
}
