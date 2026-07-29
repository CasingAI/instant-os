import type { AiTokenizerFamily } from './ai-providers.ts'

export type ModelTokenizerFamily = AiTokenizerFamily

export type ModelTokenizerWorkerRequest =
  | {
      type: 'load'
      requestId: number
      family: ModelTokenizerFamily
    }
  | {
      type: 'count'
      requestId: number
      family: ModelTokenizerFamily
      texts: string[]
    }
  | {
      type: 'abort'
      requestId: number
    }

export type ModelTokenizerWorkerResponse =
  | {
      type: 'ready'
      requestId: number
      family: ModelTokenizerFamily
      ok: boolean
    }
  | {
      type: 'counts'
      requestId: number
      family: ModelTokenizerFamily
      counts: number[]
    }
  | {
      type: 'error'
      requestId: number
      message: string
    }
