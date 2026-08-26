/**
 * 第十二期：iCode「对话」外壳——直接复用 vscode 的 VscodeAiPanel。
 *
 * 引擎不动（第三期接的受控终端 agent 循环、写入硬限草稿根、整轮回滚），本组件只喂
 * iCode 自己的 host：
 * - 会话：每应用一个会话，落包 Developer/ai-sessions.json（500ms 合并写 + 卸载/页隐藏兜底）；
 *   不读旧 chat.json（留盘只读存档）。
 * - 模型偏好：不读 vscode 偏好，写 Developer/ai-prefs.json。
 * - 工具：VS Code 默认工具集 + request_capability（确认走面板内嵌横幅「请求用户拍板」）；
 *   plan/agent 模式的计划工具换成落草稿树 Plans/ 的变体。
 * - 变更确认流程不启用：agent 写完即落草稿（autoKeepTerminalChanges）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { GeneratedAppId } from '../../os/types.ts'
import type { IcodeDraftFile } from '../../os/icode-managed-apps.ts'
import {
  loadIcodeAiPrefs,
  loadIcodeAiSessions,
  saveIcodeAiPrefs,
  saveIcodeAiSessions,
} from '../../os/icode-managed-apps.ts'
import type { AgentTool } from '../../ai/agent-tool.ts'
import type { MonacoProblem } from '../../monaco/monaco-markers.ts'
import type { ProdudeTerminalHostApi } from '../produde/produde-terminal-host.tsx'
import {
  createVscodeAiChatSessionId,
  type VscodeAiChatSession,
} from '../vscode/vscode-ai-chat-storage.ts'
import type { VscodeAiMode } from '../vscode/vscode-ai-mode.ts'
import type { TerminalChangeSet } from '../../terminal/terminal-changeset.ts'
import type { VscodeAiLastChangeSource } from '../vscode/vscode-ai-run-command.ts'
import { createVscodeAiTools, type VscodeAiToolsHost } from '../vscode/vscode-ai-tools.ts'
import type { AiUsageContext } from '../../ai/ai-usage-context.ts'
import { VscodeAiPanel } from '../vscode/vscode-ai-panel.tsx'
import type { VscodeAiModelOptionPrefs, VscodeModelSource } from '../vscode/vscode-prefs.ts'
import {
  buildIcodeAgentContext,
  buildIcodeAgentSystemPrompt,
  createIcodePlanTools,
  createRequestCapabilityTool,
  icodeChatSessionId,
  ICODE_CAPABILITY_TAG_LABELS,
  type IcodeCapabilityTag,
} from './icode-agent.ts'

const SESSION_SAVE_DEBOUNCE_MS = 500

const ICODE_AI_USAGE_CONTEXT: AiUsageContext = {
  actor: 'icode',
  behavior: 'chat',
  actorLabel: 'iCode',
  behaviorLabel: '编辑',
}

function newFreshSession(appName: string): VscodeAiChatSession {
  return {
    id: createVscodeAiChatSessionId(),
    title: appName ? `${appName} 编辑` : '新对话',
    messages: [],
    updatedAt: Date.now(),
  }
}

export type IcodeAiChatPanelProps = {
  appId: GeneratedAppId
  appName: string
  draftRoot: string
  draftFiles: readonly IcodeDraftFile[]
  /** 二进制资源只把路径写进给模型的清单 */
  binaryPaths: readonly string[]
  grantedCapabilities: readonly IcodeCapabilityTag[]
  /** 横幅同意后由宿主写清单标签并刷预览 */
  onGrantCapability: (tag: IcodeCapabilityTag) => void
  problems: readonly MonacoProblem[]
  terminalApi: ProdudeTerminalHostApi | null
  /** 一轮开始前把源码页工作副本落盘，agent 才能读到最新内容 */
  onBeforeAgentTurn: () => void
}

export function IcodeAiChatPanel(props: IcodeAiChatPanelProps) {
  const chatSessionId = useMemo(() => icodeChatSessionId(props.appId), [props.appId])
  const chatTitle = useMemo(() => props.appName.slice(0, 24) || 'iCode', [props.appName])

  // ---- 可变 props 走 ref：回调保持稳定身份，取值时读当前值 ----

  const terminalApiRef = useRef(props.terminalApi)
  terminalApiRef.current = props.terminalApi
  const appIdRef = useRef(props.appId)
  appIdRef.current = props.appId
  const grantedRef = useRef(props.grantedCapabilities)
  grantedRef.current = props.grantedCapabilities
  const problemsRef = useRef(props.problems)
  problemsRef.current = props.problems
  const manifestPathsRef = useRef<readonly string[]>([])
  manifestPathsRef.current = useMemo(
    () => [
      ...props.draftFiles.map((file) => file.path),
      ...props.binaryPaths,
    ],
    [props.draftFiles, props.binaryPaths],
  )
  const grantRef = useRef(props.onGrantCapability)
  grantRef.current = props.onGrantCapability
  const beforeTurnRef = useRef(props.onBeforeAgentTurn)
  beforeTurnRef.current = props.onBeforeAgentTurn
  const draftRootRef = useRef(props.draftRoot)
  draftRootRef.current = props.draftRoot

  // ---- 会话状态与持久化（每应用一个会话） ----

  const [session, setSession] = useState<VscodeAiChatSession | undefined>()
  const sessionRef = useRef(session)
  sessionRef.current = session
  const saveTimerRef = useRef<number | undefined>(undefined)

  const persistNow = useCallback(() => {
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = undefined
    }
    const current = sessionRef.current
    if (!current) return
    void saveIcodeAiSessions(appIdRef.current, {
      openSessions: [current],
      activeSessionId: current.id,
    }).catch(() => undefined)
  }, [])

  const schedulePersist = useCallback(() => {
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = undefined
      persistNow()
    }, SESSION_SAVE_DEBOUNCE_MS)
  }, [persistNow])

  useEffect(() => {
    let cancelled = false
    setSession(undefined)
    void (async () => {
      try {
        const file = await loadIcodeAiSessions(appIdRef.current)
        if (!cancelled) {
          setSession(file.openSessions[0] ?? newFreshSession(chatTitle))
        }
      } catch {
        if (!cancelled) {
          setSession(newFreshSession(chatTitle))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [appIdRef, chatTitle])

  useEffect(() => {
    const flush = () => persistNow()
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [persistNow])

  const onMessagesChange = useCallback(
    (
      messages: VscodeAiChatSession['messages'],
      extras?: {
        apiTranscript?: VscodeAiChatSession['apiTranscript']
        wireTranscript?: VscodeAiChatSession['wireTranscript']
      },
    ) => {
      setSession((current) => {
        if (!current) return current
        return {
          ...current,
          messages,
          updatedAt: Date.now(),
          ...(extras
            ? {
                apiTranscript: extras.apiTranscript,
                wireTranscript: extras.wireTranscript,
              }
            : {}),
        }
      })
      schedulePersist()
    },
    [schedulePersist],
  )

  const onLastSentTerminalChange = useCallback(
    (value: VscodeAiChatSession['lastSentTerminal']) => {
      setSession((current) =>
        current ? { ...current, lastSentTerminal: value ?? undefined } : current,
      )
      schedulePersist()
    },
    [schedulePersist],
  )

  // ---- 模型偏好（不读 vscode 偏好；写 Developer/ai-prefs.json） ----

  const [modelSource, setModelSource] = useState<VscodeModelSource>('text')
  const [modelKey, setModelKey] = useState<string | undefined>(undefined)
  const [modelOptions, setModelOptions] = useState<Record<string, VscodeAiModelOptionPrefs>>({})
  const modelPrefsRef = useRef({ source: modelSource as VscodeModelSource, key: modelKey, options: modelOptions })
  const prefsLoadedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    prefsLoadedRef.current = false
    void (async () => {
      try {
        const prefs = await loadIcodeAiPrefs(appIdRef.current)
        if (!cancelled) {
          const source = (['text-secondary', 'text', 'custom'] as const).find(
            (item) => item === prefs.aiModelSource,
          )
          if (source) setModelSource(source)
          if (typeof prefs.aiModelKey === 'string' && prefs.aiModelKey.trim()) {
            setModelKey(prefs.aiModelKey)
          }
          if (prefs.aiModelOptions && typeof prefs.aiModelOptions === 'object') {
            setModelOptions(prefs.aiModelOptions as Record<string, VscodeAiModelOptionPrefs>)
          }
        }
      } catch {
        // 无偏好文件按默认走
      } finally {
        if (!cancelled) prefsLoadedRef.current = true
      }
    })()
    return () => {
      cancelled = true
    }
  }, [appIdRef])

  const persistModelPrefs = useCallback(() => {
    if (!prefsLoadedRef.current) return
    const snapshot = modelPrefsRef.current
    void saveIcodeAiPrefs(appIdRef.current, {
      aiModelSource: snapshot.source,
      aiModelKey: snapshot.key,
      aiModelOptions: snapshot.options,
    }).catch(() => undefined)
  }, [appIdRef])

  const handleModelSelectionChange = useCallback(
    (source: VscodeModelSource, key: string | undefined) => {
      modelPrefsRef.current.source = source
      modelPrefsRef.current.key = key
      setModelSource(source)
      setModelKey(key)
      persistModelPrefs()
    },
    [persistModelPrefs],
  )

  const handleModelOptionsChange = useCallback(
    (next: Record<string, VscodeAiModelOptionPrefs>) => {
      modelPrefsRef.current.options = next
      setModelOptions(next)
      persistModelPrefs()
    },
    [persistModelPrefs],
  )

  // ---- 三档模式；默认 agent（iCode 不持久化模式，重开回到 agent） ----

  const [mode, setMode] = useState<VscodeAiMode>('agent')

  // ---- 受控变更槽 / 终端桥（沿用第三期 Produde 宿主） ----

  const npmLastChangesByRef = useRef(
    new Map<string, { current: TerminalChangeSet | undefined }>(),
  )
  const lastChangeSourceByRef = useRef(
    new Map<string, { current: VscodeAiLastChangeSource | undefined }>(),
  )

  const getNpmLastChangesSlot = useCallback((id: string) => {
    let slot = npmLastChangesByRef.current.get(id)
    if (!slot) {
      slot = { current: undefined }
      npmLastChangesByRef.current.set(id, slot)
    }
    return slot
  }, [])

  const getLastChangeSourceSlot = useCallback((id: string) => {
    let slot = lastChangeSourceByRef.current.get(id)
    if (!slot) {
      slot = { current: undefined }
      lastChangeSourceByRef.current.set(id, slot)
    }
    return slot
  }, [])

  const ensureAiTerminal = useCallback(
    async (kind: Parameters<ProdudeTerminalHostApi['ensureAiTerminal']>[0], id: string, title: string) => {
      const api = terminalApiRef.current
      if (!api) throw new Error('开发终端不可用，无法编辑')
      return api.ensureAiTerminal(kind, id, title)
    },
    [],
  )

  const getAiTerminalHandle = useCallback(
    (kind: Parameters<ProdudeTerminalHostApi['getAiTerminalHandle']>[0], id: string) =>
      terminalApiRef.current?.getAiTerminalHandle(kind, id),
    [],
  )

  const getAiTerminalSnapshot = useCallback(
    (kind: Parameters<ProdudeTerminalHostApi['getAiTerminalSnapshot']>[0], id: string) => {
      const api = terminalApiRef.current
      if (!api) return { status: 'none' } as ReturnType<ProdudeTerminalHostApi['getAiTerminalSnapshot']>
      return api.getAiTerminalSnapshot(kind, id)
    },
    [],
  )

  const closeAiTerminal = useCallback(
    (kind: Parameters<ProdudeTerminalHostApi['closeAiTerminal']>[0], id: string) => {
      terminalApiRef.current?.closeAiTerminal(kind, id)
    },
    [],
  )

  /** 编辑重发：拆掉本聊天绑定的全部 AI 终端（agent/ask/plan） */
  const closeAiTerminalsBoundToChat = useCallback((id: string) => {
    const api = terminalApiRef.current
    if (!api) return
    for (const kind of ['agent', 'ask', 'plan'] as const) {
      api.closeAiTerminal(kind, id)
    }
  }, [])

  // ---- 引擎覆盖注入：工具 / 系统提示 / 用量 ----

  const agentCreateTools = useCallback(
    (turnMode: VscodeAiMode, host: VscodeAiToolsHost): AgentTool[] => {
      // 计划工具换成草稿树 Plans/ 变体；能力工具追加在默认集后
      const excluded =
        turnMode === 'plan'
          ? ['write_plan']
          : turnMode === 'agent'
            ? ['update_plan']
            : ['write_plan', 'update_plan']
      const tools = createVscodeAiTools(turnMode, host).filter(
        (tool) => !excluded.includes(tool.name),
      )
      if (turnMode === 'plan') {
        tools.push(createIcodePlanTools({ draftRoot: draftRootRef.current }).writePlan)
      }
      if (turnMode === 'agent') {
        tools.push(createIcodePlanTools({ draftRoot: draftRootRef.current }).updatePlan)
      }
      tools.push(
        createRequestCapabilityTool({
          grantedTags: grantedRef.current,
          requestCapability: async (tag, reason) => {
            const outcome =
              (await host.requestChange?.({
                title: '能力请求',
                message:
                  `AI 请求为「${props.appName}」授予${ICODE_CAPABILITY_TAG_LABELS[tag]}。` +
                  (reason ? `\n理由：${reason}` : ''),
                confirmLabel: '授予能力',
                cancelLabel: '暂不授予',
              })) ?? 'denied'
            if (outcome === 'approved') {
              grantRef.current(tag)
            }
            return outcome === 'approved'
          },
        }),
      )
      return tools
    },
    [props.appName],
  )

  const agentBuildSystemPrompt = useCallback(
    (turnMode: VscodeAiMode) =>
      buildIcodeAgentSystemPrompt({
        appName: props.appName,
        draftRoot: draftRootRef.current,
        fileManifest: manifestPathsRef.current,
        grantedCapabilities: grantedRef.current,
        mode: turnMode,
      }),
    [manifestPathsRef, props.appName],
  )

  const getContext = useCallback(
    () =>
      buildIcodeAgentContext(
        draftRootRef.current,
        terminalApiRef.current,
        chatSessionId,
        problemsRef.current,
      ),
    [chatSessionId],
  )

  const onBusyChange = useCallback((busy: boolean) => {
    if (busy) beforeTurnRef.current()
  }, [])

  const openPlanFileNoop = useCallback(async () => {}, [])

  // ---- 渲染 ----

  if (!session) {
    return <p class="icode__list--empty">正在加载对话…</p>
  }
  if (!props.terminalApi) {
    return <p class="icode__list--empty">正在准备开发终端…</p>
  }

  return (
    <div class="icode__ai-chat">
      <VscodeAiPanel
        sessionId={session.id}
        messages={session.messages}
        apiTranscript={session.apiTranscript}
        wireTranscript={session.wireTranscript}
        onMessagesChange={onMessagesChange}
        mode={mode}
        onModeChange={setMode}
        aiModelSource={modelSource}
        aiModelKey={modelKey}
        onAiModelSelectionChange={handleModelSelectionChange}
        aiModelOptions={modelOptions}
        onAiModelOptionsChange={handleModelOptionsChange}
        workspaceFolder={props.draftRoot}
        lastSentTerminal={session.lastSentTerminal}
        onLastSentTerminalChange={onLastSentTerminalChange}
        getContext={getContext}
        problems={props.problems}
        getNpmLastChangesSlot={getNpmLastChangesSlot}
        getLastChangeSourceSlot={getLastChangeSourceSlot}
        ensureAiTerminal={(kind, id, title) => ensureAiTerminal(kind, id, title)}
        getAiTerminalHandle={getAiTerminalHandle}
        getAiTerminalSnapshot={getAiTerminalSnapshot}
        closeAiTerminal={closeAiTerminal}
        closeAiTerminalsBoundToChat={closeAiTerminalsBoundToChat}
        openPlanFile={openPlanFileNoop}
        onBusyChange={onBusyChange}
        autoKeepTerminalChanges
        agentCreateTools={agentCreateTools}
        agentBuildSystemPrompt={agentBuildSystemPrompt}
        agentUsageContext={ICODE_AI_USAGE_CONTEXT}
      />
    </div>
  )
}
