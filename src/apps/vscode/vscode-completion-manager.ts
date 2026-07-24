import { isStreamAbortError } from '../../ai/stream-abort.ts'
import {
  completeVscodeCode,
  type VscodeCompletionRequest,
  type VscodeCompletionResult,
} from './vscode-completion-service.ts'

export type VscodeCompletionContext = {
  beforeCursor: string
  afterCursor: string
  language: string
  filePath: string
  readOnly?: boolean
  modelKey?: string | undefined
}

export type VscodeCompletionManagerOptions = {
  debounceMs?: number
  onLoadingChange?: (loading: boolean) => void
}

type CacheEntry = {
  key: string
  text: string
}

function cacheKeyFor(context: VscodeCompletionContext): string {
  // 用光标前后局部内容 + 路径做缓存键，避免整文件过长
  const beforeTail = context.beforeCursor.slice(-800)
  const afterHead = context.afterCursor.slice(0, 200)
  return `${context.filePath}\0${context.language}\0${beforeTail}\0${afterHead}`
}

export class VscodeCompletionManager {
  private debounceMs: number
  private onLoadingChange?: (loading: boolean) => void
  private abortController: AbortController | undefined
  private debounceTimer: ReturnType<typeof setTimeout> | undefined
  private cache: CacheEntry | undefined
  private loading = false
  private requestSeq = 0

  constructor(options: VscodeCompletionManagerOptions = {}) {
    this.debounceMs = options.debounceMs ?? 400
    this.onLoadingChange = options.onLoadingChange
  }

  setDebounceMs(ms: number): void {
    if (!Number.isFinite(ms)) return
    this.debounceMs = Math.min(2000, Math.max(100, Math.round(ms)))
  }

  setOnLoadingChange(callback: ((loading: boolean) => void) | undefined): void {
    this.onLoadingChange = callback
  }

  isLoading(): boolean {
    return this.loading
  }

  cancel(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = undefined
    }
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = undefined
    }
    this.setLoading(false)
  }

  dispose(): void {
    this.cancel()
    this.cache = undefined
    this.onLoadingChange = undefined
  }

  async requestCompletion(
    context: VscodeCompletionContext,
  ): Promise<VscodeCompletionResult> {
    if (context.readOnly) {
      this.cancel()
      return { text: '' }
    }
    if (!/\S/.test(context.beforeCursor)) {
      this.cancel()
      return { text: '' }
    }

    const key = cacheKeyFor(context)
    if (this.cache && this.cache.key === key) {
      return { text: this.cache.text }
    }

    this.cancel()
    const seq = ++this.requestSeq
    const controller = new AbortController()
    this.abortController = controller

    const debounceMs = this.debounceMs
    try {
      await new Promise<void>((resolve, reject) => {
        this.debounceTimer = setTimeout(() => {
          this.debounceTimer = undefined
          resolve()
        }, debounceMs)
        const onAbort = () => {
          if (this.debounceTimer !== undefined) {
            clearTimeout(this.debounceTimer)
            this.debounceTimer = undefined
          }
          reject(new DOMException('Aborted', 'AbortError'))
        }
        if (controller.signal.aborted) {
          onAbort()
          return
        }
        controller.signal.addEventListener('abort', onAbort, { once: true })
      })
    } catch (error) {
      if (isStreamAbortError(error, controller.signal)) {
        return { text: '' }
      }
      throw error
    }

    if (seq !== this.requestSeq || controller.signal.aborted) {
      return { text: '' }
    }

    this.setLoading(true)

    const request: VscodeCompletionRequest = {
      beforeCursor: context.beforeCursor,
      afterCursor: context.afterCursor,
      language: context.language,
      filePath: context.filePath,
      modelKey: context.modelKey,
      signal: controller.signal,
      onFirstToken: () => {
        if (seq === this.requestSeq) {
          this.setLoading(false)
        }
      },
    }

    try {
      const result = await completeVscodeCode(request)
      if (seq !== this.requestSeq || controller.signal.aborted) {
        return { text: '' }
      }
      if (result.text) {
        this.cache = { key, text: result.text }
      }
      return result
    } finally {
      if (seq === this.requestSeq) {
        this.setLoading(false)
        if (this.abortController === controller) {
          this.abortController = undefined
        }
      }
    }
  }

  private setLoading(next: boolean): void {
    if (this.loading === next) return
    this.loading = next
    this.onLoadingChange?.(next)
  }
}
