import * as monaco from 'monaco-editor'

let typescriptConfigured = false

export type MonacoTypescriptCompilerOverrides = {
  jsxImportSource?: string
  baseUrl?: string
  paths?: Record<string, string[]>
}

const BASE_COMPILER_OPTIONS: monaco.typescript.CompilerOptions = {
  target: monaco.typescript.ScriptTarget.ESNext,
  module: monaco.typescript.ModuleKind.ESNext,
  moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
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

export function applyMonacoTypescriptCompilerOverrides(
  overrides: MonacoTypescriptCompilerOverrides | undefined,
): void {
  ensureMonacoTypescriptDefaults()

  const next: monaco.typescript.CompilerOptions = {
    ...BASE_COMPILER_OPTIONS,
    ...(overrides?.jsxImportSource ? { jsxImportSource: overrides.jsxImportSource } : undefined),
    ...(overrides?.baseUrl ? { baseUrl: overrides.baseUrl } : undefined),
    ...(overrides?.paths ? { paths: overrides.paths } : undefined),
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
