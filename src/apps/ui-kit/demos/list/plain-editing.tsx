import { useState } from 'preact/hooks'
import { List } from '../../../../ui/list.tsx'
import { ListItem } from '../../../../ui/list-item.tsx'
import { Button } from '../../../../ui/button.tsx'
import { DemoVariants, DemoVariant, PLAIN_THREADS } from '../../ui-kit-demo-shared.tsx'

export default function ListPlainEditingDemo() {
  const [editing, setEditing] = useState(false)
  const [threads, setThreads] = useState(PLAIN_THREADS)

  const reorder = (fromId: string, toId: string) => {
    setThreads((prev) => {
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
      <DemoVariant label="「编辑」进出：减号删除 / 把手重排（plain 分支与 grouped 共用同一套机制）" wide>
        <div class="ui-kit-demo__row">
          <Button onClick={() => setEditing(!editing)}>
            {editing ? '完成' : '编辑'}
          </Button>
          {!editing && threads.length !== PLAIN_THREADS.length && (
            <Button onClick={() => setThreads(PLAIN_THREADS)}>
              还原列表
            </Button>
          )}
        </div>
        <List
          variant="plain"
          editing={editing}
          onDelete={(id) => setThreads((prev) => prev.filter((it) => it.id !== id))}
          onReorder={reorder}
        >
          {threads.map((thread) => (
            <ListItem
              key={thread.id}
              id={thread.id}
              label={thread.label}
              trailing={thread.trailing}
              subtitle={thread.subtitle}
              preview={thread.preview}
              unread={thread.unread}
            />
          ))}
        </List>
        {threads.length === 0 && <p class="ui-kit-demo__status">列表已清空</p>}
      </DemoVariant>
    </DemoVariants>
  )
}
