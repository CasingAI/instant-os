/**
 * 内置应用注册表存储助手 createRegistryStore 单测。
 * 运行：node --experimental-strip-types src/os/registry-store.test.ts
 *
 * 覆盖：默认 deserialize；async read/write 往返；写入后订阅通知；readSync 语义；
 * hydrate 后同步读；changedEventName 派发；大 JSON 字段连续 readSync 走引用缓存。
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { __resetRegistryCacheForTest } from './app-registry.ts'
import { resetRegistryDbForTests } from './app-registry-db.ts'
import { createRegistryStore } from './registry-store.ts'

type SampleStore = {
  items: string[]
  name?: string
}

function emptyStore(): SampleStore {
  return { items: [] }
}

function makeStore(appId: string, changedEventName?: string) {
  return createRegistryStore<SampleStore>({
    appId,
    key: 'store',
    serialize: (store) => JSON.stringify(store),
    deserialize: (raw) => {
      if (!raw) {
        return emptyStore()
      }
      try {
        const parsed = JSON.parse(raw) as Partial<SampleStore>
        return {
          items: Array.isArray(parsed.items) ? parsed.items : [],
          name: typeof parsed.name === 'string' ? parsed.name : undefined,
        }
      } catch {
        return emptyStore()
      }
    },
    changedEventName,
  })
}

function installWindowStub(): void {
  const listeners = new Map<string, Set<() => void>>()
  ;(globalThis as Record<string, unknown>).window = {
    addEventListener: (type: string, listener: () => void) => {
      let set = listeners.get(type)
      if (!set) {
        set = new Set()
        listeners.set(type, set)
      }
      set.add(listener)
    },
    removeEventListener: (type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener)
    },
    dispatchEvent: (event: Event) => {
      for (const listener of listeners.get(event.type) ?? []) {
        listener()
      }
      return true
    },
  }
}

async function resetState(): Promise<void> {
  __resetRegistryCacheForTest()
  await resetRegistryDbForTests()
}

async function testReadReturnsDefaultWhenEmpty(): Promise<void> {
  await resetState()
  const store = makeStore('registry-store-default')
  assert.equal(store.isHydrated(), false, '未读取前不 hydrate')
  assert.deepEqual(await store.read(), emptyStore())
  assert.equal(store.isHydrated(), true, '读取后命名空间已 hydrate')
}

async function testReadWriteRoundTrip(): Promise<void> {
  await resetState()
  const store = makeStore('registry-store-roundtrip')
  await store.write({ items: ['a', 'b'], name: 'n' })
  assert.deepEqual(await store.read(), { items: ['a', 'b'], name: 'n' })

  // 新实例（模拟重新挂载）仍能读到持久化数据
  const reopened = makeStore('registry-store-roundtrip')
  assert.deepEqual(await reopened.read(), { items: ['a', 'b'], name: 'n' })
}

async function testDeserializeNormalizes(): Promise<void> {
  await resetState()
  const store = makeStore('registry-store-normalize')
  // 直接写脏数据，读时走 deserialize 归一化
  const { createAppRegistry } = await import('./app-registry.ts')
  await createAppRegistry('registry-store-normalize').setText('store', '{"items":"not-array"}')
  const value = await store.read()
  assert.deepEqual(value.items, [], '非数组 items 归一化为空数组')

  // 损坏 JSON：清缓存后从 DB 读回，deserialize 抛错回退默认值
  const { registryDbPut } = await import('./app-registry-db.ts')
  await registryDbPut('registry-store-normalize', 'store', 'not-json')
  __resetRegistryCacheForTest()
  assert.deepEqual(await store.read(), emptyStore(), '损坏 JSON 回退默认值')
}

async function testSubscribeFiresOnWrite(): Promise<void> {
  await resetState()
  installWindowStub()
  const store = makeStore('registry-store-subscribe', 'instant-os:registry-store-test-changed')
  const seen: number[] = []
  let dispatchCount = 0
  const onWindowEvent = () => {
    dispatchCount += 1
  }
  ;(window as unknown as { addEventListener: (type: string, listener: () => void) => void }).addEventListener(
    'instant-os:registry-store-test-changed',
    onWindowEvent,
  )

  const unsubscribe = store.subscribe(() => seen.push(1))
  await store.write({ items: ['x'] })
  assert.equal(seen.length, 1, '写入后订阅者被通知')
  assert.equal(dispatchCount, 1, 'changedEventName 事件被派发')

  unsubscribe()
  await store.write({ items: ['y'] })
  assert.equal(seen.length, 1, '取消订阅后不再通知')
}

async function testReadSyncBeforeHydrateIsUndefined(): Promise<void> {
  await resetState()
  const store = makeStore('registry-store-readsync')
  assert.equal(store.readSync(), undefined, '未 hydrate 时同步读返回 undefined')

  await store.hydrate()
  assert.deepEqual(store.readSync(), emptyStore(), 'hydrate 后同步读返回默认值')

  await store.write({ items: ['z'] })
  const afterWrite = store.readSync()
  assert.deepEqual(
    afterWrite,
    { items: ['z'], name: undefined },
    '写入后同步读命中内存缓存',
  )
  assert.equal(store.readSync(), afterWrite, '连续 readSync 返回同一引用')
}

// ── 字段模式（多 key）──

type SampleFieldStore = {
  items: string[]
  name?: string
}

function makeFieldStore(appId: string, changedEventName?: string) {
  return createRegistryStore<SampleFieldStore>({
    appId,
    defaultValue: emptyStore,
    legacyKey: 'store',
    fields: [
      {
        key: 'name',
        read: (store) => store.name,
        write: (value, current) => ({ ...current, name: value }),
        serialize: (value) => value ?? '',
        deserialize: (raw) => (raw ? raw : undefined),
      },
      {
        key: 'items',
        valueType: 'json',
        read: (store) => store.items,
        write: (value, current) => ({ ...current, items: value }),
        normalize: (raw) => (Array.isArray(raw) ? raw : []),
      },
    ],
    changedEventName,
  })
}

async function testFieldReadWriteRoundTrip(): Promise<void> {
  await resetState()
  const store = makeFieldStore('registry-store-field-roundtrip')
  await store.write({ items: ['a', 'b'], name: 'n' })
  assert.deepEqual(await store.read(), { items: ['a', 'b'], name: 'n' })

  const reopened = makeFieldStore('registry-store-field-roundtrip')
  assert.deepEqual(await reopened.read(), { items: ['a', 'b'], name: 'n' })
}

async function testFieldDiffOnlyWritesChangedKeys(): Promise<void> {
  await resetState()
  const store = makeFieldStore('registry-store-field-diff')
  await store.write({ items: ['a'], name: 'n' })
  const { createAppRegistry } = await import('./app-registry.ts')
  const registry = createAppRegistry('registry-store-field-diff')
  assert.deepEqual((await registry.keys()).sort(), ['items', 'name'].sort())

  const { registryDbListEntries } = await import('./app-registry-db.ts')
  const itemsUp1 = (await registryDbListEntries('registry-store-field-diff')).find(
    (entry) => entry.key === 'items',
  )?.updatedAt

  // 只改 name：items 的 updatedAt 不应变化
  await store.write({ items: ['a'], name: 'n2' })
  const entries = await registryDbListEntries('registry-store-field-diff')
  const itemsUpdated = entries.find((entry) => entry.key === 'items')?.updatedAt
  const nameUpdated = entries.find((entry) => entry.key === 'name')?.updatedAt
  assert.equal(itemsUpdated, itemsUp1, '未变化的字段不会重写')
  assert.ok(nameUpdated !== undefined && nameUpdated > 0, '变化字段被写回')
}

async function testFieldMigratesFromLegacyStore(): Promise<void> {
  await resetState()
  // 模拟旧版：直接把整份 JSON 写到 'store' key
  const { createAppRegistry } = await import('./app-registry.ts')
  await createAppRegistry('registry-store-field-migrate').setText(
    'store',
    JSON.stringify({ items: ['x', 'y'], name: 'legacy' }),
  )
  __resetRegistryCacheForTest()

  const store = makeFieldStore('registry-store-field-migrate')
  assert.deepEqual(await store.read(), { items: ['x', 'y'], name: 'legacy' })

  // 迁移后：旧 store 清除，字段 key 独立存在
  const registry = createAppRegistry('registry-store-field-migrate')
  assert.deepEqual((await registry.keys()).sort(), ['items', 'name'].sort())

  // 再次访问应幂等（不复写）
  const reopened = makeFieldStore('registry-store-field-migrate')
  assert.deepEqual(await reopened.read(), { items: ['x', 'y'], name: 'legacy' })
}

async function testFieldReadSyncMerges(): Promise<void> {
  await resetState()
  const store = makeFieldStore('registry-store-field-readsync')
  assert.equal(store.readSync(), undefined, '未 hydrate 时同步读返回 undefined')

  await store.write({ items: ['a'], name: 'n' })
  const first = store.readSync()
  assert.deepEqual(
    first,
    { items: ['a'], name: 'n' },
    '写入后同步读合并字段命中内存缓存',
  )
  assert.equal(store.readSync(), first, '连续 readSync 返回同一引用')

  await store.write({ items: ['a', 'b'], name: 'n' })
  const next = store.readSync()
  assert.notEqual(next, first, '写入后解析缓存失效')
  assert.deepEqual(next, { items: ['a', 'b'], name: 'n' })
}

async function testFieldCleansLegacyKeyFromMemory(): Promise<void> {
  await resetState()
  const { createAppRegistry } = await import('./app-registry.ts')
  await createAppRegistry('registry-store-field-clean').setText(
    'store',
    JSON.stringify({ items: ['a'], name: 'n' }),
  )
  __resetRegistryCacheForTest()

  const store = makeFieldStore('registry-store-field-clean')
  await store.write({ items: ['b'], name: 'n2' })
  // 写后 legacyKey 不应再残留（内存与 DB 均已删除）
  const registry = createAppRegistry('registry-store-field-clean')
  assert.equal(await registry.getText('store'), undefined, '旧 store key 已被清除')
  assert.deepEqual(await store.read(), { items: ['b'], name: 'n2' })
}

async function testFieldJsonWriteIsTyped(): Promise<void> {
  await resetState()
  const store = makeFieldStore('registry-store-json-type')
  await store.write({ items: ['a'], name: 'n' })
  const { createAppRegistry } = await import('./app-registry.ts')
  const registry = createAppRegistry('registry-store-json-type')
  assert.equal(await registry.getType('items'), 'json')
  assert.equal(await registry.getType('name'), 'text')
  assert.deepEqual(await registry.getJson('items'), ['a'])
  assert.equal(await registry.getText('name'), 'n')
}

async function testFieldReadSyncCacheSkipsReserializingLargeJson(): Promise<void> {
  await resetState()
  const store = makeFieldStore('registry-store-large-json-cache')
  const items = Array.from({ length: 80 }, (_, index) => `${index}:${'n'.repeat(8000)}`)
  await store.write({ items, name: 'n' })
  const first = store.readSync()
  const started = Date.now()
  for (let index = 0; index < 300; index++) {
    assert.equal(store.readSync(), first, '命中解析缓存时应返回同一引用')
  }
  const elapsed = Date.now() - started
  assert.ok(
    elapsed < 80,
    `大 JSON 字段的连续 readSync 不应拷贝 raw，实际 ${elapsed}ms`,
  )
}

async function testFieldRetagsUntypedWithoutRewritingRaw(): Promise<void> {
  await resetState()
  const raw = '[ "keep" , "order" ]'
  const { registryDbPut } = await import('./app-registry-db.ts')
  await registryDbPut('registry-store-retag', 'items', raw)
  await registryDbPut('registry-store-retag', 'name', 'hello')
  __resetRegistryCacheForTest()

  const store = makeFieldStore('registry-store-retag')
  await store.read()
  const { createAppRegistry } = await import('./app-registry.ts')
  const registry = createAppRegistry('registry-store-retag')
  assert.equal(await registry.getType('items'), 'json')
  assert.equal(await registry.getType('name'), 'text')
  assert.equal(await registry.getText('items'), raw, '打标不改 raw 字节')
  assert.equal(await registry.getText('name'), 'hello')
}

async function main(): Promise<void> {
  const cases = [
    testReadReturnsDefaultWhenEmpty,
    testReadWriteRoundTrip,
    testDeserializeNormalizes,
    testSubscribeFiresOnWrite,
    testReadSyncBeforeHydrateIsUndefined,
    testFieldReadWriteRoundTrip,
    testFieldDiffOnlyWritesChangedKeys,
    testFieldMigratesFromLegacyStore,
    testFieldReadSyncMerges,
    testFieldCleansLegacyKeyFromMemory,
    testFieldJsonWriteIsTyped,
    testFieldReadSyncCacheSkipsReserializingLargeJson,
    testFieldRetagsUntypedWithoutRewritingRaw,
  ]
  for (const test of cases) {
    await test()
    console.log(`ok: ${test.name}`)
  }
  console.log('registry-store: all passed')
}

await main()
