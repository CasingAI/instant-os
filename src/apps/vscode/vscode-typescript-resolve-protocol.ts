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

export type VscodeTypescriptResolveResult = {
  files: VscodeTypescriptResolveFile[]
  monacoOverrides?: VscodeTypescriptResolveMonacoOverrides
  nearestCompilerOptions?: ResolveCompilerOptionsInput
  configDirectory?: string
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
