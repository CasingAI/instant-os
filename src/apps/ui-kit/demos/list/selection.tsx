import { useState } from 'preact/hooks'
import { List } from '../../../../ui/list.tsx'
import { ListItem } from '../../../../ui/list-item.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function ListSelectionDemo() {
  const [selectedId, setSelectedId] = useState('icloud')

  const accounts = [
    { id: 'icloud', label: 'iCloud', value: 'john@example.com' },
    { id: 'exchange', label: 'Exchange', value: 'work@example.com' },
    { id: 'gmail', label: 'Gmail', value: 'john@gmail.com' },
    { id: 'qq', label: 'QQ 邮箱', value: 'john@qq.com' },
  ]

  return (
    <DemoVariants>
      <DemoVariant label="selectedId/onSelect + accessory 勾随选中" wide>
        <List selectedId={selectedId} onSelect={setSelectedId}>
          {accounts.map((account) => (
            <ListItem
              key={account.id}
              id={account.id}
              label={account.label}
              value={account.value}
              accessory="check"
            />
          ))}
        </List>
        <p class="ui-kit-demo__status">当前选中：{selectedId}</p>
      </DemoVariant>
    </DemoVariants>
  )
}
