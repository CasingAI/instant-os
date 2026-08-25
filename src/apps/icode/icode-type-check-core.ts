/**
 * 类型检查核心（第五期）：纯函数化，Worker 与 Node 单测共用。
 * 引擎是完整 TypeScript 检查器（宿主已带的库；日后可原位换成 TS7 的 WASM）。
 * 旁路：诊断只是附加信号，不挡预览转译、发布打包与桌面运行。
 */
import * as ts from 'typescript'

export type IcodeTypeCheckRequest = {
  type: 'instant-os-icode-type-check'
  runId: number
  files: Record<string, string>
  entryPath: string
}

export type IcodeTypeCheckDiagnostic = {
  file: string
  line: number
  column: number
  category: 'error' | 'warning'
  code: number | undefined
  message: string
}

export type IcodeTypeCheckResponse = {
  type: 'instant-os-icode-type-check-result'
  runId: number
  diagnostics: IcodeTypeCheckDiagnostic[]
  error: string | undefined
}

/** 静态支撑文件：TS lib + 系统 Preact 声明（含包清单与资源模块声明） */
export type TypeCheckSupportFiles = {
  libs: Record<string, string>
  systemTypes: Record<string, string>
}

/** Worker / 测试装配用的支撑文件路径清单（内容随宿主静态资源或 node_modules 提供） */
export const TYPE_CHECK_SUPPORT_PATHS = {
  libNames: [
    'lib.es5.d.ts',
    'lib.es2015.d.ts',
    'lib.es2016.d.ts',
    'lib.es2017.d.ts',
    'lib.es2018.d.ts',
    'lib.es2019.d.ts',
    'lib.es2020.d.ts',
    'lib.dom.d.ts',
    'lib.dom.iterable.d.ts',
    'lib.dom.asynciterable.d.ts',
    'lib.scripthost.d.ts',
    'lib.webworker.importscripts.d.ts',
  ],
  systemTypeNames: [
    'node_modules/preact/src/index.d.ts',
    'node_modules/preact/src/dom.d.ts',
    'node_modules/preact/src/jsx.d.ts',
    'node_modules/preact/src/internal.d.ts',
    'node_modules/preact/hooks/src/index.d.ts',
    'node_modules/preact/hooks/src/internal.d.ts',
    'node_modules/preact/jsx-runtime/src/index.d.ts',
  ],
} as const

/** 系统 Preact 声明的包清单（镜像真实包布局，node 模块解析可命中白名单裸名） */
export function buildPreactPackageJsons(): Record<string, string> {
  return {
    'node_modules/preact/package.json': JSON.stringify({
      name: 'preact',
      types: 'src/index.d.ts',
      main: 'dist/preact.js',
    }),
    'node_modules/preact/hooks/package.json': JSON.stringify({
      name: 'preact/hooks',
      types: 'src/index.d.ts',
    }),
    'node_modules/preact/jsx-runtime/package.json': JSON.stringify({
      name: 'preact/jsx-runtime',
      types: 'src/index.d.ts',
    }),
    // 工程约定：样式与静态资源以默认字符串导入（与 esbuild 的 loader 行为对齐）
    'icode-asset-modules.d.ts': `declare module '*.css' {\n  const content: string\n  export default content\n}\ndeclare module '*.less' {\n  const content: string\n  export default content\n}\n${[
      'png',
      'jpg',
      'jpeg',
      'gif',
      'webp',
      'avif',
      'bmp',
      'svg',
    ]
      .map((ext) => `declare module '*.${ext}' { const src: string; export default src }\n`)
      .join('')}`,
  }
}

export function runTypeCheck(
  request: Omit<IcodeTypeCheckRequest, 'type' | 'runId'>,
  support: TypeCheckSupportFiles,
): IcodeTypeCheckResponse {
  const virtualFiles = new Map<string, string>([
    ...Object.entries(support.libs),
    ...Object.entries(support.systemTypes),
    ...Object.entries(request.files),
  ])

  const knownDirectories = new Set<string>()
  for (const path of virtualFiles.keys()) {
    let current = path
    while (true) {
      const slash = current.lastIndexOf('/')
      if (slash <= 0) break
      current = current.slice(0, slash)
      knownDirectories.add(current)
    }
  }

  const compilerOptions: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    allowJs: true,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    // Bundler 解析与第四期 esbuild 语义一致（无扩展名 / 目录入口补全）
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    // 虚拟宿主没有 baseUrl / package.json imports 语义；保持开启会在
    // TS 的模块 specifier 计算里以 undefined 崩溃
    resolvePackageJsonImports: false,
    resolvePackageJsonExports: false,
    jsx: ts.JsxEmit.ReactJSX,
    jsxImportSource: 'preact',
    lib: ['lib.es2020.full.d.ts'],
    types: [],
    skipLibCheck: true,
  }

  const sourceFiles = new Map<string, ts.SourceFile>()
  // 解析器可能带前导 `/` 寻址（getCurrentDirectory 为根）；按键原样与去斜杠两种形式兜底
  const lookup = (fileName: string): string | undefined =>
    virtualFiles.get(fileName) ?? virtualFiles.get(fileName.replace(/^\//, ''))
  const host: ts.CompilerHost = {
    getSourceFile: (fileName) => {
      const cached = sourceFiles.get(fileName)
      if (cached !== undefined) return cached
      const text = lookup(fileName)
      if (text === undefined) return undefined
      const source = ts.createSourceFile(
        fileName,
        text,
        compilerOptions.target ?? ts.ScriptTarget.ES2020,
        true,
      )
      sourceFiles.set(fileName, source)
      return source
    },
    getDefaultLibFileName: () => 'lib.es2020.full.d.ts',
    writeFile: () => undefined,
    getCurrentDirectory: () => '',
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (fileName) => lookup(fileName) !== undefined,
    readFile: (fileName) => lookup(fileName),
    directoryExists: (dirName) =>
      dirName === '' ||
      dirName === '/' ||
      knownDirectories.has(dirName) ||
      knownDirectories.has(dirName.replace(/^\//, '')),
    getDirectories: (dirName) =>
      [...knownDirectories]
        .filter(
          (dir) =>
            (dir.startsWith(`${dirName}/`) || dir.startsWith(`${dirName.replace(/^\//, '')}/`)) &&
            !dir.slice(dirName.length + 1).includes('/'),
        )
        .map((dir) => dir.slice(dirName.length + 1)),
  }

  try {
    const program = ts.createProgram(
      [request.entryPath, 'icode-asset-modules.d.ts'],
      compilerOptions,
      host,
    )
    const diagnostics: IcodeTypeCheckDiagnostic[] = []
    const collect = (list: readonly ts.Diagnostic[]) => {
      for (const diagnostic of list) {
        const file = diagnostic.file?.fileName ?? ''
        // 只收草稿源码树内的诊断（lib / 系统声明跳过）
        if (!file || !request.files[file]) continue
        const start = diagnostic.file?.getLineAndCharacterOfPosition(diagnostic.start ?? 0)
        diagnostics.push({
          file,
          line: (start?.line ?? 0) + 1,
          column: (start?.character ?? 0) + 1,
          category: diagnostic.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
          code: diagnostic.code,
          message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        })
      }
    }
    collect(program.getSyntacticDiagnostics())
    collect(program.getSemanticDiagnostics())
    return {
      type: 'instant-os-icode-type-check-result',
      runId: -1,
      diagnostics,
      error: undefined,
    }
  } catch (error) {
    return {
      type: 'instant-os-icode-type-check-result',
      runId: -1,
      diagnostics: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
