import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { RefObject, VNode } from 'preact'
import type OpenAI from 'openai'
import {
  formatHumanDurationMs,
  formatThinkingDurationMs,
} from '../../ai/format-human-duration.ts'
import { useSpeechDictation } from '../../ai/use-speech-dictation.ts'
import { isStreamAbortError } from '../../ai/stream-abort.ts'
import { playSystemSound } from '../../os/system-sounds.ts'
import { buildLiveAnswerClassName, HelpMarkdown } from '../help/help-markdown.tsx'
import { SettingsChoiceField } from '../../ui/settings-choice-field.tsx'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import { SubagentIcon, VscodeIcon, ForwardIcon, PlusIcon } from '../../icons/app-icons.tsx'
import type { MonacoProblem } from '../../monaco/monaco-markers.ts'
import type {
  VscodeAgentTerminalEnsureResult,
  VscodeAiLastChangeSource,
} from './vscode-ai-run-command.ts'
import type { TerminalChangeSet } from '../../terminal/terminal-changeset.ts'
import type { TerminalReplHandle } from '../terminal/terminal-repl-panel.tsx'
import type {
  VscodeAgentTerminalSnapshot,
  VscodeAiTerminalKind,
} from './vscode-terminal-sessions.ts'
import {
  isVscodeAiMode,
  normalizeVscodeAiMode,
  VSCODE_AI_MODE_LABELS,
  type VscodeAiMode,
} from './vscode-ai-mode.ts'
import type { VscodeAiContextInput } from './vscode-ai-context.ts'
import { rememberLiveCompressionDetail } from './vscode-compression-lookup.ts'
import {
  askVscodeAiAgent,
  buildVscodeAiInvestigationFromTimeline,
  formatVscodeAiWriteCardHeading,
  type VscodeAiActivity,
  type VscodeAiInvestigation,
  type VscodeAiInvestigationStep,
  type VscodeAiTimelineItem,
  type VscodeAiWriteItem,
} from './vscode-ai-agent.ts'
import {
  sliceApiTranscriptBeforeUserOrdinal,
  stripLeadingSystemMessages,
} from './vscode-ai-transcript.ts'
import type { VscodeAiToolsHost } from './vscode-ai-tools.ts'
import {
  collectPathsFromChangeSets,
  collectTurnChangeSessionsFromHost,
  revertVscodeAiChangeSessions,
  type VscodeAiRunCommandHost,
} from './vscode-ai-run-command.ts'
import {
  VscodeAiPendingChangesPanel,
} from './vscode-ai-change-review.tsx'
import {
  createVscodeAiChatMessage,
  type VscodeAiChatMessage,
  type VscodeAiReviewStatus,
} from './vscode-ai-chat-storage.ts'
import {
  attachmentFromVfsPath,
  VSCODE_AI_IMAGE_ACCEPT_EXTENSIONS,
  VSCODE_AI_NO_VISION_ATTACH_ERROR,
  vscodeAiCanAttachImages,
  writeVscodeAiPastedImage,
  type VscodeAiImageAttachment,
} from './vscode-ai-attachments.ts'
import { VscodeAiAttachmentImages } from './vscode-ai-attachment-images.tsx'
import { useSystemOpenDialog } from '../../window/system-open-dialog.tsx'
import { filesReadText, filesWatch } from '../files/files-api.ts'
import {
  isVscodePlanWriteToolName,
  parsePlanTodoProgress,
  resolvePlanPathFromWriteTool,
} from './vscode-ai-plan.ts'
import { VscodeMarkdownPreview } from './vscode-markdown-preview.tsx'
import {
  buildVscodeAiSystemReminder,
  collectVscodeAiReminderEvents,
  type VscodeAiLastSentTerminal,
} from './vscode-ai-system-reminder.ts'
import { VscodeAiModelPicker } from './vscode-ai-model-picker.tsx'
import type { FlatEnabledModel } from '../../ai/ai-providers.ts'
import {
  decodeVscodeModelPickerValue,
  encodeVscodeModelPickerValue,
  openAiConfigForVscodeAiModelKey,
  parseVscodeAiModelRefKey,
  resolveVscodeAiModelKey,
  tokenizerFamilyForVscodeAiModelKey,
  useVscodeAiCapabilityTags,
  useVscodeAiTextModels,
  type VscodeAiCapabilityTags,
} from './vscode-ai-models.ts'
import type {
  VscodeAiModelOptionPrefs,
  VscodeCustomSubAgent,
  VscodeModelSource,
  VscodePrefs,
} from './vscode-prefs.ts'
import { buildVscodeSubAgentHostConfig } from './vscode-subagent-config.ts'
import {
  measureVscodeAiContextUsage,
  prepareVscodeAiContextUsage,
  type VscodeAiContextUsage,
} from './vscode-ai-context-usage.ts'
import { VscodeAiContextUsageView } from './vscode-ai-context-usage-view.tsx'
import { osNowMs } from '../../os/os-clock.ts'
import '../help/help.css'
import './vscode-ai.css'

const CONTEXT_USAGE_DEBOUNCE_MS = 280
/** Agent 进行中把 incomplete 助手消息节流写入 IndexedDB，崩溃刷新后可恢复工具轨迹 */
const TURN_CHECKPOINT_INTERVAL_MS = 2_000

const VSCODE_AI_MODAL_THEME = '#2f87e2'

const SAMPLE_PROMPTS = [
  '这个项目结构是怎样的？',
  '解释当前打开的文件',
  '帮我修一下 Problems 里的错误',
  '在工作区里搜索某个符号',
] as const

const VSCODE_AI_MODE_OPTIONS = (['ask', 'plan', 'agent'] as const).map((item) => ({
  id: item as string,
  label: VSCODE_AI_MODE_LABELS[item],
}))

const INVESTIGATION_STEP_STAGGER_MS = 55
const INVESTIGATION_STEP_ANIM_MS = 320
const INVESTIGATION_COLLAPSE_MS = 280
const COMPOSER_INPUT_MAX_LINES = 5
/** 离底部不超过该距离视为「贴底」，继续自动跟滚 */
const STICK_TO_BOTTOM_THRESHOLD_PX = 64

function resolveMessageSendSettings(
  message: VscodeAiChatMessage,
  fallback: {
    mode: VscodeAiMode
    source: VscodeModelSource
    key: string | undefined
  },
): { mode: VscodeAiMode; source: VscodeModelSource; key: string | undefined } {
  const mode = normalizeVscodeAiMode(message.sentMode ?? fallback.mode)
  const source = message.sentModelSource ?? fallback.source
  const key =
    message.sentModelSource !== undefined
      ? source === 'custom'
        ? message.sentModelKey
        : undefined
      : source === 'custom'
        ? fallback.key
        : undefined
  return { mode, source, key }
}

type SendOptions = {
  replaceFromUserId?: string
  sendMode?: VscodeAiMode
  sendModelSource?: VscodeModelSource
  sendModelKey?: string | undefined
  attachments?: readonly VscodeAiImageAttachment[]
  /** 「用 Agent 实施」：关联带 plan 的 assistant 消息 id */
  implementsPlanMessageId?: string
}

/** 取 Markdown 第一个一级标题（`# Title`，忽略 ##） */
function extractMarkdownH1(markdown: string): string | undefined {
  const match = /(?:^|\n)[ \t]*#[ \t]+([^\n#][^\n]*)/.exec(markdown)
  const title = match?.[1]?.trim().replace(/[ \t]+#*[ \t]*$/, '').trim()
  return title || undefined
}

function extractPlanMetaFromTimeline(
  timeline: readonly VscodeAiTimelineItem[],
): { planPath?: string; planTitle?: string } {
  let planPath: string | undefined
  let planTitle: string | undefined
  for (const item of timeline) {
    if (item.kind !== 'write' || !item.done) continue
    if (!isVscodePlanWriteToolName(item.toolName)) continue
    const path = resolvePlanPathFromWriteTool(item.toolName, {
      result: item.result,
      title: item.title,
    })
    if (path) planPath = path
    const h1 = extractMarkdownH1(item.preview)
    if (h1) planTitle = h1
  }
  return { planPath, planTitle }
}

function resolveMessagePlanMeta(
  message: VscodeAiChatMessage,
): { planPath?: string; planTitle?: string } {
  const storedPath = message.planPath?.trim()
  const storedTitle = message.planTitle?.trim()
  if (storedPath) {
    if (storedTitle) return { planPath: storedPath, planTitle: storedTitle }
    if (message.investigation) {
      const fromTimeline = extractPlanMetaFromTimeline(message.investigation.timeline)
      return {
        planPath: storedPath,
        planTitle: fromTimeline.planTitle,
      }
    }
    return { planPath: storedPath }
  }
  if (!message.investigation) return {}
  return extractPlanMetaFromTimeline(message.investigation.timeline)
}

function planFileLabel(planPath: string): string {
  const parts = planPath.split('/').filter(Boolean)
  return parts[parts.length - 1] || '计划已就绪'
}

function planMetaExtras(meta: {
  planPath?: string
  planTitle?: string
}): { planPath?: string; planTitle?: string } {
  if (!meta.planPath) return {}
  return {
    planPath: meta.planPath,
    ...(meta.planTitle ? { planTitle: meta.planTitle } : {}),
  }
}

/** 其后是否存在指向该 assistant 的「用 Agent 实施」user 消息（含发送队列） */
function isPlanImplemented(
  messages: readonly VscodeAiChatMessage[],
  assistantMessageId: string,
  queued?: readonly { implementsPlanMessageId?: string }[],
): boolean {
  for (const message of messages) {
    if (
      message.role === 'user' &&
      message.implementsPlanMessageId === assistantMessageId
    ) {
      return true
    }
  }
  if (queued) {
    for (const item of queued) {
      if (item.implementsPlanMessageId === assistantMessageId) return true
    }
  }
  return false
}

function syncComposerTextareaHeight(
  el: HTMLTextAreaElement,
  maxLines: number,
  previousHeightRef?: { current: number | undefined },
): void {
  const styles = getComputedStyle(el)
  const lineHeight = Number.parseFloat(styles.lineHeight) || 18
  const paddingY =
    (Number.parseFloat(styles.paddingTop) || 0) + (Number.parseFloat(styles.paddingBottom) || 0)
  const minHeight = lineHeight + paddingY
  const maxHeight = lineHeight * maxLines + paddingY
  const previousHeight = previousHeightRef?.current ?? Math.max(el.offsetHeight, minHeight)

  el.style.transition = 'none'
  el.style.minHeight = '0'
  el.style.height = '0px'
  const contentHeight = el.scrollHeight
  const nextHeight = Math.min(Math.max(contentHeight, minHeight), maxHeight)
  el.style.minHeight = ''
  el.style.height = `${previousHeight}px`
  void el.offsetHeight
  el.style.transition = ''
  el.style.height = `${nextHeight}px`
  el.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden'
  if (previousHeightRef) {
    previousHeightRef.current = nextHeight
  }
}

type UserBubbleMorphFrom = {
  messageId: string
  width: number
  height: number
}

type QueuedSend = {
  id: string
  text: string
  attachments?: VscodeAiImageAttachment[]
  implementsPlanMessageId?: string
}

function createQueuedSendId(): string {
  return `vscode-ai-q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** 气泡 ↔ 编辑框：按测量尺寸做宽高过渡（useLayoutEffect 内调用，避免首帧闪一下） */
function morphUserBubbleSize(el: HTMLElement, from: UserBubbleMorphFrom): void {
  if (prefersReducedMotion()) return
  const to = el.getBoundingClientRect()
  if (Math.abs(to.width - from.width) < 2 && Math.abs(to.height - from.height) < 2) return
  el.animate(
    [
      {
        width: `${from.width}px`,
        height: `${from.height}px`,
        overflow: 'hidden',
      },
      {
        width: `${to.width}px`,
        height: `${to.height}px`,
        overflow: 'hidden',
      },
    ],
    {
      duration: 280,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    },
  )
}

type VscodeAiComposerBlockProps = {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  inputRef?: RefObject<HTMLTextAreaElement>
  placeholder: string
  inputDisabled?: boolean
  sendDisabled?: boolean
  busy: boolean
  onStop: () => void
  mode: VscodeAiMode
  onModeChange: (mode: VscodeAiMode) => void
  modelPickerValue: string
  onModelPickerChange: (encoded: string) => void
  textModels: FlatEnabledModel[]
  capabilityTags?: VscodeAiCapabilityTags
  aiModelOptions: Record<string, VscodeAiModelOptionPrefs>
  onAiModelOptionsChange: (next: Record<string, VscodeAiModelOptionPrefs>) => void
  contextUsage: VscodeAiContextUsage | undefined
  dark?: boolean
  /** composer=底部输入卡；bubble=用户气泡内编辑（无独立卡片外观） */
  surface?: 'composer' | 'bubble'
  attachments?: readonly VscodeAiImageAttachment[]
  onAttachmentsChange?: (next: VscodeAiImageAttachment[]) => void
  onAttachError?: (message: string) => void
  chatSessionId?: string
}

function dictationWrapPhaseClass(phase: string): string {
  if (phase === 'arming' || phase === 'recording') {
    return 'vscode-ai__composer-input-wrap--recording'
  }
  if (phase === 'recognizing') {
    return 'vscode-ai__composer-input-wrap--recognizing'
  }
  return ''
}

function VscodeAiComposerBlock({
  value,
  onChange,
  onSend,
  inputRef,
  placeholder,
  inputDisabled,
  sendDisabled,
  busy,
  onStop,
  mode,
  onModeChange,
  modelPickerValue,
  onModelPickerChange,
  textModels,
  capabilityTags,
  aiModelOptions,
  onAiModelOptionsChange,
  contextUsage,
  dark,
  surface = 'composer',
  attachments = [],
  onAttachmentsChange,
  onAttachError,
  chatSessionId,
}: VscodeAiComposerBlockProps) {
  const dictation = useSpeechDictation({
    as: 'textarea',
    disabled: inputDisabled,
  })
  const imeComposingRef = useRef(false)
  const imeGuardUntilRef = useRef(0)
  const { showSystemOpenDialog, dialog: openDialog } = useSystemOpenDialog()
  const rootClass = [
    surface === 'bubble'
      ? 'vscode-ai__bubble-edit'
      : 'help-app__composer vscode-ai__composer',
    dictation.isDictating ? 'vscode-ai__composer--dictating' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const inputWrapClass = [
    'vscode-ai__composer-input-wrap',
    dictationWrapPhaseClass(dictation.phase),
  ]
    .filter(Boolean)
    .join(' ')
  const inputClass = [
    surface === 'bubble' ? 'vscode-ai__bubble-edit-input' : 'help-app__input',
    dictation.isDictating ? 'vscode-ai__composer-input--dictating' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const selectClass =
    surface === 'bubble'
      ? 'vscode-ai__bubble-edit-select'
      : 'vscode-ai__footer-select vscode-ai__footer-select--trigger'

  const reportAttachError = (error: unknown) => {
    const message =
      error instanceof Error ? error.message : VSCODE_AI_NO_VISION_ATTACH_ERROR
    onAttachError?.(message)
  }

  const addAttachment = (item: VscodeAiImageAttachment) => {
    if (!onAttachmentsChange) return
    if (attachments.some((existing) => existing.path === item.path)) return
    onAttachmentsChange([...attachments, item])
  }

  const removeAttachment = (id: string) => {
    onAttachmentsChange?.(attachments.filter((item) => item.id !== id))
  }

  const pickVfsImage = async () => {
    if (!onAttachmentsChange) return
    try {
      if (!vscodeAiCanAttachImages()) {
        throw new Error(VSCODE_AI_NO_VISION_ATTACH_ERROR)
      }
      const path = await showSystemOpenDialog({
        title: '附加图片',
        acceptExtensions: [...VSCODE_AI_IMAGE_ACCEPT_EXTENSIONS],
        presentation: 'modal',
      })
      if (!path) return
      addAttachment(attachmentFromVfsPath(path))
    } catch (error) {
      reportAttachError(error)
    }
  }

  const handlePaste = async (event: ClipboardEvent) => {
    const items = event.clipboardData?.items
    if (!items || !onAttachmentsChange) return
    for (const item of Array.from(items)) {
      if (!item.type.startsWith('image/')) continue
      event.preventDefault()
      try {
        if (!vscodeAiCanAttachImages()) {
          throw new Error(VSCODE_AI_NO_VISION_ATTACH_ERROR)
        }
        const file = item.getAsFile()
        if (!file) continue
        const bytes = await file.arrayBuffer()
        const attached = await writeVscodeAiPastedImage({
          chatSessionId: chatSessionId ?? 'anonymous',
          bytes,
          mimeType: file.type || item.type,
          fileName: file.name,
        })
        addAttachment(attached)
      } catch (error) {
        reportAttachError(error)
      }
      return
    }
  }

  const handleDrop = (event: DragEvent) => {
    event.preventDefault()
    if (!onAttachmentsChange) return
    try {
      if (!vscodeAiCanAttachImages()) {
        throw new Error(VSCODE_AI_NO_VISION_ATTACH_ERROR)
      }
      const path =
        event.dataTransfer?.getData('text/plain')?.trim() ||
        event.dataTransfer?.getData('text/uri-list')?.trim()
      if (path?.startsWith('/')) {
        addAttachment(attachmentFromVfsPath(path))
        return
      }
      // 非 VFS 拖入（少见）：落入 /tmp 后再以路径引用
      const file = event.dataTransfer?.files?.[0]
      if (file?.type.startsWith('image/')) {
        void (async () => {
          try {
            const bytes = await file.arrayBuffer()
            const attached = await writeVscodeAiPastedImage({
              chatSessionId: chatSessionId ?? 'anonymous',
              bytes,
              mimeType: file.type,
              fileName: file.name,
            })
            addAttachment(attached)
          } catch (error) {
            reportAttachError(error)
          }
        })()
      }
    } catch (error) {
      reportAttachError(error)
    }
  }

  return (
    <div
      class={rootClass}
      onDragOver={(event) => {
        if (!onAttachmentsChange) return
        event.preventDefault()
      }}
      onDrop={handleDrop}
    >
      {attachments.length > 0 ? (
        <div class="vscode-ai__attach-chips" aria-label="附件图片">
          {attachments.map((item) => (
            <span key={item.id} class="vscode-ai__attach-chip" title={item.path}>
              <span class="vscode-ai__attach-chip-name">{item.name}</span>
              <button
                type="button"
                class="vscode-ai__attach-chip-remove"
                aria-label={`移除 ${item.name}`}
                disabled={inputDisabled}
                onClick={() => removeAttachment(item.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : undefined}
      <div class={inputWrapClass}>
        <textarea
          ref={inputRef}
          class={inputClass}
          rows={1}
          placeholder={placeholder}
          value={value}
          disabled={inputDisabled}
          onInput={(event) => onChange((event.target as HTMLTextAreaElement).value)}
          onPaste={(event) => void handlePaste(event)}
          onKeyDown={(event) => {
            dictation.onKeyDown(event)
            if (dictation.phase !== 'idle') {
              if (event.key === 'Enter') event.preventDefault()
              return
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              // IME 选字确认的 Enter：勿当作发送（部分浏览器 compositionend 会早于该 keydown）
              const composing =
                imeComposingRef.current ||
                event.isComposing ||
                event.keyCode === 229
              if (composing || Date.now() < imeGuardUntilRef.current) return
              event.preventDefault()
              onSend()
            }
          }}
          onKeyUp={dictation.onKeyUp}
          onBlur={dictation.onBlur}
          onCompositionStart={(event) => {
            imeComposingRef.current = true
            dictation.onCompositionStart(event)
          }}
          onCompositionEnd={(event) => {
            imeComposingRef.current = false
            imeGuardUntilRef.current = Math.max(
              imeGuardUntilRef.current,
              Date.now() + 80,
            )
            dictation.onCompositionEnd(event)
          }}
        />
        <span class="vscode-ai__composer-input-wave" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
        <span class="vscode-ai__composer-input-spinner" aria-hidden="true" />
      </div>
      <div
        class={
          surface === 'bubble'
            ? 'vscode-ai__bubble-edit-footer'
            : 'vscode-ai__composer-footer'
        }
      >
        <label class="vscode-ai__footer-field vscode-ai__footer-field--mode">
          <span class="vscode-ai__footer-label">模式</span>
          <SettingsChoiceField
            label="AI 模式"
            value={mode}
            options={VSCODE_AI_MODE_OPTIONS}
            onChange={(next) => {
              if (isVscodeAiMode(next)) onModeChange(next)
            }}
            wideLayout
            dark={dark}
          >
            {({ open, setOpen, triggerRef, displayValue, disabled: triggerDisabled }) => (
              <button
                ref={triggerRef}
                type="button"
                class={`${selectClass}${open ? ' vscode-ai__footer-select--open' : ''}`}
                disabled={triggerDisabled}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label="AI 模式"
                onClick={() => setOpen(!open)}
              >
                {displayValue}
              </button>
            )}
          </SettingsChoiceField>
        </label>
        <label class="vscode-ai__footer-field vscode-ai__footer-field--model">
          <span class="vscode-ai__footer-label">模型</span>
          <VscodeAiModelPicker
            label="模型"
            selectionMode="agent"
            value={modelPickerValue}
            models={textModels}
            onChange={onModelPickerChange}
            aiModelOptions={aiModelOptions}
            onAiModelOptionsChange={onAiModelOptionsChange}
            capabilityTags={capabilityTags}
            disabled={textModels.length === 0}
            dark={dark}
            ariaLabel="模型"
          >
            {({ open, setOpen, triggerRef, displayValue, disabled: triggerDisabled }) => (
              <button
                ref={triggerRef}
                type="button"
                class={`${selectClass}${open ? ' vscode-ai__footer-select--open' : ''}`}
                disabled={triggerDisabled}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label="模型"
                onClick={() => setOpen(!open)}
              >
                {displayValue}
              </button>
            )}
          </VscodeAiModelPicker>
        </label>
        <div class="vscode-ai__composer-footer-trailing">
          {onAttachmentsChange ? (
            <button
              type="button"
              class="vscode-ai__context-usage-trigger"
              aria-label="附加图片"
              title="附加图片"
              disabled={inputDisabled}
              onClick={() => void pickVfsImage()}
            >
              <PlusIcon />
            </button>
          ) : undefined}
          <VscodeAiContextUsageView usage={contextUsage} dark={dark} />
          {busy ? (
            <button
              type="button"
              class="help-app__stop"
              aria-label="停止"
              title="停止"
              onClick={onStop}
            >
              ■
            </button>
          ) : undefined}
          <button
            type="button"
            class={`help-app__send${surface === 'bubble' ? ' vscode-ai__bubble-edit-send' : ''}`}
            aria-label={busy ? '排队发送' : '发送'}
            title={busy ? '当前任务进行中，发送后将排队' : '发送'}
            disabled={sendDisabled}
            onClick={onSend}
          >
            ↑
          </button>
        </div>
      </div>
      {openDialog}
    </div>
  )
}

export type VscodeAiPanelProps = {
  sessionId: string
  messages: VscodeAiChatMessage[]
  onMessagesChange: (
    messages: VscodeAiChatMessage[],
    extras?: {
      apiTranscript?: OpenAI.Chat.ChatCompletionMessageParam[]
      wireTranscript?: OpenAI.Chat.ChatCompletionMessageParam[]
    },
  ) => void
  /** 会话级规范 transcript（打开中的会话）；编辑重发时优先用其截断 */
  apiTranscript?: OpenAI.Chat.ChatCompletionMessageParam[]
  /** 压缩后的线 transcript；下一轮续聊 history 优先用它 */
  wireTranscript?: OpenAI.Chat.ChatCompletionMessageParam[]
  mode: VscodeAiMode
  onModeChange: (mode: VscodeAiMode) => void
  aiModelSource: VscodeModelSource
  aiModelKey: string | undefined
  onAiModelSelectionChange: (source: VscodeModelSource, modelKey: string | undefined) => void
  aiModelOptions: Record<string, VscodeAiModelOptionPrefs>
  onAiModelOptionsChange: (next: Record<string, VscodeAiModelOptionPrefs>) => void
  /** Sub Agent 相关 prefs（全局）；缺省视为关闭 */
  subAgentsEnabled?: boolean
  subAgentsMaxConcurrent?: number
  subAgentBuiltinOverrides?: VscodePrefs['subAgentBuiltinOverrides']
  customSubAgents?: VscodeCustomSubAgent[]
  /** Agent 单轮流空闲超时秒数 */
  aiIdleTimeoutSeconds?: number
  /** Agent 单轮流空闲超时后的额外重试次数（不含首次） */
  aiIdleRetryCount?: number
  /** 任务完成且队列为空时播放系统完成提示音 */
  aiPlayCompletionSound?: boolean
  /** Debug：展示本轮注入的 system-reminder */
  aiDebugSystemReminder?: boolean
  dark?: boolean
  workspaceFolder: string | undefined
  /** 上一轮发送时的终端快照（持久化在 chat session） */
  lastSentTerminal?: VscodeAiLastSentTerminal
  onLastSentTerminalChange?: (value: VscodeAiLastSentTerminal | undefined) => void
  getContext: () => VscodeAiContextInput
  problems: readonly MonacoProblem[]
  /** 按对话取 npm/npx 受控变更槽 */
  getNpmLastChangesSlot: (chatSessionId: string) => {
    current: TerminalChangeSet | undefined
  }
  /** 按对话取最近一次有 fs 改动的来源 */
  getLastChangeSourceSlot: (chatSessionId: string) => {
    current: VscodeAiLastChangeSource | undefined
  }
  onChangesAvailable?: (available: boolean) => void
  ensureAiTerminal: (
    kind: VscodeAiTerminalKind,
    chatSessionId: string,
    chatTitle: string,
    options?: { parentChatId?: string },
  ) => Promise<VscodeAgentTerminalEnsureResult>
  getAiTerminalHandle: (
    kind: VscodeAiTerminalKind,
    chatSessionId: string,
  ) => TerminalReplHandle | undefined
  getAiTerminalSnapshot: (
    kind: VscodeAiTerminalKind,
    chatSessionId: string,
  ) => VscodeAgentTerminalSnapshot
  closeAiTerminal?: (kind: VscodeAiTerminalKind, chatSessionId: string) => void
  /** 编辑重发：拆掉本聊天主终端 + 全部子终端 */
  closeAiTerminalsBoundToChat?: (chatSessionId: string) => void
  openPlanFile: (path: string) => Promise<void>
  /** 本轮 Agent/Ask/Plan 是否在运行，供编辑器 Tab 显示加载指示 */
  onBusyChange?: (busy: boolean) => void
  /** 查看更改时打开文件 */
  onOpenPath?: (path: string) => void
  /** 打开子 Agent 详情 Tab */
  onOpenSubagentDetail?: (runId: string) => void
  /** 打开压缩详情 Tab */
  onOpenCompressionDetail?: (sessionId: string, compressionId: string) => void
  /** 只读模式：隐藏 composer、禁用消息编辑，用于子 Agent 详情 Tab */
  readOnly?: boolean
  /** 只读模式下顶部的信息栏（模型 / 状态等） */
  headerInfo?: {
    agentId: string
    modelLabel: string
    status: string
  }
  /** 外部注入的实时时间线（只读模式下由子 Agent store 驱动，覆盖内部 liveTimeline） */
  externalLiveTimeline?: VscodeAiTimelineItem[]
  /** 外部注入的实时回答文本（只读模式下由子 Agent store 驱动，覆盖内部 liveAnswer） */
  externalLiveAnswer?: string
  /** 外部注入的上下文占用（只读详情 Footer） */
  externalContextUsage?: VscodeAiContextUsage
  /** 外部注入的工具调用次数（只读详情 Footer） */
  externalToolCallCount?: number
}

function formatError(err: unknown): string {
  if (isStreamAbortError(err)) return '已停止生成'
  if (err instanceof Error) return err.message
  return String(err)
}

function formatInvestigationSummary(investigation: VscodeAiInvestigation): string {
  const parts = ['已完成调查']
  if (
    investigation.reasoningDurationMs !== undefined &&
    investigation.reasoningDurationMs >= 5000
  ) {
    parts.push(formatThinkingDurationMs(investigation.reasoningDurationMs))
  }
  parts.push(
    investigation.toolCallCount > 0
      ? `调用 ${investigation.toolCallCount} 个工具`
      : '未调用工具',
  )
  parts.push(`用时 ${formatHumanDurationMs(investigation.durationMs)}`)
  return parts.join(' · ')
}

function WaitingDots() {
  return (
    <span class="help-app__waiting-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  )
}

function latestReasoningSnippet(text: string, maxLen = 56): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) {
    return ''
  }
  if (cleaned.length <= maxLen) {
    return cleaned
  }
  return `…${cleaned.slice(-maxLen)}`
}

function WaitingStatus({ label = '等待响应' }: { label?: string }) {
  return (
    <div class="help-app__reasoning-status help-app__reasoning-status--waiting" aria-live="polite">
      <span class="help-app__reasoning-status-label">{label}</span>
    </div>
  )
}

function CompressionStatus({
  item,
  sessionId,
  onOpenCompressionDetail,
}: {
  item: Extract<VscodeAiTimelineItem, { kind: 'compression' }>
  sessionId?: string
  onOpenCompressionDetail?: (sessionId: string, compressionId: string) => void
}) {
  const canOpen = Boolean(sessionId && onOpenCompressionDetail)
  return (
    <button
      type="button"
      class={`help-app__reasoning-status help-app__reasoning-status--done vscode-ai__compression-row${canOpen ? '' : ' vscode-ai__compression-row--disabled'}`}
      aria-label={canOpen ? `查看压缩详情：${item.label}` : item.label}
      disabled={!canOpen}
      onClick={() => {
        if (!canOpen || !sessionId || !onOpenCompressionDetail) return
        rememberLiveCompressionDetail(sessionId, item)
        onOpenCompressionDetail(sessionId, item.id)
      }}
    >
      <span class="help-app__reasoning-summary">{item.label}</span>
      {canOpen ? (
        <span class="vscode-ai__compression-row-arrow" aria-hidden="true">
          →
        </span>
      ) : undefined}
    </button>
  )
}

function WriteFileCard({
  item,
  live,
}: {
  item: VscodeAiWriteItem
  live?: boolean
}) {
  const [expanded, setExpanded] = useState(!item.done)
  const previewScrollRef = useRef<HTMLElement | null>(null)
  const streaming = Boolean(live) && !item.done
  const preview = item.preview.trim()
  const heading = formatVscodeAiWriteCardHeading(item.toolName, item.phase)
  const markdownPreview =
    item.toolName === 'write_plan' || item.toolName === 'update_plan'

  useLayoutEffect(() => {
    if (!streaming || !expanded) return
    const el = previewScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [streaming, expanded, item.preview])

  useEffect(() => {
    if (item.done) setExpanded(false)
  }, [item.done])

  return (
    <div
      class={`vscode-ai__write-card${streaming ? ' vscode-ai__write-card--live' : ''}${item.done ? ' vscode-ai__write-card--done' : ''}`}
      aria-live={streaming ? 'polite' : undefined}
    >
      <button
        type="button"
        class="vscode-ai__write-card-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span
          class={`help-app__investigation-chevron${expanded ? ' help-app__investigation-chevron--expanded' : ''}`}
          aria-hidden="true"
        />
        <span class="vscode-ai__write-card-heading">
          {streaming ? <WaitingDots /> : undefined}
          <span class="vscode-ai__write-card-title">{heading}</span>
          {item.title ? (
            <span class="vscode-ai__write-card-path"> · {item.title}</span>
          ) : undefined}
        </span>
      </button>
      {expanded ? (
        markdownPreview ? (
          <div
            ref={(node) => {
              previewScrollRef.current = node
            }}
            class="vscode-ai__write-card-preview vscode-ai__write-card-preview--md"
          >
            {preview ? (
              <VscodeMarkdownPreview text={preview} />
            ) : (
              <span class="vscode-ai__write-card-preview-empty">
                {streaming ? '…' : '（无预览）'}
              </span>
            )}
          </div>
        ) : (
          <pre
            ref={(node) => {
              previewScrollRef.current = node
            }}
            class="vscode-ai__write-card-preview"
          >
            {preview || (streaming ? '…' : '（无预览）')}
          </pre>
        )
      ) : undefined}
    </div>
  )
}

/** 全宽横幅气泡变体；后续可加 review / tip 等 */
type VscodeAiBannerKind = 'plan' | 'mode-switch'

const MODE_SWITCH_TIMEOUT_MS = 30_000

function PlanReadyBar({
  planPath,
  planTitle,
  onViewPlan,
  onImplement,
  showImplement,
  implemented,
}: {
  planPath: string
  planTitle?: string
  onViewPlan: (path: string) => void
  onImplement?: (path: string) => void
  showImplement?: boolean
  implemented?: boolean
}) {
  const [displayTitle, setDisplayTitle] = useState(
    () => planTitle?.trim() || planFileLabel(planPath),
  )
  const [todoProgress, setTodoProgress] = useState<{ done: number; total: number } | null>(
    null,
  )

  useEffect(() => {
    const known = planTitle?.trim()
    if (known) {
      setDisplayTitle(known)
    }
    let cancelled = false

    const loadPlanFile = () => {
      void filesReadText(planPath)
        .then((text) => {
          if (cancelled) return
          if (!known) {
            setDisplayTitle(extractMarkdownH1(text) || planFileLabel(planPath))
          }
          const progress = parsePlanTodoProgress(text)
          setTodoProgress(progress.total > 0 ? progress : null)
        })
        .catch(() => {
          if (cancelled) return
          if (!known) setDisplayTitle(planFileLabel(planPath))
          setTodoProgress(null)
        })
    }

    loadPlanFile()
    const unwatch = filesWatch(planPath, () => {
      if (!cancelled) loadPlanFile()
    })

    return () => {
      cancelled = true
      unwatch()
    }
  }, [planPath, planTitle])

  const bannerKind: VscodeAiBannerKind = 'plan'

  return (
    <div
      class={`vscode-ai__banner vscode-ai__banner--${bannerKind}`}
      role="status"
    >
      <span class="vscode-ai__banner-label" title={planPath}>
        {displayTitle}
        {todoProgress ? (
          <span class="vscode-ai__banner-progress">
            {' '}
            · 待办 {todoProgress.done}/{todoProgress.total}
          </span>
        ) : undefined}
      </span>
      <div class="vscode-ai__banner-actions">
        <button
          type="button"
          class="vscode-ai__plan-bar-btn"
          onClick={() => onViewPlan(planPath)}
        >
          查看计划
        </button>
        {showImplement && onImplement ? (
          <button
            type="button"
            class="vscode-ai__plan-bar-btn"
            disabled={implemented}
            onClick={() => {
              if (implemented) return
              onImplement(planPath)
            }}
          >
            {implemented ? '已实施' : '用 Agent 实施'}
          </button>
        ) : undefined}
      </div>
    </div>
  )
}

type ModeSwitchPendingUi = {
  target: VscodeAiMode
  from: VscodeAiMode
  explanation?: string
  expiresAt: number
}

function ModeSwitchBar({
  pending,
  onApprove,
  onReject,
}: {
  pending: ModeSwitchPendingUi
  onApprove: () => void
  onReject: () => void
}) {
  const toLabel = VSCODE_AI_MODE_LABELS[pending.target]
  const fromLabel = VSCODE_AI_MODE_LABELS[pending.from]
  const reason = pending.explanation?.trim()
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.ceil((pending.expiresAt - Date.now()) / 1000)),
  )
  const [progress, setProgress] = useState(() =>
    Math.max(0, Math.min(1, (pending.expiresAt - Date.now()) / MODE_SWITCH_TIMEOUT_MS)),
  )

  useEffect(() => {
    let frame = 0
    const tick = () => {
      const remainingMs = pending.expiresAt - Date.now()
      setSecondsLeft(Math.max(0, Math.ceil(remainingMs / 1000)))
      setProgress(Math.max(0, Math.min(1, remainingMs / MODE_SWITCH_TIMEOUT_MS)))
      if (remainingMs > 0) {
        frame = window.requestAnimationFrame(tick)
      }
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [pending.expiresAt])

  const label = `切换到 ${toLabel}`
  const title = reason
    ? `${fromLabel} → ${toLabel}：${reason}`
    : `${fromLabel} → ${toLabel}`

  return (
    <div
      class="vscode-ai__banner vscode-ai__banner--mode-switch"
      role="alertdialog"
      aria-label="切换 AI 模式"
      style={{ ['--mode-switch-progress' as string]: String(progress) }}
    >
      <span class="vscode-ai__banner-label" title={title}>
        {label}
        {reason ? (
          <span class="vscode-ai__banner-progress"> · {reason}</span>
        ) : (
          <span class="vscode-ai__banner-progress">
            {' '}
            · 从 {fromLabel}
          </span>
        )}
        <span class="vscode-ai__banner-progress"> · 剩余 {secondsLeft}s</span>
      </span>
      <div class="vscode-ai__banner-actions">
        <button type="button" class="vscode-ai__plan-bar-btn" onClick={onReject}>
          保持当前
        </button>
        <button
          type="button"
          class="vscode-ai__plan-bar-btn vscode-ai__plan-bar-btn--primary"
          onClick={onApprove}
        >
          {label}
        </button>
      </div>
    </div>
  )
}

function ActivityStatus({
  activity,
  live,
  isCurrent,
  onOpenSubagentDetail,
}: {
  activity: VscodeAiActivity
  live?: boolean
  isCurrent?: boolean
  onOpenSubagentDetail?: (runId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const current = Boolean(live) && Boolean(isCurrent) && !activity.done
  const content = activity.content?.trim() ?? ''
  const result = activity.result?.trim() ?? ''
  const expandable = Boolean(content || result)
  const canOpenDetail = Boolean(activity.subagentRunId && onOpenSubagentDetail)
  const openDetail = () => {
    if (activity.subagentRunId && onOpenSubagentDetail) {
      onOpenSubagentDetail(activity.subagentRunId)
    }
  }
  const summary = (
    <>
      {activity.label}
      {activity.detail ? (
        <span class="help-app__reasoning-summary-detail"> · {activity.detail}</span>
      ) : undefined}
    </>
  )

  if (current) {
    if (canOpenDetail) {
      return (
        <button
          type="button"
          class="help-app__reasoning-status help-app__reasoning-status--waiting vscode-ai__subagent-row"
          aria-live="polite"
          aria-label={`查看 Sub Agent 详情：${activity.detail || activity.label}`}
          onClick={openDetail}
        >
          <WaitingDots />
          <span class="help-app__reasoning-status-label">{summary}</span>
          <span class="vscode-ai__subagent-row-arrow" aria-hidden="true">
            <ForwardIcon size={12} />
          </span>
        </button>
      )
    }
    return (
      <div
        class="help-app__reasoning-status help-app__reasoning-status--waiting"
        aria-live="polite"
      >
        <WaitingDots />
        <span class="help-app__reasoning-status-label">{summary}</span>
      </div>
    )
  }

  if (canOpenDetail) {
    return (
      <button
        type="button"
        class="help-app__reasoning-status vscode-ai__subagent-row"
        aria-label={`查看 Sub Agent 详情：${activity.detail || activity.label}`}
        onClick={openDetail}
      >
        <span class="help-app__reasoning-status-label">{summary}</span>
        <span class="vscode-ai__subagent-row-arrow" aria-hidden="true">
          <ForwardIcon size={12} />
        </span>
      </button>
    )
  }

  if (!expandable) {
    return (
      <div class="help-app__reasoning-status">
        <span class="help-app__reasoning-status-label">{summary}</span>
      </div>
    )
  }

  return (
    <div
      class={`help-app__reasoning-panel${expanded ? ' help-app__reasoning-panel--expanded' : ''}`}
    >
      <button
        type="button"
        class="help-app__reasoning-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span
          class={`help-app__investigation-chevron${expanded ? ' help-app__investigation-chevron--expanded' : ''}`}
          aria-hidden="true"
        />
        <span class="help-app__reasoning-summary">{summary}</span>
      </button>
      {expanded ? (
        <div class="help-app__reasoning-body help-app__reasoning-body--stack">
          {content ? (
            <pre class="help-app__reasoning-body help-app__reasoning-body--code">{content}</pre>
          ) : undefined}
          {result ? (
            <>
              <div class="help-app__reasoning-result-label">输出</div>
              <pre class="help-app__reasoning-body help-app__reasoning-body--code">{result}</pre>
            </>
          ) : undefined}
        </div>
      ) : undefined}
    </div>
  )
}

function ReasoningStatus({
  text,
  streaming,
  durationMs,
}: {
  text: string
  streaming?: boolean
  durationMs?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const reasoningBody = text.trim()

  if (streaming) {
    if (!reasoningBody) {
      return <WaitingStatus />
    }
    const snippet = latestReasoningSnippet(text)
    return (
      <div class="help-app__reasoning-status help-app__reasoning-status--live" aria-live="polite">
        <WaitingDots />
        <span class="help-app__reasoning-status-label">模型正在思考</span>
        {snippet ? (
          <span class="help-app__reasoning-status-snippet">{snippet}</span>
        ) : undefined}
      </div>
    )
  }

  if (durationMs === undefined) {
    return undefined
  }

  return (
    <div
      class={`help-app__reasoning-panel${expanded ? ' help-app__reasoning-panel--expanded' : ''}`}
    >
      <button
        type="button"
        class="help-app__reasoning-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span
          class={`help-app__investigation-chevron${expanded ? ' help-app__investigation-chevron--expanded' : ''}`}
          aria-hidden="true"
        />
        <span class="help-app__reasoning-summary">
          {formatThinkingDurationMs(durationMs)}
        </span>
      </button>
      {expanded ? (
        <pre class="help-app__reasoning-body">
          {reasoningBody || '（这次没有留下可展示的思考原文）'}
        </pre>
      ) : undefined}
    </div>
  )
}

function InvestigationSteps({
  timeline,
  exiting = false,
  sessionId,
  onOpenSubagentDetail,
  onOpenCompressionDetail,
}: {
  timeline: VscodeAiInvestigationStep[]
  exiting?: boolean
  sessionId?: string
  onOpenSubagentDetail?: (runId: string) => void
  onOpenCompressionDetail?: (sessionId: string, compressionId: string) => void
}) {
  if (timeline.length === 0) {
    return undefined
  }

  return (
    <div class="help-app__investigation-steps">
      {timeline.map((item, index) => {
        const stepStyle = exiting
          ? undefined
          : {
              animationDelay: `${index * INVESTIGATION_STEP_STAGGER_MS}ms`,
              animationDuration: `${INVESTIGATION_STEP_ANIM_MS}ms`,
            }

        return (
          <div
            key={item.id}
            class={`help-app__investigation-step${exiting ? ' help-app__investigation-step--out' : ''}`}
            style={stepStyle}
          >
            {item.kind === 'activity' ? (
              <ActivityStatus activity={item} onOpenSubagentDetail={onOpenSubagentDetail} />
            ) : item.kind === 'write' ? (
              <WriteFileCard item={item} />
            ) : item.kind === 'compression' ? (
              <CompressionStatus
                item={item}
                sessionId={sessionId}
                onOpenCompressionDetail={onOpenCompressionDetail}
              />
            ) : (
              <ReasoningStatus text={item.content} durationMs={item.durationMs} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function InvestigationPanel({
  investigation,
  sessionId,
  onOpenSubagentDetail,
  onOpenCompressionDetail,
}: {
  investigation: VscodeAiInvestigation
  sessionId?: string
  onOpenSubagentDetail?: (runId: string) => void
  onOpenCompressionDetail?: (sessionId: string, compressionId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [bodyMounted, setBodyMounted] = useState(false)
  const [clipOpen, setClipOpen] = useState(false)
  const [exiting, setExiting] = useState(false)
  const exitTimerRef = useRef<number | undefined>(undefined)
  const openFrameRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (exitTimerRef.current !== undefined) {
        window.clearTimeout(exitTimerRef.current)
      }
      if (openFrameRef.current !== undefined) {
        window.cancelAnimationFrame(openFrameRef.current)
      }
    }
  }, [])

  if (investigation.timeline.length === 0) {
    return undefined
  }

  const handleToggle = () => {
    if (exitTimerRef.current !== undefined) {
      window.clearTimeout(exitTimerRef.current)
      exitTimerRef.current = undefined
    }
    if (openFrameRef.current !== undefined) {
      window.cancelAnimationFrame(openFrameRef.current)
      openFrameRef.current = undefined
    }

    if (!expanded) {
      setExiting(false)
      setBodyMounted(true)
      setExpanded(true)
      setClipOpen(false)
      openFrameRef.current = window.requestAnimationFrame(() => {
        openFrameRef.current = window.requestAnimationFrame(() => {
          openFrameRef.current = undefined
          setClipOpen(true)
        })
      })
      return
    }

    setExpanded(false)
    setExiting(true)
    setClipOpen(false)
    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = undefined
      setExiting(false)
      setBodyMounted(false)
    }, INVESTIGATION_COLLAPSE_MS)
  }

  return (
    <div
      class={`help-app__investigation${expanded ? ' help-app__investigation--expanded' : ''}${exiting ? ' help-app__investigation--exiting' : ''}`}
    >
      <button
        type="button"
        class="help-app__investigation-toggle"
        aria-expanded={expanded}
        onClick={handleToggle}
      >
        <span
          class={`help-app__investigation-chevron${expanded ? ' help-app__investigation-chevron--expanded' : ''}`}
          aria-hidden="true"
        />
        <span class="help-app__investigation-summary">
          {formatInvestigationSummary(investigation)}
        </span>
      </button>
      {bodyMounted ? (
        <div
          class={`help-app__investigation-clip${clipOpen ? ' help-app__investigation-clip--open' : ''}`}
          style={{
            ['--help-investigation-collapse-ms' as string]: `${INVESTIGATION_COLLAPSE_MS}ms`,
          }}
        >
          <div class="help-app__investigation-clip-inner">
            <div class="help-app__investigation-body">
              <InvestigationSteps
                timeline={investigation.timeline}
                exiting={exiting}
                sessionId={sessionId}
                onOpenSubagentDetail={onOpenSubagentDetail}
                onOpenCompressionDetail={onOpenCompressionDetail}
              />
            </div>
          </div>
        </div>
      ) : undefined}
    </div>
  )
}

function LiveTimeline({
  items,
  sessionId,
  onOpenSubagentDetail,
  onOpenCompressionDetail,
}: {
  items: VscodeAiTimelineItem[]
  sessionId?: string
  onOpenSubagentDetail?: (runId: string) => void
  onOpenCompressionDetail?: (sessionId: string, compressionId: string) => void
}) {
  if (items.length === 0) {
    return <ReasoningStatus text="" streaming />
  }
  const waitingForNext = items.every((item) => item.done)
  return (
    <div class="help-app__live-timeline">
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        if (item.kind === 'activity') {
          return (
            <ActivityStatus
              key={item.id}
              activity={{
                id: item.id,
                label: item.label,
                detail: item.detail,
                content: item.content,
                result: item.result,
                done: item.done,
                subagentRunId: item.subagentRunId,
              }}
              live
              isCurrent={isLast && !item.done}
              onOpenSubagentDetail={onOpenSubagentDetail}
            />
          )
        }
        if (item.kind === 'write') {
          return <WriteFileCard key={item.id} item={item} live />
        }
        if (item.kind === 'compression') {
          return (
            <CompressionStatus
              key={item.id}
              item={item}
              sessionId={sessionId}
              onOpenCompressionDetail={onOpenCompressionDetail}
            />
          )
        }
        if (item.kind === 'reasoning') {
          return (
            <ReasoningStatus
              key={item.id}
              text={item.content}
              streaming={!item.done}
              durationMs={item.durationMs}
            />
          )
        }
        if (item.kind !== 'text') {
          return undefined
        }
        const separated = items.slice(0, index).some((entry) => entry.kind !== 'text')

        return (
          <div
            key={item.id}
            class={buildLiveAnswerClassName({ streaming: !item.done, separated })}
          >
            <HelpMarkdown text={item.content} streaming={!item.done} />
          </div>
        )
      })}
      {waitingForNext ? <WaitingStatus /> : undefined}
    </div>
  )
}

export function VscodeAiPanel({
  sessionId,
  messages,
  onMessagesChange,
  apiTranscript,
  wireTranscript,
  mode,
  onModeChange,
  aiModelSource,
  aiModelKey,
  onAiModelSelectionChange,
  aiModelOptions,
  onAiModelOptionsChange,
  subAgentsEnabled = false,
  subAgentsMaxConcurrent = 5,
  subAgentBuiltinOverrides = {},
  customSubAgents = [],
  aiIdleTimeoutSeconds = 60,
  aiIdleRetryCount = 10,
  aiPlayCompletionSound = true,
  aiDebugSystemReminder = false,
  dark,
  workspaceFolder,
  lastSentTerminal,
  onLastSentTerminalChange,
  getContext,
  problems,
  getNpmLastChangesSlot,
  getLastChangeSourceSlot,
  onChangesAvailable,
  ensureAiTerminal,
  getAiTerminalHandle,
  getAiTerminalSnapshot,
  closeAiTerminal,
  closeAiTerminalsBoundToChat,
  openPlanFile,
  onBusyChange,
  onOpenPath,
  onOpenSubagentDetail,
  onOpenCompressionDetail,
  readOnly = false,
  headerInfo,
  externalLiveTimeline,
  externalLiveAnswer,
  externalContextUsage,
  externalToolCallCount,
}: VscodeAiPanelProps) {
  const modal = useWindowModal()
  const textModels = useVscodeAiTextModels()
  const capabilityTags = useVscodeAiCapabilityTags()
  const modelPickerValue = useMemo(
    () => encodeVscodeModelPickerValue(aiModelSource, aiModelKey),
    [aiModelKey, aiModelSource],
  )
  const resolvedModelKey = useMemo(
    () => resolveVscodeAiModelKey({ aiModelSource, aiModelKey }),
    [aiModelKey, aiModelSource, textModels],
  )

  const handleModelPickerChange = useCallback(
    (encoded: string) => {
      const decoded = decodeVscodeModelPickerValue(encoded)
      if (decoded.source === 'vision') return
      onAiModelSelectionChange(
        decoded.source,
        decoded.source === 'custom' ? decoded.modelKey : aiModelKey,
      )
    },
    [aiModelKey, onAiModelSelectionChange],
  )

  const [draft, setDraft] = useState('')
  const [draftAttachments, setDraftAttachments] = useState<VscodeAiImageAttachment[]>(
    [],
  )
  const [editingAttachments, setEditingAttachments] = useState<
    VscodeAiImageAttachment[]
  >([])
  const [attachError, setAttachError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [sendQueue, setSendQueue] = useState<QueuedSend[]>([])
  const [sendQueueExpanded, setSendQueueExpanded] = useState(false)
  const [internalLiveTimeline, setLiveTimeline] = useState<VscodeAiTimelineItem[]>([])
  const [internalLiveAnswer, setLiveAnswer] = useState('')
  const [pendingModeSwitch, setPendingModeSwitch] = useState<ModeSwitchPendingUi | null>(
    null,
  )
  /** 只读模式下由外部注入的实时数据优先；否则随 busy 内部状态 */
  const liveTimeline = externalLiveTimeline ?? internalLiveTimeline
  const liveAnswer = externalLiveAnswer ?? internalLiveAnswer
  const [composerContextUsage, setComposerContextUsage] = useState<
    VscodeAiContextUsage | undefined
  >(undefined)
  const [editContextUsage, setEditContextUsage] = useState<VscodeAiContextUsage | undefined>(
    undefined,
  )
  const abortRef = useRef<AbortController | undefined>(undefined)
  const historyRef = useRef<OpenAI.Chat.ChatCompletionMessageParam[]>([])
  const apiTranscriptRef = useRef<OpenAI.Chat.ChatCompletionMessageParam[]>(
    apiTranscript ?? [],
  )
  const wireTranscriptRef = useRef<OpenAI.Chat.ChatCompletionMessageParam[]>(
    wireTranscript ?? [],
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  /** 贴底才跟滚：用户上翻后暂停，滚回底部再恢复 */
  const stickToBottomRef = useRef(true)
  const composerWrapRef = useRef<HTMLDivElement>(null)
  const composerInputRef = useRef<HTMLTextAreaElement>(null)
  const composerInputHeightRef = useRef<number | undefined>(undefined)
  const userEditInputRef = useRef<HTMLTextAreaElement>(null)
  const userEditComposerRef = useRef<HTMLDivElement>(null)
  const userBubbleMorphFromRef = useRef<UserBubbleMorphFrom | undefined>(undefined)
  const userEditInputHeightRef = useRef<number | undefined>(undefined)
  const liveTimelineRef = useRef<VscodeAiTimelineItem[]>([])
  const liveAnswerRef = useRef('')
  const liveToolCallCountRef = useRef(0)
  const liveStartedAtRef = useRef(0)
  /** 当前 live 回合的 assistant 草稿 id（供计划条「实施」关联） */
  const liveDraftAssistantIdRef = useRef<string | undefined>(undefined)
  const sessionIdRef = useRef(sessionId)
  const messagesRef = useRef(messages)
  const sendQueueRef = useRef<QueuedSend[]>([])
  sendQueueRef.current = sendQueue
  const turnChangeSessionsRef = useRef<TerminalChangeSet[]>([])
  const lastSentModeRef = useRef<VscodeAiMode | undefined>(undefined)
  const modeRef = useRef(mode)
  modeRef.current = mode
  const pendingModeSwitchSessionRef = useRef<{
    resolve: (decision: 'approved' | 'denied') => void
    timerId: number
    onAbort: () => void
    signal: AbortSignal | undefined
    target: VscodeAiMode
  } | null>(null)
  const lastSentTerminalRef = useRef<VscodeAiLastSentTerminal | undefined>(lastSentTerminal)
  lastSentTerminalRef.current = lastSentTerminal
  const busyRef = useRef(false)
  busyRef.current = busy
  const reviewBusyRef = useRef(false)
  const onBusyChangeRef = useRef(onBusyChange)
  onBusyChangeRef.current = onBusyChange
  /** 编辑重发打断当前 turn：跳过「已停止」落盘，并保持 busy 无缝接到下一轮 */
  const replaceHandoffRef = useRef<
    { resolve: (orphanedSessionIds: string[]) => void } | undefined
  >(undefined)
  /** 页面隐藏/卸载时强制把 live 进度 checkpoint 到消息存储 */
  const forceTurnCheckpointRef = useRef<(() => void) | undefined>(undefined)
  const sendRef = useRef<(textOverride?: string, options?: SendOptions) => Promise<void>>(
    async () => {},
  )

  // 空闲时跟随 props；busy 期间只信 applyMessages，避免父级滞后 props 冲掉本地历史
  useEffect(() => {
    if (!busy) messagesRef.current = messages
  }, [busy, messages])

  useEffect(() => {
    return () => onBusyChangeRef.current?.(false)
  }, [])

  useEffect(() => {
    const flush = () => forceTurnCheckpointRef.current?.()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const [editingUserId, setEditingUserId] = useState<string | undefined>(undefined)
  const [editingDraft, setEditingDraft] = useState('')
  const [editingMode, setEditingMode] = useState<VscodeAiMode>('ask')
  const [editingModelSource, setEditingModelSource] = useState<VscodeModelSource>('text')
  const [editingModelKey, setEditingModelKey] = useState<string | undefined>(undefined)
  const [reviewBusy, setReviewBusy] = useState(false)
  reviewBusyRef.current = reviewBusy
  const [reviewChangesOpen, setReviewChangesOpen] = useState(false)
  // readOnly 底栏在文档流内，无需为绝对定位 composer 预留下方空白
  const [composerInset, setComposerInset] = useState(readOnly ? 0 : 96)

  useEffect(() => {
    onBusyChangeRef.current?.(busy || reviewBusy)
  }, [busy, reviewBusy])

  const editingModelPickerValue = useMemo(
    () => encodeVscodeModelPickerValue(editingModelSource, editingModelKey),
    [editingModelKey, editingModelSource],
  )
  const editingResolvedModelKey = useMemo(
    () =>
      resolveVscodeAiModelKey({
        aiModelSource: editingModelSource,
        aiModelKey: editingModelKey,
      }),
    [editingModelKey, editingModelSource, textModels],
  )
  const handleEditingModelPickerChange = useCallback((encoded: string) => {
    const decoded = decodeVscodeModelPickerValue(encoded)
    if (decoded.source === 'vision') return
    setEditingModelSource(decoded.source)
    setEditingModelKey(decoded.source === 'custom' ? decoded.modelKey : undefined)
  }, [])

  const resolvedModelId = useMemo(
    () => openAiConfigForVscodeAiModelKey(resolvedModelKey).defaultModel,
    [resolvedModelKey],
  )
  const resolvedProviderEntryId = useMemo(
    () => parseVscodeAiModelRefKey(resolvedModelKey ?? '')?.providerEntryId,
    [resolvedModelKey],
  )
  const resolvedTokenizerFamily = useMemo(
    () => tokenizerFamilyForVscodeAiModelKey(resolvedModelKey),
    [resolvedModelKey],
  )
  const editingResolvedModelId = useMemo(
    () => openAiConfigForVscodeAiModelKey(editingResolvedModelKey).defaultModel,
    [editingResolvedModelKey],
  )
  const editingResolvedProviderEntryId = useMemo(
    () => parseVscodeAiModelRefKey(editingResolvedModelKey ?? '')?.providerEntryId,
    [editingResolvedModelKey],
  )
  const editingResolvedTokenizerFamily = useMemo(
    () => tokenizerFamilyForVscodeAiModelKey(editingResolvedModelKey),
    [editingResolvedModelKey],
  )

  useLayoutEffect(() => {
    const el = composerInputRef.current
    if (!el) return
    syncComposerTextareaHeight(el, COMPOSER_INPUT_MAX_LINES, composerInputHeightRef)
  }, [draft])

  useLayoutEffect(() => {
    if (!editingUserId) return
    const el = userEditInputRef.current
    if (!el) return
    syncComposerTextareaHeight(el, COMPOSER_INPUT_MAX_LINES, userEditInputHeightRef)
  }, [editingDraft, editingUserId])

  useLayoutEffect(() => {
    if (!editingUserId) return
    const el = userEditInputRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editingUserId])

  useLayoutEffect(() => {
    const from = userBubbleMorphFromRef.current
    if (!from) return
    userBubbleMorphFromRef.current = undefined
    const el =
      (editingUserId
        ? userEditComposerRef.current
        : null) ??
      (scrollRef.current?.querySelector(
        `[data-vscode-ai-user-bubble="${from.messageId}"]`,
      ) as HTMLElement | null)
    if (!el) return
    morphUserBubbleSize(el, from)
  }, [editingUserId])

  useLayoutEffect(() => {
    const el = composerWrapRef.current
    if (!el) return
    const updateInset = () => setComposerInset(el.offsetHeight)
    updateInset()
    const observer = new ResizeObserver(updateInset)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = undefined
    }
  }, [])

  const chatTitle = useMemo(() => {
    const firstUser = messages.find((m) => m.role === 'user')?.content?.trim()
    return firstUser?.slice(0, 40) || '对话'
  }, [messages])

  const aiTerminalKind: VscodeAiTerminalKind =
    mode === 'ask' ? 'ask' : mode === 'plan' ? 'plan' : 'agent'

  const runCommandHost = useMemo<VscodeAiRunCommandHost>(
    () => ({
      workspaceFolder,
      npmLastChanges: getNpmLastChangesSlot(sessionId),
      lastChangeSource: getLastChangeSourceSlot(sessionId),
      turnChangeSessions: turnChangeSessionsRef,
      onChangesAvailable,
      ensureAgentTerminal: () =>
        ensureAiTerminal(
          aiTerminalKind,
          sessionIdRef.current,
          messagesRef.current.find((m) => m.role === 'user')?.content?.trim().slice(0, 40) ||
            chatTitle,
        ),
      getAgentTerminalHandle: () => getAiTerminalHandle(aiTerminalKind, sessionIdRef.current),
      getAgentTerminalSnapshot: () =>
        getAiTerminalSnapshot(aiTerminalKind, sessionIdRef.current),
      getFsMode: () => {
        const handle = getAiTerminalHandle(aiTerminalKind, sessionIdRef.current)
        const fromHandle = handle?.getFsMode()
        if (fromHandle) return fromHandle
        return aiTerminalKind === 'agent' ? 'controlled' : 'readonly'
      },
    }),
    [
      aiTerminalKind,
      chatTitle,
      ensureAiTerminal,
      getAiTerminalHandle,
      getAiTerminalSnapshot,
      getLastChangeSourceSlot,
      getNpmLastChangesSlot,
      onChangesAvailable,
      sessionId,
      workspaceFolder,
    ],
  )

  const pendingReview = useMemo(() => {
    const paths = new Set<string>()
    const sessionIds: string[] = []
    for (const message of messages) {
      if (message.role !== 'assistant') continue
      const status: VscodeAiReviewStatus | undefined =
        message.reviewStatus ??
        (message.changeSessionIds?.length || message.terminalChangeReview?.status === 'pending'
          ? message.terminalChangeReview?.status ?? 'pending'
          : undefined)
      if (status !== 'pending') continue
      const ids =
        message.changeSessionIds ??
        (message.terminalChangeReview ? [message.terminalChangeReview.sessionId] : [])
      for (const id of ids) {
        if (!sessionIds.includes(id)) sessionIds.push(id)
      }
      const messagePaths =
        message.changePaths ??
        message.terminalChangeReview?.files.map((file) => file.path) ??
        []
      for (const path of messagePaths) paths.add(path)
    }
    return { fileCount: paths.size, sessionIds, paths: [...paths] }
  }, [messages])

  useEffect(() => {
    if (pendingReview.fileCount === 0) setReviewChangesOpen(false)
  }, [pendingReview.fileCount])

  const contextWithTerminal = useCallback((): VscodeAiContextInput => {
    const base = getContext()
    return {
      ...base,
      aiTerminal: getAiTerminalSnapshot(aiTerminalKind, sessionId),
      aiTerminalKind,
    }
  }, [aiTerminalKind, getAiTerminalSnapshot, getContext, sessionId])

  const settleModeSwitch = useCallback((decision: 'approved' | 'denied') => {
    const session = pendingModeSwitchSessionRef.current
    if (!session) return
    pendingModeSwitchSessionRef.current = null
    window.clearTimeout(session.timerId)
    if (session.signal) {
      session.signal.removeEventListener('abort', session.onAbort)
    }
    setPendingModeSwitch(null)
    session.resolve(decision)
  }, [])

  useEffect(() => {
    return () => {
      const session = pendingModeSwitchSessionRef.current
      if (!session) return
      pendingModeSwitchSessionRef.current = null
      window.clearTimeout(session.timerId)
      if (session.signal) {
        session.signal.removeEventListener('abort', session.onAbort)
      }
      session.resolve('denied')
    }
  }, [])

  const requestModeSwitch = useCallback(
    (input: {
      target: VscodeAiMode
      explanation?: string
    }): Promise<'approved' | 'denied'> => {
      if (pendingModeSwitchSessionRef.current) {
        settleModeSwitch('denied')
      }
      const from = modeRef.current
      const expiresAt = Date.now() + MODE_SWITCH_TIMEOUT_MS
      const signal = abortRef.current?.signal
      return new Promise((resolve) => {
        const onAbort = () => settleModeSwitch('denied')
        const timerId = window.setTimeout(() => {
          settleModeSwitch('denied')
        }, MODE_SWITCH_TIMEOUT_MS)
        pendingModeSwitchSessionRef.current = {
          resolve,
          timerId,
          onAbort,
          signal,
          target: input.target,
        }
        setPendingModeSwitch({
          target: input.target,
          from,
          explanation: input.explanation?.trim() || undefined,
          expiresAt,
        })
        if (signal) {
          if (signal.aborted) {
            settleModeSwitch('denied')
            return
          }
          signal.addEventListener('abort', onAbort, { once: true })
        }
      })
    },
    [settleModeSwitch],
  )

  const approvePendingModeSwitch = useCallback(() => {
    const session = pendingModeSwitchSessionRef.current
    if (!session) return
    onModeChange(session.target)
    modeRef.current = session.target
    settleModeSwitch('approved')
  }, [onModeChange, settleModeSwitch])

  const rejectPendingModeSwitch = useCallback(() => {
    settleModeSwitch('denied')
  }, [settleModeSwitch])

  const toolsHost = useMemo<VscodeAiToolsHost>(
    () => ({
      getContext: contextWithTerminal,
      runCommandHost,
      openPlanFile,
      chatSessionId: sessionId,
      ensureAiTerminal,
      getAiTerminalHandle,
      getAiTerminalSnapshot,
      closeAiTerminal,
      requestModeSwitch,
    }),
    [
      closeAiTerminal,
      contextWithTerminal,
      ensureAiTerminal,
      getAiTerminalHandle,
      getAiTerminalSnapshot,
      openPlanFile,
      requestModeSwitch,
      runCommandHost,
      sessionId,
    ],
  )

  useEffect(() => {
    void prepareVscodeAiContextUsage(resolvedModelId, resolvedTokenizerFamily)
  }, [resolvedModelId, resolvedTokenizerFamily])

  const scrollToBottom = useCallback((force = false) => {
    const node = scrollRef.current
    if (!node) return
    if (!force && !stickToBottomRef.current) return
    stickToBottomRef.current = true
    node.scrollTop = node.scrollHeight
  }, [])

  const onChatScroll = useCallback(() => {
    const node = scrollRef.current
    if (!node) return
    const distanceFromBottom =
      node.scrollHeight - node.scrollTop - node.clientHeight
    stickToBottomRef.current = distanceFromBottom <= STICK_TO_BOTTOM_THRESHOLD_PX
  }, [])

  useEffect(() => {
    stickToBottomRef.current = true
  }, [sessionId])

  useEffect(() => {
    scrollToBottom()
  }, [messages, liveTimeline, liveAnswer, pendingModeSwitch, scrollToBottom])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = undefined
    getAiTerminalHandle(aiTerminalKind, sessionIdRef.current)?.abort()
  }, [aiTerminalKind, getAiTerminalHandle])

  useEffect(() => {
    apiTranscriptRef.current = apiTranscript ?? []
  }, [apiTranscript])

  useEffect(() => {
    wireTranscriptRef.current = wireTranscript ?? []
  }, [wireTranscript])

  const rebuildHistoryFromMessages = useCallback((source: readonly VscodeAiChatMessage[]) => {
    const next: OpenAI.Chat.ChatCompletionMessageParam[] = []
    for (const message of source) {
      if (message.role === 'user') {
        next.push({ role: 'user', content: message.content })
        continue
      }
      if (message.role === 'assistant' && !message.isError) {
        next.push({ role: 'assistant', content: message.content })
      }
    }
    return next
  }, [])

  const historyFromCanonicalOrUi = useCallback(
    (uiMessages: readonly VscodeAiChatMessage[]) => {
      const wire = wireTranscriptRef.current
      if (wire.length > 0) {
        return stripLeadingSystemMessages(wire)
      }
      const transcript = apiTranscriptRef.current
      if (transcript.length > 0) {
        return stripLeadingSystemMessages(transcript)
      }
      return rebuildHistoryFromMessages(uiMessages)
    },
    [rebuildHistoryFromMessages],
  )

  useEffect(() => {
    if (sessionIdRef.current === sessionId) return
    // 先中止旧轮次，让 in-flight catch 仍能读到 live*Ref 快照
    abortRef.current?.abort()
    abortRef.current = undefined
    sessionIdRef.current = sessionId
    setDraft('')
    setDraftAttachments([])
    setBusy(false)
    setLiveTimeline([])
    setLiveAnswer('')
    setComposerContextUsage(undefined)
    setEditContextUsage(undefined)
    // refs 由旧 send 的 finally / catch 自行收尾；此处只重置 UI
    apiTranscriptRef.current = apiTranscript ?? []
    wireTranscriptRef.current = wireTranscript ?? []
    historyRef.current = historyFromCanonicalOrUi(messages)
    turnChangeSessionsRef.current = []
    lastSentModeRef.current = undefined
    setEditingUserId(undefined)
    setEditingDraft('')
    setEditingAttachments([])
    setAttachError(undefined)
    sendQueueRef.current = []
    setSendQueue([])
    setSendQueueExpanded(false)
  }, [apiTranscript, historyFromCanonicalOrUi, messages, sessionId, wireTranscript])

  useEffect(() => {
    if (busy) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        await prepareVscodeAiContextUsage(
          resolvedModelId,
          resolvedTokenizerFamily,
        )
        if (cancelled || busyRef.current) return

        const history =
          historyRef.current.length > 0
            ? historyRef.current
            : historyFromCanonicalOrUi(messages)
        const currentTerminal = aiTerminalKind
          ? getAiTerminalSnapshot(aiTerminalKind, sessionId)
          : undefined
        const reminderText = buildVscodeAiSystemReminder(
          collectVscodeAiReminderEvents({
            mode,
            previousMode: lastSentModeRef.current,
            aiTerminalKind,
            currentTerminal,
            lastSentTerminal: lastSentTerminalRef.current,
          }),
        )
        const usage = await measureVscodeAiContextUsage({
          mode,
          context: contextWithTerminal(),
          history,
          userMessage: draft,
          reminderText,
          model: resolvedModelId,
          providerEntryId: resolvedProviderEntryId,
          modelKey: resolvedModelKey,
          tokenizerFamily: resolvedTokenizerFamily,
          toolsHost,
        })
        if (cancelled || busyRef.current) return
        setComposerContextUsage(usage)
      })()
    }, CONTEXT_USAGE_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    aiModelOptions,
    aiTerminalKind,
    busy,
    contextWithTerminal,
    draft,
    getAiTerminalSnapshot,
    messages,
    mode,
    problems,
    rebuildHistoryFromMessages,
    historyFromCanonicalOrUi,
    resolvedModelId,
    resolvedModelKey,
    resolvedProviderEntryId,
    resolvedTokenizerFamily,
    sessionId,
    toolsHost,
    workspaceFolder,
  ])

  useEffect(() => {
    if (busy || !editingUserId) {
      setEditContextUsage(undefined)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        await prepareVscodeAiContextUsage(
          editingResolvedModelId,
          editingResolvedTokenizerFamily,
        )
        if (cancelled || busyRef.current) return

        const editingIndex = messages.findIndex((message) => message.id === editingUserId)
        if (editingIndex < 0) return
        const userOrdinal = messages
          .slice(0, editingIndex)
          .filter((message) => message.role === 'user').length
        const history =
          apiTranscriptRef.current.length > 0
            ? sliceApiTranscriptBeforeUserOrdinal(apiTranscriptRef.current, userOrdinal)
            : rebuildHistoryFromMessages(messages.slice(0, editingIndex))
        const editTerminalKind: VscodeAiTerminalKind | undefined =
          editingMode === 'ask'
            ? 'ask'
            : editingMode === 'plan'
              ? 'plan'
              : editingMode === 'agent'
                ? 'agent'
                : undefined
        const currentTerminal = editTerminalKind
          ? getAiTerminalSnapshot(editTerminalKind, sessionId)
          : undefined
        const reminderText = buildVscodeAiSystemReminder(
          collectVscodeAiReminderEvents({
            mode: editingMode,
            previousMode: lastSentModeRef.current,
            aiTerminalKind: editTerminalKind,
            currentTerminal,
            lastSentTerminal: lastSentTerminalRef.current,
          }),
        )
        const usage = await measureVscodeAiContextUsage({
          mode: editingMode,
          context: contextWithTerminal(),
          history,
          userMessage: editingDraft,
          reminderText,
          model: editingResolvedModelId,
          providerEntryId: editingResolvedProviderEntryId,
          modelKey: editingResolvedModelKey,
          tokenizerFamily: editingResolvedTokenizerFamily,
          toolsHost,
        })
        if (cancelled || busyRef.current) return
        setEditContextUsage(usage)
      })()
    }, CONTEXT_USAGE_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    aiModelOptions,
    busy,
    contextWithTerminal,
    editingDraft,
    editingMode,
    editingResolvedModelId,
    editingResolvedModelKey,
    editingResolvedProviderEntryId,
    editingResolvedTokenizerFamily,
    editingUserId,
    getAiTerminalSnapshot,
    messages,
    problems,
    rebuildHistoryFromMessages,
    historyFromCanonicalOrUi,
    sessionId,
    toolsHost,
    workspaceFolder,
  ])

  const collectSessionIdsAfter = useCallback(
    (source: readonly VscodeAiChatMessage[], fromIndex: number): string[] => {
      const ids: string[] = []
      for (let index = fromIndex; index < source.length; index += 1) {
        const message = source[index]
        if (message.role !== 'assistant') continue
        const sessionIds =
          message.changeSessionIds ??
          (message.terminalChangeReview ? [message.terminalChangeReview.sessionId] : [])
        for (const id of sessionIds) {
          if (!ids.includes(id)) ids.push(id)
        }
      }
      return ids
    },
    [],
  )

  const turnChangeExtras = useCallback(() => {
    const sessions = collectTurnChangeSessionsFromHost(runCommandHost)
    if (sessions.length === 0) return undefined
    return {
      changeSessionIds: sessions.map((session) => session.sessionId),
      changePaths: collectPathsFromChangeSets(sessions),
      reviewStatus: 'pending' as const,
    }
  }, [runCommandHost])

  const applyMessages = useCallback(
    (
      next: VscodeAiChatMessage[],
      extras?: {
        apiTranscript?: OpenAI.Chat.ChatCompletionMessageParam[]
        wireTranscript?: OpenAI.Chat.ChatCompletionMessageParam[]
      },
    ) => {
      messagesRef.current = next
      onMessagesChange(next, extras)
    },
    [onMessagesChange],
  )

  const enqueueSend = useCallback(
    (
      text: string,
      attachments?: readonly VscodeAiImageAttachment[],
      implementsPlanMessageId?: string,
    ) => {
      const item: QueuedSend = {
        id: createQueuedSendId(),
        text,
        attachments: attachments && attachments.length > 0 ? [...attachments] : undefined,
        implementsPlanMessageId,
      }
      const next = [...sendQueueRef.current, item]
      sendQueueRef.current = next
      setSendQueue(next)
    },
    [],
  )

  const removeQueuedSend = useCallback((id: string) => {
    const next = sendQueueRef.current.filter((item) => item.id !== id)
    sendQueueRef.current = next
    setSendQueue(next)
  }, [])

  const clearSendQueue = useCallback(() => {
    sendQueueRef.current = []
    setSendQueue([])
    setSendQueueExpanded(false)
  }, [])

  const waitUntilSendIdle = useCallback(async () => {
    if (!busyRef.current && !reviewBusyRef.current) return
    await new Promise<void>((resolve) => {
      const tick = () => {
        if (!busyRef.current && !reviewBusyRef.current) {
          resolve()
          return
        }
        window.setTimeout(tick, 16)
      }
      tick()
    })
  }, [])

  const clearLiveTurnState = useCallback(() => {
    settleModeSwitch('denied')
    setLiveTimeline([])
    setLiveAnswer('')
    liveTimelineRef.current = []
    liveAnswerRef.current = ''
    liveToolCallCountRef.current = 0
    liveDraftAssistantIdRef.current = undefined
  }, [settleModeSwitch])

  const releaseBusyTurn = useCallback(() => {
    setBusy(false)
    busyRef.current = false
    clearLiveTurnState()
    abortRef.current = undefined
  }, [clearLiveTurnState])

  const send = useCallback(
    async (textOverride?: string, options?: SendOptions) => {
      const text = (textOverride ?? draft).trim()
      const turnAttachments =
        options?.attachments ??
        (textOverride === undefined && !options?.replaceFromUserId
          ? draftAttachments
          : options?.replaceFromUserId
            ? editingAttachments
            : [])
      if (!text && turnAttachments.length === 0) {
        // 输入为空时回车：有排队则打断当前任务，由 finally 立刻发送「下一个」
        if (
          textOverride === undefined &&
          !options?.replaceFromUserId &&
          busyRef.current &&
          sendQueueRef.current.length > 0
        ) {
          stop()
        }
        return
      }

      // 用户主动发送：强制贴底并恢复跟滚
      scrollToBottom(true)

      const turnMode = options?.sendMode ?? mode
      modeRef.current = turnMode
      const turnModelSource = options?.sendModelSource ?? aiModelSource
      const turnModelKey =
        options?.sendModelSource !== undefined ? options.sendModelKey : aiModelKey
      const turnResolvedModelKey = resolveVscodeAiModelKey({
        aiModelSource: turnModelSource,
        aiModelKey: turnModelKey,
      })
      const turnTerminalKind: VscodeAiTerminalKind =
        turnMode === 'ask' ? 'ask' : turnMode === 'plan' ? 'plan' : 'agent'
      const sentModelKeyForMessage =
        turnModelSource === 'custom' ? turnModelKey : undefined

      let handoffOrphanedSessionIds: string[] = []
      let keptBusyFromHandoff = false

      // 编辑重发且当前正在生成：无缝打断（不落「已停止」、不熄灭 live）
      if (options?.replaceFromUserId && busyRef.current) {
        clearSendQueue()
        if (abortRef.current) {
          handoffOrphanedSessionIds = await new Promise<string[]>((resolve) => {
            replaceHandoffRef.current = { resolve }
            stop()
          })
          keptBusyFromHandoff = true
        } else {
          await waitUntilSendIdle()
        }
      } else if (options?.replaceFromUserId && reviewBusyRef.current) {
        clearSendQueue()
        await waitUntilSendIdle()
      }

      // 普通发送在 busy / 回滚中入队；编辑重发在 handoff 后继续（busy 仍为 true）
      if (!options?.replaceFromUserId && (busyRef.current || reviewBusyRef.current)) {
        enqueueSend(text, turnAttachments, options?.implementsPlanMessageId)
        if (!textOverride) {
          setDraft('')
          setDraftAttachments([])
        }
        return
      }

      if (options?.replaceFromUserId && reviewBusyRef.current) {
        await waitUntilSendIdle()
      }

      let withUser: VscodeAiChatMessage[]
      const currentMessages = messagesRef.current
      const currentTerminal = getAiTerminalSnapshot(turnTerminalKind, sessionId)
      const reminderText = buildVscodeAiSystemReminder(
        collectVscodeAiReminderEvents({
          mode: turnMode,
          previousMode: lastSentModeRef.current,
          aiTerminalKind: turnTerminalKind,
          currentTerminal,
          lastSentTerminal: lastSentTerminalRef.current,
        }),
      )
      const reminderForStorage = reminderText.trim() || undefined
      if (options?.replaceFromUserId) {
        const index = currentMessages.findIndex(
          (message) => message.id === options.replaceFromUserId,
        )
        if (index < 0 || currentMessages[index]?.role !== 'user') {
          if (keptBusyFromHandoff) releaseBusyTurn()
          return
        }
        const sessionIds = collectSessionIdsAfter(currentMessages, index + 1)
        for (const sessionIdToRevert of handoffOrphanedSessionIds) {
          if (!sessionIds.includes(sessionIdToRevert)) {
            sessionIds.push(sessionIdToRevert)
          }
        }
        if (sessionIds.length > 0) {
          setReviewBusy(true)
          try {
            await revertVscodeAiChangeSessions(runCommandHost, sessionIds)
          } finally {
            setReviewBusy(false)
          }
        }
        closeAiTerminalsBoundToChat?.(sessionIdRef.current)
        const editedUser: VscodeAiChatMessage = {
          ...currentMessages[index],
          content: text,
          createdAt: Date.now(),
          systemReminder: reminderForStorage,
          sentMode: turnMode,
          sentModelSource: turnModelSource,
          sentModelKey: sentModelKeyForMessage,
          attachments:
            turnAttachments.length > 0 ? [...turnAttachments] : undefined,
        }
        withUser = [...currentMessages.slice(0, index), editedUser]
        const userOrdinal = currentMessages
          .slice(0, index)
          .filter((message) => message.role === 'user').length
        historyRef.current =
          apiTranscriptRef.current.length > 0
            ? sliceApiTranscriptBeforeUserOrdinal(apiTranscriptRef.current, userOrdinal)
            : rebuildHistoryFromMessages(currentMessages.slice(0, index))
        apiTranscriptRef.current = historyRef.current
        wireTranscriptRef.current = historyRef.current
        applyMessages(withUser, {
          apiTranscript: historyRef.current,
          wireTranscript: historyRef.current,
        })
        setEditingUserId(undefined)
        setEditingDraft('')
        setEditingAttachments([])
        // 编辑重发成功：主输入框同步为本次选用的模式与模型
        if (options.sendMode !== undefined) {
          onModeChange(options.sendMode)
        }
        if (options.sendModelSource !== undefined) {
          onAiModelSelectionChange(
            options.sendModelSource,
            options.sendModelSource === 'custom' ? options.sendModelKey : undefined,
          )
        }
      } else {
        if (!textOverride) {
          setDraft('')
          setDraftAttachments([])
        }
        const userMessage = createVscodeAiChatMessage('user', text, {
          systemReminder: reminderForStorage,
          sentMode: turnMode,
          sentModelSource: turnModelSource,
          sentModelKey: sentModelKeyForMessage,
          attachments:
            turnAttachments.length > 0 ? [...turnAttachments] : undefined,
          ...(options?.implementsPlanMessageId
            ? { implementsPlanMessageId: options.implementsPlanMessageId }
            : {}),
        })
        withUser = [...currentMessages, userMessage]
        applyMessages(withUser)
      }

      setBusy(true)
      busyRef.current = true
      clearLiveTurnState()
      liveStartedAtRef.current = osNowMs()
      if (historyRef.current.length === 0 && currentMessages.length > 0) {
        historyRef.current = historyFromCanonicalOrUi(currentMessages)
      }
      turnChangeSessionsRef.current = []

      const controller = new AbortController()
      abortRef.current = controller

      const draftAssistantId = `vscode-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const draftCreatedAt = Date.now()
      liveDraftAssistantIdRef.current = draftAssistantId
      let lastCheckpointToolCount = -1
      let lastCheckpointAt = 0
      let checkpointTimer: number | undefined

      const clearCheckpointTimer = () => {
        if (checkpointTimer === undefined) return
        window.clearTimeout(checkpointTimer)
        checkpointTimer = undefined
      }

      const checkpointTurn = (force = false) => {
        if (controller.signal.aborted && !force) return
        if (replaceHandoffRef.current) return
        const toolCount = liveToolCallCountRef.current
        const timeline = liveTimelineRef.current
        const answer = liveAnswerRef.current
        const now = Date.now()
        const toolAdvanced = toolCount > lastCheckpointToolCount
        const intervalElapsed = now - lastCheckpointAt >= TURN_CHECKPOINT_INTERVAL_MS
        if (!force && !toolAdvanced && !intervalElapsed) return
        if (timeline.length === 0 && !answer.trim() && toolCount === 0) return

        lastCheckpointToolCount = toolCount
        lastCheckpointAt = now
        // live 气泡已展示完整 timeline；纯文本流式 interval 不把 investigation 再写进 messages，
        // 避免与 live 双份常驻。工具推进 / force 仍写入，供崩溃恢复工具轨迹。
        const investigation =
          (force || toolAdvanced) && timeline.length > 0
            ? buildVscodeAiInvestigationFromTimeline(timeline, {
                toolCallCount: toolCount,
                startedAt: liveStartedAtRef.current,
              })
            : undefined
        const changeExtras = turnChangeExtras()
        const planMeta = extractPlanMetaFromTimeline(timeline)
        applyMessages([
          ...withUser,
          createVscodeAiChatMessage('assistant', answer, {
            id: draftAssistantId,
            createdAt: draftCreatedAt,
            incomplete: true,
            investigation,
            ...planMetaExtras(planMeta),
            ...changeExtras,
          }),
        ])
      }

      const scheduleCheckpoint = () => {
        if (checkpointTimer !== undefined) return
        checkpointTimer = window.setTimeout(() => {
          checkpointTimer = undefined
          checkpointTurn()
        }, TURN_CHECKPOINT_INTERVAL_MS)
      }

      forceTurnCheckpointRef.current = () => {
        clearCheckpointTimer()
        checkpointTurn(true)
      }

      try {
        const result = await askVscodeAiAgent({
          mode: turnMode,
          userMessage: text,
          reminderText,
          context: contextWithTerminal(),
          toolsHost,
          history: historyRef.current.length > 0 ? historyRef.current : undefined,
          signal: controller.signal,
          modelKey: turnResolvedModelKey,
          idleTimeoutMs: Math.max(5, aiIdleTimeoutSeconds) * 1000,
          idleRetryCount: aiIdleRetryCount,
          imageAttachments: turnAttachments,
          subAgentConfig: buildVscodeSubAgentHostConfig(
            {
              subAgentsEnabled,
              subAgentsMaxConcurrent,
              subAgentBuiltinOverrides,
              customSubAgents,
            },
            turnMode,
            turnResolvedModelKey,
            { parentRunId: sessionId },
          ),
          onProgress: (progress) => {
            if (controller.signal.aborted) return
            const previousToolCount = liveToolCallCountRef.current
            liveTimelineRef.current = progress.timeline
            liveAnswerRef.current = progress.answerText
            liveToolCallCountRef.current = progress.toolCallCount
            setLiveTimeline(progress.timeline)
            setLiveAnswer(progress.answerText)
            if (progress.contextUsage) {
              setComposerContextUsage(progress.contextUsage)
            }
            if (progress.toolCallCount > previousToolCount) {
              clearCheckpointTimer()
              checkpointTurn()
            } else {
              scheduleCheckpoint()
            }
          },
          onModeChangeDuringRun: (nextMode) => {
            modeRef.current = nextMode
            lastSentModeRef.current = nextMode
          },
        })

        // 已被编辑重发接管：丢弃本轮结果，由 finally 做 handoff
        if (replaceHandoffRef.current) {
          return
        }

        lastSentModeRef.current = result.finalMode ?? turnMode
        const finalMode = result.finalMode ?? turnMode
        const finalTerminalKind: VscodeAiTerminalKind =
          finalMode === 'ask' ? 'ask' : finalMode === 'plan' ? 'plan' : 'agent'
        const nextLastSent: VscodeAiLastSentTerminal = {
          kind: finalTerminalKind,
          snapshot: getAiTerminalSnapshot(finalTerminalKind, sessionId),
        }
        lastSentTerminalRef.current = nextLastSent
        onLastSentTerminalChange?.(nextLastSent)

        if (controller.signal.aborted) {
          const snapshotTimeline = liveTimelineRef.current
          const investigation =
            snapshotTimeline.length > 0
              ? buildVscodeAiInvestigationFromTimeline(snapshotTimeline, {
                  toolCallCount: liveToolCallCountRef.current,
                  startedAt: liveStartedAtRef.current,
                })
              : undefined
          const changeExtras = turnChangeExtras()
          const planMeta = extractPlanMetaFromTimeline(snapshotTimeline)
          const assistantMessage = createVscodeAiChatMessage(
            'assistant',
            liveAnswerRef.current.trim() || '已停止生成',
            {
              id: draftAssistantId,
              createdAt: draftCreatedAt,
              investigation,
              ...planMetaExtras(planMeta),
              ...changeExtras,
            },
          )
          const nextMessages = [...withUser, assistantMessage]
          const nextCanonical = [
            ...apiTranscriptRef.current,
            { role: 'user' as const, content: text },
            { role: 'assistant' as const, content: assistantMessage.content },
          ]
          const nextWire = [
            ...historyRef.current,
            { role: 'user' as const, content: text },
            { role: 'assistant' as const, content: assistantMessage.content },
          ]
          historyRef.current = nextWire
          apiTranscriptRef.current = nextCanonical
          wireTranscriptRef.current = nextWire
          applyMessages(nextMessages, {
            apiTranscript: nextCanonical,
            wireTranscript: nextWire,
          })
        } else {
          if (result.messages) {
            const canonical = stripLeadingSystemMessages(result.messages)
            const wire =
              result.wireMessages && result.wireMessages.length > 0
                ? result.wireMessages
                : canonical
            historyRef.current = wire
            apiTranscriptRef.current = canonical
            wireTranscriptRef.current = wire
          }

          const investigation =
            result.investigation.timeline.length > 0
              ? result.investigation
              : liveTimelineRef.current.length > 0
                ? buildVscodeAiInvestigationFromTimeline(liveTimelineRef.current, {
                    toolCallCount: liveToolCallCountRef.current,
                    startedAt: liveStartedAtRef.current,
                  })
                : undefined

          const changeExtras = turnChangeExtras()
          const planMeta = extractPlanMetaFromTimeline(
            investigation?.timeline ?? liveTimelineRef.current,
          )
          const assistantMessage = createVscodeAiChatMessage(
            'assistant',
            result.text || liveAnswerRef.current,
            {
              id: draftAssistantId,
              createdAt: draftCreatedAt,
              incomplete: result.incomplete,
              investigation,
              ...planMetaExtras(planMeta),
              ...changeExtras,
            },
          )
          applyMessages([...withUser, assistantMessage], {
            apiTranscript: apiTranscriptRef.current,
            wireTranscript: wireTranscriptRef.current,
          })
        }
      } catch (error) {
        if (replaceHandoffRef.current) {
          return
        }
        const snapshotTimeline = liveTimelineRef.current
        const investigation =
          snapshotTimeline.length > 0
            ? buildVscodeAiInvestigationFromTimeline(snapshotTimeline, {
                toolCallCount: liveToolCallCountRef.current,
                startedAt: liveStartedAtRef.current,
              })
            : undefined
        const aborted = isStreamAbortError(error, controller.signal)
        const content = aborted
          ? liveAnswerRef.current.trim() || formatError(error)
          : formatError(error)
        const changeExtras = turnChangeExtras()
        const planMeta = extractPlanMetaFromTimeline(snapshotTimeline)
        const assistantMessage = createVscodeAiChatMessage('assistant', content, {
          id: draftAssistantId,
          createdAt: draftCreatedAt,
          isError: !aborted,
          investigation,
          ...planMetaExtras(planMeta),
          ...changeExtras,
        })
        const nextMessages = [...withUser, assistantMessage]
        const nextCanonical = [
          ...apiTranscriptRef.current,
          { role: 'user' as const, content: text },
          { role: 'assistant' as const, content: content },
        ]
        const nextWire = [
          ...historyRef.current,
          { role: 'user' as const, content: text },
          { role: 'assistant' as const, content: content },
        ]
        historyRef.current = nextWire
        apiTranscriptRef.current = nextCanonical
        wireTranscriptRef.current = nextWire
        applyMessages(nextMessages, {
          apiTranscript: nextCanonical,
          wireTranscript: nextWire,
        })
      } finally {
        clearCheckpointTimer()
        forceTurnCheckpointRef.current = undefined
        const handoff = replaceHandoffRef.current
        if (handoff) {
          replaceHandoffRef.current = undefined
          const orphanedSessionIds = turnChangeSessionsRef.current.map(
            (session) => session.sessionId,
          )
          // 保持 busy，只清 live，避免「等待响应」中间熄灭一帧
          clearLiveTurnState()
          abortRef.current = undefined
          turnChangeSessionsRef.current = []
          handoff.resolve(orphanedSessionIds)
          return
        }

        setBusy(false)
        busyRef.current = false
        clearLiveTurnState()
        abortRef.current = undefined

        // QuickJS Asyncify WASM 堆只涨不缩；回合结束后重建以归还 ArrayBuffer。
        // 有未审改动时保留实例，避免丢掉可回滚 ChangeSet。
        const terminalHandle = getAiTerminalHandle(turnTerminalKind, sessionId)
        if (terminalHandle) {
          const pending = terminalHandle.getLastChanges()
          if (!pending || pending.changes.length === 0) {
            void (async () => {
              try {
                terminalHandle.clear()
                await terminalHandle.rebuildInstance()
              } catch {
                // 回收失败不阻断下一轮发送
              }
            })()
          }
        }

        const queued = sendQueueRef.current
        if (queued.length > 0) {
          const [next, ...rest] = queued
          sendQueueRef.current = rest
          setSendQueue(rest)
          queueMicrotask(() => {
            void sendRef.current(next.text, {
              attachments: next.attachments,
              ...(next.implementsPlanMessageId
                ? { implementsPlanMessageId: next.implementsPlanMessageId }
                : {}),
            })
          })
        } else if (aiPlayCompletionSound && !controller.signal.aborted) {
          playSystemSound('complete')
        }
      }
    },
    [
      aiModelKey,
      aiModelSource,
      applyMessages,
      clearLiveTurnState,
      clearSendQueue,
      closeAiTerminalsBoundToChat,
      collectSessionIdsAfter,
      contextWithTerminal,
      customSubAgents,
      draft,
      draftAttachments,
      editingAttachments,
      enqueueSend,
      getAiTerminalHandle,
      getAiTerminalSnapshot,
      mode,
      onAiModelSelectionChange,
      onLastSentTerminalChange,
      onModeChange,
      historyFromCanonicalOrUi,
      rebuildHistoryFromMessages,
      releaseBusyTurn,
      runCommandHost,
      scrollToBottom,
      sessionId,
      stop,
      subAgentBuiltinOverrides,
      subAgentsEnabled,
      subAgentsMaxConcurrent,
      aiIdleTimeoutSeconds,
      aiIdleRetryCount,
      aiPlayCompletionSound,
      toolsHost,
      turnChangeExtras,
      waitUntilSendIdle,
    ],
  )
  sendRef.current = send

  const keepAllPendingChanges = useCallback(() => {
    onMessagesChange(
      messages.map((message) => {
        if (message.role !== 'assistant') return message
        const status =
          message.reviewStatus ??
          (message.changeSessionIds?.length || message.terminalChangeReview?.status === 'pending'
            ? message.terminalChangeReview?.status ?? 'pending'
            : undefined)
        if (status !== 'pending') return message
        return {
          ...message,
          reviewStatus: 'kept' as const,
          terminalChangeReview: message.terminalChangeReview
            ? { ...message.terminalChangeReview, status: 'kept' as const }
            : message.terminalChangeReview,
        }
      }),
    )
  }, [messages, onMessagesChange])

  const undoAllPendingChanges = useCallback(async () => {
    if (reviewBusy || pendingReview.sessionIds.length === 0) return
    setReviewBusy(true)
    try {
      await revertVscodeAiChangeSessions(runCommandHost, pendingReview.sessionIds)
      onMessagesChange(
        messages.map((message) => {
          if (message.role !== 'assistant') return message
          const status =
            message.reviewStatus ??
            (message.changeSessionIds?.length || message.terminalChangeReview?.status === 'pending'
              ? message.terminalChangeReview?.status ?? 'pending'
              : undefined)
          if (status !== 'pending') return message
          return {
            ...message,
            reviewStatus: 'reverted' as const,
            terminalChangeReview: message.terminalChangeReview
              ? { ...message.terminalChangeReview, status: 'reverted' as const }
              : message.terminalChangeReview,
          }
        }),
      )
    } finally {
      setReviewBusy(false)
    }
  }, [messages, onMessagesChange, pendingReview.sessionIds, reviewBusy, runCommandHost])

  const viewPlan = useCallback(
    (planPath: string) => {
      void openPlanFile(planPath)
    },
    [openPlanFile],
  )

  const implementPlan = useCallback(
    (planPath: string, assistantMessageId: string) => {
      if (readOnly) return
      onModeChange('agent')
      void send(
        `请严格按照计划文件 \`${planPath}\` 实施。先读取该计划，再按其中的实现要点与 Todos 执行。每完成一项 Todo，调用 update_plan 将对应 \`- [ ]\` 改为 \`- [x]\` 并写入完整计划内容；不要只改代码不更新计划。`,
        { sendMode: 'agent', implementsPlanMessageId: assistantMessageId },
      )
    },
    [onModeChange, readOnly, send],
  )

  const beginEditUserMessage = useCallback(
    (message: VscodeAiChatMessage, bubbleEl?: HTMLElement | null) => {
      if (message.role !== 'user') return
      if (bubbleEl) {
        const rect = bubbleEl.getBoundingClientRect()
        userBubbleMorphFromRef.current = {
          messageId: message.id,
          width: rect.width,
          height: rect.height,
        }
      } else {
        userBubbleMorphFromRef.current = undefined
      }
      userEditInputHeightRef.current = undefined
      const settings = resolveMessageSendSettings(message, {
        mode,
        source: aiModelSource,
        key: aiModelKey,
      })
      setEditingUserId(message.id)
      setEditingDraft(message.content)
      setEditingAttachments(message.attachments ? [...message.attachments] : [])
      setEditingMode(settings.mode)
      setEditingModelSource(settings.source)
      setEditingModelKey(settings.key)
    },
    [aiModelKey, aiModelSource, mode],
  )

  const cancelEditUserMessage = useCallback(() => {
    const bubbleEl = userEditComposerRef.current
    const messageId = bubbleEl?.getAttribute('data-vscode-ai-user-bubble')
    if (bubbleEl && messageId) {
      const rect = bubbleEl.getBoundingClientRect()
      userBubbleMorphFromRef.current = {
        messageId,
        width: rect.width,
        height: rect.height,
      }
    } else {
      userBubbleMorphFromRef.current = undefined
    }
    setEditingUserId(undefined)
    setEditingDraft('')
    setEditingAttachments([])
    userEditInputHeightRef.current = undefined
  }, [])

  useEffect(() => {
    if (!editingUserId) return
    const onPointerDown = (event: PointerEvent) => {
      const root = userEditComposerRef.current
      if (!root) return
      const target = event.target
      if (target instanceof Node && root.contains(target)) return
      // 模型列表 / 模式菜单 portal 到浮动层，点击时不应取消编辑
      const overlay = document.getElementById('instant-os-floating-overlays')
      if (overlay && target instanceof Node && overlay.contains(target)) return
      // 确认框 / prompt 等窗口模态；点按钮不应连带退出编辑
      if (
        target instanceof Element &&
        target.closest('.window-modal-overlay-root')
      ) {
        return
      }
      // 上下文占用弹层 portal 到 body，点击时不应取消编辑
      if (
        target instanceof Element &&
        target.closest('.vscode-ai__context-usage-popover')
      ) {
        return
      }
      cancelEditUserMessage()
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [cancelEditUserMessage, editingUserId])

  const resubmitEditedUserMessage = useCallback(
    async (messageId: string) => {
      const text = editingDraft.trim()
      if (!text && editingAttachments.length === 0) return
      const index = messages.findIndex((message) => message.id === messageId)
      if (index < 0) return
      const hasLater = index < messages.length - 1
      const hasLaterChanges = collectSessionIdsAfter(messages, index + 1).length > 0
      const interrupting = busy || reviewBusy
      if (hasLater || hasLaterChanges || interrupting) {
        const ok = await modal.confirm({
          title: '从此消息重新发送？',
          message: interrupting
            ? '将停止当前生成、丢弃此消息之后的对话，并回滚之后 Agent 产生的文件改动，然后按新文案重新发送。'
            : '将丢弃此消息之后的对话，并回滚之后 Agent 产生的文件改动，然后按新文案重新发送。',
          confirmLabel: '重新发送',
          cancelLabel: '取消',
          themeColor: VSCODE_AI_MODAL_THEME,
        })
        if (!ok) return
      }
      // 确认后再打断并重发；取消时绝不动当前生成
      await send(text, {
        replaceFromUserId: messageId,
        sendMode: editingMode,
        sendModelSource: editingModelSource,
        sendModelKey: editingModelKey,
        attachments: editingAttachments,
      })
    },
    [
      busy,
      collectSessionIdsAfter,
      editingAttachments,
      editingDraft,
      editingMode,
      editingModelKey,
      editingModelSource,
      messages,
      modal,
      reviewBusy,
      send,
    ],
  )

  /**
   * 只读模式：子 Agent 处于 running 就持续渲染 live 气泡（无数据时与主聊天一样
   * 显示 WaitingStatus 等待动画）；完成/出错后由 messages 落盘渲染。
   */
  const showLive = readOnly
    ? headerInfo?.status === 'running' ||
      (externalLiveTimeline?.length ?? 0) > 0 ||
      !!externalLiveAnswer
    : busy
  /** 欢迎页仅用于可交互的主对话；只读面板不显示 */
  const showWelcome = !readOnly && messages.length === 0 && !busy
  /** busy 时末尾 incomplete 草稿由 live 气泡展示，避免与落盘 checkpoint 双份渲染 */
  const displayMessages = useMemo(() => {
    if (!busy || messages.length === 0) return messages
    const last = messages[messages.length - 1]
    if (last?.role === 'assistant' && last.incomplete) {
      return messages.slice(0, -1)
    }
    return messages
  }, [busy, messages])

  const handleUserBubbleActivate = useCallback(
    (message: VscodeAiChatMessage, bubbleEl?: HTMLElement | null) => {
      if (message.role !== 'user') return
      beginEditUserMessage(message, bubbleEl)
    },
    [beginEditUserMessage],
  )

  return (
    <div
      class="help-app vscode-ai help-app--width-full"
      style={{ '--vscode-ai-composer-inset': `${readOnly ? 0 : composerInset}px` }}
    >
      {readOnly && headerInfo ? (
        <div class="vscode-ai__readonly-header" role="status">
          <span class="vscode-ai__readonly-header-label">Sub Agent</span>
          <span class="vscode-ai__readonly-header-agent">{headerInfo.agentId}</span>
          <span class="vscode-ai__readonly-header-sep">·</span>
          <span class="vscode-ai__readonly-header-model" title={headerInfo.modelLabel}>
            {headerInfo.modelLabel}
          </span>
          <span class="vscode-ai__readonly-header-sep">·</span>
          <span
            class={`vscode-ai__readonly-header-status vscode-ai__readonly-header-status--${headerInfo.status}`}
          >
            {headerInfo.status === 'running' ? '运行中' : headerInfo.status === 'done' ? '已完成' : headerInfo.status === 'error' ? '出错' : headerInfo.status}
          </span>
        </div>
      ) : undefined}
      <div
        class="help-app__chat vscode-ai__chat"
        ref={scrollRef}
        onScroll={onChatScroll}
      >
        {showWelcome ? (
          <div class="help-app__welcome vscode-ai__welcome">
            <div class="help-app__welcome-icon" aria-hidden="true">
              <VscodeIcon size={56} />
            </div>
            <h2 class="help-app__welcome-title">代码助手</h2>
            <p class="help-app__welcome-sub">
              可阅读工作区、写计划、改文件或运行命令。切换 Ask / Plan / Edit / Agent 控制权限。
            </p>
            <div class="help-app__samples" aria-label="示例提问">
              {SAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  class="help-app__sample"
                  onClick={() => void send(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div class="help-app__messages">
            {displayMessages.map((message) => {
              const isEditingUser = message.role === 'user' && editingUserId === message.id
              const isEditableUser = message.role === 'user' && !editingUserId && !readOnly

              if (message.role === 'user') {
                // 只读详情（子 Agent Tab）：任务消息是主 Agent 的发言，
                // 微信式：图片单独一个气泡，问题文案再一个气泡，都在左侧
                if (readOnly) {
                  const attachments = message.attachments
                  const hasAttachments = !!attachments && attachments.length > 0
                  const text = message.content.trim()
                  if (!hasAttachments && !text) return null
                  const rows: VNode[] = []
                  if (hasAttachments) {
                    rows.push(
                      <div
                        key={`${message.id}-img`}
                        class="help-app__message help-app__message--assistant"
                      >
                        <span class="help-app__avatar" aria-hidden="true">
                          <VscodeIcon size={30} />
                        </span>
                        <div class="help-app__bubble vscode-ai__bubble--image">
                          <VscodeAiAttachmentImages
                            attachments={attachments}
                            layout="stack"
                          />
                        </div>
                      </div>,
                    )
                  }
                  if (text) {
                    rows.push(
                      <div
                        key={`${message.id}-text`}
                        class="help-app__message help-app__message--assistant"
                      >
                        <span class="help-app__avatar" aria-hidden="true">
                          <VscodeIcon size={30} />
                        </span>
                        <div class="help-app__bubble">
                          <HelpMarkdown text={message.content} />
                        </div>
                      </div>,
                    )
                  }
                  return rows
                }
                return (
                  <div
                    key={message.id}
                    class={`help-app__message help-app__message--user${
                      isEditingUser ? ' help-app__message--user-editing' : ''
                    }`}
                  >
                    <span class="help-app__avatar" aria-hidden="true">
                      🙂
                    </span>
                    <div
                      data-vscode-ai-user-bubble={message.id}
                      class={`help-app__bubble vscode-ai__bubble--user${
                        isEditingUser ? ' vscode-ai__bubble--user-editing' : ''
                      }${isEditableUser ? ' vscode-ai__bubble--user-editable' : ''}`}
                      ref={isEditingUser ? userEditComposerRef : undefined}
                      role={isEditableUser ? 'button' : undefined}
                      tabIndex={isEditableUser ? 0 : undefined}
                      aria-label={isEditableUser ? '编辑消息' : undefined}
                      onClick={
                        isEditableUser
                          ? (event) => {
                              const target = event.target as HTMLElement
                              if (
                                target.closest('details, summary, button, a, textarea, input')
                              ) {
                                return
                              }
                              handleUserBubbleActivate(
                                message,
                                event.currentTarget as HTMLElement,
                              )
                            }
                          : undefined
                      }
                      onKeyDown={
                        isEditableUser
                          ? (event) => {
                              if (event.key !== 'Enter' && event.key !== ' ') return
                              event.preventDefault()
                              handleUserBubbleActivate(
                                message,
                                event.currentTarget as HTMLElement,
                              )
                            }
                          : undefined
                      }
                    >
                      {isEditingUser ? (
                        <VscodeAiComposerBlock
                          surface="bubble"
                          value={editingDraft}
                          onChange={setEditingDraft}
                          onSend={() => void resubmitEditedUserMessage(message.id)}
                          inputRef={userEditInputRef}
                          placeholder="编辑消息…"
                          sendDisabled={
                            (!editingDraft.trim() && editingAttachments.length === 0) ||
                            textModels.length === 0
                          }
                          busy={false}
                          onStop={stop}
                          mode={editingMode}
                          onModeChange={setEditingMode}
                          modelPickerValue={editingModelPickerValue}
                          onModelPickerChange={handleEditingModelPickerChange}
                          textModels={textModels}
                          capabilityTags={capabilityTags}
                          aiModelOptions={aiModelOptions}
                          onAiModelOptionsChange={onAiModelOptionsChange}
                          contextUsage={editContextUsage}
                          dark={dark}
                          attachments={editingAttachments}
                          onAttachmentsChange={setEditingAttachments}
                          onAttachError={setAttachError}
                          chatSessionId={sessionId}
                        />
                      ) : (
                        <>
                          {message.attachments && message.attachments.length > 0 ? (
                            <div class="vscode-ai__attach-chips vscode-ai__attach-chips--bubble">
                              {message.attachments.map((item) => (
                                <span
                                  key={item.id}
                                  class="vscode-ai__attach-chip"
                                  title={item.path}
                                >
                                  <span class="vscode-ai__attach-chip-name">{item.name}</span>
                                </span>
                              ))}
                            </div>
                          ) : undefined}
                          {aiDebugSystemReminder && message.systemReminder?.trim() ? (
                            <details class="vscode-ai__system-reminder" open>
                              <summary>System Reminder（debug）</summary>
                              <pre class="vscode-ai__system-reminder-body">
                                {message.systemReminder}
                              </pre>
                            </details>
                          ) : undefined}
                          <div class="help-app__answer help-app__answer--plain">
                            {message.content}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )
              }

              const planMeta =
                message.role === 'assistant' && !message.isError
                  ? resolveMessagePlanMeta(message)
                  : undefined
              const showPlanBanner = Boolean(planMeta?.planPath)

              return (
                <div
                  key={message.id}
                  class={`help-app__message help-app__message--${message.role}${message.isError ? ' help-app__message--error' : ''}${
                    showPlanBanner ? ' help-app__message--with-banner' : ''
                  }`}
                >
                  <div class="vscode-ai__message-main">
                    <span class="help-app__avatar" aria-hidden="true">
                      {message.isError ? '!' : readOnly ? <SubagentIcon size={30} /> : <VscodeIcon size={30} />}
                    </span>
                    <div class="vscode-ai__message-stack">
                      <div
                        class={`help-app__bubble${message.isError ? ' help-app__bubble--error' : ''}${message.investigation ? ' help-app__bubble--with-investigation' : ''}`}
                      >
                        {message.investigation ? (
                          <InvestigationPanel
                            investigation={message.investigation}
                            sessionId={sessionId}
                            onOpenSubagentDetail={onOpenSubagentDetail}
                            onOpenCompressionDetail={onOpenCompressionDetail}
                          />
                        ) : undefined}
                        {message.role === 'assistant' && !message.isError ? (
                          <div class="help-app__answer">
                            <HelpMarkdown text={message.content} />
                          </div>
                        ) : (
                          <div class="help-app__answer help-app__answer--plain">
                            {message.content}
                          </div>
                        )}
                        {message.incomplete ? (
                          <p class="vscode-ai__incomplete-note" role="status">
                            本轮未完整结束，已保存的进度如下。可继续提问。
                          </p>
                        ) : undefined}
                      </div>
                    </div>
                  </div>
                  {showPlanBanner && planMeta?.planPath ? (
                    <PlanReadyBar
                      planPath={planMeta.planPath}
                      planTitle={planMeta.planTitle}
                      onViewPlan={viewPlan}
                      onImplement={(path) => implementPlan(path, message.id)}
                      showImplement={!readOnly}
                      implemented={isPlanImplemented(messages, message.id, sendQueue)}
                    />
                  ) : undefined}
                </div>
              )
            })}

            {showLive ? (
              (() => {
                const livePlanMeta = extractPlanMetaFromTimeline(liveTimeline)
                const liveAssistantId = liveDraftAssistantIdRef.current
                const showLivePlanBanner = Boolean(
                  livePlanMeta.planPath && liveAssistantId,
                )
                const showModeSwitchBanner = Boolean(pendingModeSwitch)
                return (
                  <div
                    class={`help-app__message help-app__message--assistant${
                      showLivePlanBanner || showModeSwitchBanner
                        ? ' help-app__message--with-banner'
                        : ''
                    }`}
                  >
                    <div class="vscode-ai__message-main">
                      <span class="help-app__avatar" aria-hidden="true">
                        {readOnly ? <SubagentIcon size={30} /> : <VscodeIcon size={30} />}
                      </span>
                      <div class="vscode-ai__message-stack">
                        <div class="help-app__bubble help-app__bubble--with-investigation help-app__bubble--live">
                          <LiveTimeline
                            items={liveTimeline}
                            sessionId={sessionId}
                            onOpenSubagentDetail={onOpenSubagentDetail}
                            onOpenCompressionDetail={onOpenCompressionDetail}
                          />
                          {liveAnswer && !liveTimeline.some((item) => item.kind === 'text') ? (
                            <div
                              class={buildLiveAnswerClassName({
                                streaming: true,
                                separated: liveTimeline.length > 0,
                              })}
                            >
                              <HelpMarkdown text={liveAnswer} streaming />
                            </div>
                          ) : undefined}
                        </div>
                      </div>
                    </div>
                    {pendingModeSwitch ? (
                      <ModeSwitchBar
                        pending={pendingModeSwitch}
                        onApprove={approvePendingModeSwitch}
                        onReject={rejectPendingModeSwitch}
                      />
                    ) : undefined}
                    {showLivePlanBanner && livePlanMeta.planPath && liveAssistantId ? (
                      <PlanReadyBar
                        planPath={livePlanMeta.planPath}
                        planTitle={livePlanMeta.planTitle}
                        onViewPlan={viewPlan}
                        onImplement={(path) => implementPlan(path, liveAssistantId)}
                        showImplement={!readOnly}
                        implemented={isPlanImplemented(
                          messages,
                          liveAssistantId,
                          sendQueue,
                        )}
                      />
                    ) : undefined}
                  </div>
                )
              })()
            ) : undefined}
          </div>
        )}
      </div>

      {readOnly ? (
        <div class="vscode-ai__readonly-footer" role="status" ref={composerWrapRef}>
          <div class="vscode-ai__readonly-footer-meta">
            {typeof externalToolCallCount === 'number' && externalToolCallCount > 0 ? (
              <span class="vscode-ai__readonly-footer-stat">工具 {externalToolCallCount}</span>
            ) : undefined}
          </div>
          <div class="vscode-ai__readonly-footer-trailing">
            <VscodeAiContextUsageView usage={externalContextUsage} dark={dark} />
          </div>
        </div>
      ) : (
      <div class="help-app__composer-wrap vscode-ai__composer-wrap" ref={composerWrapRef}>
        {pendingReview.fileCount > 0 ? (
          <div class="vscode-ai__review-dock">
            {reviewChangesOpen ? (
              <VscodeAiPendingChangesPanel
                sessionIds={pendingReview.sessionIds}
                onOpenPath={onOpenPath}
              />
            ) : undefined}
            <div class="vscode-ai__review-bar" role="status">
              <span class="vscode-ai__review-bar-label">
                已修改 {pendingReview.fileCount} 个文件
              </span>
              <div class="vscode-ai__review-bar-actions">
                <button
                  type="button"
                  class="help-app__sample"
                  disabled={reviewBusy}
                  aria-expanded={reviewChangesOpen}
                  onClick={() => setReviewChangesOpen((value) => !value)}
                >
                  {reviewChangesOpen ? '收起更改' : '查看更改'}
                </button>
                <button
                  type="button"
                  class="help-app__sample"
                  disabled={busy || reviewBusy}
                  onClick={keepAllPendingChanges}
                >
                  全部保留
                </button>
                <button
                  type="button"
                  class="help-app__sample"
                  disabled={busy || reviewBusy}
                  onClick={() => void undoAllPendingChanges()}
                >
                  全部撤销
                </button>
              </div>
            </div>
          </div>
        ) : undefined}
        {sendQueue.length > 0 ? (
          <div class="vscode-ai__send-queue" aria-label="待发送队列">
            <div class="vscode-ai__send-queue-summary">
              <span class="vscode-ai__send-queue-badge">下一个</span>
              <span class="vscode-ai__send-queue-text">{sendQueue[0]?.text}</span>
              {sendQueue.length > 1 ? (
                <button
                  type="button"
                  class="vscode-ai__send-queue-toggle"
                  aria-expanded={sendQueueExpanded}
                  aria-label={`${sendQueueExpanded ? '收起' : '展开'}排队，共 ${sendQueue.length} 条`}
                  onClick={() => setSendQueueExpanded((value) => !value)}
                >
                  {sendQueueExpanded ? '收起' : '展开'} ({sendQueue.length})
                </button>
              ) : undefined}
              <button
                type="button"
                class="vscode-ai__send-queue-remove"
                aria-label="清空排队"
                title="清空排队"
                onClick={clearSendQueue}
              >
                ×
              </button>
            </div>
            {sendQueueExpanded && sendQueue.length > 1 ? (
              <div class="vscode-ai__send-queue-list">
                {sendQueue.map((item, index) => (
                  <div key={item.id} class="vscode-ai__send-queue-item">
                    <span class="vscode-ai__send-queue-badge">
                      {index === 0 ? '下一个' : index + 1}
                    </span>
                    <span class="vscode-ai__send-queue-text">{item.text}</span>
                    <button
                      type="button"
                      class="vscode-ai__send-queue-remove"
                      aria-label="移除排队消息"
                      title="移除"
                      onClick={() => removeQueuedSend(item.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : undefined}
          </div>
        ) : undefined}
        {attachError ? (
          <div class="vscode-ai__attach-error" role="alert">
            {attachError}
            <button
              type="button"
              class="vscode-ai__attach-error-dismiss"
              aria-label="关闭"
              onClick={() => setAttachError(undefined)}
            >
              ×
            </button>
          </div>
        ) : undefined}
        <VscodeAiComposerBlock
          value={draft}
          onChange={setDraft}
          onSend={() => void send()}
          inputRef={composerInputRef}
          placeholder={
            busy
              ? sendQueue.length > 0
                ? '空回车跳过当前，立即发送排队消息…'
                : '继续输入，发送后将排队…'
              : mode === 'ask'
                ? '只读问答…'
                : mode === 'plan'
                  ? '调研并写计划…'
                  : '描述任务…'
          }
          sendDisabled={
            (!draft.trim() && draftAttachments.length === 0) || textModels.length === 0
          }
          busy={busy}
          onStop={stop}
          mode={mode}
          onModeChange={onModeChange}
          modelPickerValue={modelPickerValue}
          onModelPickerChange={handleModelPickerChange}
          textModels={textModels}
          capabilityTags={capabilityTags}
          aiModelOptions={aiModelOptions}
          onAiModelOptionsChange={onAiModelOptionsChange}
          contextUsage={composerContextUsage}
          dark={dark}
          attachments={draftAttachments}
          onAttachmentsChange={setDraftAttachments}
          onAttachError={setAttachError}
          chatSessionId={sessionId}
        />
      </div>
      )}
    </div>
  )
}
