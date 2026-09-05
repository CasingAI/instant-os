import { useState } from 'preact/hooks'
import { TreeView } from '../../../../ui/tree-view.tsx'
import { formatStorageSize } from '../../../../os/format-storage-size.ts'
import { DemoVariants, DemoVariant, DEMO_TREE } from '../../ui-kit-demo-shared.tsx'

export default function TreeViewDemo() {
  const [selectedId, setSelectedId] = useState<string | undefined>('photos-2025-08')

  return (
    <DemoVariants>
      <DemoVariant label="展开 / 折叠 / 选中" wide>
        <div class="ui-kit-demo__tree">
          <TreeView
            nodes={DEMO_TREE}
            defaultExpandedIds={['photos', 'photos-2025', 'downloads']}
            selectedId={selectedId}
            onSelect={(node) => setSelectedId(node.id)}
            renderNode={(node) => (
              <>
                <span class="ui-kit-demo__tree-label">{node.label}</span>
                <span class="ui-kit-demo__tree-size">{formatStorageSize(node.size)}</span>
              </>
            )}
          />
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}
