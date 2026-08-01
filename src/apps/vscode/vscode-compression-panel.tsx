import { formatCompactTokenCount } from '../browser/format-token-count.ts'
import { HelpMarkdown } from '../help/help-markdown.tsx'
import type { VscodeAiChatSession } from './vscode-ai-chat-storage.ts'
import {
  compressionKindLabel,
  compressionTriggerLabel,
  findCompressionDetailInSession,
} from './vscode-compression-lookup.ts'

export type VscodeCompressionPanelProps = {
  sessionId: string
  compressionId: string
  session: VscodeAiChatSession | undefined
  dark?: boolean
}

type FoldedToolRow = {
  name: string
  args: string
  result: string
}

function parseFoldedToolRows(text: string): FoldedToolRow[] {
  const rows: FoldedToolRow[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('- ')) continue
    const body = trimmed.slice(2)
    const arrow = body.lastIndexOf(' → ')
    if (arrow < 0) {
      rows.push({ name: body, args: '', result: '' })
      continue
    }
    const left = body.slice(0, arrow).trim()
    const result = body.slice(arrow + 3).trim()
    const space = left.indexOf(' ')
    if (space < 0) {
      rows.push({ name: left, args: '', result })
    } else {
      rows.push({
        name: left.slice(0, space),
        args: left.slice(space + 1).trim(),
        result,
      })
    }
  }
  return rows
}

function OverviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div class="vscode-compression__overview-row">
      <span class="vscode-compression__overview-label">{label}</span>
      <span class="vscode-compression__overview-value">{value}</span>
    </div>
  )
}

export function VscodeCompressionPanel({
  sessionId,
  compressionId,
  session,
  dark,
}: VscodeCompressionPanelProps) {
  const record = findCompressionDetailInSession(session, compressionId, sessionId)
  const detail = record?.compressionDetail

  if (!record) {
    return (
      <div class={`vscode-compression${dark ? ' vscode-compression--dark' : ''}`}>
        <div class="vscode-compression__empty" role="status">
          详情不可用（旧会话或已裁切）
        </div>
      </div>
    )
  }

  const before = formatCompactTokenCount(record.beforeTokens)
  const after = formatCompactTokenCount(record.afterTokens)
  const covered =
    record.coveredCanonicalFrom !== undefined && record.coveredCanonicalTo !== undefined
      ? `消息 ${record.coveredCanonicalFrom}–${record.coveredCanonicalTo}`
      : '未记录'

  return (
    <div class={`vscode-compression${dark ? ' vscode-compression--dark' : ''}`}>
      <header class="vscode-compression__header">
        <span class="vscode-compression__header-label">压缩详情</span>
        <span class="vscode-compression__header-kind">
          {compressionKindLabel(record.compressionKind)}
        </span>
      </header>

      <div class="vscode-compression__body">
        <section class="vscode-compression__section">
          <h2 class="vscode-compression__section-title">总览</h2>
          <div class="vscode-compression__overview">
            <OverviewRow label="类型" value={compressionKindLabel(record.compressionKind)} />
            <OverviewRow
              label="触发"
              value={compressionTriggerLabel(detail?.trigger)}
            />
            <OverviewRow label="用量" value={`${before} → ${after}`} />
            <OverviewRow label="覆盖" value={covered} />
            {record.detail ? <OverviewRow label="备注" value={record.detail} /> : undefined}
          </div>
        </section>

        {detail?.kind === 'structure_fold' ? (
          <section class="vscode-compression__section">
            <h2 class="vscode-compression__section-title">
              折叠的工具（{detail.toolCallCount}）
            </h2>
            {parseFoldedToolRows(detail.foldedToolsText).length === 0 ? (
              <pre class="vscode-compression__pre">{detail.foldedToolsText}</pre>
            ) : (
              <ul class="vscode-compression__tool-list">
                {parseFoldedToolRows(detail.foldedToolsText).map((row, index) => (
                  <li key={`${row.name}-${index}`} class="vscode-compression__tool-item">
                    <div class="vscode-compression__tool-name">{row.name}</div>
                    {row.args ? (
                      <div class="vscode-compression__tool-args">{row.args}</div>
                    ) : undefined}
                    {row.result ? (
                      <div class="vscode-compression__tool-result">{row.result}</div>
                    ) : undefined}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : undefined}

        {detail?.kind === 'reasoning_prune' ? (
          <section class="vscode-compression__section">
            <h2 class="vscode-compression__section-title">思维链修剪</h2>
            <p class="vscode-compression__muted">
              已删除 {detail.prunedAssistantCount} 段思维链，约{' '}
              {formatCompactTokenCount(Math.ceil(detail.prunedChars / 2.5))} token（
              {detail.prunedChars.toLocaleString()} 字符）。不保留原文。
            </p>
          </section>
        ) : undefined}

        {detail?.kind === 'tail_window' ? (
          <section class="vscode-compression__section">
            <h2 class="vscode-compression__section-title">省略更早回合</h2>
            <p class="vscode-compression__muted">
              省略了约 {detail.omittedUserCount} 轮用户消息；保留最近{' '}
              {detail.keepRecentTurns} 轮不受影响。细节通常由后续摘要承接。
            </p>
          </section>
        ) : undefined}

        {detail?.kind === 'llm_compact' || detail?.kind === 'self_compact' ? (
          <section class="vscode-compression__section">
            <h2 class="vscode-compression__section-title">摘要</h2>
            {detail.focus ? (
              <p class="vscode-compression__focus">焦点：{detail.focus}</p>
            ) : undefined}
            {detail.note ? (
              <p class="vscode-compression__note" role="status">
                {detail.note}
              </p>
            ) : undefined}
            <div class="vscode-compression__summary">
              <HelpMarkdown text={detail.summary} />
            </div>
          </section>
        ) : undefined}

        {detail?.kind === 'tool_budget' ? (
          <section class="vscode-compression__section">
            <h2 class="vscode-compression__section-title">工具输出</h2>
            <p class="vscode-compression__muted">
              {detail.spilled ? '输出已外置到临时文件。' : '输出已按预算裁剪。'}
            </p>
            {detail.preview ? (
              <pre class="vscode-compression__pre">{detail.preview}</pre>
            ) : undefined}
          </section>
        ) : undefined}

        {!detail ? (
          <section class="vscode-compression__section">
            <p class="vscode-compression__muted">
              {record.summaryPreview || '无结构化详情（旧数据）。'}
            </p>
          </section>
        ) : undefined}
      </div>
    </div>
  )
}
