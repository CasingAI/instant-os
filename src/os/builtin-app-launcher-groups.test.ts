/**
 * 默认桌面文件夹分组单测。
 * 运行：node --experimental-strip-types src/os/builtin-app-launcher-groups.test.ts
 */
import assert from 'node:assert/strict'
import {
  applyDefaultLauncherFolders,
  DEVELOPER_TOOL_APP_IDS,
  DEVELOPER_TOOLS_FOLDER_ID,
  DEVELOPER_TOOLS_FOLDER_NAME,
  isDefaultFolderGroupedAppId,
  SYSTEM_TOOLS_FOLDER_ID,
} from './builtin-app-launcher-groups.ts'

function testOnlyDeveloperToolsAreGrouped(): void {
  assert.equal(isDefaultFolderGroupedAppId('vscode'), true)
  assert.equal(isDefaultFolderGroupedAppId('icode'), true)
  assert.equal(isDefaultFolderGroupedAppId('files'), false)
  assert.equal(isDefaultFolderGroupedAppId('settings'), false)
  assert.equal(isDefaultFolderGroupedAppId('browser'), false)
  assert.ok(DEVELOPER_TOOL_APP_IDS.includes('terminal'))
}

function testLooseDevAppsMoveIntoFolderAndSystemAppsStayOnDesktop(): void {
  const next = applyDefaultLauncherFolders({
    desktopIconOrder: ['browser', 'files', 'vscode', 'news', 'terminal'],
    desktopFolders: [],
  })

  assert.deepEqual(next.desktopIconOrder, [
    'browser',
    'files',
    'news',
    DEVELOPER_TOOLS_FOLDER_ID,
  ])
  assert.equal(next.desktopFolders.some((folder) => folder.id === SYSTEM_TOOLS_FOLDER_ID), false)

  const developer = next.desktopFolders.find((folder) => folder.id === DEVELOPER_TOOLS_FOLDER_ID)
  assert.equal(developer?.name, DEVELOPER_TOOLS_FOLDER_NAME)
  assert.ok(developer?.appIds.includes('vscode'))
  assert.ok(developer?.appIds.includes('terminal'))
}

function testDissolvesLegacySystemToolsFolderOntoDesktop(): void {
  const next = applyDefaultLauncherFolders({
    desktopIconOrder: ['browser', SYSTEM_TOOLS_FOLDER_ID, 'news'],
    desktopFolders: [
      {
        id: SYSTEM_TOOLS_FOLDER_ID,
        name: '系统工具',
        appIds: ['files', 'settings'],
      },
    ],
  })

  assert.equal(next.desktopFolders.some((folder) => folder.id === SYSTEM_TOOLS_FOLDER_ID), false)
  assert.ok(next.desktopIconOrder.includes('files'))
  assert.ok(next.desktopIconOrder.includes('settings'))
  assert.ok(next.desktopIconOrder.includes('browser'))
  assert.ok(next.desktopIconOrder.includes(DEVELOPER_TOOLS_FOLDER_ID))
}

function testDoesNotStealAppsFromUserFolders(): void {
  const next = applyDefaultLauncherFolders({
    desktopIconOrder: ['browser', 'folder:custom', 'files'],
    desktopFolders: [
      {
        id: 'folder:custom',
        name: '我的开发',
        appIds: ['vscode'],
      },
    ],
  })

  const custom = next.desktopFolders.find((folder) => folder.id === 'folder:custom')
  const developer = next.desktopFolders.find((folder) => folder.id === DEVELOPER_TOOLS_FOLDER_ID)
  assert.deepEqual(custom?.appIds, ['vscode'])
  assert.equal(developer?.appIds.includes('vscode'), false)
  assert.ok(next.desktopIconOrder.includes('folder:custom'))
  assert.ok(next.desktopIconOrder.includes('files'))
}

function testSecondApplyIsIdempotentOnOrder(): void {
  const first = applyDefaultLauncherFolders({
    desktopIconOrder: ['help', 'settings', 'icode'],
    desktopFolders: [],
  })
  const second = applyDefaultLauncherFolders(first)
  assert.deepEqual(second.desktopIconOrder, first.desktopIconOrder)
  assert.deepEqual(second.desktopFolders, first.desktopFolders)
}

function testKeepsRenamedDeveloperFolderName(): void {
  const next = applyDefaultLauncherFolders({
    desktopIconOrder: [DEVELOPER_TOOLS_FOLDER_ID],
    desktopFolders: [
      {
        id: DEVELOPER_TOOLS_FOLDER_ID,
        name: '实验室',
        appIds: ['vscode'],
      },
    ],
  })
  const developer = next.desktopFolders.find((folder) => folder.id === DEVELOPER_TOOLS_FOLDER_ID)
  assert.equal(developer?.name, '实验室')
  assert.ok(developer?.appIds.includes('vscode'))
  assert.ok(developer?.appIds.includes('icode'))
}

testOnlyDeveloperToolsAreGrouped()
testLooseDevAppsMoveIntoFolderAndSystemAppsStayOnDesktop()
testDissolvesLegacySystemToolsFolderOntoDesktop()
testDoesNotStealAppsFromUserFolders()
testSecondApplyIsIdempotentOnOrder()
testKeepsRenamedDeveloperFolderName()
console.log('builtin-app-launcher-groups.test.ts ok')
