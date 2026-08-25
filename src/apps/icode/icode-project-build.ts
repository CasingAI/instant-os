/**
 * iCode TSX 工程（第四期）：判别、共享模块解析、预览按模块转译、发布打单文件。
 *
 * - 无安装清单；约定入口 `main.tsx`（版本清单 JSON 可写明 entry）。
 * - 系统提供 Preact：裸名白名单 `preact` / `preact/hooks` / `preact/jsx-runtime`
 *   解析到宿主静态资源里内置的那一份，打进转译结果或单文件；不拷进应用包。
 * - 相对路径按 TypeScript 习惯补全扩展名与目录入口文件；解析不得逃出该版本源码树
 *   （约定产物目录 Dist 是保留名，模块解析不得走进去）。
 * - 预览（开发面）：每模块 esbuild.transform 成 CJS，注册进一个极小的模块注册表，
 *   保持多文件形态；浏览器里跑 esbuild-wasm，不调用本机程序、不起子进程之外的任何东西。
 * - 发布（收口）：esbuild.build bundle 成一份产物，与源码同夹共存于 Dist。
 */
import { inlineCssAssetRefs, siteMimeForPath } from '../generated/generated-app-site-html.ts'

export const PROJECT_ENTRY_FILE = 'main.tsx'
export const PROJECT_DIST_DIR = 'Dist'
export const PROJECT_DIST_PRODUCT = 'Dist/index.html'

/** 裸名白名单本期钉死：只提供 Preact 这一套框架 */
export const SYSTEM_MODULE_WHITELIST: readonly string[] = [
  'preact',
  'preact/hooks',
  'preact/jsx-runtime',
]

const MODULE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.css', '.json'] as const
const ASSET_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.svg',
  '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.wav', '.ogg', '.mp4', '.webm',
]

export type ProjectModuleId =
  | { kind: 'module'; path: string }
  | { kind: 'system'; name: string }
  | { kind: 'asset'; path: string }

/**
 * 工程判别（3.1）：入口存在 → 当工程处理；否则当静态网站根。
 * 清单可写明入口路径（缺省用约定名 main.tsx）。
 */
export function detectProjectEntry(
  manifestEntry: string | undefined,
  hasPath: (path: string) => boolean,
): string | undefined {
  const entry = manifestEntry?.trim() || PROJECT_ENTRY_FILE
  if (isModulePath(entry) && hasPath(entry)) {
    return entry
  }
  if (!manifestEntry && hasPath(PROJECT_ENTRY_FILE)) {
    return PROJECT_ENTRY_FILE
  }
  return undefined
}

export function isModulePath(path: string): boolean {
  const lower = path.toLowerCase()
  return (
    lower.endsWith('.tsx') ||
    lower.endsWith('.ts') ||
    lower.endsWith('.jsx') ||
    lower.endsWith('.js') ||
    lower.endsWith('.mjs')
  )
}

export function isAssetPath(path: string): boolean {
  const lower = path.toLowerCase()
  return ASSET_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

function normalizeProjectPath(segments: readonly string[]): string | undefined {
  const stack: string[] = []
  for (const segment of segments) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (stack.length === 0) return undefined
      stack.pop()
      continue
    }
    stack.push(segment)
  }
  return stack.join('/')
}

/**
 * 共享模块解析：裸名只认白名单；相对路径按 TS 习惯补全；
 * 逃出源码树 / 进入 Dist / 未知裸名一律解析失败。
 */
export function resolveProjectImport(params: {
  importerPath: string
  spec: string
  hasPath: (path: string) => boolean
}): ProjectModuleId | undefined {
  const { importerPath, spec, hasPath } = params
  if (!spec.startsWith('.') && !spec.startsWith('/')) {
    const clean = spec.replace(/\/+$/, '')
    return SYSTEM_MODULE_WHITELIST.includes(clean)
      ? { kind: 'system', name: clean }
      : undefined
  }

  const cleaned = spec.split('?')[0]!.split('#')[0]!
  const base = cleaned.startsWith('/')
    ? []
    : importerPath.split('/').slice(0, -1)
  const normalized = normalizeProjectPath([...base, ...cleaned.split('/')])
  if (normalized === undefined || normalized === '' || normalized === PROJECT_DIST_DIR || normalized.startsWith(`${PROJECT_DIST_DIR}/`)) {
    return undefined
  }

  // 精确命中（含资源文件） → 资源或精确模块
  if (hasPath(normalized)) {
    if (isModulePath(normalized) || normalized.endsWith('.css') || normalized.endsWith('.json')) {
      return { kind: 'module', path: normalized }
    }
    return { kind: 'asset', path: normalized }
  }

  // 补全扩展名
  for (const ext of MODULE_EXTENSIONS) {
    const candidate = `${normalized}${ext}`
    if (hasPath(candidate)) {
      return { kind: 'module', path: candidate }
    }
  }
  // 目录入口文件
  for (const ext of MODULE_EXTENSIONS) {
    const candidate = `${normalized}/index${ext}`
    if (hasPath(candidate)) {
      return { kind: 'module', path: candidate }
    }
  }
  // 无扩展名资源（hasPath 精确失败已覆盖；这里兜底失败）
  return undefined
}

// ---- esbuild-wasm 初始化（浏览器 / Node 测试两用） ----

type EsbuildModule = typeof import('esbuild-wasm')

let esbuildReady: Promise<EsbuildModule> | undefined

export async function loadEsbuild(): Promise<EsbuildModule> {
  if (esbuildReady) return esbuildReady
  esbuildReady = (async () => {
    const esbuild = (await import('esbuild-wasm')) as unknown as EsbuildModule
    // 浏览器：wasm 随宿主静态资源下发，初始化到 esbuild 自己的 Worker；
    // Node（单测）：esbuild-wasm 的 node 构建自动定位包内 wasm，无需 initialize
    if (typeof document !== 'undefined' && typeof window !== 'undefined') {
      await esbuild.initialize({
        wasmURL: new URL('/vendor/esbuild-wasm/esbuild.wasm', window.location.origin).href,
        worker: true,
      })
    }
    return esbuild
  })()
  return esbuildReady
}

// ---- 系统 Preact 模块（宿主静态资源里内置的那一份） ----

export type SystemModuleProvider = (name: string) => Promise<string>

const systemModuleCache = new Map<string, string>()

export const fetchSystemModule: SystemModuleProvider = async (name) => {
  const cached = systemModuleCache.get(name)
  if (cached !== undefined) return cached
  const file =
    name === 'preact' ? 'preact.js' : name === 'preact/hooks' ? 'hooks.js' : 'jsx-runtime.js'
  const response = await fetch(new URL(`/vendor/microapp/preact/${file}`, window.location.origin).href)
  if (!response.ok) {
    throw new Error(`系统模块 ${name} 加载失败（${response.status}）`)
  }
  const text = await response.text()
  systemModuleCache.set(name, text)
  return text
}

function loaderForPath(path: string): 'js' | 'jsx' | 'ts' | 'tsx' | 'css' | 'json' {
  const lower = path.toLowerCase()
  if (lower.endsWith('.tsx')) return 'tsx'
  if (lower.endsWith('.ts')) return 'ts'
  if (lower.endsWith('.jsx')) return 'jsx'
  if (lower.endsWith('.mjs')) return 'js'
  if (lower.endsWith('.css')) return 'css'
  if (lower.endsWith('.json')) return 'json'
  return 'js'
}

export function moduleIdToId(resolved: ProjectModuleId): string {
  if (resolved.kind === 'system') return `$system:${resolved.name}`
  return resolved.path
}

/** 把 CJS 输出里的 require("<spec>") 预解析为注册表 id（含裸名白名单） */
function rewriteRequires(params: {
  code: string
  importerPath: string
  hasPath: (path: string) => boolean
}): { code: string; failures: string[] } {
  const failures: string[] = []
  const code = params.code.replace(
    /require\("((?:[^"\\]|\\.)*)"\)/g,
    (match, spec: string) => {
      const resolved = resolveProjectImport({
        importerPath: params.importerPath,
        spec,
        hasPath: params.hasPath,
      })
      if (!resolved) {
        failures.push(`${params.importerPath} → "${spec}"`)
        return match
      }
      return `__require(${JSON.stringify(moduleIdToId(resolved))})`
    },
  )
  return { code, failures }
}

// ---- 预览：按模块转译 + 注册表运行时（保持多文件形态） ----

export type ProjectPreviewInput = {
  entryPath: string
  files: Map<string, string>
  assets: Map<string, Uint8Array>
  readSystemModule?: SystemModuleProvider
}

export type ProjectPreviewResult =
  | { ok: true; html: string }
  | { ok: false; error: string }

export async function buildProjectPreviewDocument(
  input: ProjectPreviewInput,
): Promise<ProjectPreviewResult> {
  const readSystemModule = input.readSystemModule ?? fetchSystemModule
  const hasPath = (path: string) => input.files.has(path) || input.assets.has(path)

  const esbuild = await loadEsbuild()
  const registry = new Map<string, string>()
  const failures: string[] = []

  const registerModule = async (path: string): Promise<void> => {
    if (registry.has(path)) return
    const source = input.files.get(path)
    if (source === undefined) return
    registry.set(path, '') // 占位防循环
    try {
      const transformed = await esbuild.transform(source, {
        loader: loaderForPath(path),
        format: 'cjs',
        jsx: 'automatic',
        jsxImportSource: 'preact',
        sourcefile: path,
        target: 'es2020',
      })
      const { code, failures: requireFailures } = rewriteRequires({
        code: transformed.code,
        importerPath: path,
        hasPath,
      })
      failures.push(...requireFailures)
      registry.set(path, code)
    } catch (transformError) {
      const message = transformError instanceof Error ? transformError.message : String(transformError)
      failures.push(`${path}: ${message}`)
      registry.set(path, `throw new Error(${JSON.stringify(`转译失败：${path}\n${message}`)})`)
    }
  }

  for (const path of input.files.keys()) {
    if (isModulePath(path) || path.endsWith('.json')) {
      await registerModule(path)
    }
  }

  // 系统 Preact：内置 ESM 源码同样转成注册表模块（其内部 import "preact" 亦被解析）
  for (const name of SYSTEM_MODULE_WHITELIST) {
    const id = `$system:${name}`
    if (registry.has(id)) continue
    try {
      const source = await readSystemModule(name)
      const transformed = await esbuild.transform(source, {
        loader: 'js',
        format: 'cjs',
        target: 'es2020',
      })
      const { code } = rewriteRequires({
        code: transformed.code,
        importerPath: name,
        hasPath: () => false,
      })
      registry.set(id, code)
    } catch (systemError) {
      const message = systemError instanceof Error ? systemError.message : String(systemError)
      return { ok: false, error: `系统模块 ${name} 加载失败：${message}` }
    }
  }

  if (failures.length > 0) {
    return { ok: false, error: `模块解析失败：\n${failures.join('\n')}` }
  }

  const assetEntries: Array<[string, string]> = []
  for (const [path, bytes] of input.assets) {
    let binary = ''
    const chunk = 0x8000
    for (let index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
    }
    assetEntries.push([path, `data:${siteMimeForPath(path)};base64,${btoa(binary)}`])
  }

  const moduleEntries: string[] = []
  for (const [path, source] of input.files) {
    if (path.endsWith('.css')) {
      const css = inlineCssAssetRefs({
        css: source,
        referrerPath: path,
        resolveBytes: (resolved) => (resolved ? input.assets.get(resolved) : undefined),
      })
      registry.set(
        path,
        `(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);module.exports={}})`,
      )
    }
  }

  for (const [id, code] of registry) {
    moduleEntries.push(`${JSON.stringify(id)}: function(require, module, exports){\n${code}\n}`)
  }

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;padding:0;font-family:-apple-system,"PingFang SC",sans-serif}</style>
</head>
<body>
<script>
(function(){
"use strict";
var __assets = ${JSON.stringify(assetEntries.length > 0 ? Object.fromEntries(assetEntries) : {})};
var __modules = {
${moduleEntries.join(',\n')}
};
var __cache = {};
function __require(id){
  if (id in __cache) return __cache[id].exports;
  if (__assets[id] !== undefined) return __assets[id];
  var factory = __modules[id];
  if (!factory) throw new Error("模块缺失: " + id);
  var module = { exports: {} };
  __cache[id] = module;
  try { factory(__require, module, module.exports); }
  catch (error) { delete __cache[id]; throw error; }
  return module.exports;
}
try {
  __require(${JSON.stringify(input.entryPath)});
} catch (error) {
  var box = document.createElement('pre');
  box.style.cssText = 'margin:16px;padding:12px;border-radius:10px;background:#fff1f0;color:#cf1322;font-size:12px;white-space:pre-wrap;word-break:break-word';
  box.textContent = '预览运行错误：' + (error && error.stack ? error.stack : String(error));
  document.body.appendChild(box);
  console.error(error);
}
})();
</script>
</body>
</html>`

  return { ok: true, html }
}

// ---- 发布：esbuild bundle → 单文件产物（写入该正式号 Dist/） ----

export type ProjectBundleInput = {
  entryPath: string
  files: Map<string, string>
  assets: Map<string, Uint8Array>
  readSystemModule?: SystemModuleProvider
}

export type ProjectBundleResult =
  | { ok: true; html: string }
  | { ok: false; error: string }

export async function bundleProjectToSingleFile(
  input: ProjectBundleInput,
): Promise<ProjectBundleResult> {
  const readSystemModule = input.readSystemModule ?? fetchSystemModule
  const hasPath = (path: string) => input.files.has(path) || input.assets.has(path)
  const esbuild = await loadEsbuild()

  const vfsPlugin = {
    name: 'instant-vfs',
    setup(build: import('esbuild-wasm').PluginBuild) {
      build.onResolve({ filter: /.*/ }, (args) => {
        // 入口点名（如 main.tsx）按源码树根相对解析
        const isEntry = args.kind === 'entry-point' || args.importer === ''
        const spec = isEntry && !args.path.startsWith('.') && !args.path.startsWith('/')
          ? `/${args.path.replace(/^\/+/, '')}`
          : args.path
        const resolved = resolveProjectImport({
          importerPath: isEntry ? '' : args.importer,
          spec,
          hasPath,
        })
        if (!resolved) {
          return {
            errors: [
              {
                text: `无法解析 "${args.path}"（裸名只支持 ${SYSTEM_MODULE_WHITELIST.join(' / ')}；解析不得逃出源码树）`,
                location: null,
              },
            ],
          }
        }
        return { path: moduleIdToId(resolved), namespace: resolved.kind === 'system' ? 'instant-system' : 'instant-vfs' }
      })

      build.onLoad({ filter: /.*/, namespace: 'instant-vfs' }, async (args) => {
        const path = args.path
        const text = input.files.get(path)
        if (text !== undefined) {
          return { contents: text, loader: loaderForPath(path) }
        }
        const bytes = input.assets.get(path)
        if (bytes !== undefined) {
          return { contents: bytes, loader: 'dataurl' as const }
        }
        return { errors: [{ text: `文件缺失: ${path}`, location: null }] }
      })

      build.onLoad({ filter: /.*/, namespace: 'instant-system' }, async (args) => {
        const name = args.path.slice('$system:'.length)
        try {
          const source = await readSystemModule(name)
          return { contents: source, loader: 'js' as const }
        } catch (error) {
          return {
            errors: [
              {
                text: `系统模块 ${name} 加载失败：${error instanceof Error ? error.message : String(error)}`,
                location: null,
              },
            ],
          }
        }
      })
    },
  }

  try {
    const result = await esbuild.build({
      entryPoints: [input.entryPath],
      bundle: true,
      format: 'esm',
      jsx: 'automatic',
      jsxImportSource: 'preact',
      write: false,
      outdir: 'out',
      target: 'es2020',
      logLevel: 'silent',
      plugins: [vfsPlugin as unknown as import('esbuild-wasm').Plugin],
    })

    let js = ''
    let css = ''
    for (const file of result.outputFiles ?? []) {
      if (file.path.endsWith('.js')) {
        js += file.text
      } else if (file.path.endsWith('.css')) {
        css += file.text
      }
    }
    if (!js) {
      return { ok: false, error: '打包产物为空' }
    }

    const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${css ? `<style>\n${css}\n</style>` : ''}
<style>html,body{margin:0;padding:0;font-family:-apple-system,"PingFang SC",sans-serif}</style>
</head>
<body>
<script type="module">
${js}
</script>
</body>
</html>`
    return { ok: true, html }
  } catch (buildError) {
    const message = buildError instanceof Error ? buildError.message : String(buildError)
    return { ok: false, error: message }
  }
}

/** 桌面打开正式号但产物缺失时的明确失败态（不假装跑成功） */
export function buildMissingProductDocument(appName: string): string {
  return buildProjectErrorDocument(
    `「${appName}」缺少发布产物`,
    '这一版是工程（main.tsx），但没有可运行的单文件产物：发布时打包失败，或产物被删除。<br/>请在 iCode 中重新发布这一应用。',
  )
}

/** 预览侧构建失败文档（转译/模块解析错误可见原因） */
export function buildProjectErrorDocument(title: string, bodyHtml: string): string {
  const escaped = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
html,body{margin:0;height:100%;background:#f5f5f7;color:#1d1d1f;font-family:-apple-system,"PingFang SC",sans-serif}
.card{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px}
.box{max-width:520px;padding:24px 28px;border-radius:16px;background:#fff;box-shadow:0 8px 28px rgba(0,0,0,.08);text-align:center}
h1{font-size:16px;margin:0 0 8px}
p{font-size:13px;line-height:1.6;margin:0;color:#6e6e73}
pre{text-align:left;font-size:11.5px;background:#f5f5f7;border-radius:10px;padding:10px;overflow:auto;max-height:240px;white-space:pre-wrap}
</style>
</head>
<body>
<div class="card"><div class="box">
<h1>${escaped}</h1>
<p>${bodyHtml}</p>
</div></div>
</body>
</html>`
}

/** 新 iCode 应用默认按 TSX 工程生成（3.6）：约定入口 + 最小骨架 + 引用系统 Preact */
export function buildIcodeTsxTemplateFiles(identity: {
  name: string
  themeColor: string
}): Array<{ path: string; text: string }> {
  const escaped = identity.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return [
    {
      path: PROJECT_ENTRY_FILE,
      text: `import { render } from 'preact'
import App from './components/App'
import './styles/app.css'

render(<App />, document.body)
`,
    },
    {
      path: 'components/App.tsx',
      text: `import { useState } from 'preact/hooks'

export default function App() {
  const [count, setCount] = useState(0)
  return (
    <main class="app">
      <h1>${escaped}</h1>
      <p>在 iCode 对话中描述你想要的应用，AI 会在这里生成。</p>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        点击次数：{count}
      </button>
    </main>
  )
}
`,
    },
    {
      path: 'styles/app.css',
      text: `:root { color-scheme: light dark; }
* { box-sizing: border-box; }
html, body {
  margin: 0;
  min-height: 100%;
  font-family: -apple-system, "PingFang SC", sans-serif;
  background: #f5f5f7;
  color: #1d1d1f;
}
.app {
  display: flex;
  min-height: 100vh;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
  padding: 24px;
}
.app h1 { font-size: 22px; margin: 0; }
.app p { color: #6e6e73; margin: 0; }
.app button {
  border: none;
  border-radius: 999px;
  padding: 10px 18px;
  font-size: 14px;
  color: #fff;
  background: ${identity.themeColor};
  cursor: pointer;
}
`,
    },
  ]
}
