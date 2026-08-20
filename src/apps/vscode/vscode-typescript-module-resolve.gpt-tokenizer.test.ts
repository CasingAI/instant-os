/**
 * 回归：无 types 字段、exports 只指 .js、旁路有 .d.ts 的包（仿 gpt-tokenizer），
 * 须与真实 TS Bundler 一样解到 esm/main.d.ts。
 *
 * 运行：node --experimental-strip-types src/apps/vscode/vscode-typescript-module-resolve.gpt-tokenizer.test.ts
 */
import assert from 'node:assert/strict'
import {
  declarationPathBesideJs,
  FilesResolutionCache,
  resolveBareSpecifier,
  resolvePackageTypesEntryDirect,
  toTsCompilerOptions,
  typesEntryFromPackageJson,
} from './vscode-typescript-module-resolve.ts'

const GPT_TOKENIZER_PKG = {
  name: 'gpt-tokenizer',
  version: '3.4.0',
  exports: {
    '.': {
      import: './esm/main.js',
      require: './cjs/main.js',
    },
    './*': {
      import: './esm/*.js',
      require: './cjs/*.js',
    },
  },
  main: 'esm/main.js',
  module: 'esm/main.js',
} as const

assert.equal(declarationPathBesideJs('./esm/main.js'), './esm/main.d.ts')
assert.equal(declarationPathBesideJs('foo.mjs'), 'foo.d.mts')
assert.equal(declarationPathBesideJs('foo.cjs'), 'foo.d.cts')

assert.equal(
  typesEntryFromPackageJson({ ...GPT_TOKENIZER_PKG }, undefined),
  './esm/main.d.ts',
  'exports → js 应旁路到 .d.ts',
)

assert.equal(
  typesEntryFromPackageJson({ main: 'lib/index.js', module: 'esm/index.js' }, undefined),
  'esm/index.d.ts',
  '无 exports 时用 module/main 旁路（module 优先）',
)

assert.equal(
  typesEntryFromPackageJson({ types: 'dist/types.d.ts', main: 'dist/index.js' }, undefined),
  'dist/types.d.ts',
  '显式 types 优先',
)

const cache = new FilesResolutionCache()
const root = '/user/demo'
const pkgRoot = `${root}/node_modules/gpt-tokenizer`
const containing = `${root}/src/shared/chat-context-compression.ts`

for (const dir of [
  root,
  `${root}/src`,
  `${root}/src/shared`,
  `${root}/node_modules`,
  pkgRoot,
  `${pkgRoot}/esm`,
  `${pkgRoot}/cjs`,
]) {
  cache.seedFolder(dir)
}

const pkgJsonText = JSON.stringify(GPT_TOKENIZER_PKG, undefined, 2)
cache.seedFile(`${pkgRoot}/package.json`, pkgJsonText)
cache.seedFile(`${pkgRoot}/esm/main.js`, 'export const countTokens = () => 0\n')
cache.seedFile(
  `${pkgRoot}/esm/main.d.ts`,
  'export declare function countTokens(input: string): number\n',
)
cache.seedFile(`${pkgRoot}/cjs/main.js`, 'exports.countTokens = () => 0\n')
cache.seedFile(
  `${pkgRoot}/cjs/main.d.ts`,
  'export declare function countTokens(input: string): number\n',
)
cache.seedFile(containing, "import { countTokens } from 'gpt-tokenizer'\n")

const direct = await resolvePackageTypesEntryDirect(cache, containing, 'gpt-tokenizer')
assert.equal(direct, `${pkgRoot}/esm/main.d.ts`)

const resolved = await resolveBareSpecifier(
  cache,
  containing,
  'gpt-tokenizer',
  toTsCompilerOptions({ moduleResolution: 'bundler' }, root),
)
assert.equal(resolved, `${pkgRoot}/esm/main.d.ts`)

console.log('vscode-typescript-module-resolve.gpt-tokenizer.test.ts: ok')
