/**
 * gomoku 存储（注册表化后）单测。
 * 运行：node --experimental-strip-types src/apps/gomoku/gomoku-storage.test.ts
 *
 * 覆盖：默认模式；save/load 往返；订阅通知；损坏数据回退默认；跨实例持久化。
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { __resetRegistryCacheForTest } from '../../os/app-registry.ts'
import { resetRegistryDbForTests, registryDbPut } from '../../os/app-registry-db.ts'
import {
  loadGomokuGameMode,
  saveGomokuGameMode,
  subscribeGomokuGameMode,
} from './gomoku-storage.ts'

async function resetState(): Promise<void> {
  __resetRegistryCacheForTest()
  await resetRegistryDbForTests()
}

async function testDefaultModeIsPve(): Promise<void> {
  await resetState()
  assert.equal(await loadGomokuGameMode(), 'pve')
}

async function testSaveLoadRoundTrip(): Promise<void> {
  await resetState()
  await saveGomokuGameMode('aivai')
  assert.equal(await loadGomokuGameMode(), 'aivai')

  await saveGomokuGameMode('pvp')
  assert.equal(await loadGomokuGameMode(), 'pvp')
}

async function testCorruptDataFallsBackToDefault(): Promise<void> {
  await resetState()
  // 字段值为非法模式：归一化兜底为 pvp
  await registryDbPut('gomoku', 'gameMode', 'unknown-mode')
  __resetRegistryCacheForTest()
  assert.equal(await loadGomokuGameMode(), 'pvp', '非法模式归一化为 pvp（normalizeGameMode 兜底）')

  // 空值：回退默认 pve
  await registryDbPut('gomoku', 'gameMode', '')
  __resetRegistryCacheForTest()
  assert.equal(await loadGomokuGameMode(), 'pve', '空值回退默认 pve')
}

async function testMigratesFromLegacyStore(): Promise<void> {
  await resetState()
  // 模拟旧版单 key 存储
  await registryDbPut('gomoku', 'store', JSON.stringify({ gameMode: 'pve' }))
  __resetRegistryCacheForTest()
  assert.equal(await loadGomokuGameMode(), 'pve')

  // 迁移后旧 store 被清除，字段 key 独立存在
  const { registryDbListKeys } = await import('../../os/app-registry-db.ts')
  assert.deepEqual((await registryDbListKeys('gomoku')).sort(), ['gameMode'].sort())
}

async function testSubscribeFiresOnSave(): Promise<void> {
  await resetState()
  let calls = 0
  const unsubscribe = subscribeGomokuGameMode(() => {
    calls += 1
  })
  await saveGomokuGameMode('pve')
  assert.equal(calls, 1)
  unsubscribe()
  await saveGomokuGameMode('pvp')
  assert.equal(calls, 1, '取消订阅后不再通知')
}

async function testPersistsAcrossInstances(): Promise<void> {
  await resetState()
  await saveGomokuGameMode('pve')
  // 模拟重开应用：清空内存缓存后重新读取（仍从 IndexedDB hydrate）
  __resetRegistryCacheForTest()
  assert.equal(await loadGomokuGameMode(), 'pve')
}

async function main(): Promise<void> {
  const cases = [
    testDefaultModeIsPve,
    testSaveLoadRoundTrip,
    testCorruptDataFallsBackToDefault,
    testSubscribeFiresOnSave,
    testPersistsAcrossInstances,
  ]
  for (const test of cases) {
    await test()
    console.log(`ok: ${test.name}`)
  }
  console.log('gomoku-storage: all passed')
}

await main()
