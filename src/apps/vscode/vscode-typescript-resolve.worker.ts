/// <reference lib="webworker" />

import {
  clearTypescriptResolveCaches,
  resolveBareModulesForEntriesCore,
} from './vscode-typescript-resolve-core.ts'
import type {
  VscodeTypescriptResolveWorkerRequest,
  VscodeTypescriptResolveWorkerResponse,
} from './vscode-typescript-resolve-protocol.ts'

const abortControllers = new Map<number, AbortController>()

function post(message: VscodeTypescriptResolveWorkerResponse): void {
  self.postMessage(message)
}

self.onmessage = (event: MessageEvent<VscodeTypescriptResolveWorkerRequest>) => {
  const message = event.data

  if (message.type === 'abort') {
    const controller = abortControllers.get(message.requestId)
    controller?.abort()
    abortControllers.delete(message.requestId)
    return
  }

  if (message.type === 'clear') {
    clearTypescriptResolveCaches()
    post({
      type: 'done',
      requestId: message.requestId,
      result: { files: [] },
    })
    return
  }

  if (message.type !== 'resolve') return

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
