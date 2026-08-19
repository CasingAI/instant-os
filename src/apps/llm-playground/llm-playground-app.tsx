import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  AI_PROVIDER_PRESETS,
  AI_REASONING_EFFORT_PRESETS,
} from '../../ai/ai-providers.ts'
import {
  listSupportedReasoningEfforts,
  modelSupportsReasoningEffortPicker,
} from '../../ai/ai-thinking.ts'
import { accountSettingsToOpenAiConfig, loadAccountSettings } from '../../os/account-settings-storage.ts'
import { MarkdownHtmlView } from '../../markdown/markdown-html-view.tsx'
import { renderMarkdownHtml } from '../../markdown/render-markdown-html.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { IosSwitch } from '../../ui/ios-switch.tsx'
import {
  runPlaygroundCompletion,
  usePlaygroundTextModels,
} from './llm-playground-api.ts'
import { formatPlaygroundConversation } from './llm-playground-messages.ts'
import {
  createPlaygroundMessage,
  readLlmPlaygroundStore,
  writeLlmPlaygroundStore,
} from './llm-playground-storage.ts'
import type {
  LlmPlaygroundConfig,
  LlmPlaygroundMessage,
  LlmPlaygroundStore,
} from './llm-playground-types.ts'
import './llm-playground.css'

const ROLE_LABELS: Record<LlmPlaygroundMessage['role'], string> = {
  system: 'System',
  user: 'User',
  assistant: 'Assistant',
}

const providerPresetNames = new Map<string, string>(
  AI_PROVIDER_PRESETS.map((preset) => [preset.id, preset.name]),
)

function findProviderPresetName(providerId: string): string | undefined {
  return providerPresetNames.get(providerId)
}

const EXAMPLE_MESSAGES: LlmPlaygroundMessage[] = [
  createPlaygroundMessage(
    'system',
    'You are a helpful, concise assistant. Answer in the user\'s language.',
  ),
  createPlaygroundMessage('user', '你好，请用三句话介绍你自己。'),
]

function autosizeTextarea(element: HTMLTextAreaElement): void {
  element.style.height = 'auto'
  // 空内容 / 尚未布局时 scrollHeight 可能为 0，用最小高度兜底
  const target = Math.max(element.scrollHeight, MESSAGE_TEXTAREA_MIN_HEIGHT)
  element.style.height = `${target}px`
}

/** 消息编辑卡片最小可视高度（与 CSS min-height 保持一致） */
const MESSAGE_TEXTAREA_MIN_HEIGHT = 42

type PlaygroundMessageCardProps = {
  message: LlmPlaygroundMessage
  index: number
  total: number
  onChange: (id: string, content: string) => void
  onRoleChange: (id: string, role: LlmPlaygroundMessage['role']) => void
  onMove: (index: number, direction: -1 | 1) => void
  onRemove: (id: string) => void
}

function PlaygroundMessageCard({
  message,
  index,
  total,
  onChange,
  onRoleChange,
  onMove,
  onRemove,
}: PlaygroundMessageCardProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // 内容变化（含从存储恢复 / 载入示例）与宽度变化（窗口缩放导致换行变化）时校准高度。
  // 不再给 textarea 设上限：单条消息多长就显示多高，滚动只发生在外层消息列表。
  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) return
    const resize = () => autosizeTextarea(element)
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [message.content])

  return (
    <div
      class={`llm-playground-message llm-playground-message--${message.role}`}
    >
      <div class="llm-playground-message__head">
        <select
          class={`llm-playground-message__role llm-playground-message__role--${message.role}`}
          value={message.role}
          aria-label={`消息 ${index + 1} 角色`}
          onChange={(event) =>
            onRoleChange(
              message.id,
              (event.currentTarget as HTMLSelectElement).value as LlmPlaygroundMessage['role'],
            )
          }
        >
          <option value="system">System</option>
          <option value="user">User</option>
          <option value="assistant">Assistant</option>
        </select>
        <span class="llm-playground-message__index">#{index + 1}</span>
        <span class="llm-playground-message__spacer" />
        <button
          type="button"
          class="llm-playground-message__action"
          title="上移"
          aria-label="上移"
          disabled={index === 0}
          onClick={() => onMove(index, -1)}
        >
          ↑
        </button>
        <button
          type="button"
          class="llm-playground-message__action"
          title="下移"
          aria-label="下移"
          disabled={index === total - 1}
          onClick={() => onMove(index, 1)}
        >
          ↓
        </button>
        <button
          type="button"
          class="llm-playground-message__action llm-playground-message__action--danger"
          title="删除"
          aria-label="删除"
          onClick={() => onRemove(message.id)}
        >
          ×
        </button>
      </div>
      <textarea
        ref={textareaRef}
        class="llm-playground-message__content"
        rows={1}
        value={message.content}
        placeholder={`输入 ${ROLE_LABELS[message.role]} 消息内容…`}
        onInput={(event) => {
          const element = event.currentTarget as HTMLTextAreaElement
          onChange(message.id, element.value)
          autosizeTextarea(element)
        }}
      />
    </div>
  )
}

function formatRangeValue(value: number, digits = 1): string {
  const fixed = value.toFixed(digits)
  return fixed.replace(/\.?0+$/, '') || '0'
}

type SliderFieldProps = {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
  format?: (value: number) => string
}

function SliderField({
  label,
  min,
  max,
  step,
  value,
  onChange,
  format = (v) => String(v),
}: SliderFieldProps) {
  return (
    <label class="llm-playground-field">
      <span class="llm-playground-field__head">
        <span class="llm-playground-field__label">{label}</span>
        <output class="llm-playground-field__value">{format(value)}</output>
      </span>
      <input
        type="range"
        class="llm-playground-field__range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(event) =>
          onChange(Number((event.currentTarget as HTMLInputElement).value))
        }
      />
    </label>
  )
}

export function LlmPlaygroundApp() {
  const { setAppWindowTitle } = useOs()
  const [store, setStore] = useState<LlmPlaygroundStore>(() => readLlmPlaygroundStore())
  const [running, setRunning] = useState(false)
  const [streamingReasoning, setStreamingReasoning] = useState('')
  const [streamingContent, setStreamingContent] = useState('')
  const [responseStatus, setResponseStatus] = useState<'idle' | 'streaming' | 'done' | 'error'>(
    'idle',
  )
  const [responseError, setResponseError] = useState('')
  const [saveState, setSaveState] = useState<{ kind: 'saved' | 'error'; text: string } | null>(null)
  const [copyState, setCopyState] = useState<'copied' | 'failed' | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const storeRef = useRef<LlmPlaygroundStore>(store)
  const saveTimerRef = useRef<number | null>(null)
  const copyTimerRef = useRef<number | null>(null)

  const messages = store.messages
  const config = store.config

  const models = usePlaygroundTextModels()

  useEffect(() => {
    storeRef.current = store
  }, [store])

  const reportSaveState = useCallback((ok: boolean) => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
    }
    if (ok) {
      setSaveState({ kind: 'saved', text: '已自动保存' })
      saveTimerRef.current = window.setTimeout(() => setSaveState(null), 2200)
    } else {
      setSaveState({ kind: 'error', text: '保存失败：本地存储不可用或空间已满，更改可能无法保留' })
    }
  }, [])

  const persistStore = useCallback(
    (next: LlmPlaygroundStore) => {
      const ok = writeLlmPlaygroundStore(next)
      reportSaveState(ok)
      setStore(next)
    },
    [reportSaveState],
  )

  /** 追加一条 Assistant 消息；基于最新 store，避免闭包里的过期快照 */
  const appendAssistantMessage = useCallback(
    (content: string) => {
      const trimmed = content.trim()
      if (!trimmed) return
      const current = storeRef.current
      const next: LlmPlaygroundStore = {
        ...current,
        messages: [...current.messages, createPlaygroundMessage('assistant', trimmed)],
      }
      const ok = writeLlmPlaygroundStore(next)
      reportSaveState(ok)
      setStore(next)
    },
    [reportSaveState],
  )

  useEffect(() => {
    setAppWindowTitle('llm-playground', 'LLM Playground')
  }, [setAppWindowTitle])

  useEffect(
    () => () => {
      abortRef.current?.abort()
    },
    [],
  )

  const updateMessage = useCallback(
    (id: string, patch: Partial<LlmPlaygroundMessage>) => {
      persistStore({
        ...store,
        messages: store.messages.map((message) =>
          message.id === id ? { ...message, ...patch } : message,
        ),
      })
    },
    [persistStore, store],
  )

  const removeMessage = useCallback(
    (id: string) => {
      persistStore({ ...store, messages: store.messages.filter((message) => message.id !== id) })
    },
    [persistStore, store],
  )

  const insertMessage = useCallback(
    (index: number, role: LlmPlaygroundMessage['role'] = 'user') => {
      const next = [...store.messages]
      next.splice(index, 0, createPlaygroundMessage(role))
      persistStore({ ...store, messages: next })
    },
    [persistStore, store],
  )

  const moveMessage = useCallback(
    (index: number, direction: -1 | 1) => {
      const target = index + direction
      if (target < 0 || target >= store.messages.length) return
      const next = [...store.messages]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      persistStore({ ...store, messages: next })
    },
    [persistStore, store],
  )

  const updateConfig = useCallback(
    (patch: Partial<LlmPlaygroundConfig>) => {
      persistStore({ ...store, config: { ...store.config, ...patch } })
    },
    [persistStore, store],
  )

  const handleLoadExample = useCallback(() => {
    persistStore({ ...store, messages: EXAMPLE_MESSAGES.map((m) => ({ ...m })) })
  }, [persistStore, store])

  const handleClearMessages = useCallback(() => {
    persistStore({ ...store, messages: [] })
  }, [persistStore, store])

  /** 复制整个对话（所有消息）到剪贴板 */
  const handleCopyConversation = useCallback(async () => {
    const text = formatPlaygroundConversation(storeRef.current.messages)
    if (!text) {
      setCopyState('failed')
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopyState(null), 2200)
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
    copyTimerRef.current = window.setTimeout(() => setCopyState(null), 2200)
  }, [])

  const handleSend = useCallback(async () => {
    if (running) return
    const snapshot = store.messages.slice()
    const configSnapshot = store.config
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setStreamingReasoning('')
    setStreamingContent('')
    setResponseError('')
    setResponseStatus('streaming')
    try {
      const text = await runPlaygroundCompletion({
        messages: snapshot,
        config: configSnapshot,
        signal: controller.signal,
        onChunk: (_delta, accumulated) => setStreamingContent(accumulated),
        onReasoningChunk: (_delta, accumulated) => setStreamingReasoning(accumulated),
      })
      if (configSnapshot.autoAppendResponse && text.trim()) {
        appendAssistantMessage(text)
        setResponseStatus('idle')
        setStreamingReasoning('')
        setStreamingContent('')
      } else {
        setStreamingContent(text)
        setResponseStatus('done')
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setResponseStatus('idle')
        setStreamingReasoning('')
        setStreamingContent('')
      } else {
        setResponseError(error instanceof Error ? error.message : String(error))
        setResponseStatus('error')
      }
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }, [appendAssistantMessage, running, store])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const handleAppendResponse = useCallback(() => {
    const content = streamingContent.trim()
    if (!content) return
    appendAssistantMessage(content)
    setStreamingReasoning('')
    setStreamingContent('')
    setResponseStatus('idle')
  }, [appendAssistantMessage, streamingContent])

  const selectedModel = useMemo(() => {
    if (config.modelRefKey) {
      const separator = config.modelRefKey.indexOf(':')
      if (separator > 0) {
        const providerEntryId = config.modelRefKey.slice(0, separator)
        const modelId = config.modelRefKey.slice(separator + 1)
        const match = models.find(
          (model) =>
            model.providerEntryId === providerEntryId && model.modelId === modelId,
        )
        if (match) {
          return { providerId: match.providerId, modelId: match.modelId }
        }
        return { providerId: undefined, modelId }
      }
    }
    try {
      const settings = loadAccountSettings()
      const fallback = settings
        ? accountSettingsToOpenAiConfig(settings, 'text')
        : undefined
      if (fallback) {
        return {
          providerId: fallback.providerId,
          modelId: fallback.defaultModel,
        }
      }
    } catch {
      return undefined
    }
    return undefined
  }, [config.modelRefKey, models])

  const showEffortPicker =
    config.thinkingEnabled &&
    selectedModel !== undefined &&
    modelSupportsReasoningEffortPicker(selectedModel.providerId, selectedModel.modelId)

  const { effortOptions, showEffortLimitHint } = useMemo(() => {
    if (!selectedModel) {
      return { effortOptions: AI_REASONING_EFFORT_PRESETS as readonly string[], showEffortLimitHint: false }
    }
    const supported = listSupportedReasoningEfforts(
      selectedModel.providerId,
      selectedModel.modelId,
    )
    if (supported === null) {
      return { effortOptions: AI_REASONING_EFFORT_PRESETS as readonly string[], showEffortLimitHint: false }
    }
    // 档位被模型预设限制（如 DeepSeek V4 仅 high / max，不含 none）时，
    // 提示「关闭思考」应使用深度思考开关
    return {
      effortOptions: supported,
      showEffortLimitHint: supported.length > 0 && !supported.includes('none'),
    }
  }, [selectedModel])

  // 存储的档位不再受当前模型支持时，回落到「默认」，避免下拉空白
  useEffect(() => {
    if (
      config.thinkingEffort !== 'default' &&
      effortOptions.length > 0 &&
      !effortOptions.includes(config.thinkingEffort)
    ) {
      updateConfig({ thinkingEffort: 'default' })
    }
  }, [config.thinkingEffort, effortOptions, updateConfig])

  const groupedModels = useMemo(() => {
    const groups: Array<{ label: string; models: typeof models }> = []
    const labelCounts = new Map<string, number>()
    for (const model of models) {
      let label: string = model.providerId
      const presetName = findProviderPresetName(model.providerId)
      if (presetName) label = presetName
      const count = labelCounts.get(label) ?? 0
      labelCounts.set(label, count + 1)
      const groupLabel = count > 0 ? `${label} ${count + 1}` : label
      let group = groups.find((item) => item.label === groupLabel)
      if (!group) {
        group = { label: groupLabel, models: [] }
        groups.push(group)
      }
      group.models.push(model)
    }
    return groups
  }, [models])

  const menuBar = useMemo((): MenuDefinition[] => {
    return [
      {
        label: '编辑',
        items: [
          {
            type: 'action',
            label: '载入示例',
            shortcut: '⌘N',
            onClick: handleLoadExample,
          },
          {
            type: 'action',
            label: '清空消息',
            shortcut: '⌘K',
            onClick: handleClearMessages,
          },
          {
            type: 'action',
            label: '添加消息',
            shortcut: '⇧⌘N',
            onClick: () => insertMessage(store.messages.length),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '复制对话',
            shortcut: '⇧⌘C',
            onClick: () => void handleCopyConversation(),
          },
        ],
      },
    ]
  }, [
    handleClearMessages,
    handleCopyConversation,
    handleLoadExample,
    insertMessage,
    store.messages.length,
  ])

  useAppMenuBar('llm-playground', menuBar)

  const hasOutput = streamingContent.length > 0 || streamingReasoning.length > 0

  return (
    <div class="llm-playground">
      <div class="llm-playground__body">
        <section class="llm-playground__main">
          <div class="llm-playground__messages">
            {messages.length === 0 ? (
              <div class="llm-playground__empty">
                <p class="llm-playground__empty-title">空白消息列表</p>
                <p class="llm-playground__empty-sub">
                  添加 System / User / Assistant 消息，编辑后点击右侧「发送」请求模型。
                </p>
                <div class="llm-playground__empty-actions">
                  <button type="button" class="llm-playground-btn" onClick={handleLoadExample}>
                    载入示例
                  </button>
                  <button
                    type="button"
                    class="llm-playground-btn llm-playground-btn--primary"
                    onClick={() => insertMessage(0)}
                  >
                    添加第一条消息
                  </button>
                </div>
              </div>
            ) : (
              messages.map((message, index) => (
                <PlaygroundMessageCard
                  key={message.id}
                  message={message}
                  index={index}
                  total={messages.length}
                  onChange={(id, content) => updateMessage(id, { content })}
                  onRoleChange={(id, role) => updateMessage(id, { role })}
                  onMove={moveMessage}
                  onRemove={removeMessage}
                />
              ))
            )}
          </div>

          {messages.length > 0 && (
            <div class="llm-playground__message-actions">
              <button
                type="button"
                class="llm-playground__add-message"
                onClick={() => insertMessage(messages.length)}
              >
                ＋ 添加消息
              </button>
              <button
                type="button"
                class="llm-playground__copy-conversation"
                onClick={() => void handleCopyConversation()}
                disabled={running}
              >
                复制对话
              </button>
              {copyState === 'copied' && (
                <span class="llm-playground__copy-status llm-playground__copy-status--ok">
                  ✓ 已复制
                </span>
              )}
              {copyState === 'failed' && (
                <span class="llm-playground__copy-status llm-playground__copy-status--error">
                  {messages.some((message) => message.content.trim())
                    ? '复制失败，请重试'
                    : '没有可复制的内容'}
                </span>
              )}
            </div>
          )}

          <div
            class={`llm-playground-response llm-playground-response--${responseStatus}`}
          >
            {responseStatus === 'idle' && (
              <p class="llm-playground-response__hint">
                {hasOutput ? '响应已清空' : '点击右侧「发送」把当前消息列表发给模型，流式响应将显示在这里。'}
              </p>
            )}

            {responseStatus !== 'idle' && streamingReasoning && (
              <details class="llm-playground-response__reasoning" open>
                <summary>思考链</summary>
                <pre class="llm-playground-response__reasoning-text">{streamingReasoning}</pre>
              </details>
            )}

            {responseStatus === 'streaming' && streamingContent && (
              <MarkdownHtmlView
                class="llm-playground-response__content llm-playground-response__content--streaming"
                html={renderMarkdownHtml(streamingContent)}
              />
            )}

            {responseStatus === 'streaming' && !streamingContent && !streamingReasoning && (
              <p class="llm-playground-response__waiting">正在等待模型输出…</p>
            )}

            {responseStatus === 'done' && (
              <>
                <div class="llm-playground-response__toolbar">
                  <span class="llm-playground-response__status">完成</span>
                  <span class="llm-playground-response__spacer" />
                  <button
                    type="button"
                    class="llm-playground-btn llm-playground-btn--small"
                    onClick={() => navigator.clipboard?.writeText(streamingContent).catch(() => {})}
                  >
                    复制
                  </button>
                  <button
                    type="button"
                    class="llm-playground-btn llm-playground-btn--small llm-playground-btn--primary"
                    onClick={handleAppendResponse}
                    disabled={!streamingContent.trim()}
                  >
                    追加到消息
                  </button>
                </div>
                <MarkdownHtmlView
                  class="llm-playground-response__content"
                  html={renderMarkdownHtml(streamingContent)}
                />
              </>
            )}

            {responseStatus === 'error' && (
              <div class="llm-playground-response__error">
                <p class="llm-playground-response__error-title">请求失败</p>
                <p class="llm-playground-response__error-message">{responseError}</p>
              </div>
            )}
          </div>
        </section>

        <aside class="llm-playground__panel">
          <h2 class="llm-playground__panel-title">请求配置</h2>

          <label class="llm-playground-field">
            <span class="llm-playground-field__head">
              <span class="llm-playground-field__label">模型</span>
            </span>
            <select
              class="llm-playground-field__select"
              value={config.modelRefKey}
              onChange={(event) =>
                updateConfig({ modelRefKey: (event.currentTarget as HTMLSelectElement).value })
              }
            >
              <option value="">跟随账户首选</option>
              {groupedModels.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.models.map((model) => (
                    <option
                      key={`${model.providerEntryId}:${model.modelId}`}
                      value={`${model.providerEntryId}:${model.modelId}`}
                    >
                      {model.name || model.modelId}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <div class="llm-playground-field llm-playground-field--switch">
            <span class="llm-playground-field__head">
              <span class="llm-playground-field__label">深度思考</span>
            </span>
            <IosSwitch
              checked={config.thinkingEnabled}
              label="深度思考"
              onChange={(checked) => updateConfig({ thinkingEnabled: checked })}
            />
          </div>

          {showEffortPicker && (
            <label class="llm-playground-field">
              <span class="llm-playground-field__head">
                <span class="llm-playground-field__label">思考力度</span>
              </span>
              <select
                class="llm-playground-field__select"
                value={config.thinkingEffort}
                onChange={(event) =>
                  updateConfig({ thinkingEffort: (event.currentTarget as HTMLSelectElement).value })
                }
              >
                <option value="default">默认</option>
                {effortOptions.map((effort) => (
                  <option key={effort} value={effort}>
                    {effort === 'none' ? 'none（关闭思考）' : effort}
                  </option>
                ))}
              </select>
              {showEffortLimitHint && (
                <span class="llm-playground-field__hint">
                  该模型开启思考时仅支持
                  {effortOptions.join(' / ')}
                  ；要关闭思考请关闭上方「深度思考」开关。
                </span>
              )}
            </label>
          )}

          <div class="llm-playground-panel__divider" />

          <SliderField
            label="Temperature"
            min={0}
            max={2}
            step={0.1}
            value={config.temperature ?? 0.7}
            onChange={(value) => updateConfig({ temperature: value })}
            format={(value) => formatRangeValue(value, 1)}
          />

          <SliderField
            label="Top P"
            min={0}
            max={1}
            step={0.05}
            value={config.topP ?? 1}
            onChange={(value) => updateConfig({ topP: value })}
            format={(value) => formatRangeValue(value, 2)}
          />

          <SliderField
            label="频率惩罚"
            min={-2}
            max={2}
            step={0.1}
            value={config.frequencyPenalty ?? 0}
            onChange={(value) => updateConfig({ frequencyPenalty: value })}
            format={(value) => formatRangeValue(value, 1)}
          />

          <SliderField
            label="出现惩罚"
            min={-2}
            max={2}
            step={0.1}
            value={config.presencePenalty ?? 0}
            onChange={(value) => updateConfig({ presencePenalty: value })}
            format={(value) => formatRangeValue(value, 1)}
          />

          <label class="llm-playground-field">
            <span class="llm-playground-field__head">
              <span class="llm-playground-field__label">最大输出 Tokens</span>
              <span class="llm-playground-field__hint">留空 = 模型默认</span>
            </span>
            <input
              type="number"
              class="llm-playground-field__input"
              min={1}
              step={1}
              placeholder="默认"
              value={config.maxTokens ?? ''}
              onInput={(event) => {
                const raw = (event.currentTarget as HTMLInputElement).value
                const parsed = raw === '' ? null : Number(raw)
                updateConfig({ maxTokens: parsed !== null && Number.isFinite(parsed) ? parsed : null })
              }}
            />
          </label>

          <label class="llm-playground-field">
            <span class="llm-playground-field__head">
              <span class="llm-playground-field__label">停止序列</span>
              <span class="llm-playground-field__hint">逗号分隔</span>
            </span>
            <input
              type="text"
              class="llm-playground-field__input"
              placeholder="如：</output>, END"
              value={config.stop}
              onInput={(event) =>
                updateConfig({ stop: (event.currentTarget as HTMLInputElement).value })
              }
            />
          </label>

          <div class="llm-playground-panel__divider" />

          <div class="llm-playground-field llm-playground-field--switch">
            <span class="llm-playground-field__head">
              <span class="llm-playground-field__label">响应自动追加</span>
            </span>
            <IosSwitch
              checked={config.autoAppendResponse}
              label="响应自动追加"
              onChange={(checked) => updateConfig({ autoAppendResponse: checked })}
            />
          </div>
          <p class="llm-playground-send-note">
            {config.autoAppendResponse
              ? '发送完成后，响应会自动保存为 Assistant 消息，关掉窗口重新打开仍在。'
              : '发送完成后响应仅显示在下方，需点击「追加到消息」才会保存为消息。'}
          </p>

          <button
            type="button"
            class={`llm-playground-send${running ? ' llm-playground-send--running' : ''}`}
            onClick={running ? handleStop : () => void handleSend()}
          >
            {running ? '停止生成' : '发送'}
          </button>
          {running && (
            <p class="llm-playground-send-note">请求发送的是点击时的消息快照，编辑消息不影响本次请求。</p>
          )}

          {saveState && (
            <div
              class={`llm-playground-save-state llm-playground-save-state--${saveState.kind}`}
              role="status"
            >
              {saveState.kind === 'saved' ? '✓' : '✕'} {saveState.text}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
