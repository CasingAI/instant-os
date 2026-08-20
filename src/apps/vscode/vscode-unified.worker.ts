/// <reference lib="webworker" />

// Unified worker that routes between workspace-search and typescript-resolve.
// Vite 8 / rolldown flags false-positive "Circular worker imports" when two
// ?worker entries share transitive deps, so we merge them into one entry.

import { startWorkerHeapSampler } from '../../os/worker-heap-sampler.ts'

// ---- workspace search ----
import { searchVscodeWorkspaceFilesCoreDetailed } from './vscode-workspace-search-core.ts'
import type {
  VscodeWorkspaceSearchWorkerRequest,
  VscodeWorkspaceSearchWorkerResponse,
} from './vscode-workspace-search-protocol.ts'

// ---- typescript resolve ----
import {
  clearTypescriptResolveCaches,
  resolveBareModulesForEntriesCore,
} from './vscode-typescript-resolve-core.ts'
import type {
  VscodeTypescriptResolveWorkerRequest,
  VscodeTypescriptResolveWorkerResponse,
} from './vscode-typescript-resolve-protocol.ts'

const abortControllers = new Map<number, AbortController>()

function post(message: VscodeWorkspaceSearchWorkerResponse | VscodeTypescriptResolveWorkerResponse): void {
  self.postMessage(message)
}

startWorkerHeapSampler(post)

self.onmessage = (
  event: MessageEvent<
    VscodeWorkspaceSearchWorkerRequest | VscodeTypescriptResolveWorkerRequest
  >,
) => {
  const message = event.data

  if (message.type === 'abort') {
    const controller = abortControllers.get(message.requestId)
    controller?.abort()
    abortControllers.delete(message.requestId)
    return
  }

  if (message.type === 'search') {
    handleSearch(message)
    return
  }

  if (message.type === 'resolve') {
    handleResolve(message)
    return
  }

  if (message.type === 'clear') {
    handleClear(message)
    return
  }
}

// ---- workspace search ----

function handleSearch(message: VscodeWorkspaceSearchWorkerRequest & { type: 'search' }): void {
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

// ---- typescript resolve ----

function handleResolve(message: VscodeTypescriptResolveWorkerRequest & { type: 'resolve' }): void {
  const existing = abortControllers.get(message.requestId)
  existing?.abort()

  const controller = new AbortController()
  abortControllers.set(message.requestId, controller)

  void resolveBareModulesForEntriesCore({
    workspaceFolder: message.workspaceFolder,
    entries: message.entries,
    maxPackageFilesTotal: message.maxPackageFilesTotal,
    maxPackageFilesPerResolve: message.maxPackageFilesPerResolve,
    clearMissing: message.clearMissing,
    signal: controller.signal,
  })
    .then((result) => {
      if (controller.signal.aborted) return
      post({ type: 'done', requestId: message.requestId, result })
    })
    .catch((error: unknown) => {
      if (controller.signal.aborted) return
      const messageText = error instanceof Error && error.message ? error.message : '模块解析失败'
      post({ type: 'error', requestId: message.requestId, message: messageText })
    })
    .finally(() => {
      if (abortControllers.get(message.requestId) === controller) {
        abortControllers.delete(message.requestId)
      }
    })
}

function handleClear(message: VscodeTypescriptResolveWorkerRequest & { type: 'clear' }): void {
  clearTypescriptResolveCaches()
  post({
    type: 'done',
    requestId: message.requestId,
    result: { files: [] },
  })
}
