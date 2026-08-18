/**
 * icode 内部项目存储（注册表化后）单测。
 * 运行：node --experimental-strip-types src/apps/icode/icode-storage.test.ts
 *
 * 覆盖：默认空列表；create/update/remove/get 往返；loadInternalProjectsSync 同步读；
 * 订阅通知；跨实例持久化。
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { __resetRegistryCacheForTest } from '../../os/app-registry.ts'
import { resetRegistryDbForTests } from '../../os/app-registry-db.ts'
import {
  createInternalProject,
  getInternalProject,
  loadInternalProjects,
  loadInternalProjectsSync,
  removeInternalProject,
  subscribeInternalProjects,
  updateInternalProject,
} from './icode-storage.ts'

async function resetState(): Promise<void> {
  // 先让模块加载时触发的后台 hydrate 落定，避免与删库竞态
  await new Promise((resolve) => setTimeout(resolve, 0))
  __resetRegistryCacheForTest()
  await resetRegistryDbForTests()
}

async function testDefaultEmptyList(): Promise<void> {
  await resetState()
  assert.deepEqual(await loadInternalProjects(), [])
  assert.deepEqual(loadInternalProjectsSync(), [])
  assert.equal(await getInternalProject('nope'), undefined)
}

async function testCreateAddsProject(): Promise<void> {
  await resetState()
  const project = await createInternalProject('我的应用', '描述')
  assert.equal(project.name, '我的应用')
  assert.equal(project.description, '描述')
  assert.ok(project.id.startsWith('icode-'))
  assert.ok(project.linkedAppId!.startsWith('gen:'), '自动生成关联桌面应用 id')

  const projects = await loadInternalProjects()
  assert.equal(projects.length, 1)
  assert.equal(projects[0]!.id, project.id)
  assert.deepEqual(loadInternalProjectsSync(), projects, '同步读命中内存缓存')
}

async function testUpdatePatchesProject(): Promise<void> {
  await resetState()
  const project = await createInternalProject('原名', '')
  const updated = await updateInternalProject(project.id, { name: '新名', html: '<p>hi</p>' })
  assert.equal(updated?.name, '新名')
  assert.equal(updated?.html, '<p>hi</p>')
  assert.ok(updated!.updatedAt >= project.updatedAt, 'updatedAt 被刷新')

  assert.equal(await updateInternalProject('missing-id', { name: 'x' }), undefined)
  assert.equal((await loadInternalProjects()).length, 1, '更新失败不影响列表')
}

async function testRemoveDeletesProject(): Promise<void> {
  await resetState()
  const project = await createInternalProject('待删除', '')
  assert.equal(await removeInternalProject(project.id), true)
  assert.equal(await getInternalProject(project.id), undefined)
  assert.deepEqual(await loadInternalProjects(), [])

  assert.equal(await removeInternalProject(project.id), false, '重复删除返回 false')
}

async function testSubscribeFiresOnMutations(): Promise<void> {
  await resetState()
  const seen: number[] = []
  const unsubscribe = subscribeInternalProjects(() => seen.push(1))

  const project = await createInternalProject('p', '')
  assert.equal(seen.length, 1)
  await updateInternalProject(project.id, { name: 'p2' })
  assert.equal(seen.length, 2)
  await removeInternalProject(project.id)
  assert.equal(seen.length, 3)

  unsubscribe()
  await createInternalProject('q', '')
  assert.equal(seen.length, 3, '取消订阅后不再通知')
}

async function testPersistsAcrossInstances(): Promise<void> {
  await resetState()
  const project = await createInternalProject('持久化', '')
  // 模拟重开应用：清空内存缓存后仍能从 IndexedDB 读回
  __resetRegistryCacheForTest()
  const projects = await loadInternalProjects()
  assert.equal(projects.length, 1)
  assert.equal(projects[0]!.id, project.id)
}

async function testMigratesFromLegacyStoreKey(): Promise<void> {
  await resetState()
  // 模拟旧版：数据存在 'store' 单键下
  const { registryDbPut, registryDbListKeys } = await import('../../os/app-registry-db.ts')
  await registryDbPut(
    'icode',
    'store',
    JSON.stringify([
      {
        id: 'icode-1',
        name: '旧项目',
        description: '旧描述',
        category: '内部开发',
        iconEmoji: '🛠️',
        themeColor: '#5856d6',
        tags: [],
        html: '',
        appData: {},
        chat: [],
        linkedAppId: 'gen:icode-1',
        createdAt: 1,
        updatedAt: 1,
      },
    ]),
  )
  __resetRegistryCacheForTest()

  const projects = await loadInternalProjects()
  assert.equal(projects.length, 1)
  assert.equal(projects[0]!.name, '旧项目')

  // 迁移后旧键清除，字段键 'projects' 独立存在
  const keys = await registryDbListKeys('icode')
  assert.deepEqual(keys.sort(), ['projects'].sort())
}

async function main(): Promise<void> {
  const cases = [
    testDefaultEmptyList,
    testCreateAddsProject,
    testUpdatePatchesProject,
    testRemoveDeletesProject,
    testSubscribeFiresOnMutations,
    testPersistsAcrossInstances,
    testMigratesFromLegacyStoreKey,
  ]
  for (const test of cases) {
    await test()
    console.log(`ok: ${test.name}`)
  }
  console.log('icode-storage: all passed')
}

await main()
