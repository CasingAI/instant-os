/**
 * 内置应用 loader 与 BuiltinAppId 对齐。
 * 运行：node --experimental-strip-types src/os/app-registry-loaders.test.ts
 */
import assert from 'node:assert/strict'
import { BUILTIN_APP_DISPLAY_NAMES } from './builtin-app-display-names.ts'
import { listBuiltinAppLoaderIds } from './app-registry-loaders.ts'

const registryIds = Object.keys(BUILTIN_APP_DISPLAY_NAMES).sort()
const loaderIds = [...listBuiltinAppLoaderIds()].sort()

assert.deepEqual(
  loaderIds,
  registryIds,
  'APP_LOADERS 必须覆盖每一个 BuiltinAppId',
)

console.log(`app-registry-loaders: ${loaderIds.length} apps aligned`)
