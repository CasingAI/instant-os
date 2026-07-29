import VscodeWorkspaceSearchWorker from './vscode-workspace-search.worker.ts?worker'
import { defineService } from '../../os/service-supervisor.ts'
import {
  matchVscodeOpenFiles,
  type VscodeWorkspaceSearchHit,
  type VscodeWorkspaceSearchOpenFile,
  type VscodeWorkspaceSearchParams,
} from './vscode-workspace-search-core.ts'
import type {
  VscodeWorkspaceSearchWorkerRequest,
  VscodeWorkspaceSearchWorkerResponse,
} from './vscode-workspace-search-protocol.ts'

export type {
  VscodeWorkspaceSearchHit,
  VscodeWorkspaceSearchOpenFile,
  VscodeWorkspaceSearchParams,
}

export { matchVscodeOpenFiles }

export type VscodeWorkspaceSearchClientResult = {
  hits: VscodeWorkspaceSearchHit[]
  patternError: string | undefined
}

type SearchResponse = Exclude<VscodeWorkspaceSearchWorkerResponse, { type: 'heap' }>

const service = defineService<VscodeWorkspaceSearchWorkerRequest, SearchResponse>({
  id: 'vscode-workspace-search',
  description: '工作区全文搜索：在独立 Worker 中扫描未打开文件，避免阻塞编辑器主线程。',
  createWorker: () => new VscodeWorkspaceSearchWorker(),
})

/**
 * 在搜索服务 Worker 中扫描工作区未打开文件。
 * 服务不可用时返回空结果与错误提示（主线程永不执行搜索）。
 * 调用方应将 matchVscodeOpenFiles 的结果排在本函数结果之前。
 */
export async function searchVscodeWorkspaceFiles(
  params: VscodeWorkspaceSearchParams,
): Promise<VscodeWorkspaceSearchHit[]> {
  const result = await searchVscodeWorkspaceFilesDetailed(params)
  return result.hits
}

export async function searchVscodeWorkspaceFilesDetailed(
  params: VscodeWorkspaceSearchParams,
): Promise<VscodeWorkspaceSearchClientResult> {
  const query = params.query.trim()
  if (!query || !params.workspaceFolder) return { hits: [], patternError: undefined }
  if (params.onlyOpenEditors) return { hits: [], patternError: undefined }

  const skipPaths = [...(params.skipPaths instanceof Set ? params.skipPaths : params.skipPaths)]
  const onlyPaths = params.onlyPaths
    ? [...(params.onlyPaths instanceof Set ? params.onlyPaths : params.onlyPaths)]
    : undefined

  try {
    return await service.request<VscodeWorkspaceSearchClientResult>(
      {
        type: 'search',
        query,
        skipPaths,
        workspaceFolder: params.workspaceFolder,
        isCaseSensitive: params.isCaseSensitive,
        matchWholeWord: params.matchWholeWord,
        isRegex: params.isRegex,
        filesToInclude: params.filesToInclude,
        filesToExclude: params.filesToExclude,
        useExcludeSettingsAndIgnoreFiles: params.useExcludeSettingsAndIgnoreFiles,
        onlyOpenEditors: params.onlyOpenEditors,
        onlyPaths,
        contextLines: params.contextLines,
      },
      {
        signal: params.signal,
        abortedValue: () => ({ hits: [], patternError: undefined }),
        route: (message) => {
          if (message.type === 'progress') {
            params.onProgress?.(message.hits)
            return { action: 'continue' }
          }
          if (message.type === 'done') {
            return {
              action: 'resolve',
              value: { hits: message.hits, patternError: message.patternError },
            }
          }
          return { action: 'reject', error: new Error(message.message) }
        },
      },
    )
  } catch (error) {
    if (params.signal?.aborted) return { hits: [], patternError: undefined }
    console.warn('[vscode-workspace-search] 服务不可用', error)
    return { hits: [], patternError: '搜索服务不可用，可在性能监视器中重启该服务' }
  }
}
