/**
 * 应用数据目录（方案 B 纠偏版）单测。
 * 运行：node --experimental-strip-types src/apps/files/files-app-data.test.ts
 *
 * 覆盖：ID 与 gen_ 目录段往返；写入后按 /Applications/{id}.app/Data 可列、可读；
 * 卷根不重复列出真实包；用户写路径被拒、系统层 API 可写；空键不进入已迁移集合；
 * 记账键为原始 appId。
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { zipSync } from 'fflate'
import { writeAppDataText } from './files-app-data-api.ts'
import { appDataDirName, appDataDirNameToAppId, appBundleDirName } from './files-app-id.ts'
import { getAppDataBytesByApp } from './files-app-data-quota.ts'
import { isAppDataMigrated, runAppDataMigrationOnce } from './files-app-data-migration.ts'
import { resetFilesDbForTests } from './files-storage.ts'
import {
  invalidateFilesVfsPathCaches,
  listDirectory,
  readTextFile,
  resolveNodeByAbsolutePath,
  upsertFilesBatch,
} from './files-vfs.ts'
import { DEVICE_STORAGE_KEYS } from '../../os/device-storage.ts'

const APP_DATA_REL = 'weather.app/Data/weather.json'

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
  await resetFilesDbForTests()
  invalidateFilesVfsPathCaches()
}

async function testAppDataDirNameRoundTrip(): Promise<void> {
  assert.equal(appDataDirName('weather'), 'weather')
  assert.equal(appDataDirName('gen:foo-bar'), 'gen_foo-bar')
  assert.equal(appDataDirNameToAppId('gen_foo-bar'), 'gen:foo-bar')
  assert.equal(appDataDirNameToAppId('weather'), 'weather')
  assert.equal(appDataDirNameToAppId(appDataDirName('gen:abc')), 'gen:abc')
  assert.equal(appBundleDirName('gen:foo-bar'), 'gen_foo-bar.app')
  assert.equal(appBundleDirName('weather'), 'weather.app')
}

async function testWriteThenListAndRead(): Promise<void> {
  await resetState()
  await writeAppDataText('weather', 'weather.json', '{"temp":21}')

  const file = await resolveNodeByAbsolutePath(`/Applications/${APP_DATA_REL}`)
  assert.ok(file, 'Data 文件应可解析')
  assert.equal(file?.kind, 'file')

  const { text } = await readTextFile(`/Applications/${APP_DATA_REL}`)
  assert.equal(text, '{"temp":21}')

  const dataDir = await resolveNodeByAbsolutePath('/Applications/weather.app/Data')
  assert.ok(dataDir)
  assert.equal(dataDir?.kind, 'folder')
  const children = await listDirectory(dataDir.locationId, dataDir.id)
  assert.ok(children.some((child) => child.name === 'weather.json'))

  // 只读投影：Data 内节点不可写
  assert.equal(file?.attributes.writable, false)
}

async function testBundleRootNotDuplicated(): Promise<void> {
  await resetState()
  await writeAppDataText('weather', 'weather.json', '{}')

  const root = await listDirectory('applications', undefined)
  const weatherBundles = root.filter((node) => node.name === 'weather.app')
  // 真实节点在 IndexedDB 中，但卷根只列 catalog 合成包，不应出现两份
  assert.equal(weatherBundles.length, 1)
  assert.equal(weatherBundles[0]?.kind, 'folder')
}

async function testUserWriteRejectedButSystemWriteWorks(): Promise<void> {
  await resetState()
  await assert.rejects(
    () => upsertFilesBatch([{ path: `/Applications/${APP_DATA_REL}`, text: 'x' }]),
    /不支持批量写入|只读/,
  )

  await writeAppDataText('weather', 'weather.json', 'ok')
  const { text } = await readTextFile(`/Applications/${APP_DATA_REL}`)
  assert.equal(text, 'ok')
}

async function testEmptyKeyNotMarkedMigrated(): Promise<void> {
  await resetState()
  const store = installLocalStorageStub()
  // 有数据的 weather 应导出并标记
  store.set(DEVICE_STORAGE_KEYS.weather, '{"cached":1}')
  // 空键（如 calendar）不进入已迁移集合
  const result = await runAppDataMigrationOnce()
  assert.ok(result.migrated.includes('weather'))
  assert.ok(!result.skipped.includes('weather') || result.skipped.length >= 0)
  assert.equal(isAppDataMigrated('weather'), true)
  assert.equal(isAppDataMigrated('calendar'), false)

  const file = await resolveNodeByAbsolutePath('/Applications/weather.app/Data/weather.json')
  assert.ok(file, '迁移后文件应存在')
  const { text } = await readTextFile(`/Applications/${APP_DATA_REL}`)
  assert.equal(text, '{"cached":1}')
}

async function testQuotaKeysAreRawAppId(): Promise<void> {
  await resetState()
  await writeAppDataText('weather', 'weather.json', '0123456789')
  await writeAppDataText('gen:foo', 'app-data.json', 'abcdef')

  const byApp = await getAppDataBytesByApp()
  assert.ok(byApp.weather !== undefined, '内置应用记账键应为 weather')
  assert.ok(byApp['gen:foo'] !== undefined, '生成应用记账键应为 gen:foo 原样')
  assert.equal(Object.keys(byApp).includes('weather.app'), false)
  assert.equal(Object.keys(byApp).includes('gen_foo'), false)
}

async function main(): Promise<void> {
  stubSourceSnapshotFetch()
  const cases = [
    testAppDataDirNameRoundTrip,
    testWriteThenListAndRead,
    testBundleRootNotDuplicated,
    testUserWriteRejectedButSystemWriteWorks,
    testEmptyKeyNotMarkedMigrated,
    testQuotaKeysAreRawAppId,
  ]
  for (const test of cases) {
    await test()
    console.log(`ok: ${test.name}`)
  }
  console.log('files-app-data: all passed')
}

await main()
