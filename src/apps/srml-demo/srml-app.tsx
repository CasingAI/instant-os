import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { buildSrmlDslSpec, buildSrmlSystemPrompt, SrmlAgent } from './srml-agent.ts'
import {
  type SrmlBlock,
  type SrmlPartialState,
  type SrmlPromptBlock,
  type SrmlSegment,
  type SrmlTaskBlock,
} from './srml-dsl.ts'
import type { SrmlBranchSummary, SrmlEngineEvent } from './srml-engine.ts'
import { SrmlEngine } from './srml-engine.ts'
import type { SrmlScenario } from './srml-scenario.ts'
import { SRML_SCENARIOS } from './srml-scenario.ts'
import './srml.css'

const EFFORT_OPTIONS = [
  { value: '', label: '思考强度：不指定' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'max', label: 'max' },
]

const NEW_GROUP_KEY = 'new'

type StagedPrompt = {
  key: number
  content: string
  thoughtEffort: string
}

/** 全局递增的 prompt 编号：跨轮次、跨分支唯一，避免 task 编号冲突 */
let nextPromptId = 1

function tasksFrom(blocks: SrmlBlock[]): SrmlTaskBlock[] {
  return blocks.filter((block): block is SrmlTaskBlock => block.kind === 'task')
}

function promptsFrom(blocks: SrmlBlock[]): SrmlPromptBlock[] {
  return blocks.filter((block): block is SrmlPromptBlock => block.kind === 'prompt')
}

function SegmentCard({ segment }: { segment: SrmlSegment }) {
  if (segment.kind === 'thought') {
    return (
      <div class="srml-segment srml-segment--thought">
        <div class="srml-segment__label">
          <span class="srml-segment__tag srml-segment__tag--thought">&lt;begin_of_thought&gt;</span>
          <span class="srml-segment__name">思考</span>
        </div>
        <div class="srml-segment__content">{segment.content}</div>
      </div>
    )
  }
  if (segment.kind === 'tool-call') {
    return (
      <div class="srml-segment srml-segment--tool">
        <div class="srml-segment__label">
          <span class="srml-segment__tag srml-segment__tag--tool">&lt;|begin_of_tool_call|&gt;</span>
          <span class="srml-segment__name">工具调用</span>
        </div>
        <div class="srml-segment__tool-body">
          <div class="srml-segment__tool-row">
            <span class="srml-segment__tool-key">名称</span>
            <span class="srml-segment__tool-value">{segment.name || '(未解析出名称)'}</span>
          </div>
          {segment.arguments ? (
            <div class="srml-segment__tool-row">
              <span class="srml-segment__tool-key">参数</span>
              <pre class="srml-segment__tool-value">{segment.arguments}</pre>
            </div>
          ) : null}
        </div>
      </div>
    )
  }
  return (
    <div class="srml-segment srml-segment--response">
      <div class="srml-segment__label">
        <span class="srml-segment__tag srml-segment__tag--response">&lt;begin_of_response&gt;</span>
        <span class="srml-segment__name">回复</span>
      </div>
      <div class="srml-segment__content">{segment.content}</div>
    </div>
  )
}

function TaskCard({
  block,
  branchId,
  branch,
  onContinue,
  onDiscard,
}: {
  block: SrmlTaskBlock
  branchId?: number
  branch?: SrmlBranchSummary
  onContinue?: (branchId: number) => void
  onDiscard?: (branchId: number) => void
}) {
  const discarded = branch?.discarded === true
  const actionable = !discarded && branchId !== undefined && onContinue !== undefined && onDiscard !== undefined
  return (
    <div class={`srml-task${discarded ? ' srml-task--discarded' : ''}`}>
      <div class="srml-task__head">
        <span class="srml-task__tag">&lt;|begin_of_task_{block.id}|&gt;</span>
        <span class="srml-task__title">任务 {block.id}</span>
        <span class="srml-task__count">{block.segments.length} 段</span>
        {branch && !discarded && (
          <span class="srml-task__branch-chip">
            {branch.label}
            {branch.summary ? ` · ${branch.summary}` : ''}
          </span>
        )}
        {discarded && <span class="srml-task__discarded">已丢弃</span>}
        {actionable && (
          <span class="srml-task__actions">
            <button
              type="button"
              class="srml-task__action srml-task__action--continue"
              onClick={() => onContinue(branchId as number)}
            >
              继续
            </button>
            <button
              type="button"
              class="srml-task__action srml-task__action--discard"
              onClick={() => onDiscard(branchId as number)}
            >
              丢弃
            </button>
          </span>
        )}
      </div>
      <div class="srml-task__segments">
        {block.segments.map((segment, index) => (
          <SegmentCard key={index} segment={segment} />
        ))}
      </div>
    </div>
  )
}

function PartialTaskCard({ partial }: { partial: Extract<SrmlPartialState, { open: 'task' }> }) {
  return (
    <div class="srml-task srml-task--pending">
      <div class="srml-task__head">
        <span class="srml-task__tag">&lt;|begin_of_task_{partial.id}|&gt;</span>
        <span class="srml-task__title">任务 {partial.id}</span>
        <span class="srml-task__count">{partial.segments.length} 段</span>
        <span class="srml-task__live">解析中…</span>
      </div>
      <div class="srml-task__segments">
        {partial.segments.map((segment, index) => (
          <SegmentCard key={index} segment={segment} />
        ))}
        {partial.segment ? (
          <div class={`srml-segment srml-segment--pending srml-segment--${partial.segment.kind}`}>
            <div class="srml-segment__label">
              {partial.segment.kind === 'thought' ? (
                <span class="srml-segment__tag srml-segment__tag--thought">&lt;begin_of_thought&gt;</span>
              ) : partial.segment.kind === 'tool-call' ? (
                <span class="srml-segment__tag srml-segment__tag--tool">&lt;|begin_of_tool_call|&gt;</span>
              ) : (
                <span class="srml-segment__tag srml-segment__tag--response">&lt;begin_of_response&gt;</span>
              )}
              <span class="srml-segment__name">
                {partial.segment.kind === 'thought'
                  ? '思考'
                  : partial.segment.kind === 'tool-call'
                    ? '工具调用'
                    : '回复'}
              </span>
              <span class="srml-task__live">接收中</span>
            </div>
            <div class="srml-segment__content">{partial.segment.content || '…'}</div>
          </div>
        ) : (
          <div class="srml-task__waiting">
            {partial.loose ? <span class="srml-task__waiting-text">{partial.loose}</span> : null}
            等待段标签…
          </div>
        )}
      </div>
    </div>
  )
}

function ParsedTasks({
  blocks,
  partial,
  emptyHint,
  branchIdOf,
  branchOf,
  onContinue,
  onDiscard,
}: {
  blocks: SrmlTaskBlock[]
  partial: SrmlPartialState | null
  emptyHint: string
  branchIdOf?: (taskId: number) => number
  branchOf?: (branchId: number) => SrmlBranchSummary | undefined
  onContinue?: (branchId: number) => void
  onDiscard?: (branchId: number) => void
}) {
  if (blocks.length === 0 && !partial) {
    return <div class="srml-node__blocks-empty">{emptyHint}</div>
  }
  return (
    <div class="srml-node__tasks">
      {blocks.map((block) => {
        const branchId = branchIdOf?.(block.id)
        return (
          <TaskCard
            key={`${block.kind}-${block.id}`}
            block={block}
            branchId={branchId}
            branch={branchId !== undefined ? branchOf?.(branchId) : undefined}
            onContinue={onContinue}
            onDiscard={onDiscard}
          />
        )
      })}
      {partial?.open === 'task' && <PartialTaskCard partial={partial} />}
    </div>
  )
}

type TimelineItemProps = {
  event: SrmlEngineEvent
  branches: SrmlBranchSummary[]
  onContinueBranch: (branchId: number) => void
  onDiscardBranch: (branchId: number) => void
}

function TimelineItem({ event, branches, onContinueBranch, onDiscardBranch }: TimelineItemProps) {
  switch (event.type) {
    case 'exchange-start': {
      const prompts = promptsFrom(event.prompts)
      return (
        <div class="srml-node srml-node--request">
          <span class="srml-node__dot srml-node__dot--request" />
          <div class="srml-node__body">
            <div class="srml-node__title">
              <span class="srml-tag srml-tag--request">请求</span>
              第 {event.turn} 轮
              {event.branchId !== undefined ? (
                <span class="srml-node__count">→ 分支 {event.branchId}</span>
              ) : (
                <span class="srml-node__count">→ 新任务组（fork {prompts.length} 个任务）</span>
              )}
            </div>
            <div class="srml-node__prompt-chips">
              {prompts.map((item) => (
                <span key={item.id} class="srml-node__prompt-chip">
                  prompt_{item.id}
                  {item.thoughtEffort ? ` · effort ${item.thoughtEffort}` : ''}
                </span>
              ))}
            </div>
            <pre class="srml-node__original">{event.requestText}</pre>
          </div>
        </div>
      )
    }
    case 'plan':
      return (
        <div class="srml-node srml-node--plan">
          <span class="srml-node__dot srml-node__dot--plan" />
          <div class="srml-node__body">
            <div class="srml-node__title">
              <span class="srml-tag srml-tag--model">模型输出</span>
              第 {event.step} 步 · 解析出 {tasksFrom(event.blocks).length} 个任务
              {event.attempt > 1 && <span class="srml-node__count">（重试第 {event.attempt} 次）</span>}
              {event.branchId !== undefined && <span class="srml-node__count">（分支 {event.branchId}）</span>}
            </div>
            {event.warnings.length > 0 && (
              <div class="srml-node__warnings">
                {event.warnings.map((warning) => (
                  <span key={warning} class="srml-tag srml-tag--warn">
                    {warning}
                  </span>
                ))}
              </div>
            )}
            <div class="srml-node__compare">
              <div class="srml-node__compare-col">
                <div class="srml-node__compare-head srml-node__compare-head--raw">
                  <span class="srml-node__compare-dot" /> 模型输出原文
                </div>
                <pre class="srml-node__original">{event.raw}</pre>
              </div>
              <div class="srml-node__compare-col">
                <div class="srml-node__compare-head srml-node__compare-head--parsed">
                  <span class="srml-node__compare-dot" /> UI 解析结果
                </div>
                <ParsedTasks
                  blocks={tasksFrom(event.blocks)}
                  partial={null}
                  emptyHint="没有解析出任务"
                  branchIdOf={(taskId) => (event.branchId !== undefined ? event.branchId : taskId)}
                  branchOf={(branchId) => branches.find((branch) => branch.id === branchId)}
                  onContinue={onContinueBranch}
                  onDiscard={onDiscardBranch}
                />
              </div>
            </div>
          </div>
        </div>
      )
    case 'tool-executing':
      return (
        <div class="srml-node srml-node--tool">
          <span class="srml-node__dot srml-node__dot--tool" />
          <div class="srml-node__body">
            <div class="srml-node__title">
              <span class="srml-tag srml-tag--tool">工具执行中</span>
              任务 {event.taskId} · {event.name}
              <span class="srml-node__count">参数: {event.arguments}</span>
            </div>
          </div>
        </div>
      )
    case 'tool-result':
      return (
        <div class="srml-node srml-node--tool">
          <span class="srml-node__dot srml-node__dot--tool-done" />
          <div class="srml-node__body">
            <div class="srml-node__title">
              <span class="srml-tag srml-tag--tool-done">工具结果</span>
              任务 {event.taskId} · {event.name}
              <span class="srml-node__count">耗时 {event.ms}ms</span>
            </div>
            <pre class="srml-node__tool-result">{event.result}</pre>
          </div>
        </div>
      )
    case 'prediction-checked':
      return (
        <div class="srml-node srml-node--prediction">
          <span
            class={`srml-node__dot ${event.ok ? 'srml-node__dot--tool-done' : 'srml-node__dot--fail'}`}
          />
          <div class="srml-node__body">
            <div class="srml-node__title">
              <span class={`srml-tag ${event.ok ? 'srml-tag--tool-done' : 'srml-tag--retry'}`}>
                {event.ok ? '预判成立' : '预判不符'}
              </span>
              任务 {event.taskId} · {event.name}
            </div>
            {event.ok ? (
              <div class="srml-node__sub">
                expect 预判与真实返回相符（乐观成立），结果未回填，整轮仅消耗一次请求。
              </div>
            ) : (
              <>
                <div class="srml-node__sub">
                  expect 预判与真实返回不符，该 tool_call 之后的假设内容已作废，真实结果已回填并要求修正。
                </div>
                <pre class="srml-node__tool-result">{event.error}</pre>
              </>
            )}
          </div>
        </div>
      )
    case 'branch-created':
      return (
        <div class="srml-node srml-node--branch">
          <span class="srml-node__dot srml-node__dot--request" />
          <div class="srml-node__body">
            <div class="srml-node__title">
              <span class="srml-tag srml-tag--request">新分支</span>
              {event.branch.label}
              {event.branch.summary ? <span class="srml-node__count">· {event.branch.summary}</span> : null}
            </div>
          </div>
        </div>
      )
    case 'branch-discarded':
      return (
        <div class="srml-node srml-node--branch">
          <span class="srml-node__dot srml-node__dot--fail" />
          <div class="srml-node__body">
            <div class="srml-node__title">
              <span class="srml-tag srml-tag--retry">丢弃</span>
              分支 {event.branchId} 已丢弃，不再出现在发送目标与后续上下文中
            </div>
          </div>
        </div>
      )
    case 'retry-parse':
      return (
        <div class="srml-node srml-node--retry">
          <span class="srml-node__dot srml-node__dot--retry" />
          <div class="srml-node__body">
            <div class="srml-node__title">
              <span class="srml-tag srml-tag--retry">重试</span>
              第 {event.attempt} 次输出无法解析（{event.message}）
            </div>
          </div>
        </div>
      )
    case 'error':
      return (
        <div class="srml-node srml-node--error">
          <span class="srml-node__dot srml-node__dot--fail" />
          <div class="srml-node__body">
            <div class="srml-node__title">错误</div>
            <div class="srml-node__error">{event.message}</div>
          </div>
        </div>
      )
    case 'done':
      return (
        <div class="srml-node srml-node--done">
          <span class="srml-node__dot srml-node__dot--done" />
          <div class="srml-node__body">
            <div class="srml-node__title">完成 · LLM 调用 {event.llmCalls} 次</div>
            <div class="srml-node__sub">{event.summary}</div>
          </div>
        </div>
      )
  }
}

type StreamingState = {
  text: string
  tasks: SrmlTaskBlock[]
  partial: SrmlPartialState | null
  warnings: string[]
}

const EMPTY_STREAM: StreamingState = { text: '', tasks: [], partial: null, warnings: [] }

function EffortSelect({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <select
      class="srml-app__effort"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange((event.target as HTMLSelectElement).value)}
    >
      {EFFORT_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export function SrmlDemoApp() {
  const { closeWindowsForApp, minimizeWindow, setAppWindowTitle, windows } = useOs()
  const { showBuiltinAbout } = useAboutApp()

  const [events, setEvents] = useState<SrmlEngineEvent[]>([])
  const [running, setRunning] = useState(false)
  const [streaming, setStreaming] = useState<StreamingState>(EMPTY_STREAM)
  const [staged, setStaged] = useState<StagedPrompt[]>([])
  const [draft, setDraft] = useState('')
  const [draftEffort, setDraftEffort] = useState('')
  const [branches, setBranches] = useState<SrmlBranchSummary[]>([])
  const [targetKey, setTargetKey] = useState<string>(NEW_GROUP_KEY)

  const engineRef = useRef<SrmlEngine | null>(null)
  const stagedKeyRef = useRef(1)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)

  const systemPrompt = useMemo(() => buildSrmlSystemPrompt(), [])
  const dslSpec = useMemo(() => buildSrmlDslSpec(), [])

  const appendEvent = useCallback((event: SrmlEngineEvent) => {
    if (event.type === 'stream') {
      setStreaming({
        text: event.text,
        tasks: tasksFrom(event.blocks),
        partial: event.partial,
        warnings: event.warnings,
      })
      return
    }
    if (event.type === 'plan' || event.type === 'error' || event.type === 'done') {
      setStreaming(EMPTY_STREAM)
    }
    if (event.type === 'branch-created') {
      setBranches((current) => [...current, event.branch])
    }
    if (event.type === 'branch-discarded') {
      setBranches((current) =>
        current.map((branch) => (branch.id === event.branchId ? { ...branch, discarded: true } : branch)),
      )
    }
    setEvents((current) => [...current, event])
  }, [])

  /** 同一会话复用同一个引擎（分支结构在引擎内维护） */
  const ensureEngine = useCallback(() => {
    if (!engineRef.current) {
      engineRef.current = new SrmlEngine({ agent: new SrmlAgent(), onEvent: appendEvent })
    }
    return engineRef.current
  }, [appendEvent])

  const addDraftToStaged = useCallback(() => {
    const content = draft.trim()
    if (!content || running) return
    setStaged((current) => [
      ...current,
      { key: stagedKeyRef.current++, content, thoughtEffort: draftEffort },
    ])
    setDraft('')
  }, [draft, draftEffort, running])

  const updateStaged = useCallback((key: number, patch: Partial<StagedPrompt>) => {
    setStaged((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  }, [])

  const removeStaged = useCallback((key: number) => {
    setStaged((current) => current.filter((item) => item.key !== key))
  }, [])

  const loadTemplate = useCallback(
    (scenario: SrmlScenario) => {
      if (running) return
      setStaged((current) => [
        ...current,
        ...scenario.prompts.map((prompt) => ({
          key: stagedKeyRef.current++,
          content: prompt.content,
          thoughtEffort: prompt.thoughtEffort ?? '',
        })),
      ])
    },
    [running],
  )

  const continueOnBranch = useCallback(
    (branchId: number) => {
      setTargetKey(String(branchId))
      composerRef.current?.focus()
    },
    [],
  )

  const discardBranch = useCallback((branchId: number) => {
    engineRef.current?.discardBranch(branchId)
  }, [])

  const submit = useCallback(async () => {
    if (running || staged.length === 0) return
    const branchId = targetKey === NEW_GROUP_KEY ? undefined : Number(targetKey)
    const prompts: SrmlPromptBlock[] = staged.map((item) => {
      const prompt: SrmlPromptBlock = { kind: 'prompt', id: nextPromptId++, content: item.content }
      if (item.thoughtEffort) prompt.thoughtEffort = item.thoughtEffort
      return prompt
    })
    setStaged([])
    setStreaming(EMPTY_STREAM)
    // 每次提交后重置发送目标，避免误把下一次提交发到旧分支
    setTargetKey(NEW_GROUP_KEY)
    setRunning(true)
    const engine = ensureEngine()
    try {
      await engine.run(prompts, { branchId })
    } finally {
      setRunning(false)
    }
  }, [ensureEngine, running, staged, targetKey])

  const abortDemo = useCallback(() => {
    engineRef.current?.abort()
  }, [])

  const resetDemo = useCallback(() => {
    engineRef.current?.abort()
    engineRef.current = null
    setEvents([])
    setStreaming(EMPTY_STREAM)
    setStaged([])
    setDraft('')
    setBranches([])
    setTargetKey(NEW_GROUP_KEY)
    setRunning(false)
  }, [])

  useEffect(() => {
    setAppWindowTitle('srml-demo', 'SRML 演示')
    return () => {
      engineRef.current?.abort()
      engineRef.current = null
    }
  }, [setAppWindowTitle])

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === 'srml-demo' && !window.minimized)
    return [
      {
        label: 'SRML',
        items: [
          ...aboutAppMenuPrefix('关于 SRML 演示', () => showBuiltinAbout('srml-demo')),
          {
            type: 'action',
            label: '隐藏 SRML 演示',
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出 SRML 演示',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp('srml-demo'),
          },
        ],
      },
      {
        label: '文件',
        items: [
          {
            type: 'action',
            label: '清空会话',
            shortcut: '⌘N',
            onClick: resetDemo,
            disabled: running,
          },
          {
            type: 'action',
            label: running ? '生成中…' : `提交 ${staged.length} 个任务`,
            shortcut: '⌘R',
            onClick: () => (running ? abortDemo() : void submit()),
            disabled: !running && staged.length === 0,
          },
        ],
      },
    ]
  }, [abortDemo, closeWindowsForApp, minimizeWindow, resetDemo, running, showBuiltinAbout, staged.length, submit, windows])

  useAppMenuBar('srml-demo', menuBar)

  return (
    <div class="srml-app">
      <aside class="srml-app__sidebar">
        <div class="srml-app__brand">
          <span class="srml-app__brand-mark" aria-hidden="true">
            ⚡
          </span>
          <span class="srml-app__brand-text">SRML 演示</span>
        </div>

        <div class="srml-app__section">
          <label class="srml-app__label">模板（填入暂存区）</label>
          <div class="srml-app__templates">
            {SRML_SCENARIOS.map((scenario) => (
              <button
                key={scenario.id}
                type="button"
                class="srml-app__template"
                disabled={running}
                onClick={() => loadTemplate(scenario)}
              >
                <span class="srml-app__template-title">{scenario.title}</span>
                <span class="srml-app__template-desc">{scenario.description}</span>
              </button>
            ))}
          </div>
          <p class="srml-app__hint">也可以自己输入内容、设置思考强度，添加到暂存区。</p>
        </div>

        <div class="srml-app__status">
          <div class="srml-app__status-row">
            <span class="srml-app__status-key">状态</span>
            <span class={`srml-app__status-value srml-app__status-value--${running ? 'run' : 'idle'}`}>
              {running ? '生成中' : '就绪'}
            </span>
          </div>
          <div class="srml-app__status-row">
            <span class="srml-app__status-key">暂存任务</span>
            <span class="srml-app__status-value">{staged.length}</span>
          </div>
          <div class="srml-app__status-row">
            <span class="srml-app__status-key">分支</span>
            <span class="srml-app__status-value">{branches.filter((branch) => !branch.discarded).length}</span>
          </div>
        </div>

        <div class="srml-app__actions">
          <button type="button" class="srml-app__btn srml-app__btn--new" onClick={resetDemo} disabled={running}>
            清空会话
          </button>
        </div>
      </aside>

      <div class="srml-app__main">
        <div class="srml-app__conversation">
          <details class="srml-app__system">
            <summary class="srml-app__system-summary">发给模型的内容：系统提示词 + DSL 规范（点击展开）</summary>
            <div class="srml-app__system-body">
              <div class="srml-app__system-label">系统提示词（System Prompt）</div>
              <pre class="srml-node__original">{systemPrompt}</pre>
              <div class="srml-app__system-label">DSL 规范（随系统提示词一并发送）</div>
              <pre class="srml-node__original">{dslSpec}</pre>
            </div>
          </details>

          {events.length === 0 && staged.length === 0 && !running ? (
            <div class="srml-app__empty">
              <div class="srml-app__empty-icon" aria-hidden="true">
                ⚡
              </div>
              <h2 class="srml-app__empty-title">标签 DSL · Fork 演示</h2>
              <p class="srml-app__empty-text">
                支持 Fork 的聊天：输入内容会进入<b>暂存区</b>，可以同时堆多个任务，
                全部准备好后一次<b>提交</b>给 AI。AI 在一次回复里用
                <code>&lt;|begin_of_task_N|&gt;</code> 为每个任务输出结果，
                思考打包在 <code>&lt;begin_of_thought&gt;</code> 里。
              </p>
              <div class="srml-app__empty-steps">
                <div>1. 在底部输入内容（可设置思考强度），点「添加到暂存区」</div>
                <div>2. 重复添加，堆出多个任务（Fork）</div>
                <div>3. 提交后，每个任务成为一个分支</div>
                <div>4. 模型需要外部信息时会输出工具调用，引擎执行后回填结果再继续</div>
                <div>5. 分支卡片上可「继续」（只带该分支历史再聊）或「丢弃」</div>
              </div>
            </div>
          ) : (
            <>
              {events.map((event, index) => (
                <TimelineItem
                  key={index}
                  event={event}
                  branches={branches}
                  onContinueBranch={continueOnBranch}
                  onDiscardBranch={discardBranch}
                />
              ))}
              {streaming.text && (
                <div class="srml-node srml-node--stream">
                  <span class="srml-node__dot srml-node__dot--stream" />
                  <div class="srml-node__body">
                    <div class="srml-node__title">
                      <span class="srml-tag srml-tag--model">模型输出</span>实时生成中
                      <span class="srml-node__count">
                        已解析 {streaming.tasks.length} 个任务
                        {streaming.partial?.open === 'task' ? ` · 正在解析任务 ${streaming.partial.id}` : ''}
                      </span>
                    </div>
                    {streaming.warnings.length > 0 && (
                      <div class="srml-node__warnings">
                        {streaming.warnings.map((warning, warningIndex) => (
                          <span key={warningIndex} class="srml-tag srml-tag--warn">
                            {warning}
                          </span>
                        ))}
                      </div>
                    )}
                    <div class="srml-node__compare">
                      <div class="srml-node__compare-col">
                        <div class="srml-node__compare-head srml-node__compare-head--raw">
                          <span class="srml-node__compare-dot" /> 模型输出原文（实时）
                        </div>
                        <pre class="srml-node__original srml-node__original--stream">{streaming.text}</pre>
                      </div>
                      <div class="srml-node__compare-col">
                        <div class="srml-node__compare-head srml-node__compare-head--parsed">
                          <span class="srml-node__compare-dot" /> 实时解析
                        </div>
                        <ParsedTasks
                          blocks={streaming.tasks}
                          partial={streaming.partial}
                          emptyHint="等待 &lt;|begin_of_task|&gt; 标签…"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {staged.length > 0 && (
            <div class="srml-app__staged">
              <div class="srml-app__staged-head">
                <span class="srml-app__staged-title">暂存区 · 待提交 {staged.length} 个任务</span>
                <span class="srml-app__staged-hint">提交后合并为一次请求发给 AI（Fork）</span>
              </div>
              <div class="srml-app__staged-list">
                {staged.map((item) => (
                  <div key={item.key} class="srml-app__staged-item">
                    <div class="srml-app__staged-item-head">
                      <span class="srml-node__prompt-chip">待提交 prompt</span>
                      <EffortSelect
                        value={item.thoughtEffort}
                        disabled={running}
                        onChange={(effort) => updateStaged(item.key, { thoughtEffort: effort })}
                      />
                      <button
                        type="button"
                        class="srml-app__staged-remove"
                        disabled={running}
                        onClick={() => removeStaged(item.key)}
                      >
                        移除
                      </button>
                    </div>
                    <textarea
                      class="srml-app__staged-content"
                      value={item.content}
                      disabled={running}
                      rows={Math.min(6, Math.max(2, item.content.split('\n').length))}
                      onChange={(event) => updateStaged(item.key, { content: (event.target as HTMLTextAreaElement).value })}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div class="srml-app__composer">
          <textarea
            ref={composerRef}
            class="srml-app__composer-input"
            value={draft}
            placeholder="输入要发给 AI 的内容（Enter 换行）"
            disabled={running}
            onChange={(event) => setDraft((event.target as HTMLTextAreaElement).value)}
          />
          <div class="srml-app__composer-bar">
            <select
              class="srml-app__target"
              value={targetKey}
              disabled={running}
              onChange={(event) => setTargetKey((event.target as HTMLSelectElement).value)}
              title="选择把暂存区任务发给谁：新任务组不带历史；选中分支只携带该分支的历史"
            >
              <option value={NEW_GROUP_KEY}>发送到：新任务组（不带历史）</option>
              {branches
                .filter((branch) => !branch.discarded)
                .map((branch) => (
                  <option key={branch.id} value={String(branch.id)}>
                    发送到：{branch.label}
                    {branch.summary ? ` · ${branch.summary}` : ''}
                  </option>
                ))}
            </select>
            <EffortSelect value={draftEffort} disabled={running} onChange={setDraftEffort} />
            <button
              type="button"
              class="srml-app__btn srml-app__btn--new"
              disabled={running || !draft.trim()}
              onClick={addDraftToStaged}
            >
              + 添加到暂存区
            </button>
            {running ? (
              <button type="button" class="srml-app__btn srml-app__btn--abort" onClick={abortDemo}>
                中止
              </button>
            ) : (
              <button
                type="button"
                class="srml-app__btn srml-app__btn--run"
                disabled={staged.length === 0}
                onClick={() => void submit()}
              >
                提交 {staged.length > 0 ? `${staged.length} 个任务` : ''}给 AI
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
