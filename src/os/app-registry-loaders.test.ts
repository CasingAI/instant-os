/**
 * 内置应用 loader 与 BuiltinAppId 对齐：有窗口应用必须有窗口加载器，
 * 无窗口应用（windowless）必须没有。二者互斥。
 * 运行：node --experimental-strip-types src/os/app-registry-loaders.test.ts
 */
import assert from 'node:assert/strict'
import { BUILTIN_APP_DISPLAY_NAMES } from './builtin-app-display-names.ts'
import { listBuiltinAppLoaderIds } from './app-registry-loaders.ts'

const registryIds = Object.keys(BUILTIN_APP_DISPLAY_NAMES).sort()
const loaderIds = [...listBuiltinAppLoaderIds()].sort()
const windowlessIds = ['disk-image']

for (const id of windowlessIds) {
  assert.equal(
    loaderIds.includes(id),
    false,
    `无窗口应用不应有窗口加载器: ${id}`,
  )
}

const expectedLoaderIds = registryIds.filter((id) => !windowlessIds.includes(id))

assert.deepEqual(
  loaderIds,
  expectedLoaderIds,
  'APP_LOADERS 必须且只能覆盖每一个有窗口的 BuiltinAppId',
)

console.log(`app-registry-loaders: ${loaderIds.length} apps aligned (windowless: ${windowlessIds.length})`)
