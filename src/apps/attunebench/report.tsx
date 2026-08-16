/** AttuneBench 报告渲染：聚合对话得分并展示 */

import type { ConversationData, ConversationScore, EMRunOutput } from './types.ts'
import { aggregateConversations, computeZScores, scoreConversation } from './scorer.ts'
import { MODE_LABELS, type EvalMode } from './constants.ts'
import { modelDisplayName } from './client.ts'

export function computeReportScores(
  conversations: ConversationData[],
  outputs: EMRunOutput[],
): ConversationScore[] {
  const byId = new Map(conversations.map((c) => [c.conversationId, c]))
  const scores: ConversationScore[] = []
  for (const output of outputs) {
    const conversation = byId.get(output.conversationId)
    if (!conversation) continue
    try {
      scores.push(scoreConversation(conversation, output))
    } catch {
      // 跳过无法评分的条目
    }
  }
  return scores
}

function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return (value * 100).toFixed(1).replace(/\.0$/, '')
}

function formatAscore(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return (value * 100).toFixed(0)
}

export function AttuneBenchReportView({
  conversations,
  outputs,
  modelRefKey,
  modeHint,
}: {
  conversations: ConversationData[]
  outputs: EMRunOutput[]
  modelRefKey: string
  modeHint?: string
}) {
  const scores = computeReportScores(conversations, outputs)
  if (scores.length === 0) {
    return <p className="attunebench-report__empty">暂无可用结果，请先完成一次评测。</p>
  }

  const aggregated = computeZScores(aggregateConversations(scores))
  const shownModes = modeHint ? [modeHint] : undefined

  const displayRows = aggregated
    .filter((row) => !shownModes || shownModes.includes(row.mode))
    .sort((a, b) => b.composite_score - a.composite_score)

  const modelLabel = modelDisplayName(modelRefKey)

  return (
    <div className="attunebench-report">
      <header className="attunebench-report__header">
        <h2 className="attunebench-report__title">评测报告 · {modelLabel}</h2>
        <span className="attunebench-report__sub">综合情商得分（Composite，0-100）</span>
      </header>

      <table className="attunebench-report__table">
        <thead>
          <tr>
            <th>模式</th>
            <th>对话数</th>
            <th>情绪追踪 (24%)</th>
            <th>评估质量 (49%)</th>
            <th>整体理解 (27%)</th>
            <th>综合得分</th>
            <th>Z 值</th>
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row) => {
            const modeLabel = (MODE_LABELS as Record<string, string>)[row.mode] ?? row.mode
            return (
              <tr key={`${row.em_model}-${row.mode}`}>
                <td>{modeLabel}</td>
                <td>{row.n_conversations}</td>
                <td>{formatScore(row.avg_emotion_f1 || row.turn_level_average)}</td>
                <td>{formatScore((row.avg_binary_om_accuracy + row.avg_binary_human_accuracy) / 2)}</td>
                <td>{formatScore(row.conversation_wide_average)}</td>
                <td className="attunebench-report__score">
                  <strong>{row.composite_score.toFixed(1)}</strong>
                </td>
                <td>{row.z_score?.toFixed(2) ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="attunebench-report__aggregate">
        <div className="attunebench-report__metric">
          <span className="attunebench-report__metric-value">{formatAscore(row0(displayRows).turn_level_average)}</span>
          <span className="attunebench-report__metric-label">轮级平均</span>
        </div>
        <div className="attunebench-report__metric">
          <span className="attunebench-report__metric-value">{formatAscore(row0(displayRows).conversation_wide_average)}</span>
          <span className="attunebench-report__metric-label">对话级平均</span>
        </div>
      </div>

      {displayRows.length > 1 && (
        <p className="attunebench-report__note">
          综合得分基于独立加权：情绪标签追踪（F1 + VA 相似度）占 24%，两两比较与二元判断等评估质量占 49%，PANAS 预测、跨对话问题与四分支理解占 27%。
        </p>
      )}
    </div>
  )
}

function row0(rows: Array<{ turn_level_average: number; conversation_wide_average: number }>): {
  turn_level_average: number
  conversation_wide_average: number
} {
  return rows[0] ?? { turn_level_average: 0, conversation_wide_average: 0 }
}

/** 成本估算（粗略）：每轮约 5 次调用 × 对话轮数 + 对话后 1 次（useJudge 时每轮 +1） */
export function estimateConversationCalls(
  conversation: ConversationData,
  modes: string[],
  useJudge = false,
): number {
  const turns = conversation.turns.length
  const perTurnCalls = 4 + (useJudge ? 1 : 0) // draft + om + (hp binary) + pairwise (+ judge)
  const perConvCalls = perTurnCalls * turns + 1 // post-conversation
  return perConvCalls * modes.length
}

export type CostEstimate = {
  conversations: number
  callsPerConversation: number
  totalCalls: number
}

export function estimateRunCost(
  conversations: ConversationData[],
  modes: string[],
  useJudge = false,
): CostEstimate {
  const callsPerConversation =
    conversations.length > 0
      ? estimateConversationCalls(conversations[0], modes, useJudge)
      : 0
  const totalCalls = callsPerConversation * conversations.length
  return { conversations: conversations.length, callsPerConversation, totalCalls }
}

export type { EvalMode }
