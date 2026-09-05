import { useState } from 'preact/hooks'
import { List } from '../../../../ui/list.tsx'
import { ListItem } from '../../../../ui/list-item.tsx'
import { SegmentedControl } from '../../../../ui/segmented-control.tsx'
import { DemoVariants, DemoVariant, PLAIN_THREADS } from '../../ui-kit-demo-shared.tsx'

export default function ListPlainVariantDemo() {
  const [variant, setVariant] = useState<'grouped' | 'plain'>('plain')
  const [selectedId, setSelectedId] = useState('t2')

  return (
    <DemoVariants>
      <DemoVariant label="variant 现场切换：同一组件同一份数据，传参换装（plain 专属槽位 trailing/preview/unread 在 grouped 下忽略）" wide>
        <SegmentedControl
          ariaLabel="List 变体"
          value={variant}
          onChange={setVariant}
          items={[
            { id: 'grouped', label: 'grouped 设置' },
            { id: 'plain', label: 'plain 邮件' },
          ]}
        />
        <List variant={variant} selectedId={selectedId} onSelect={setSelectedId}>
          {PLAIN_THREADS.map((thread) => (
            <ListItem
              key={thread.id}
              id={thread.id}
              label={thread.label}
              trailing={thread.trailing}
              subtitle={thread.subtitle}
              preview={thread.preview}
              unread={thread.unread}
              accessory="check"
            />
          ))}
        </List>
        <p class="ui-kit-demo__status">
          当前变体：{variant} · 选中：{selectedId}
        </p>
      </DemoVariant>
    </DemoVariants>
  )
}
