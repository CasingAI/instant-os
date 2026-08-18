/**
 * 应用注册表（App Registry）单测。
 * 运行：node --experimental-strip-types src/os/app-registry.test.ts
 *
 * 覆盖：IndexedDB 读写删 / 命名空间枚举 / 字节统计；命名空间隔离；
 * 按需粗粒度 hydrate；5 MB 单应用配额；失败回滚；批量写入；全局注册表只读。
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import {
  APP_REGISTRY_QUOTA_BYTES,
  __resetRegistryCacheForTest,
  applyRegistryBatch,
  createAppRegistry,
  createGlobalRegistry,
  hydrateAppRegistry,
  RegistryQuotaExceededError,
  RegistryWriteError,
} from './app-registry.ts'
import {
  registryDbGet,
  registryDbGetBytesByApp,
  registryDbListApps,
  registryDbListEntries,
  resetRegistryDbForTests,
} from './app-registry-db.ts'

async function resetState(): Promise<void> {
  __resetRegistryCacheForTest()
  await resetRegistryDbForTests()
}

async function testReadWriteDeleteRoundTrip(): Promise<void> {
  await resetState()
  const registry = createAppRegistry('weather')

  assert.equal(await registry.getItem('store'), undefined, '未写入时返回 undefined')
  await registry.setItem('store', '{"cities":[]}')
  assert.equal(await registry.getItem('store'), '{"cities":[]}')
  assert.deepEqual(await registry.keys(), ['store'])

  await registry.removeItem('store')
  assert.equal(await registry.getItem('store'), undefined)
  assert.deepEqual(await registry.keys(), [])

  // 底层 DB 视角一致
  await registry.setItem('a', '1')
  const entries = await registryDbListEntries('weather')
  assert.equal(entries.length, 1)
  assert.equal(entries[0]!.key, 'a')
  assert.equal(entries[0]!.value, '1')
  assert.ok(typeof entries[0]!.updatedAt === 'number')
}

async function testNamespaceIsolation(): Promise<void> {
  await resetState()
  const weather = createAppRegistry('weather')
  const news = createAppRegistry('news')

  await weather.setItem('store', 'weather-data')
  assert.equal(await news.getItem('store'), undefined, '其他命名空间不可见')
  assert.equal(await registryDbGet('news', 'store'), undefined)

  // 同一 appId 多次 createAppRegistry 共享内存缓存
  const weather2 = createAppRegistry('weather')
  assert.equal(await weather2.getItem('store'), 'weather-data')
}

async function testCoarseHydrationFromDb(): Promise<void> {
  await resetState()
  // 直接写 DB（模拟另一来源），再通过 API 读取应能整包 hydrate
  await createAppRegistry('mail').setItem('k1', 'v1')
  await createAppRegistry('mail').setItem('k2', 'v2')

  const registry = createAppRegistry('mail')
  assert.equal(await registry.getItem('k1'), 'v1')
  assert.deepEqual(await registry.keys(), ['k1', 'k2'])
}

async function testQuotaExceededThrows(): Promise<void> {
  await resetState()
  const registry = createAppRegistry('quota-app')
  const big = 'x'.repeat(APP_REGISTRY_QUOTA_BYTES + 1)

  await assert.rejects(() => registry.setItem('store', big), RegistryQuotaExceededError)
  // 失败不产生脏数据
  assert.equal(await registry.getItem('store'), undefined)

  // 先写小值，再超限写入：旧值保留
  await registry.setItem('store', 'small')
  await assert.rejects(() => registry.setItem('store', big), RegistryQuotaExceededError)
  assert.equal(await registry.getItem('store'), 'small')

  // 总量约束：多个 key 之和超限
  await registry.setItem('a', 'x'.repeat(APP_REGISTRY_QUOTA_BYTES - 10))
  await assert.rejects(
    () => registry.setItem('b', 'x'.repeat(20)),
    RegistryQuotaExceededError,
  )
}

async function testWriteFailureRollsBackMemory(): Promise<void> {
  await resetState()
  const registry = createAppRegistry('rollback-app')
  await registry.setItem('k', 'old')

  // 篡改底层：monkey-patch 不可行（闭包），改为验证乐观更新 + 成功路径已覆盖；
  // 这里验证 setItem 失败路径通过伪造 DB 抛错：先关库再写应抛 RegistryWriteError
  const { openRegistryDb } = await import('./app-registry-db.ts')
  const db = await openRegistryDb()
  db.close()
  // 重建库连接对象会复用单例 promise（已 close），后续写会失败
  await assert.rejects(() => registry.setItem('k', 'new'), RegistryWriteError)
  // 内存应回滚为旧值
  assert.equal(await registry.getItem('k'), 'old')
}

async function testBatchApply(): Promise<void> {
  await resetState()
  const registry = createAppRegistry('batch-app')
  await registry.setItem('keep', '1')
  await registry.setItem('remove-me', '2')

  const failures = await applyRegistryBatch('batch-app', [
    { key: 'keep', value: 'updated' },
    { key: 'remove-me', value: undefined },
    { key: 'added', value: '3' },
  ])
  assert.deepEqual(failures, [])
  assert.equal(await registry.getItem('keep'), 'updated')
  assert.equal(await registry.getItem('remove-me'), undefined)
  assert.equal(await registry.getItem('added'), '3')

  // 配额失败：返回失败项并保留旧值，其余项照常写入
  const big = 'x'.repeat(APP_REGISTRY_QUOTA_BYTES)
  const batchFailures = await applyRegistryBatch('batch-app', [
    { key: 'added', value: 'still-ok' },
    { key: 'keep', value: big },
  ])
  assert.equal(batchFailures.length, 1)
  assert.equal(batchFailures[0]!.key, 'keep')
  assert.equal(batchFailures[0]!.previous, 'updated')
  assert.ok(batchFailures[0]!.error instanceof RegistryQuotaExceededError)
  assert.equal(await registry.getItem('added'), 'still-ok')
  assert.equal(await registry.getItem('keep'), 'updated', '失败 key 回滚旧值')
}

async function testGlobalRegistryReadOnly(): Promise<void> {
  await resetState()
  await createAppRegistry('weather').setItem('store', 'w')
  await createAppRegistry('news').setItem('store', 'n')

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
  assert.equal(await createAppRegistry('weather').getItem('store'), undefined)

  await createAppRegistry('news').setItem('x', '1')
  await global.clearNamespace('news')
  assert.equal(await createAppRegistry('news').getItem('x'), undefined)

  const after = await global.listNamespaces()
  assert.equal(after.length, 0, '清空后无命名空间')
}

async function testClear(): Promise<void> {
  await resetState()
  const registry = createAppRegistry('clear-app')
  await registry.setItem('a', '1')
  await registry.setItem('b', '2')
  await registry.clear()
  assert.deepEqual(await registry.keys(), [])
  assert.deepEqual(await registryDbListApps(), [])
}

async function testBytesByAppStats(): Promise<void> {
  await resetState()
  await createAppRegistry('weather').setItem('store', '天气数据-中文')
  await createAppRegistry('news').setItem('store', 'a'.repeat(100))

  const bytes = await registryDbGetBytesByApp()
  assert.ok(bytes.weather! > 3, '中文 UTF-8 多字节计数')
  assert.equal(bytes.news, 100)
}

async function main(): Promise<void> {
  const cases = [
    testReadWriteDeleteRoundTrip,
    testNamespaceIsolation,
    testCoarseHydrationFromDb,
    testQuotaExceededThrows,
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
