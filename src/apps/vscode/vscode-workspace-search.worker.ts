/// <reference lib="webworker" />

import { searchVscodeWorkspaceFilesCore } from './vscode-workspace-search-core.ts'
import type {
  VscodeWorkspaceSearchWorkerRequest,
  VscodeWorkspaceSearchWorkerResponse,
} from './vscode-workspace-search-protocol.ts'

const abortControllers = new Map<number, AbortController>()

function post(message: VscodeWorkspaceSearchWorkerResponse): void {
  self.postMessage(message)
}

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

  void searchVscodeWorkspaceFilesCore({
    query: message.query,
    skipPaths: message.skipPaths,
    workspaceFolder: message.workspaceFolder,
    signal: controller.signal,
    onProgress: (hits) => {
      if (controller.signal.aborted) return
      post({ type: 'progress', requestId: message.requestId, hits })
    },
  })
    .then((hits) => {
      if (controller.signal.aborted) return
      post({ type: 'done', requestId: message.requestId, hits })
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
