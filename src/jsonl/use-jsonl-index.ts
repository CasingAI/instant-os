import { useEffect, useRef, useState } from 'preact/hooks'
import {
  EMPTY_JSONL_INDEX,
  indexJsonlLines,
  type JsonlIndexResult,
} from './parse-jsonl-lines.ts'
import type {
  JsonlIndexWorkerRequest,
  JsonlIndexWorkerResponse,
} from './jsonl-index-protocol.ts'
import { JSONL_INDEX_PROGRESS_CHARS, JSONL_INDEX_WORKER_BYTES } from './jsonl-perf.ts'
import JsonlIndexWorker from './jsonl-index.worker.ts?worker'

export type UseJsonlIndexState = JsonlIndexResult & {
  indexing: boolean
  /** 已处理非空行数（进度展示用） */
  progressLines: number
}

let sharedWorker: Worker | undefined
let nextRequestId = 1

function getWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new JsonlIndexWorker()
  }
  return sharedWorker
}

function indexOnMain(text: string): UseJsonlIndexState {
  const result = indexJsonlLines(text)
  return { ...result, indexing: false, progressLines: result.entries.length }
}

/**
 * 小文件主线程同步索引；大文件走 Dedicated Worker，可取消旧请求。
 */
export function useJsonlIndex(text: string): UseJsonlIndexState {
  const [state, setState] = useState<UseJsonlIndexState>(() =>
    text.length < JSONL_INDEX_WORKER_BYTES ? indexOnMain(text) : { ...EMPTY_JSONL_INDEX, indexing: true, progressLines: 0 },
  )
  const textRef = useRef(text)
  textRef.current = text

  useEffect(() => {
    if (text.length < JSONL_INDEX_WORKER_BYTES) {
      setState(indexOnMain(text))
      return
    }

    const requestId = nextRequestId
    nextRequestId += 1
    let settled = false

    setState({ ...EMPTY_JSONL_INDEX, indexing: true, progressLines: 0 })

    let worker: Worker
    try {
      worker = getWorker()
    } catch {
      // Worker 不可用时回退主线程（仍可能卡，但功能可用）
      setState(indexOnMain(text))
      return
    }

    const onMessage = (event: MessageEvent<JsonlIndexWorkerResponse>) => {
      const message = event.data
      if (message.requestId !== requestId) return

      if (message.type === 'progress') {
        setState((prev) =>
          prev.indexing
            ? { ...prev, progressLines: message.processedLines }
            : prev,
        )
        return
      }

      settled = true
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)

      if (message.type === 'result') {
        setState({ ...message.result, indexing: false, progressLines: message.result.entries.length })
        return
      }

      if (message.type === 'error') {
        // 失败回退主线程
        if (textRef.current === text) setState(indexOnMain(text))
        return
      }

      // aborted：新请求会覆盖状态，此处忽略
    }

    const onError = () => {
      if (settled) return
      settled = true
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      if (textRef.current === text) setState(indexOnMain(text))
    }

    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)

    const payload: JsonlIndexWorkerRequest = {
      type: 'index',
      requestId,
      text,
      progressChars: JSONL_INDEX_PROGRESS_CHARS,
    }
    worker.postMessage(payload)

    return () => {
      if (settled) return
      settled = true
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      worker.postMessage({ type: 'abort', requestId } satisfies JsonlIndexWorkerRequest)
    }
  }, [text])

  return state
}
