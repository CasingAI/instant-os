/**
 * 发布收口端到端：TSX 草稿 → 升格 → 浏览器内 esbuild-wasm 打单文件 → Dist 只读产物。
 * 运行：node --experimental-strip-types src/os/icode-managed-apps-publish.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'

// 浏览器桩：系统 Preact 模块经 fetchSystemModule 读取（真实文件在 public/vendor）
const FAKE_MODULES: Record<string, string> = {
  '/vendor/microapp/preact/preact.js': `export const options = {}; export function render(node, host) { host.textContent = 'ok'; }`,
  '/vendor/microapp/preact/hooks.js': `import { options } from 'preact'; export function useState(v) { return [typeof v === 'function' ? v() : v, () => {}]; }`,
  '/vendor/microapp/preact/jsx-runtime.js': `export function jsx(type, props, key) { return type; } export const jsxs = jsx; export const Fragment = {};`,
}
;(globalThis as { window?: unknown }).window = {
  location: { origin: 'vfs://test' },
  dispatchEvent: () => true,
  setTimeout,
}
;(globalThis as { fetch?: unknown }).fetch = (async (url: string) => {
  const text = FAKE_MODULES[url] ?? FAKE_MODULES[url.replace(/^[a-z]+:\/\/[^/]*/, '')]
  if (text === undefined) {
    return { ok: false, status: 404, text: async () => '' }
  }
  return { ok: true, status: 200, text: async () => text }
}) as typeof fetch

import { resetFilesDbForTests } from '../apps/files/files-storage.ts'
import {
  listVersionTreeFiles,
  readVersionFileText,
  writeDraftManifest,
  writeDraftTextFile,
} from './generated-app-versions-layout.ts'
import {
  bundleIcodeFormalVersion,
  publishIcodeAppDraft,
} from './icode-managed-apps.ts'
import { PROJECT_DIST_PRODUCT } from '../apps/icode/icode-project-build.ts'

const APP_ID = 'gen:icode-publish-test' as `gen:${string}`

async function seedTsxDraft(): Promise<void> {
  await writeDraftManifest(APP_ID, {
    format: 'instant-os-generated-app-version',
    name: '工程应用',
    description: '',
    category: '内部开发',
    iconEmoji: '🛠️',
    themeColor: '#5856d6',
    tags: [],
    entry: 'main.tsx',
  })
  await writeDraftTextFile({
    appId: APP_ID,
    relativePath: 'main.tsx',
    text: `import { render } from 'preact'\nimport App from './components/App'\nrender(<App />, document.body)\n`,
  })
  await writeDraftTextFile({
    appId: APP_ID,
    relativePath: 'components/App.tsx',
    text: `export default function App() {\n  return <div class="app">hello</div>\n}\n`,
  })
}

async function testPublishBundlesProject(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await resetFilesDbForTests()
  await seedTsxDraft()

  const version = await publishIcodeAppDraft(APP_ID)
  assert.equal(version, 1)

  const outcome = await bundleIcodeFormalVersion(APP_ID, version)
  assert.equal(outcome.kind, 'bundled', outcome.kind === 'failed' ? outcome.error : '')

  const product = await readVersionFileText(APP_ID, 1, PROJECT_DIST_PRODUCT)
  assert.ok(product !== undefined, 'Dist/index.html 存在')
  assert.ok(product.includes('<script type="module">'))
  assert.ok(product.includes('className') || product.includes('jsx'))

  // 产物只读
  const files = await listVersionTreeFiles(APP_ID, 1)
  const distFile = files.find((file) => file.path === PROJECT_DIST_PRODUCT)
  assert.equal(distFile?.node.attributes.writable, false)

  // 新草稿没有产物目录（发布后只拷源码）
  const draftFiles = await listVersionTreeFiles(APP_ID, 'Draft')
  assert.equal(draftFiles.some((file) => file.path.startsWith('Dist/')), false)
}

async function testStaticTreeNeedsNoProduct(): Promise<void> {
  await resetFilesDbForTests()
  await writeDraftManifest(APP_ID, {
    format: 'instant-os-generated-app-version',
    name: '静态应用',
    description: '',
    category: '内部开发',
    iconEmoji: '🛠️',
    themeColor: '#5856d6',
    tags: [],
  })
  await writeDraftTextFile({
    appId: APP_ID,
    relativePath: 'index.html',
    text: '<html><body>hi</body></html>',
  })
  await publishIcodeAppDraft(APP_ID)
  const outcome = await bundleIcodeFormalVersion(APP_ID, 1)
  assert.equal(outcome.kind, 'static')
}

async function testBrokenProjectBundleFailsExplicitly(): Promise<void> {
  await resetFilesDbForTests()
  await writeDraftManifest(APP_ID, {
    format: 'instant-os-generated-app-version',
    name: '坏工程',
    description: '',
    category: '内部开发',
    iconEmoji: '🛠️',
    themeColor: '#5856d6',
    tags: [],
    entry: 'main.tsx',
  })
  await writeDraftTextFile({
    appId: APP_ID,
    relativePath: 'main.tsx',
    text: `import x from 'lodash'\nx()`,
  })
  await publishIcodeAppDraft(APP_ID)
  const outcome = await bundleIcodeFormalVersion(APP_ID, 1)
  assert.equal(outcome.kind, 'failed')
  // 版本仍在（升格成功），只是没有产物：桌面将给明确失败态
  const files = await listVersionTreeFiles(APP_ID, 1)
  assert.equal(files.some((file) => file.path === PROJECT_DIST_PRODUCT), false)
}

async function main(): Promise<void> {
  await testPublishBundlesProject()
  await testStaticTreeNeedsNoProduct()
  await testBrokenProjectBundleFailsExplicitly()
  console.log('icode-managed-apps-publish.test: all passed')
}

void main()
