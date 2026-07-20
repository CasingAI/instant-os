import type { VscodeWorkspaceSearchHit } from './vscode-workspace-search-core.ts'

export type VscodeWorkspaceSearchWorkerRequest =
  | {
      type: 'search'
      requestId: number
      query: string
      skipPaths: string[]
      workspaceFolder: string
    }
  | {
      type: 'abort'
      requestId: number
    }

export type VscodeWorkspaceSearchWorkerResponse =
  | {
      type: 'progress'
      requestId: number
      hits: VscodeWorkspaceSearchHit[]
    }
  | {
      type: 'done'
      requestId: number
      hits: VscodeWorkspaceSearchHit[]
    }
  | {
      type: 'error'
      requestId: number
      message: string
    }
