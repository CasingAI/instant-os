/**
 * 菜单栏在外观不变时仍应执行最新点击回调。
 * 运行：node --experimental-strip-types src/os/menu-bar-live-handlers.test.ts
 */
import assert from 'node:assert/strict'
import { bindMenusToLive } from './menu-bar-live-handlers.ts'
import type { MenuDefinition } from './menu-bar-types.ts'

function actionMenu(label: string, onClick: () => void): MenuDefinition[] {
  return [
    {
      label: '文件',
      items: [{ type: 'action', label: '删除', onClick }],
    },
  ]
}

{
  const calls: string[] = []
  const live: { current?: MenuDefinition[] } = {}
  live.current = actionMenu('删除', () => {
    calls.push('xp')
  })
  const published = bindMenusToLive(() => live.current, live.current)
  live.current = actionMenu('删除', () => {
    calls.push('vm3')
  })

  const item = published[0]?.items[0]
  assert.equal(item?.type, 'action')
  if (item?.type === 'action') {
    item.onClick()
  }
  assert.deepEqual(calls, ['vm3'])
}

{
  const calls: string[] = []
  const live: { current?: MenuDefinition[] } = {}
  live.current = [
    {
      label: '文件',
      items: [
        {
          type: 'submenu',
          label: '最近',
          items: [{ type: 'action', label: '打开', onClick: () => calls.push('old') }],
        },
      ],
    },
  ]
  const published = bindMenusToLive(() => live.current, live.current)
  live.current = [
    {
      label: '文件',
      items: [
        {
          type: 'submenu',
          label: '最近',
          items: [{ type: 'action', label: '打开', onClick: () => calls.push('new') }],
        },
      ],
    },
  ]

  const submenu = published[0]?.items[0]
  assert.equal(submenu?.type, 'submenu')
  if (submenu?.type === 'submenu' && submenu.items[0]?.type === 'action') {
    submenu.items[0].onClick()
  }
  assert.deepEqual(calls, ['new'])
}

console.log('menu-bar-live-handlers.test.ts ok')
