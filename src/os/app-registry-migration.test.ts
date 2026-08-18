/**
 * 应用注册表迁移单测。
 * 运行：node --experimental-strip-types src/os/app-registry-migration.test.ts
 *
 * 覆盖：内置应用 localStorage → 注册表导入并删除旧键；空键不导入；
 * 生成应用整份快照逐 key 导入；幂等（注册表已有数据时跳过导入、清理陈旧旧键）；
 * iCode 内部项目导入；上一版 Data 旧 JSON 副本删除。
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { zipSync } from 'fflate'
import { __resetRegistryCacheForTest, createAppRegistry } from './app-registry.ts'
import { resetRegistryDbForTests, registryDbListKeys } from './app-registry-db.ts'
import { runAppRegistryMigration } from './app-registry-migration.ts'
import { GENERATED_APP_DATA_KEY_PREFIX, DEVICE_STORAGE_KEYS } from './device-storage.ts'
import { writeAppDataText } from '../apps/files/files-app-data-api.ts'
import { resetFilesDbForTests } from '../apps/files/files-storage.ts'
import { invalidateFilesVfsPathCaches, resolveNodeByAbsolutePath } from '../apps/files/files-vfs.ts'

/** 测试环境无 /source-snapshot.zip：stub fetch 返回空 zip，让源码投影可正常枚举。 */
function stubSourceSnapshotFetch(): void {
  const emptyZip = zipSync({})
  ;(globalThis as Record<string, unknown>).fetch = async () =>
    new Response(new Blob([emptyZip]), { status: 200 })
}

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
  await resetFilesDbForTests()
  invalidateFilesVfsPathCaches()
}

async function testBuiltinAppImportedAndLegacyKeyRemoved(): Promise<void> {
  await resetState()
  const store = installLocalStorageStub()
  store.set(DEVICE_STORAGE_KEYS.weather, '{"cached":1}')

  const result = await runAppRegistryMigration()
  assert.ok(result.migrated.includes('weather'))
  assert.equal(store.has(DEVICE_STORAGE_KEYS.weather), false, '导入后删除 localStorage 旧键')

  const registry = createAppRegistry('weather')
  const keys = await registry.keys()
  assert.ok(!keys.includes('store'), '旧 store 单键应被拆分为字段 key')
  assert.deepEqual(keys.sort(), ['cities', 'defaultDisplay', 'myLocationCityId', 'activeCityId'].sort(), 'weather 字段 key 已生成')
  assert.equal(await registry.getItem('defaultDisplay'), 'my-location', '默认值被写入 defaultDisplay 字段')
}

async function testEmptyKeysNotImported(): Promise<void> {
  await resetState()
  installLocalStorageStub()
  // 没有任何旧数据：全部跳过
  const result = await runAppRegistryMigration()
  assert.equal(result.migrated.length, 0)
  assert.ok(result.skipped.includes('calendar'))

  const registry = createAppRegistry('calendar')
  assert.equal(await registry.getItem('store'), undefined)
}

async function testGeneratedAppSnapshotImportedPerKey(): Promise<void> {
  await resetState()
  const store = installLocalStorageStub()
  store.set(
    `${GENERATED_APP_DATA_KEY_PREFIX}gen:abc`,
    JSON.stringify({ theme: 'dark', notes: 'hello' }),
  )

  const result = await runAppRegistryMigration()
  assert.ok(result.migrated.includes('gen:abc'))
  assert.equal(store.has(`${GENERATED_APP_DATA_KEY_PREFIX}gen:abc`), false)

  const registry = createAppRegistry('gen:abc')
  assert.equal(await registry.getItem('theme'), 'dark')
  assert.equal(await registry.getItem('notes'), 'hello')
}

async function testIdempotentSkipWhenRegistryHasData(): Promise<void> {
  await resetState()
  const store = installLocalStorageStub()
  // 先有注册表数据（模拟应用已打开写入）
  const registry = createAppRegistry('weather')
  await registry.setItem('store', JSON.stringify({
    myLocationCityId: 'beijing',
    defaultDisplay: 'my-location',
    cities: [{ id: 'beijing', name: '北京', region: undefined, weather: undefined }],
    activeCityId: 'beijing',
  }))
  // 同时存在陈旧 localStorage 旧键
  store.set(DEVICE_STORAGE_KEYS.weather, '{"stale":1}')

  const result = await runAppRegistryMigration()
  assert.ok(!result.migrated.includes('weather'))
  assert.ok(result.cleanedLegacyKeys.includes('weather'), '陈旧旧键被清理')
  assert.equal(store.has(DEVICE_STORAGE_KEYS.weather), false)

  // 注册表原有数据不被旧 localStorage 覆盖，且旧 store 会被拆分为字段 key
  assert.equal(await registry.getItem('store'), undefined, '旧 store 单键已拆分清除')
  assert.equal(await registry.getItem('myLocationCityId'), 'beijing', '注册表数据保留为字段 key')
  assert.deepEqual(JSON.parse((await registry.getItem('cities')) ?? '[]'), [{ id: 'beijing', name: '北京' }])
}

async function testIcodeStoreKeyMigratedToProjects(): Promise<void> {
  await resetState()
  // 模拟线上实际状态：icode 数据以旧单键 'store' 存在
  const { registryDbPut } = await import('./app-registry-db.ts')
  await registryDbPut('icode', 'store', JSON.stringify([{ id: 'p1' }]))
  __resetRegistryCacheForTest()

  const result = await runAppRegistryMigration()
  assert.ok(!result.migrated.includes('icode'), '注册表已有数据，不再从 localStorage 导入')

  const registry = createAppRegistry('icode')
  const keys = await registry.keys()
  assert.ok(!keys.includes('store'), '旧 store 单键应被拆分为 projects 字段 key')
  assert.ok(keys.includes('projects'), 'projects 字段 key 已生成')
  assert.equal(await registry.getItem('projects'), JSON.stringify([{ id: 'p1' }]))
}

async function testLegacyDataFilesDeleted(): Promise<void> {
  await resetState()
  const store = installLocalStorageStub()
  store.set(DEVICE_STORAGE_KEYS.weather, '{"cached":1}')
  // 上一版导出到 Data 目录的旧副本
  await writeAppDataText('weather', 'weather.json', '{"cached":1}')

  const result = await runAppRegistryMigration()
  assert.ok(result.cleanedDataFiles.includes('weather'), '旧 Data 副本被删除')

  const file = await resolveNodeByAbsolutePath('/Applications/weather.app/Data/weather.json')
  assert.equal(file, undefined, 'Data 旧文件已不存在')
}

async function main(): Promise<void> {
  stubSourceSnapshotFetch()
  const cases = [
    testBuiltinAppImportedAndLegacyKeyRemoved,
    testEmptyKeysNotImported,
    testGeneratedAppSnapshotImportedPerKey,
    testIdempotentSkipWhenRegistryHasData,
    testIcodeStoreKeyMigratedToProjects,
    testLegacyDataFilesDeleted,
  ]
  for (const test of cases) {
    await test()
    console.log(`ok: ${test.name}`)
  }
  console.log('app-registry-migration: all passed')
}

await main()
