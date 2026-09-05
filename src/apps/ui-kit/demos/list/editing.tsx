import { useState } from 'preact/hooks'
import { List } from '../../../../ui/list.tsx'
import { ListItem } from '../../../../ui/list-item.tsx'
import { Button } from '../../../../ui/button.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

const INITIAL_SHOPPING = [
  { id: 'milk', label: '牛奶', qty: '×2' },
  { id: 'eggs', label: '鸡蛋', qty: '×12' },
  { id: 'bread', label: '吐司', qty: '×1' },
  { id: 'coffee', label: '咖啡豆', qty: '×1' },
  { id: 'apple', label: '苹果', qty: '×6' },
  { id: 'yogurt', label: '酸奶', qty: '×4' },
  { id: 'tissue', label: '纸巾', qty: '×1' },
  { id: 'detergent', label: '洗衣液', qty: '×1' },
]

export default function ListEditingDemo() {
  const [editing, setEditing] = useState(false)
  const [shopping, setShopping] = useState(INITIAL_SHOPPING)

  const reorder = (fromId: string, toId: string) => {
    setShopping((prev) => {
      const from = prev.findIndex((it) => it.id === fromId)
      const to = prev.findIndex((it) => it.id === toId)
      if (from < 0 || to < 0) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  return (
    <DemoVariants>
      <DemoVariant label="「编辑」进出：减号删除 / 把手重排" wide>
        <div class="ui-kit-demo__row">
          <Button onClick={() => setEditing(!editing)}>
            {editing ? '完成' : '编辑'}
          </Button>
          {!editing && shopping.length !== INITIAL_SHOPPING.length && (
            <Button onClick={() => setShopping(INITIAL_SHOPPING)}>
              还原清单
            </Button>
          )}
        </div>
        <List
          editing={editing}
          onDelete={(id) => setShopping((prev) => prev.filter((it) => it.id !== id))}
          onReorder={reorder}
        >
          {shopping.map((item) => (
            <ListItem key={item.id} id={item.id} label={item.label} value={item.qty} />
          ))}
        </List>
        {shopping.length === 0 && <p class="list__footnote">清单已清空</p>}
      </DemoVariant>
    </DemoVariants>
  )
}
