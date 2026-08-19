/**
 * 生成应用数据存储（委托注册表）单测。
 * 运行：node --experimental-strip-types src/os/generated-app-data-storage.test.ts
 *
 * 覆盖：同步快照读；diff 式异步保存（新增/修改/删除）；配额失败返回失败项并保留旧值；
 * 清空命名空间；localStorage 旧键枚举。
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { __resetRegistryCacheForTest, createAppRegistry, hydrateAppRegistry } from './app-registry.ts'
import { resetRegistryDbForTests, registryDbGet } from './app-registry-db.ts'
import { GENERATED_APP_DATA_KEY_PREFIX } from './device-storage.ts'
import {
  clearGeneratedAppData,
  listLegacyGeneratedAppDataKeys,
  loadGeneratedAppData,
  saveGeneratedAppDataAsync,
} from './generated-app-data-storage.ts'

function installLocalStorageStub(): Map<string, string> {
  const map = new Map<string, string>()
  ;(globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
  }
  return map
}

async function resetState(): Promise<void> {
  __resetRegistryCacheForTest()
  await resetRegistryDbForTests()
}

async function testSyncSnapshotReadAfterHydrate(): Promise<void> {
  await resetState()
  const appId = 'gen:test-app'
  // 直接写 DB，不经过 createAppRegistry（保持未 hydrate 状态）
  const { registryDbPut } = await import('./app-registry-db.ts')
  await registryDbPut(appId, 'theme', 'dark')

  // 未 hydrate 时同步读返回 {}
  assert.deepEqual(loadGeneratedAppData(appId), {})

  await hydrateAppRegistry(appId)
  assert.deepEqual(loadGeneratedAppData(appId), { theme: 'dark' })
}

async function testSaveAsyncDiffsAndWrites(): Promise<void> {
  await resetState()
  const appId = 'gen:test-diff'
  const registry = createAppRegistry(appId)
  await registry.setText('keep', '1')
  await registry.setText('remove-me', 'old')

  await hydrateAppRegistry(appId)

  const failures = await saveGeneratedAppDataAsync(appId, {
    keep: 'updated',
    added: 'new',
  })
  assert.deepEqual(failures, [], '全部成功时无失败项')

  assert.equal(await registry.getText('keep'), 'updated')
  assert.equal(await registry.getText('added'), 'new')
  assert.equal(await registry.getText('remove-me'), undefined, '快照缺失的 key 被删除')
  assert.equal(await registry.getType('keep'), 'text', '生成应用键类型为 text')
  assert.equal(await registry.getType('added'), 'text')
  assert.deepEqual(loadGeneratedAppData(appId), { keep: 'updated', added: 'new' })
}

async function testSaveAsyncQuotaFailureKeepsPrevious(): Promise<void> {
  await resetState()
  const appId = 'gen:test-quota'
  const registry = createAppRegistry(appId)
  await registry.setText('small', 'x')
  await hydrateAppRegistry(appId)

  const big = 'y'.repeat(5 * 1024 * 1024 + 1)
  const failures = await saveGeneratedAppDataAsync(appId, { small: big })
  assert.equal(failures.length, 1)
  assert.equal(failures[0]!.key, 'small')
  assert.equal(failures[0]!.previous, 'x', '失败项携带写入前旧值')
  assert.ok(failures[0]!.error.name.includes('Quota'), '失败项为配额错误')
  assert.equal(await registry.getText('small'), 'x', '配额失败回滚旧值')

  // 后续继续写入仍可用（batch 逐 key 隔离）
  const ok = await saveGeneratedAppDataAsync(appId, { small: 'ok', extra: 'e' })
  assert.deepEqual(ok, [])
  assert.equal(await registry.getText('small'), 'ok')
  assert.equal(await registry.getText('extra'), 'e')
  assert.equal(await registry.getType('extra'), 'text')
}

async function testClearGeneratedAppData(): Promise<void> {
  await resetState()
  const appId = 'gen:test-clear'
  const registry = createAppRegistry(appId)
  await registry.setText('a', '1')
  await registry.setText('b', '2')

  await clearGeneratedAppData(appId)
  assert.equal(await registryDbGet(appId, 'a'), undefined)
  assert.deepEqual(await registry.keys(), [], '清空后内存同步为空')
}

async function testLegacyKeysListed(): Promise<void> {
  await resetState()
  const store = installLocalStorageStub()
  store.set(`${GENERATED_APP_DATA_KEY_PREFIX}gen:one`, '{}')
  store.set(`${GENERATED_APP_DATA_KEY_PREFIX}gen:two`, '{}')
  store.set('unrelated-key', '1')

  const keys = listLegacyGeneratedAppDataKeys()
  assert.deepEqual(keys.sort(), [
    `${GENERATED_APP_DATA_KEY_PREFIX}gen:one`,
    `${GENERATED_APP_DATA_KEY_PREFIX}gen:two`,
  ])
}

async function main(): Promise<void> {
  const cases = [
    testSyncSnapshotReadAfterHydrate,
    testSaveAsyncDiffsAndWrites,
    testSaveAsyncQuotaFailureKeepsPrevious,
    testClearGeneratedAppData,
    testLegacyKeysListed,
  ]
  for (const test of cases) {
    await test()
    console.log(`ok: ${test.name}`)
  }
  console.log('generated-app-data-storage: all passed')
}

await main()
