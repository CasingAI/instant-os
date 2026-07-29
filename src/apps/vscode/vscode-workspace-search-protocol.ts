import type { WorkerHeapSampleMessage } from '../../os/worker-heap-sampler.ts'
import type { VscodeWorkspaceSearchHit } from './vscode-workspace-search-core.ts'

export type VscodeWorkspaceSearchWorkerSearchPayload = {
  type: 'search'
  requestId: number
  query: string
  skipPaths: string[]
  workspaceFolder: string
  isCaseSensitive?: boolean
  matchWholeWord?: boolean
  isRegex?: boolean
  filesToInclude?: string
  filesToExclude?: string
  useExcludeSettingsAndIgnoreFiles?: boolean
  onlyOpenEditors?: boolean
  onlyPaths?: string[]
  contextLines?: number
}

export type VscodeWorkspaceSearchWorkerRequest =
  | VscodeWorkspaceSearchWorkerSearchPayload
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
      patternError?: string
    }
  | {
      type: 'error'
      requestId: number
      message: string
    }
  | WorkerHeapSampleMessage
