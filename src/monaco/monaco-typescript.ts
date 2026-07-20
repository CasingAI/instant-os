import './monaco-nls.ts'
import * as monaco from 'monaco-editor'

let typescriptConfigured = false

/**
 * Monaco 公开枚举只有 Classic/NodeJs，但 TS worker 已支持 Node16/NodeNext/Bundler。
 * 数值与 typescript ModuleResolutionKind 对齐。
 */
export const MonacoModuleResolutionKind = {
  Classic: 1,
  NodeJs: 2,
  Node16: 3,
  NodeNext: 99,
  Bundler: 100,
} as const

export type MonacoModuleResolutionKindValue =
  (typeof MonacoModuleResolutionKind)[keyof typeof MonacoModuleResolutionKind]

export type MonacoTypescriptCompilerOverrides = {
  jsxImportSource?: string
  baseUrl?: string
  paths?: Record<string, string[]>
  moduleResolution?: MonacoModuleResolutionKindValue
  allowImportingTsExtensions?: boolean
}

const BASE_COMPILER_OPTIONS: monaco.typescript.CompilerOptions = {
  target: monaco.typescript.ScriptTarget.ESNext,
  module: monaco.typescript.ModuleKind.ESNext,
  moduleResolution: MonacoModuleResolutionKind.Bundler as monaco.typescript.ModuleResolutionKind,
  allowImportingTsExtensions: true,
  jsx: monaco.typescript.JsxEmit.ReactJSX,
  allowJs: true,
  allowNonTsExtensions: true,
  esModuleInterop: true,
  allowSyntheticDefaultImports: true,
  resolveJsonModule: true,
  isolatedModules: true,
  skipLibCheck: true,
  noEmit: true,
}

/** 在 Monaco worker 就绪后配置 TS/JS 语言服务默认项（全局一次） */
export function ensureMonacoTypescriptDefaults(): void {
  if (typescriptConfigured) return
  typescriptConfigured = true

  const ts = monaco.typescript.typescriptDefaults
  const js = monaco.typescript.javascriptDefaults

  ts.setCompilerOptions({ ...BASE_COMPILER_OPTIONS })
  js.setCompilerOptions({ ...BASE_COMPILER_OPTIONS })

  ts.setEagerModelSync(true)
  js.setEagerModelSync(true)

  ts.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  })
  js.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  })
}

/**
 * 强制 TS worker 用当前 compilerOptions 重跑语义诊断。
 * 动态 createModel 挂载本地依赖后，若不触发重分析，会出现「可转到定义但仍报 2307」的分裂。
 */
export function refreshMonacoTypescriptSemantics(): void {
  ensureMonacoTypescriptDefaults()
  const ts = monaco.typescript.typescriptDefaults
  const js = monaco.typescript.javascriptDefaults
  const options = { ...ts.getCompilerOptions() }
  ts.setCompilerOptions(options)
  js.setCompilerOptions(options)
}

export function applyMonacoTypescriptCompilerOverrides(
  overrides: MonacoTypescriptCompilerOverrides | undefined,
): void {
  ensureMonacoTypescriptDefaults()

  const next: monaco.typescript.CompilerOptions = {
    ...BASE_COMPILER_OPTIONS,
    ...(overrides?.jsxImportSource ? { jsxImportSource: overrides.jsxImportSource } : undefined),
    ...(overrides?.baseUrl ? { baseUrl: overrides.baseUrl } : undefined),
    ...(overrides?.paths ? { paths: overrides.paths } : undefined),
    ...(overrides?.moduleResolution !== undefined
      ? {
          moduleResolution:
            overrides.moduleResolution as monaco.typescript.ModuleResolutionKind,
        }
      : undefined),
    ...(overrides?.allowImportingTsExtensions !== undefined
      ? { allowImportingTsExtensions: overrides.allowImportingTsExtensions }
      : undefined),
  }

  monaco.typescript.typescriptDefaults.setCompilerOptions(next)
  monaco.typescript.javascriptDefaults.setCompilerOptions(next)
}

export function setMonacoTypescriptExtraLibs(
  libs: readonly { content: string; filePath: string }[],
): void {
  ensureMonacoTypescriptDefaults()
  const payload = libs.map((lib) => ({ content: lib.content, filePath: lib.filePath }))
  monaco.typescript.typescriptDefaults.setExtraLibs(payload)
  monaco.typescript.javascriptDefaults.setExtraLibs(payload)
}

export function clearMonacoTypescriptExtraLibs(): void {
  setMonacoTypescriptExtraLibs([])
}

export function monacoFileUriString(absolutePath: string): string {
  return monaco.Uri.file(absolutePath).toString()
}
