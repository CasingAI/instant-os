/**
 * 强制应用名菜单模板单测。
 * 运行：node --experimental-strip-types src/os/app-menu-template.test.ts
 */
import assert from 'node:assert/strict'
import {
  APP_MENU_ITEM_IDS,
  applyAppMenuTemplate,
  mergeAppMenuItems,
} from './app-menu-template.ts'
import type { MenuItem } from './menu-bar-types.ts'

const APP_NAME = '音乐实验室'

const actions = {
  onAbout: () => {
    calls.push('about')
  },
  onHide: () => {
    calls.push('hide')
  },
  onQuit: () => {
    calls.push('quit')
  },
}

let calls: string[] = []

function resetCalls() {
  calls = []
}

function actionLabels(items: MenuItem[]): string[] {
  return items.filter((item) => item.type === 'action').map((item) => item.label)
}

function actionIds(items: MenuItem[]): Array<string | undefined> {
  return items.filter((item) => item.type === 'action').map((item) => item.id)
}

{
  const menus = applyAppMenuTemplate([], APP_NAME, actions)
  assert.equal(menus.length, 1)
  assert.equal(menus[0]?.label, APP_NAME)
  assert.deepEqual(actionLabels(menus[0]!.items), [
    '关于 音乐实验室',
    '隐藏 音乐实验室',
    '退出 音乐实验室',
  ])
  assert.deepEqual(actionIds(menus[0]!.items), [
    APP_MENU_ITEM_IDS.about,
    APP_MENU_ITEM_IDS.hide,
    APP_MENU_ITEM_IDS.quit,
  ])
}

{
  const menus = applyAppMenuTemplate(
    [
      { label: '文件', items: [{ type: 'action', label: '打开…', onClick: () => undefined }] },
      { label: '编辑', items: [{ type: 'action', label: '重新计算节拍', onClick: () => undefined }] },
    ],
    APP_NAME,
    actions,
  )
  assert.deepEqual(
    menus.map((menu) => menu.label),
    ['音乐实验室', '文件', '编辑'],
  )
  assert.deepEqual(actionLabels(menus[0]!.items), [
    '关于 音乐实验室',
    '隐藏 音乐实验室',
    '退出 音乐实验室',
  ])
  assert.equal(menus[1]?.items[0]?.type === 'action' && menus[1].items[0].label, '打开…')
}

{
  const extraClick = () => {
    calls.push('extra')
  }
  const items = mergeAppMenuItems(
    [{ type: 'action', label: '打开音乐文件夹', onClick: extraClick }],
    '音乐',
    actions,
  )
  assert.deepEqual(actionLabels(items), ['关于 音乐', '打开音乐文件夹', '隐藏 音乐', '退出 音乐'])
}

{
  resetCalls()
  const appAbout = () => {
    calls.push('app-about')
  }
  const appHide = () => {
    calls.push('app-hide')
  }
  const appQuit = () => {
    calls.push('app-quit')
  }
  const items = mergeAppMenuItems(
    [
      { type: 'action', label: '关于 评测', onClick: appAbout },
      { type: 'separator' },
      { type: 'action', label: '隐藏 评测', shortcut: '⌘H', onClick: appHide },
      { type: 'separator' },
      { type: 'action', label: '退出 评测', shortcut: '⌘Q', onClick: appQuit },
    ],
    '评测',
    actions,
  )
  const about = items.find((item) => item.type === 'action' && item.id === APP_MENU_ITEM_IDS.about)
  const hide = items.find((item) => item.type === 'action' && item.id === APP_MENU_ITEM_IDS.hide)
  const quit = items.find((item) => item.type === 'action' && item.id === APP_MENU_ITEM_IDS.quit)
  assert.ok(about && about.type === 'action')
  assert.ok(hide && hide.type === 'action')
  assert.ok(quit && quit.type === 'action')
  about.onClick()
  hide.onClick()
  quit.onClick()
  assert.deepEqual(calls, ['about', 'hide', 'quit'])
}

{
  const extra = { type: 'action' as const, label: '设置…', onClick: () => undefined }
  const items = mergeAppMenuItems(
    [
      extra,
      { type: 'separator' },
      { type: 'action', label: '隐藏 GitHub Desktop', shortcut: '⌘H', onClick: () => undefined },
      { type: 'separator' },
      { type: 'action', label: '退出 GitHub Desktop', shortcut: '⌘Q', onClick: () => undefined },
    ],
    'GitHub Desktop',
    actions,
  )
  assert.deepEqual(actionLabels(items), [
    '关于 GitHub Desktop',
    '设置…',
    '隐藏 GitHub Desktop',
    '退出 GitHub Desktop',
  ])
}

{
  const items = mergeAppMenuItems(
    [
      { type: 'action', label: '隐藏调试面板', onClick: () => undefined },
      { type: 'action', label: '存档当前场景', onClick: () => undefined },
    ],
    '3D 实验室',
    actions,
  )
  assert.deepEqual(actionLabels(items), [
    '关于 3D 实验室',
    '隐藏调试面板',
    '存档当前场景',
    '隐藏 3D 实验室',
    '退出 3D 实验室',
  ])
}

{
  const menus = applyAppMenuTemplate(
    [
      {
        label: '文件',
        items: [
          { type: 'action', label: '关于文件', onClick: () => undefined },
          { type: 'separator' },
          { type: 'action', label: '隐藏文件', shortcut: '⌘H', onClick: () => undefined },
          { type: 'separator' },
          { type: 'action', label: '新建文件夹', onClick: () => undefined },
          { type: 'separator' },
          { type: 'action', label: '退出文件', shortcut: '⌘Q', onClick: () => undefined },
        ],
      },
      { label: '显示', items: [{ type: 'action', label: '图标', onClick: () => undefined }] },
    ],
    '文件',
    actions,
  )
  assert.equal(menus[0]?.label, '文件')
  assert.deepEqual(actionLabels(menus[0]!.items), [
    '关于 文件',
    '隐藏 文件',
    '新建文件夹',
    '退出 文件',
  ])
  assert.equal(menus[1]?.label, '显示')
}

console.log('app-menu-template.test.ts: ok')
