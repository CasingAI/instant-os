/**
 * Less 集成（第六期·结束 A）单测：编译、跨文件 @import、越界拦截、工程预览/打包接线。
 * 运行：node --experimental-strip-types src/apps/icode/icode-less.test.ts
 */
import assert from 'node:assert/strict'
import { compileLess } from './icode-less.ts'
import {
  buildProjectPreviewDocument,
  bundleProjectToSingleFile,
  resolveProjectImport,
} from './icode-project-build.ts'

const readSystemModule = async (name: string): Promise<string> => {
  if (name === 'preact') return `export function render(node, host) { host.textContent = String(node); }`
  if (name === 'preact/hooks') return `export function useState(v) { return [typeof v === 'function' ? v() : v, () => {}]; }`
  if (name === 'preact/jsx-runtime') return `export function jsx(type) { return type; } export const jsxs = jsx; export { } from 'preact';`
  throw new Error(`未知系统模块 ${name}`)
}

async function testCompileBasic(): Promise<void> {
  const result = await compileLess({
    source: '@width: 10px;\n.a { width: @width * 2; }',
    path: 'main.less',
    files: new Map(),
  })
  assert.equal(result.ok, true, result.ok ? '' : result.error)
  assert.ok(result.css.includes('width: 20px'))
}

async function testCrossFileImport(): Promise<void> {
  const files = new Map([
    ['styles/main.less', '@import "./vars.less";\n.a { color: @brand; }'],
    ['styles/vars.less', '@brand: #ff3b30;'],
    ['deep/other.less', '@bg: #eee;'],
    ['uses-deep.less', '@import "./deep/other.less";\n.b { background: @bg; }'],
  ])
  const main = await compileLess({
    source: files.get('styles/main.less')!,
    path: 'styles/main.less',
    files,
  })
  assert.equal(main.ok, true, main.ok ? '' : main.error)
  assert.ok(main.css.includes('#ff3b30'))

  const deep = await compileLess({
    source: files.get('uses-deep.less')!,
    path: 'uses-deep.less',
    files,
  })
  assert.equal(deep.ok, true, deep.ok ? '' : deep.error)
  assert.ok(deep.css.includes('#eee'))
}

async function testEscapeBlocked(): Promise<void> {
  const result = await compileLess({
    source: '@import "../../outside.less";',
    path: 'deep/x.less',
    files: new Map([['deep/x.less', '']]),
  })
  assert.equal(result.ok, false)
  assert.ok(result.error.includes('越出源码树') || result.error.includes("wasn't found"))
}

async function testMissingImportFails(): Promise<void> {
  const result = await compileLess({
    source: '@import "./nope.less";',
    path: 'main.less',
    files: new Map(),
  })
  assert.equal(result.ok, false)
}

function testResolveLessAsStyleModule(): void {
  const has = (path: string) => path === 'styles/app.less'
  assert.deepEqual(
    resolveProjectImport({ importerPath: 'main.tsx', spec: './styles/app', hasPath: has }),
    { kind: 'module', path: 'styles/app.less' },
  )
  assert.deepEqual(
    resolveProjectImport({ importerPath: 'main.tsx', spec: './styles/app.less', hasPath: has }),
    { kind: 'module', path: 'styles/app.less' },
  )
}

async function testPreviewMixesLessAndCss(): Promise<void> {
  const result = await buildProjectPreviewDocument({
    entryPath: 'main.tsx',
    files: new Map([
      ['main.tsx', `import { render } from 'preact'\nimport './styles/app.less'\nrender(1, document.body)\n`],
      ['styles/app.less', '@import "./vars.less";\n.app { color: @brand; }'],
      ['styles/vars.less', '@brand: #007aff;'],
    ]),
    assets: new Map(),
    readSystemModule,
  })
  assert.equal(result.ok, true, result.ok ? '' : result.error)
  assert.ok(result.html.includes('#007aff'))
}

async function testPreviewLessFailureVisible(): Promise<void> {
  const result = await buildProjectPreviewDocument({
    entryPath: 'main.tsx',
    files: new Map([
      ['main.tsx', `import './broken.less'\nconsole.log(1)\n`],
      ['broken.less', '@import "./missing.less";'],
    ]),
    assets: new Map(),
    readSystemModule,
  })
  assert.equal(result.ok, false)
  assert.ok(result.error.includes('broken.less'))
}

async function testBundleLessIntoSingleFile(): Promise<void> {
  const result = await bundleProjectToSingleFile({
    entryPath: 'main.tsx',
    files: new Map([
      ['main.tsx', `import { render } from 'preact'\nimport './styles/app.less'\nrender(1, document.body)\n`],
      ['styles/app.less', '@brand: #ff2d55;\n.app { color: @brand; }'],
    ]),
    assets: new Map(),
    readSystemModule,
  })
  assert.equal(result.ok, true, result.ok ? '' : result.error)
  assert.ok(result.html.includes('#ff2d55'))
  assert.ok(result.html.includes('<style>'))
}

async function main(): Promise<void> {
  await testCompileBasic()
  await testCrossFileImport()
  await testEscapeBlocked()
  await testMissingImportFails()
  testResolveLessAsStyleModule()
  await testPreviewMixesLessAndCss()
  await testPreviewLessFailureVisible()
  await testBundleLessIntoSingleFile()
  console.log('icode-less.test: all passed')
}

void main()
