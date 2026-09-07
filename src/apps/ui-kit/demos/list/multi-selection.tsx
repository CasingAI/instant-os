import { useState } from 'preact/hooks'
import { List } from '../../../../ui/list.tsx'
import { ListItem } from '../../../../ui/list-item.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function ListMultiSelectionDemo() {
  const [selectedIds, setSelectedIds] = useState<string[]>(['gmail', 'qq'])

  const accounts = [
    { id: 'icloud', label: 'iCloud', value: 'john@example.com' },
    { id: 'exchange', label: 'Exchange', value: 'work@example.com' },
    { id: 'gmail', label: 'Gmail', value: 'john@gmail.com' },
    { id: 'qq', label: 'QQ 邮箱', value: 'john@qq.com' },
  ]

  const toggle = (id: string) => {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]))
  }

  const labelOf = (id: string) => accounts.find((account) => account.id === id)?.label ?? id

  return (
    <DemoVariants>
      <DemoVariant label="selectedIds/onSelect + 点行切换勾（只显勾，无持久蓝底）" wide>
        <List selectedIds={selectedIds} onSelect={toggle} selectionTone="check">
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
        <p class="ui-kit-demo__status">
          当前选中：{selectedIds.length === 0 ? '（无）' : selectedIds.map(labelOf).join('、')}
        </p>
      </DemoVariant>
    </DemoVariants>
  )
}
