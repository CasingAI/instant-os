/**
 * 应用注册表（App Registry）单测。
 * 运行：node --experimental-strip-types src/os/app-registry.test.ts
 *
 * 覆盖：IndexedDB 读写删 / 命名空间枚举 / 字节统计；命名空间隔离；
 * 按需粗粒度 hydrate；5 MB 单应用配额；失败回滚；批量写入；全局注册表只读；
 * text/json 交叉读写、类型覆盖、setJson 校验。
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import {
  APP_REGISTRY_QUOTA_BYTES,
  __resetRegistryCacheForTest,
  applyRegistryBatch,
  createAppRegistry,
  createGlobalRegistry,
  RegistryQuotaExceededError,
  RegistryTypeError,
  RegistryWriteError,
} from './app-registry.ts'
import {
  registryDbGet,
  registryDbGetBytesByApp,
  registryDbListApps,
  registryDbListEntries,
  registryDbPut,
  resetRegistryDbForTests,
} from './app-registry-db.ts'

async function resetState(): Promise<void> {
  __resetRegistryCacheForTest()
  await resetRegistryDbForTests()
}

async function testReadWriteDeleteRoundTrip(): Promise<void> {
  await resetState()
  const registry = createAppRegistry('weather')

  assert.equal(await registry.getText('store'), undefined, '未写入时返回 undefined')
  await registry.setText('store', '{"cities":[]}')
  assert.equal(await registry.getText('store'), '{"cities":[]}')
  assert.equal(await registry.getType('store'), 'text')
  assert.deepEqual(await registry.keys(), ['store'])

  await registry.removeItem('store')
  assert.equal(await registry.getText('store'), undefined)
  assert.deepEqual(await registry.keys(), [])

  await registry.setText('a', '1')
  const entries = await registryDbListEntries('weather')
  assert.equal(entries.length, 1)
  assert.equal(entries[0]!.key, 'a')
  assert.equal(entries[0]!.value, '1')
  assert.equal(entries[0]!.valueType, 'text')
  assert.ok(typeof entries[0]!.updatedAt === 'number')
}

async function testJsonRoundTripAndCrossRead(): Promise<void> {
  await resetState()
  const registry = createAppRegistry('typed-app')

  assert.equal(await registry.getJson('cities'), undefined, '键不存在时 getJson 返回 undefined')
  assert.equal(await registry.getType('cities'), undefined)

  await registry.setJson('cities', [{ id: 'beijing', name: '北京' }])
  assert.equal(await registry.getType('cities'), 'json')
  assert.deepEqual(await registry.getJson('cities'), [{ id: 'beijing', name: '北京' }])
  assert.equal(await registry.getText('cities'), '[{"id":"beijing","name":"北京"}]', 'getText 可读 json 键的磁盘原文')

  await registry.setText('label', 'hello')
  await assert.rejects(() => registry.getJson('label'), RegistryTypeError)

  await registryDbPut('typed-app', 'legacy', '"123"')
  __resetRegistryCacheForTest()
  const reopened = createAppRegistry('typed-app')
  assert.equal(await reopened.getType('legacy'), 'untyped')
  await assert.rejects(() => reopened.getJson('legacy'), RegistryTypeError, 'untyped 不可当 JSON 猜')
  assert.equal(await reopened.getText('legacy'), '"123"')
}

async function testSetJsonUndefinedDeletesAndCircularFails(): Promise<void> {
  await resetState()
  const registry = createAppRegistry('json-write-app')
  await registry.setJson('payload', { a: 1 })
  await registry.setJson('payload', undefined)
  assert.equal(await registry.getText('payload'), undefined, 'setJson(undefined) 删除该键')

  const circular: Record<string, unknown> = {}
  circular.self = circular
  await assert.rejects(() => registry.setJson('loop', circular), TypeError)
  assert.equal(await registry.getText('loop'), undefined, 'stringify 失败不落盘')
}

async function testTypeOverwriteLastWriteWins(): Promise<void> {
  await resetState()
  const registry = createAppRegistry('overwrite-app')
  await registry.setText('k', 'hello')
  assert.equal(await registry.getType('k'), 'text')
  await registry.setJson('k', { n: 1 })
  assert.equal(await registry.getType('k'), 'json')
  assert.deepEqual(await registry.getJson('k'), { n: 1 })
  await registry.setText('k', 'hello')
  assert.equal(await registry.getType('k'), 'text')
  await assert.rejects(() => registry.getJson('k'), RegistryTypeError)
  assert.equal(await registry.getText('k'), 'hello')
}

async function testNamespaceIsolation(): Promise<void> {
  await resetState()
  const weather = createAppRegistry('weather')
  const news = createAppRegistry('news')

  await weather.setText('store', 'weather-data')
  assert.equal(await news.getText('store'), undefined, '其他命名空间不可见')
  assert.equal(await registryDbGet('news', 'store'), undefined)

  const weather2 = createAppRegistry('weather')
  assert.equal(await weather2.getText('store'), 'weather-data')
}

async function testCoarseHydrationFromDb(): Promise<void> {
  await resetState()
  await createAppRegistry('mail').setText('k1', 'v1')
  await createAppRegistry('mail').setText('k2', 'v2')

  const registry = createAppRegistry('mail')
  assert.equal(await registry.getText('k1'), 'v1')
  assert.deepEqual(await registry.keys(), ['k1', 'k2'])
}

async function testQuotaExceededThrows(): Promise<void> {
  await resetState()
  const registry = createAppRegistry('quota-app')
  const big = 'x'.repeat(APP_REGISTRY_QUOTA_BYTES + 1)

  await assert.rejects(() => registry.setText('store', big), RegistryQuotaExceededError)
  assert.equal(await registry.getText('store'), undefined)

  await registry.setText('store', 'small')
  await assert.rejects(() => registry.setText('store', big), RegistryQuotaExceededError)
  assert.equal(await registry.getText('store'), 'small')

  await registry.setText('a', 'x'.repeat(APP_REGISTRY_QUOTA_BYTES - 10))
  await assert.rejects(
    () => registry.setText('b', 'x'.repeat(20)),
    RegistryQuotaExceededError,
  )
}

async function testJsonQuotaUsesRawBytes(): Promise<void> {
  await resetState()
  const registry = createAppRegistry('json-quota-app')
  const payload = 'x'.repeat(APP_REGISTRY_QUOTA_BYTES)
  await assert.rejects(() => registry.setJson('blob', payload), RegistryQuotaExceededError)
  assert.equal(await registry.getText('blob'), undefined)
}

async function testWriteFailureRollsBackMemory(): Promise<void> {
  await resetState()
  const registry = createAppRegistry('rollback-app')
  await registry.setText('k', 'old')

  const { openRegistryDb } = await import('./app-registry-db.ts')
  const db = await openRegistryDb()
  db.close()
  await assert.rejects(() => registry.setText('k', 'new'), RegistryWriteError)
  assert.equal(await registry.getText('k'), 'old')
}

async function testBatchApply(): Promise<void> {
  await resetState()
  const registry = createAppRegistry('batch-app')
  await registry.setText('keep', '1')
  await registry.setText('remove-me', '2')

  const failures = await applyRegistryBatch('batch-app', [
    { key: 'keep', text: 'updated' },
    { key: 'remove-me', value: undefined },
    { key: 'added', text: '3' },
    { key: 'cities', json: [{ id: 'a' }] },
  ])
  assert.deepEqual(failures, [])
  assert.equal(await registry.getText('keep'), 'updated')
  assert.equal(await registry.getText('remove-me'), undefined)
  assert.equal(await registry.getText('added'), '3')
  assert.equal(await registry.getType('cities'), 'json')
  assert.deepEqual(await registry.getJson('cities'), [{ id: 'a' }])

  const big = 'x'.repeat(APP_REGISTRY_QUOTA_BYTES)
  const batchFailures = await applyRegistryBatch('batch-app', [
    { key: 'added', text: 'still-ok' },
    { key: 'keep', text: big },
  ])
  assert.equal(batchFailures.length, 1)
  assert.equal(batchFailures[0]!.key, 'keep')
  assert.equal(batchFailures[0]!.previous, 'updated')
  assert.ok(batchFailures[0]!.error instanceof RegistryQuotaExceededError)
  assert.equal(await registry.getText('added'), 'still-ok')
  assert.equal(await registry.getText('keep'), 'updated', '失败 key 回滚旧值')
}

async function testGlobalRegistryReadOnly(): Promise<void> {
  await resetState()
  await createAppRegistry('weather').setText('store', 'w')
  await createAppRegistry('news').setText('store', 'n')

  const global = createGlobalRegistry()
  const namespaces = await global.listNamespaces()
  assert.deepEqual(
    namespaces.map((ns) => ns.appId).sort(),
    ['news', 'weather'],
  )
  const weatherNs = namespaces.find((ns) => ns.appId === 'weather')
  assert.equal(weatherNs?.keyCount, 1)

  assert.equal(await global.getItem('weather', 'store'), 'w')

  const bytes = await global.bytesByApp()
  assert.equal(bytes.weather, 1)

  await global.removeItem('weather', 'store')
  assert.equal(await createAppRegistry('weather').getText('store'), undefined)

  await createAppRegistry('news').setText('x', '1')
  await global.clearNamespace('news')
  assert.equal(await createAppRegistry('news').getText('x'), undefined)

  const after = await global.listNamespaces()
  assert.equal(after.length, 0, '清空后无命名空间')
}

async function testClear(): Promise<void> {
  await resetState()
  const registry = createAppRegistry('clear-app')
  await registry.setText('a', '1')
  await registry.setText('b', '2')
  await registry.clear()
  assert.deepEqual(await registry.keys(), [])
  assert.deepEqual(await registryDbListApps(), [])
}

async function testBytesByAppStats(): Promise<void> {
  await resetState()
  await createAppRegistry('weather').setText('store', '天气数据-中文')
  await createAppRegistry('news').setText('store', 'a'.repeat(100))

  const bytes = await registryDbGetBytesByApp()
  assert.ok(bytes.weather! > 3, '中文 UTF-8 多字节计数')
  assert.equal(bytes.news, 100)
}

async function main(): Promise<void> {
  const cases = [
    testReadWriteDeleteRoundTrip,
    testJsonRoundTripAndCrossRead,
    testSetJsonUndefinedDeletesAndCircularFails,
    testTypeOverwriteLastWriteWins,
    testNamespaceIsolation,
    testCoarseHydrationFromDb,
    testQuotaExceededThrows,
    testJsonQuotaUsesRawBytes,
    testWriteFailureRollsBackMemory,
    testBatchApply,
    testGlobalRegistryReadOnly,
    testClear,
    testBytesByAppStats,
  ]
  for (const test of cases) {
    await test()
    console.log(`ok: ${test.name}`)
  }
  console.log('app-registry: all passed')
}

await main()
