/// <reference lib="webworker" />

import { indexJsonlLinesChunked } from './parse-jsonl-lines.ts'
import type {
  JsonlIndexWorkerRequest,
  JsonlIndexWorkerResponse,
} from './jsonl-index-protocol.ts'

const abortIds = new Set<number>()

function post(message: JsonlIndexWorkerResponse): void {
  self.postMessage(message)
}

self.onmessage = (event: MessageEvent<JsonlIndexWorkerRequest>) => {
  const message = event.data
  if (message.type === 'abort') {
    abortIds.add(message.requestId)
    return
  }

  if (message.type !== 'index') return

  const { requestId, text, progressChars } = message
  abortIds.delete(requestId)

  try {
    const result = indexJsonlLinesChunked(text, {
      progressChars,
      shouldAbort: () => abortIds.has(requestId),
      onProgress: (processedLines, offset) => {
        post({
          type: 'progress',
          requestId,
          processedLines,
          offset,
          totalChars: text.length,
        })
      },
    })

    if (!result || abortIds.has(requestId)) {
      abortIds.delete(requestId)
      post({ type: 'aborted', requestId })
      return
    }

    abortIds.delete(requestId)
    post({ type: 'result', requestId, result })
  } catch (error) {
    abortIds.delete(requestId)
    post({
      type: 'error',
      requestId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
