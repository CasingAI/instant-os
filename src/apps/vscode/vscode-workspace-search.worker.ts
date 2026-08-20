/// <reference lib="webworker" />

import { startWorkerHeapSampler } from '../../os/worker-heap-sampler.ts'
import { searchVscodeWorkspaceFilesCoreDetailed } from './vscode-workspace-search-core.ts'
import type {
  VscodeWorkspaceSearchWorkerRequest,
  VscodeWorkspaceSearchWorkerResponse,
} from './vscode-workspace-search-protocol.ts'

const abortControllers = new Map<number, AbortController>()

function post(message: VscodeWorkspaceSearchWorkerResponse): void {
  self.postMessage(message)
}

startWorkerHeapSampler(post)

self.onmessage = (event: MessageEvent<VscodeWorkspaceSearchWorkerRequest>) => {
  const message = event.data
  if (message.type === 'abort') {
    const controller = abortControllers.get(message.requestId)
    controller?.abort()
    abortControllers.delete(message.requestId)
    return
  }

  if (message.type !== 'search') return

  const existing = abortControllers.get(message.requestId)
  existing?.abort()

  const controller = new AbortController()
  abortControllers.set(message.requestId, controller)

  void searchVscodeWorkspaceFilesCoreDetailed({
    query: message.query,
    skipPaths: message.skipPaths,
    workspaceFolder: message.workspaceFolder,
    isCaseSensitive: message.isCaseSensitive,
    matchWholeWord: message.matchWholeWord,
    isRegex: message.isRegex,
    filesToInclude: message.filesToInclude,
    filesToExclude: message.filesToExclude,
    useExcludeSettingsAndIgnoreFiles: message.useExcludeSettingsAndIgnoreFiles,
    onlyOpenEditors: message.onlyOpenEditors,
    onlyPaths: message.onlyPaths,
    contextLines: message.contextLines,
    signal: controller.signal,
    onProgress: (hits) => {
      if (controller.signal.aborted) return
      post({ type: 'progress', requestId: message.requestId, hits })
    },
  })
    .then((result) => {
      if (controller.signal.aborted) return
      post({
        type: 'done',
        requestId: message.requestId,
        hits: result.hits,
        patternError: result.patternError,
      })
    })
    .catch((error: unknown) => {
      if (controller.signal.aborted) return
      const messageText = error instanceof Error && error.message ? error.message : '搜索失败'
      post({ type: 'error', requestId: message.requestId, message: messageText })
    })
    .finally(() => {
      if (abortControllers.get(message.requestId) === controller) {
        abortControllers.delete(message.requestId)
      }
    })
}
