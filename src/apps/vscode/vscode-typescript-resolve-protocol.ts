import type { ResolveCompilerOptionsInput } from './vscode-typescript-module-resolve.ts'

export type VscodeTypescriptResolveEntry = {
  path: string
  text: string
}

export type VscodeTypescriptResolveFile = {
  path: string
  content: string
}

export type VscodeTypescriptResolveMonacoOverrides = {
  baseUrlPath: string
  paths?: Record<string, string[]>
}

export type VscodeTypescriptResolveLog = {
  level: 'info' | 'warn' | 'error'
  message: string
}

export type VscodeTypescriptResolveResult = {
  files: VscodeTypescriptResolveFile[]
  monacoOverrides?: VscodeTypescriptResolveMonacoOverrides
  nearestCompilerOptions?: ResolveCompilerOptionsInput
  configDirectory?: string
  /** 至少一个 bare specifier 解析成功时 > 0 */
  resolvedCount?: number
  logs?: VscodeTypescriptResolveLog[]
}

export type VscodeTypescriptResolveWorkerRequest =
  | {
      type: 'resolve'
      requestId: number
      workspaceFolder: string
      entries: VscodeTypescriptResolveEntry[]
      maxPackageFilesTotal: number
      maxPackageFilesPerResolve: number
      clearMissing: boolean
    }
  | {
      type: 'abort'
      requestId: number
    }
  | {
      type: 'clear'
      requestId: number
    }

export type VscodeTypescriptResolveWorkerResponse =
  | {
      type: 'done'
      requestId: number
      result: VscodeTypescriptResolveResult
    }
  | {
      type: 'error'
      requestId: number
      message: string
    }
