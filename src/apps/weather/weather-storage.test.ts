/**
 * weather 存储（注册表化后）单测。
 * 运行：node --experimental-strip-types src/apps/weather/weather-storage.test.ts
 *
 * 覆盖：空 store 默认值；read/write 往返与归一化；订阅通知；
 * bootstrapWeatherStoreFromWidgetCache 从小组件缓存播种我的位置；
 * ensureMyLocationFromNotification 幂等 upsert。
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { __resetRegistryCacheForTest } from '../../os/app-registry.ts'
import { resetRegistryDbForTests } from '../../os/app-registry-db.ts'
import type { NotificationWeather } from '../../os/notification-center-widget-types.ts'
import {
  bootstrapWeatherStoreFromWidgetCache,
  ensureMyLocationFromNotification,
  getWidgetDisplayWeather,
  readWeatherStore,
  subscribeWeatherStore,
  writeWeatherStore,
} from './weather-storage.ts'
import type { WeatherStore } from './weather-types.ts'

const widgetWeather: NotificationWeather = {
  city: '北京',
  condition: '晴',
  temperatureC: 24,
  highC: 28,
  lowC: 18,
  humidity: 45,
  wind: '2 级',
  emoji: '☀️',
  summary: '晴',
}

async function resetState(): Promise<void> {
  __resetRegistryCacheForTest()
  await resetRegistryDbForTests()
}

async function testEmptyStoreDefaults(): Promise<void> {
  await resetState()
  const store = await readWeatherStore()
  assert.equal(store.cities.length, 0)
  assert.equal(store.defaultDisplay, 'my-location')
  assert.equal(store.myLocationCityId, undefined)
}

async function testWriteReadRoundTripWithNormalize(): Promise<void> {
  await resetState()
  const store: WeatherStore = {
    myLocationCityId: 'beijing',
    defaultDisplay: 'my-location',
    cities: [
      {
        id: 'beijing',
        name: '北京',
        region: undefined,
        weather: {
          city: '北京',
          condition: '多云',
          temperatureC: 20,
          highC: 24,
          lowC: 15,
          feelsLikeC: 20,
          humidity: 60,
          wind: '3 级',
          emoji: '⛅',
          summary: '多云',
          uvIndex: 3,
          airQuality: '良',
          visibilityKm: 10,
          hourly: [],
          daily: [],
        },
      },
    ],
    activeCityId: 'beijing',
  }
  await writeWeatherStore(store)
  assert.deepEqual(await readWeatherStore(), store)
}

async function testBootstrapSeedsMyLocationFromWidgetCache(): Promise<void> {
  await resetState()
  const store = await bootstrapWeatherStoreFromWidgetCache(widgetWeather)

  assert.equal(store.cities.length, 1)
  assert.equal(store.myLocationCityId, store.cities[0]!.id)
  assert.equal(store.cities[0]!.name, '北京')
  assert.ok(store.cities[0]!.weather, '播种了默认天气详情')

  // 已写入注册表：新实例直接读回
  const persisted = await readWeatherStore()
  assert.equal(persisted.myLocationCityId, store.cities[0]!.id)
}

async function testBootstrapKeepsExistingCities(): Promise<void> {
  await resetState()
  const seeded = await bootstrapWeatherStoreFromWidgetCache(widgetWeather)

  // 已有数据时不再重复播种
  const again = await bootstrapWeatherStoreFromWidgetCache(widgetWeather)
  assert.equal(again.cities.length, seeded.cities.length, '不重复添加我的位置')
}

async function testEnsureMyLocationUpsertsOnce(): Promise<void> {
  await resetState()
  const first = await ensureMyLocationFromNotification(widgetWeather)
  assert.equal(first.myLocationCityId, first.cities[0]!.id)

  const second = await ensureMyLocationFromNotification(widgetWeather)
  assert.equal(second.cities.length, 1, '重复通知不新增城市')
  assert.equal(second.myLocationCityId, first.myLocationCityId)
}

async function testWidgetDisplayResolves(): Promise<void> {
  await resetState()
  const store = await bootstrapWeatherStoreFromWidgetCache(widgetWeather)
  const display = getWidgetDisplayWeather(store)
  assert.ok(display, '我的位置应作为小组件展示')
  assert.equal(display!.city, '北京')
}

async function testSubscribeFiresOnWrite(): Promise<void> {
  await resetState()
  let calls = 0
  const unsubscribe = subscribeWeatherStore(() => {
    calls += 1
  })
  const store = await readWeatherStore()
  await writeWeatherStore({ ...store, cities: [] })
  assert.equal(calls, 1)
  unsubscribe()
}

async function testMigratesLegacyStoreToFieldKeys(): Promise<void> {
  await resetState()
  const { registryDbPut, registryDbListKeys } = await import('../../os/app-registry-db.ts')
  const legacy: WeatherStore = {
    myLocationCityId: 'beijing',
    defaultDisplay: 'my-location',
    cities: [
      {
        id: 'beijing',
        name: '北京',
        region: undefined,
        weather: {
          city: '北京',
          condition: '晴',
          temperatureC: 24,
          highC: 28,
          lowC: 18,
          feelsLikeC: 24,
          humidity: 45,
          wind: '2 级',
          emoji: '☀️',
          summary: '晴',
          uvIndex: 4,
          airQuality: '良',
          visibilityKm: 10,
          hourly: [],
          daily: [],
        },
      },
    ],
    activeCityId: 'beijing',
  }
  await registryDbPut('weather', 'store', JSON.stringify(legacy))
  __resetRegistryCacheForTest()

  const store = await readWeatherStore()
  assert.equal(store.cities.length, 1)
  assert.equal(store.activeCityId, 'beijing')

  // 迁移后按字段拆分：旧 store 清除，4 个字段 key 独立存在
  const keys = await registryDbListKeys('weather')
  assert.deepEqual(
    keys.sort(),
    ['activeCityId', 'cities', 'defaultDisplay', 'myLocationCityId'].sort(),
  )
}

async function main(): Promise<void> {
  const cases = [
    testEmptyStoreDefaults,
    testWriteReadRoundTripWithNormalize,
    testBootstrapSeedsMyLocationFromWidgetCache,
    testBootstrapKeepsExistingCities,
    testEnsureMyLocationUpsertsOnce,
    testWidgetDisplayResolves,
    testSubscribeFiresOnWrite,
    testMigratesLegacyStoreToFieldKeys,
  ]
  for (const test of cases) {
    await test()
    console.log(`ok: ${test.name}`)
  }
  console.log('weather-storage: all passed')
}

await main()
