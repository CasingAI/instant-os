/**
 * TSX 工程构建（第四期）单测：判别、模块解析、预览按模块转译、发布单文件。
 * 运行：node --experimental-strip-types src/apps/icode/icode-project-build.test.ts
 */
import assert from 'node:assert/strict'
import {
  bundleProjectToSingleFile,
  buildProjectPreviewDocument,
  detectProjectEntry,
  resolveProjectImport,
  SYSTEM_MODULE_WHITELIST,
} from './icode-project-build.ts'

// 浏用系统模块：等价的迷你 Preact（真实文件在 public/vendor/microapp/preact/）
const FAKE_PREACT = `export const options = {}; export const Fragment = {}; export function render(node, host) { host.textContent = String(node); } export function h(type, props, ...children) { return type; }`
const FAKE_HOOKS = `import { options } from 'preact'; export function useState(v) { return [typeof v === 'function' ? v() : v, () => {}]; }`
const FAKE_JSX = `import { options } from 'preact'; export { Fragment } from 'preact'; export function jsx(type, props, key) { return type; } export const jsxs = jsx;`

const readSystemModule = async (name: string): Promise<string> => {
  if (name === 'preact') return FAKE_PREACT
  if (name === 'preact/hooks') return FAKE_HOOKS
  if (name === 'preact/jsx-runtime') return FAKE_JSX
  throw new Error(`未知系统模块 ${name}`)
}

function files(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries))
}

function testDetectProjectEntry(): void {
  assert.equal(detectProjectEntry(undefined, (p) => p === 'main.tsx'), 'main.tsx')
  assert.equal(detectProjectEntry(undefined, () => false), undefined)
  assert.equal(detectProjectEntry('src/entry.tsx', (p) => p === 'src/entry.tsx'), 'src/entry.tsx')
  // index.html 存在但无工程入口 → 不是工程
  assert.equal(detectProjectEntry(undefined, (p) => p === 'index.html'), undefined)
}

function testResolveProjectImport(): void {
  const has = (path: string) =>
    ['main.tsx', 'components/App.tsx', 'components/App.css', 'utils/math.ts', 'data.json', 'img/logo.png'].includes(path)
  assert.deepEqual(
    resolveProjectImport({ importerPath: 'main.tsx', spec: './components/App', hasPath: has }),
    { kind: 'module', path: 'components/App.tsx' },
  )
  assert.deepEqual(
    resolveProjectImport({ importerPath: 'components/App.tsx', spec: '../utils/math', hasPath: has }),
    { kind: 'module', path: 'utils/math.ts' },
  )
  assert.deepEqual(
    resolveProjectImport({ importerPath: 'main.tsx', spec: 'preact', hasPath: has }),
    { kind: 'system', name: 'preact' },
  )
  assert.deepEqual(
    resolveProjectImport({ importerPath: 'main.tsx', spec: 'preact/hooks', hasPath: has }),
    { kind: 'system', name: 'preact/hooks' },
  )
  // 其它裸名一律解析失败
  assert.equal(
    resolveProjectImport({ importerPath: 'main.tsx', spec: 'lodash', hasPath: has }),
    undefined,
  )
  // 逃出源码树失败
  assert.equal(
    resolveProjectImport({ importerPath: 'components/App.tsx', spec: '../../outside', hasPath: () => true }),
    undefined,
  )
  // Dist 是保留名，解析不得走进去
  assert.equal(
    resolveProjectImport({ importerPath: 'main.tsx', spec: './Dist/index.html', hasPath: () => true }),
    undefined,
  )
  // 资源文件
  assert.deepEqual(
    resolveProjectImport({ importerPath: 'main.tsx', spec: './img/logo.png', hasPath: has }),
    { kind: 'asset', path: 'img/logo.png' },
  )
}

async function testPreviewDocument(): Promise<void> {
  const result = await buildProjectPreviewDocument({
    entryPath: 'main.tsx',
    files: files({
      'main.tsx': `import { render } from 'preact'\nimport { useState } from 'preact/hooks'\nimport App from './components/App'\nimport './styles/global.css'\nrender(App(), document.body)`,
      'components/App.tsx': `import { useState } from 'preact/hooks'\nexport default function App() {\n  const [n] = useState(1)\n  return <div className="app">{n}</div>\n}`,
      'styles/global.css': `body { background: url('./bg.png'); }`,
    }),
    assets: new Map([['styles/bg.png', new Uint8Array([1, 2, 3])]]),
    readSystemModule,
  })
  assert.equal(result.ok, true, result.ok ? '' : result.error)
  const html = result.html
  assert.ok(html.includes('"main.tsx"'))
  assert.ok(html.includes('"components/App.tsx"'))
  assert.ok(html.includes('$system:preact'))
  assert.ok(html.includes('$system:preact/hooks'))
  // CSS url() 内联为 data: URL
  assert.ok(html.includes('url(&#39;data:image/png') || html.includes("url('data:image/png"))
  // JSX 被剥掉并走 jsx-runtime
  assert.ok(!html.includes('<div className='))
}

async function testPreviewResolutionFailure(): Promise<void> {
  const result = await buildProjectPreviewDocument({
    entryPath: 'main.tsx',
    files: files({
      'main.tsx': `import lodash from 'lodash'\nlodash()`,
    }),
    assets: new Map(),
    readSystemModule,
  })
  assert.equal(result.ok, false)
  assert.ok(result.error.includes('lodash'))
}

async function testBundleSingleFile(): Promise<void> {
  const result = await bundleProjectToSingleFile({
    entryPath: 'main.tsx',
    files: files({
      'main.tsx': `import { render } from 'preact'\nimport App from './components/App'\nrender(App(), document.body)`,
      'components/App.tsx': `export default function App() {\n  return <div className="app">ok</div>\n}`,
    }),
    assets: new Map(),
    readSystemModule,
  })
  assert.equal(result.ok, true, result.ok ? '' : result.error)
  const html = result.html
  assert.ok(html.includes('<script type="module">'))
  // bundle 后是单段脚本，无 import 语句残留（系统 Preact 已内联）
  assert.ok(!/\bimport\s*\{/.test(html))
  assert.ok(html.includes('className') || html.includes('jsx'))
}

async function testBundleEscapeFails(): Promise<void> {
  const result = await bundleProjectToSingleFile({
    entryPath: 'main.tsx',
    files: files({
      'main.tsx': `import x from '../outside.js'\nx()`,
    }),
    assets: new Map(),
    readSystemModule,
  })
  assert.equal(result.ok, false)
  assert.ok(result.error.includes('无法解析') || result.error.includes('outside'))
}

function testWhitelist(): void {
  assert.deepEqual([...SYSTEM_MODULE_WHITELIST], ['preact', 'preact/hooks', 'preact/jsx-runtime'])
}

async function main(): Promise<void> {
  testDetectProjectEntry()
  testResolveProjectImport()
  testWhitelist()
  await testPreviewDocument()
  await testPreviewResolutionFailure()
  await testBundleSingleFile()
  await testBundleEscapeFails()
  console.log('icode-project-build.test: all passed')
}

void main()
