/**
 * Less 集成（第六期·结束 A）：源码树可写 .less、可与 CSS 混用。
 *
 * 调查结论（依据）：
 * - less 官方包的 exports 带 browser 条件（dist/less.cjs 为纯 UMD、无 require），
 *   随宿主静态资源/打包链下发即可在浏览器运行；不调用本机 lessc、不起子进程。
 * - 官方扩展点 less.FileManager + pluginManager.addFileManager 可注入虚拟文件源：
 *   跨文件 @import 从版本源码树读取，解析不得逃出该树（loadFile 做前缀限定）。
 * - 预览与发布共用同一编译函数：预览侧编好后按样式模块注入；发布侧在 esbuild-wasm
 *   插件的 onLoad 里把 .less 编成 CSS 再交给 css loader，最终收进单文件产物——
 *   嵌套页里跑的永远是编译后的 CSS，不是运行时现场编译 Less。
 * - 编译器随宿主下发，不进应用包（源码树 / 产物目录里没有 less 运行时）。
 */

type LessFileManager = {
  supports(filename: string, currentDirectory: string, options: unknown, environment: unknown): boolean
  supportsSync(): boolean
  loadFile(
    filename: string,
    currentDirectory: string,
    options: unknown,
    environment: unknown,
  ): Promise<{ filename: string; contents: string }>
}

type LessStatic = {
  render(source: string, options: Record<string, unknown>): Promise<{ css: string }>
  FileManager: new () => LessFileManager
}

type LessModule = { default?: LessStatic } & LessStatic

let lessReady: Promise<LessStatic> | undefined

async function loadLess(): Promise<LessStatic> {
  if (lessReady) {
    return lessReady
  }
  lessReady = (async () => {
    // 浏览器：package exports 的 browser 条件命中 dist/less.cjs（纯 UMD）
    const mod = (await import('less')) as unknown as LessModule
    return (mod.default ?? mod) as LessStatic
  })()
  return lessReady
}

function normalizeWithinTree(raw: string): string | undefined {
  const stack: string[] = []
  for (const segment of raw.split('/')) {
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

export type CompileLessInput = {
  source: string
  path: string
  files: Map<string, string>
}

export type CompileLessResult =
  | { ok: true; css: string }
  | { ok: false; error: string }

/** 编译一段 Less；@import 只从给定源码树读取，越出即失败（错误信息带文件定位） */
export async function compileLess(input: CompileLessInput): Promise<CompileLessResult> {
  let less: LessStatic
  try {
    less = await loadLess()
  } catch (loadError) {
    return {
      ok: false,
      error: `Less 编译器加载失败：${loadError instanceof Error ? loadError.message : String(loadError)}`,
    }
  }

  class TreeFileManager extends less.FileManager {
    supports(): boolean {
      return true
    }

    supportsSync(): boolean {
      return false
    }

    loadFile(
      filename: string,
      currentDirectory: string,
    ): Promise<{ filename: string; contents: string }> {
      const base = (currentDirectory || '').replace(/^\//, '').replace(/\/$/, '')
      const resolved = normalizeWithinTree(`${base ? `${base}/` : ''}${filename}`)
      if (resolved === undefined) {
        return Promise.reject(new Error(`Less 引用越出源码树：${filename}`))
      }
      const contents = input.files.get(resolved)
      if (contents === undefined) {
        return Promise.reject(
          new Error(`Less 文件不存在：${resolved}（@import 只能在该版本源码树内解析）`),
        )
      }
      return Promise.resolve({ filename: resolved, contents })
    }
  }

  const treePlugin = {
    install(_less: unknown, pluginManager: { addFileManager: (manager: LessFileManager) => void }) {
      pluginManager.addFileManager(new TreeFileManager())
    },
    minVersion: [3, 0, 0],
  }

  try {
    const result = await less.render(input.source, {
      filename: input.path,
      plugins: [treePlugin],
    })
    return { ok: true, css: result.css }
  } catch (renderError) {
    return {
      ok: false,
      error: renderError instanceof Error ? renderError.message : String(renderError),
    }
  }
}
