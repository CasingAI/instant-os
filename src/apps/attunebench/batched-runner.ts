/** AttuneBench 批量调度器：多对话×多模式并发执行 + 断点续跑 */

import { runConversation } from './runner.ts'
import {
  listPendingCells,
  recordSkippedCell,
  saveCompletedCell,
  updateRunStatus,
  type AttuneBenchCellKey,
} from './storage.ts'
import type { ConversationData } from './types.ts'

export type BatchRunHooks = {
  onCellStart?: (cell: AttuneBenchCellKey, index: number, total: number) => void
  onCellDone?: (cell: AttuneBenchCellKey, index: number, total: number) => void
  onCellError?: (cell: AttuneBenchCellKey, error: string, index: number, total: number) => void
  /** 返回 false 表示用户要求停止（中断），不再启动新的单元 */
  shouldContinue?: () => boolean
}

export type BatchRunOptions = {
  runId: string
  conversations: ConversationData[]
  config: {
    modelRefKey: string
    modes: string[]
    judgeModelRefKey: string | null
    maxTokens?: number
    /** 并发上限，默认 2 */
    concurrency?: number
  }
  hooks?: BatchRunHooks
  signal?: AbortSignal
}

/** 并发池辅助：限制同时执行的 promise 数量 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  shouldContinue?: () => boolean,
): Promise<Array<{ ok: boolean; error?: string }>> {
  const results: Array<{ ok: boolean; error?: string }> = []
  let nextIndex = 0

  async function runWorker() {
    while (nextIndex < items.length) {
      if (shouldContinue && !shouldContinue()) return
      const index = nextIndex
      nextIndex += 1
      try {
        await worker(items[index], index)
        results[index] = { ok: true }
      } catch (error) {
        results[index] = { ok: false, error: error instanceof Error ? error.message : String(error) }
        // 失败不退出当前 worker：继续领取下一个单元（与官方 run_all 一致）
      }
    }
  }

  const workers: Promise<void>[] = []
  const n = Math.max(1, Math.min(concurrency, items.length))
  for (let w = 0; w < n; w += 1) {
    workers.push(runWorker())
  }
  await Promise.all(workers)
  return results
}

/**
 * 执行一次批量评测。
 * - 依据 storage 跳过已完成单元（断点续跑）
 * - 并发执行 pending 单元
 * - 每个单元完成立即写回 storage
 */
export async function runBatch(options: BatchRunOptions): Promise<void> {
  const { runId, conversations, config, hooks, signal } = options
  const concurrency = config.concurrency ?? 2
  const convById = new Map(conversations.map((c) => [c.conversationId, c]))

  const { pending, completed } = listPendingCells(runId)
  const alreadyDone = completed.length
  const total = pending.length + alreadyDone

  updateRunStatus(runId, 'running')

  const baseIndex = alreadyDone

  await mapWithConcurrency(
    pending,
    concurrency,
    async (cell, localIndex) => {
      if (signal?.aborted) return
      const index = baseIndex + localIndex
      hooks?.onCellStart?.(cell, index, total)

      const conversation = convById.get(cell.conversationId)
      if (!conversation) {
        recordSkippedCell(runId, cell, '对话数据缺失')
        hooks?.onCellError?.(cell, '对话数据缺失', index, total)
        return
      }

      try {
        const output = await runConversation(conversation, {
          modelRefKey: config.modelRefKey,
          mode: cell.mode,
          maxTokens: config.maxTokens,
          judgeModelRefKey: config.judgeModelRefKey,
          signal,
        })
        await saveCompletedCell(runId, cell, output)
        hooks?.onCellDone?.(cell, index, total)
      } catch (error) {
        if (signal?.aborted) {
          // 中断属于正常停止，不记为失败
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        recordSkippedCell(runId, cell, message)
        hooks?.onCellError?.(cell, message, index, total)
      }
    },
    hooks?.shouldContinue,
  )

  // 全部结束后检查是否仍有未完成（可能因中断）；
  // pending 为空即 completed（skipped 不影响状态，失败数由报告区展示）
  const remaining = listPendingCells(runId).pending.length
  if (remaining > 0) {
    updateRunStatus(runId, 'paused')
  } else {
    updateRunStatus(runId, 'completed')
  }
}
