/**
 * iCode 对话气泡（第三期改版）：
 * - 对话区从「内联渲染 SEARCH/REPLACE 补丁块」改为活动时间线（工具调用卡片），
 *   沿用 vscode AI 面的既有组件形态（InvestigationPanel / LiveTimeline）。
 * - 旧聊天记录里已存的 SEARCH/REPLACE 文本作为历史原文只读保留，不再解析执行。
 */
import { useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { ForwardIcon } from '../../icons/app-icons.tsx'
import {
  InvestigationPanel,
  LiveTimeline,
} from '../vscode/vscode-ai-chat-surface.tsx'
import type { VscodeAiAgentProgress } from '../vscode/vscode-ai-agent.ts'
import { IcodeChatMarkdown } from './icode-chat-markdown.tsx'
import type { ICodeChatMessage } from './icode-types.ts'

function previewSnippet(text: string, maxLines = 5): string {
  const trimmed = text.trim()
  if (!trimmed) {
    return '（空）'
  }

  const lines = trimmed.split('\n')
  if (lines.length <= maxLines) {
    return trimmed
  }

  return `${lines.slice(0, maxLines).join('\n')}\n…（共 ${lines.length} 行）`
}

type IcodeChatFoldProps = {
  title: string
  expanded: boolean
  onToggle: () => void
  children: ComponentChildren
}

function IcodeChatFold({ title, expanded, onToggle, children }: IcodeChatFoldProps) {
  return (
    <div class={`icode__chat-fold${expanded ? ' icode__chat-fold--expanded' : ''}`}>
      <button type="button" class="icode__chat-fold-trigger" onClick={onToggle}>
        <span
          class={`icode__chat-fold-icon${expanded ? ' icode__chat-fold-icon--expanded' : ''}`}
          aria-hidden="true"
        >
          <ForwardIcon size={11} />
        </span>
        <span class="icode__chat-fold-title">{title}</span>
      </button>
      {expanded && <div class="icode__chat-fold-body">{children}</div>}
    </div>
  )
}

function IcodeChatUserMessage({ message }: { message: ICodeChatMessage }) {
  return (
    <div class="icode__chat-item icode__chat-item--user">
      <div class="icode__chat-bubble icode__chat-bubble--user">{message.content}</div>
    </div>
  )
}

const LEGACY_CAPABILITY_LABELS: Record<string, string> = {
  '3d': '3D 能力',
  ai: '运行时 AI 能力',
  files: '文件访问能力',
  terminal: '终端能力',
}

/** 旧引擎消息：补丁块与能力请求卡片按历史原文只读展示，不再解析执行 */
function IcodeChatLegacyAssistantMessage({ message }: { message: ICodeChatMessage }) {
  const [editsExpanded, setEditsExpanded] = useState(false)
  const [reasoningExpanded, setReasoningExpanded] = useState(false)

  return (
    <div class="icode__chat-item icode__chat-item--assistant">
      <div class="icode__chat-bubble icode__chat-bubble--assistant">
        {message.content ? (
          <IcodeChatMarkdown text={message.content} />
        ) : (
          <p class="icode__chat-legacy-note">（历史消息，无文字回复）</p>
        )}
        {message.reasoningText && (
          <IcodeChatFold
            title={`思考过程 · ${message.reasoningText.length.toLocaleString('zh-CN')} 字符`}
            expanded={reasoningExpanded}
            onToggle={() => setReasoningExpanded((value) => !value)}
          >
            <pre class="icode__chat-pre">{message.reasoningText}</pre>
          </IcodeChatFold>
        )}
        {message.edits && message.edits.length > 0 && (
          <IcodeChatFold
            title={`历史修改记录（旧格式存档）· ${message.edits.length} 块`}
            expanded={editsExpanded}
            onToggle={() => setEditsExpanded((value) => !value)}
          >
            {message.edits.map((edit, index) => (
              <div key={index} class="icode__chat-legacy-edit">
                <p class="icode__chat-legacy-edit-label">修改 {index + 1}</p>
                <pre class="icode__chat-pre">{previewSnippet(edit.search)}</pre>
                <p class="icode__chat-legacy-edit-label">替换为</p>
                <pre class="icode__chat-pre">{previewSnippet(edit.replace)}</pre>
              </div>
            ))}
          </IcodeChatFold>
        )}
        {message.capabilityRequests && message.capabilityRequests.length > 0 && (
          <div class="icode__chat-capability-list icode__chat-capability-list--legacy">
            {message.capabilityRequests.map((request, index) => (
              <div
                key={index}
                class={`icode__capability-card icode__capability-card--${request.status}`}
              >
                <p class="icode__capability-title">
                  {LEGACY_CAPABILITY_LABELS[request.tag] ?? request.tag}
                  <span class="icode__capability-status">
                    {request.status === 'granted'
                      ? ' · 已授予'
                      : request.status === 'dismissed'
                        ? ' · 已忽略'
                        : ' · 未处理'}
                  </span>
                </p>
                {request.reason && <p class="icode__capability-reason">{request.reason}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function IcodeChatAssistantMessage({ message }: { message: ICodeChatMessage }) {
  if (message.investigation) {
    return (
      <div class="icode__chat-item icode__chat-item--assistant">
        <div class="icode__chat-bubble icode__chat-bubble--assistant">
          <InvestigationPanel investigation={message.investigation} />
          {message.content ? (
            <IcodeChatMarkdown text={message.content} />
          ) : message.stopped ? (
            <p class="icode__chat-legacy-note">（已停止）</p>
          ) : null}
        </div>
      </div>
    )
  }
  return <IcodeChatLegacyAssistantMessage message={message} />
}

/** 进行中的一轮：活动时间线 + 流式文本 */
export function IcodeChatLiveTurn({
  progress,
  statusLabel,
}: {
  progress: VscodeAiAgentProgress | undefined
  statusLabel: string
}) {
  return (
    <div class="icode__chat-item icode__chat-item--assistant">
      <div class="icode__chat-bubble icode__chat-bubble--assistant">
        {progress ? (
          <LiveTimeline items={progress.timeline} />
        ) : (
          <p class="icode__chat-legacy-note">{statusLabel}</p>
        )}
      </div>
    </div>
  )
}

export function IcodeChatMessageView({ message }: { message: ICodeChatMessage }) {
  if (message.role === 'user') {
    return <IcodeChatUserMessage message={message} />
  }
  return <IcodeChatAssistantMessage message={message} />
}
