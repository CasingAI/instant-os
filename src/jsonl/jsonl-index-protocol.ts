import type { JsonlIndexResult } from './parse-jsonl-lines.ts'

export type JsonlIndexWorkerRequest =
  | {
      type: 'index'
      requestId: number
      text: string
      progressChars: number
    }
  | {
      type: 'abort'
      requestId: number
    }

export type JsonlIndexWorkerResponse =
  | {
      type: 'progress'
      requestId: number
      processedLines: number
      offset: number
      totalChars: number
    }
  | {
      type: 'result'
      requestId: number
      result: JsonlIndexResult
    }
  | {
      type: 'aborted'
      requestId: number
    }
  | {
      type: 'error'
      requestId: number
      message: string
    }
