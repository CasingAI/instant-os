/**
 * 生成应用本体迁入 Contents 单测。
 * 运行：node --experimental-strip-types src/os/generated-apps-store.test.ts
 *
 * 覆盖：旧 localStorage 大键 → Contents + 索引迁移并删除旧键；保存/载入往返；
 * 卸载删除 Contents；quota 合并 Contents+Data 记账。
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { zipSync } from 'fflate'
import type { GeneratedAppRecord } from '../apps/appstore/types.ts'
import {
  getGeneratedAppContentsBytes,
  readGeneratedAppHtmlFile,
  readGeneratedAppManifest,
} from './generated-apps-files.ts'
import {
  __resetGeneratedAppStoreForTest,
  hydrateInstalledAppsFromFiles,
  isGeneratedAppBundleStored,
  loadInstalledAppsFromCache,
  migrateGeneratedAppBundlesOnce,
  saveInstalledAppsToFiles,
} from './generated-apps-store.ts'
import { loadInstalledApps } from './generated-apps-storage.ts'
import { DEVICE_STORAGE_KEYS } from './device-storage.ts'
import { getAppDataBytesByApp } from '../apps/files/files-app-data-quota.ts'
import { writeAppDataText } from '../apps/files/files-app-data-api.ts'
import { resetFilesDbForTests } from '../apps/files/files-storage.ts'
import { invalidateFilesVfsPathCaches } from '../apps/files/files-vfs.ts'

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

function stubWindow(): void {
  const listeners = new Map<string, Array<() => void>>()
  ;(globalThis as Record<string, unknown>).window = {
    dispatchEvent: (_event: unknown) => true,
    addEventListener: (type: string, cb: () => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), cb])
    },
  }
  ;(globalThis as Record<string, unknown>).CustomEvent =
    globalThis.CustomEvent ??
    class CustomEvent {
      type: string
      constructor(type: string) {
        this.type = type
      }
    }
}

async function resetState(): Promise<void> {
  await resetFilesDbForTests()
  __resetGeneratedAppStoreForTest()
  invalidateFilesVfsPathCaches()
}

function makeRecord(
  id: `gen:${string}`,
  name: string,
  html: string,
  versions: Array<{ version: string; html: string; savedAt: number }>,
): GeneratedAppRecord {
  return {
    id,
    name,
    description: `描述 ${name}`,
    category: '测试',
    iconEmoji: '📱',
    themeColor: '#007aff',
    tags: [],
    html,
    version: versions[versions.length - 1]?.version ?? 'V1',
    pendingUpdate: false,
    versions,
  }
}

async function testMigrationMovesLegacyToContents(): Promise<void> {
  await resetState()
  const store = installLocalStorageStub()
  stubWindow()

  const legacy: GeneratedAppRecord[] = [
    makeRecord('gen:weather-x', '天气X', '<html>v2</html>', [
      { version: 'V1', html: '<html>v1</html>', savedAt: 1 },
      { version: 'V2', html: '<html>v2</html>', savedAt: 2 },
    ]),
    makeRecord('gen:calc', '计算器', '<html>calc</html>', [
      { version: 'V1', html: '<html>calc</html>', savedAt: 3 },
    ]),
  ]
  store.set(DEVICE_STORAGE_KEYS.generatedApps, JSON.stringify(legacy))

  const result = await migrateGeneratedAppBundlesOnce()
  assert.equal(result.skipped, false)
  assert.equal(result.failed.length, 0)
  assert.equal(result.migrated.length, 2)

  // 旧大键已删除，索引已写入
  assert.equal(store.has(DEVICE_STORAGE_KEYS.generatedApps), false)
  assert.ok(isGeneratedAppBundleStored('gen:weather-x'))
  assert.ok(isGeneratedAppBundleStored('gen:calc'))

  // 幂等：再次调用跳过
  const again = await migrateGeneratedAppBundlesOnce()
  assert.equal(again.skipped, true)

  // hydrate 重建完整 record
  await hydrateInstalledAppsFromFiles()
  const apps = loadInstalledAppsFromCache()
  const weather = apps.find((app) => app.id === 'gen:weather-x')
  assert.ok(weather)
  assert.equal(weather.html, '<html>v2</html>')
  assert.equal(weather.versions?.length, 2)
  assert.equal(weather.versions?.[0]?.html, '<html>v1</html>')
  assert.equal(weather.versions?.[1]?.html, '<html>v2</html>')

  // Contents 文件可直接读
  const manifest = await readGeneratedAppManifest('gen:weather-x')
  assert.equal(manifest?.name, '天气X')
  assert.equal(await readGeneratedAppHtmlFile('gen:weather-x', 'V1'), '<html>v1</html>')
  assert.equal(await readGeneratedAppHtmlFile('gen:weather-x', 'V2'), '<html>v2</html>')
}

async function testSaveThenHydrateRoundtrip(): Promise<void> {
  await resetState()
  installLocalStorageStub()
  stubWindow()

  const record = makeRecord('gen:notes', '便签', '<main>hi</main>', [
    { version: 'V1', html: '<main>hi</main>', savedAt: 100 },
  ])
  const ok = await saveInstalledAppsToFiles([record])
  assert.equal(ok, true)
  assert.ok(isGeneratedAppBundleStored('gen:notes'))

  // 重置内存缓存，验证能从文件重新 hydrate
  __resetGeneratedAppStoreForTest()
  await hydrateInstalledAppsFromFiles()
  const reloaded = loadInstalledAppsFromCache()
  assert.equal(reloaded.length, 1)
  assert.equal(reloaded[0]?.html, '<main>hi</main>')

  // 同步读接口（generated-apps-storage 委托）也命中
  assert.equal(loadInstalledApps().length, 1)
}

async function testUninstallRemovesContents(): Promise<void> {
  await resetState()
  installLocalStorageStub()
  stubWindow()

  const a = makeRecord('gen:a', 'A', '<a>', [{ version: 'V1', html: '<a>', savedAt: 1 }])
  const b = makeRecord('gen:b', 'B', '<b>', [{ version: 'V1', html: '<b>', savedAt: 2 }])
  await saveInstalledAppsToFiles([a, b])
  assert.ok((await getGeneratedAppContentsBytes('gen:a')) > 0)

  // 卸载 gen:b：只保留 a
  await saveInstalledAppsToFiles([a])
  assert.equal(await getGeneratedAppContentsBytes('gen:b'), 0)
  assert.ok((await getGeneratedAppContentsBytes('gen:a')) > 0)
  assert.equal(isGeneratedAppBundleStored('gen:b'), false)
}

async function testQuotaMergesContentsAndData(): Promise<void> {
  await resetState()
  installLocalStorageStub()
  stubWindow()

  const record = makeRecord('gen:quota-app', '配额', 'x'.repeat(200), [
    { version: 'V1', html: 'x'.repeat(200), savedAt: 1 },
  ])
  await saveInstalledAppsToFiles([record])
  await writeAppDataText('gen:quota-app', 'app-data.json', '{"k":"v"}')

  const byApp = await getAppDataBytesByApp()
  assert.ok(byApp['gen:quota-app'] !== undefined, '生成应用记账键应为原始 appId')
  assert.ok(
    byApp['gen:quota-app']! > 200,
    'quota 应合并 Contents(本体) + Data(数据)，不止 Data',
  )
  assert.equal(Object.keys(byApp).includes('gen_quota-app'), false)
}

async function main(): Promise<void> {
  stubSourceSnapshotFetch()
  const cases = [
    testMigrationMovesLegacyToContents,
    testSaveThenHydrateRoundtrip,
    testUninstallRemovesContents,
    testQuotaMergesContentsAndData,
  ]
  for (const test of cases) {
    await test()
    console.log(`ok: ${test.name}`)
  }
  console.log('generated-apps-store: all passed')
}

await main()
