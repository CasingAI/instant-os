import { useState } from 'preact/hooks'
import { TreeView, type TreeViewRemovalSelection } from '../../../../ui/tree-view.tsx'
import { formatStorageSize } from '../../../../os/format-storage-size.ts'
import { SegmentedControl } from '../../../../ui/segmented-control.tsx'
import {
  DemoVariants,
  DemoVariant,
  DEMO_TREE,
  TreePlaygroundActions,
  useTreePlayground,
} from '../../ui-kit-demo-shared.tsx'

/** 删除选中后的补选策略三档（TreeView 的 removalSelection）。 */
const REMOVAL_SELECTION_ITEMS: readonly { id: TreeViewRemovalSelection; label: string }[] = [
  { id: 'none', label: '不自动选中' },
  { id: 'prefer-previous', label: '优先前一个' },
  { id: 'prefer-next', label: '优先后一个' },
]

export default function TreeViewInteractiveDemo() {
  const { nodes, selectedId, setSelectedId, insertAbove, insertBelow, insertChild, deleteSelected } =
    useTreePlayground(DEMO_TREE, 'photos-2025-08')
  const [removalSelection, setRemovalSelection] = useState<TreeViewRemovalSelection>('prefer-next')

  return (
    <DemoVariants>
      <DemoVariant label="上方 / 下方插入选中行、插入到选中项下、删除选中（行高展开收起 + 淡入淡出）；删除后按补选策略自动选中相邻行" wide>
        <div class="ui-kit-demo__tree">
          <TreeView
            nodes={nodes}
            defaultExpandedIds={['photos', 'photos-2025', 'downloads']}
            selectedId={selectedId}
            removalSelection={removalSelection}
            onSelect={(node) => setSelectedId(node.id)}
            renderNode={(node) => (
              <>
                <span class="ui-kit-demo__tree-label">{node.label}</span>
                <span class="ui-kit-demo__tree-size">{formatStorageSize(node.size)}</span>
              </>
            )}
          />
        </div>
        <div class="ui-kit-demo__tree-actions">
          <SegmentedControl
            value={removalSelection}
            items={REMOVAL_SELECTION_ITEMS}
            onChange={setRemovalSelection}
            ariaLabel="删除选中后的补选策略"
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
