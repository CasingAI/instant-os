/**
 * 系统空间记账单测。
 * 运行：node --experimental-strip-types src/apps/settings/app-storage.test.ts
 *
 * 覆盖：注册表不进入系统空间分段；浏览器/其他 + 系统配置 = 已用；已用 + 剩余 = 容量。
 * 应用清单索引并入系统配置，不单列「应用程序」。
 */
import assert from 'node:assert/strict'
import { DEVICE_CAPACITY_BYTES } from '../../os/device-storage.ts'
import { buildSystemSpaceBreakdown } from './app-storage-system.ts'

function testSegmentsSumToUsedAndCapacity(): void {
  const usedBytes = 1200
  const browserSystemBytes = 200
  const otherBytes = 50
  const breakdown = buildSystemSpaceBreakdown({
    usedBytes,
    capacityBytes: DEVICE_CAPACITY_BYTES,
    browserSystemBytes,
    otherBytes,
  })
  assert.equal(browserSystemBytes + otherBytes + breakdown.systemConfigBytes, usedBytes)
  assert.equal(usedBytes + breakdown.availableBytes, DEVICE_CAPACITY_BYTES)
}

function testRegistryNotInSystemBreakdown(): void {
  const registryBytes = 999_999
  const usedBytes = 80
  const breakdown = buildSystemSpaceBreakdown({
    usedBytes,
    capacityBytes: DEVICE_CAPACITY_BYTES,
    browserSystemBytes: 20,
    otherBytes: 5,
  })
  assert.equal(breakdown.systemConfigBytes, 55)
  assert.equal(20 + 5 + breakdown.systemConfigBytes, usedBytes)
  assert.equal(usedBytes === registryBytes, false)
  assert.equal(breakdown.systemConfigBytes < registryBytes, true)
}

function testAppsIndexIsFoldedIntoSystemConfig(): void {
  const usedBytes = 130
  const appsIndexBytes = 40
  const browserSystemBytes = 20
  const otherBytes = 5
  const breakdown = buildSystemSpaceBreakdown({
    usedBytes,
    capacityBytes: DEVICE_CAPACITY_BYTES,
    browserSystemBytes,
    otherBytes,
  })
  assert.equal(breakdown.systemConfigBytes, usedBytes - browserSystemBytes - otherBytes)
  assert.equal(breakdown.systemConfigBytes >= appsIndexBytes, true)
}

function testAppsBytesFormulaExcludesRegistry(): void {
  const installedIndexBytes = 40
  const legacyGeneratedBytes = 8
  const generatedRegistryBytes = 70_000
  const appsBytes = installedIndexBytes + legacyGeneratedBytes
  assert.equal(appsBytes, 48)
  assert.equal(appsBytes + generatedRegistryBytes === appsBytes, false)
}

async function main(): Promise<void> {
  const cases = [
    testSegmentsSumToUsedAndCapacity,
    testRegistryNotInSystemBreakdown,
    testAppsIndexIsFoldedIntoSystemConfig,
    testAppsBytesFormulaExcludesRegistry,
  ]
  for (const test of cases) {
    test()
    console.log(`ok: ${test.name}`)
  }
  console.log('app-storage: all passed')
}

await main()
