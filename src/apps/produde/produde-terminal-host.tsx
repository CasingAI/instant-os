import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { TerminalReplHandle } from '../terminal/terminal-repl-panel.tsx'
import { TerminalReplPanel } from '../terminal/terminal-repl-panel.tsx'
import { createFsRevisionMemoryInterceptor } from '../../quickjs/fs-revision-memory-interceptor.ts'
import type { QuickJsSyscallInterceptor } from '../../quickjs/quickjs-syscall.ts'
import type { VscodeAgentTerminalEnsureResult } from '../vscode/vscode-ai-run-command.ts'
import {
  createAiTerminalSession,
  type VscodeAgentTerminalSnapshot,
  type VscodeAiTerminalKind,
  type VscodeTerminalSession,
} from '../vscode/vscode-terminal-sessions.ts'
import { PRODUDE_DEFAULT_WORKSPACE } from './produde-types.ts'

export type ProdudeTerminalHostApi = {
  ensureAiTerminal: (
    kind: VscodeAiTerminalKind,
    chatSessionId: string,
    chatTitle: string,
  ) => Promise<VscodeAgentTerminalEnsureResult>
  getAiTerminalHandle: (
    kind: VscodeAiTerminalKind,
    chatSessionId: string,
  ) => TerminalReplHandle | undefined
  getAiTerminalSnapshot: (
    kind: VscodeAiTerminalKind,
    chatSessionId: string,
  ) => VscodeAgentTerminalSnapshot
  closeAiTerminal: (kind: VscodeAiTerminalKind, chatSessionId: string) => void
}

type ProdudeTerminalHostProps = {
  workspaceFolder: string
  onApiChange: (api: ProdudeTerminalHostApi | null) => void
}

/**
 * 隐藏挂载 InstantREPL，供 ProDude Agent 调用；不向用户展示终端 UI。
 */
export function ProdudeTerminalHost({ workspaceFolder, onApiChange }: ProdudeTerminalHostProps) {
  const [sessions, setSessions] = useState<VscodeTerminalSession[]>([])
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  const handlesRef = useRef(new Map<string, TerminalReplHandle>())
  const waitersRef = useRef(
    new Map<
      string,
      {
        resolve: (handle: TerminalReplHandle) => void
        reject: (error: Error) => void
        promise: Promise<TerminalReplHandle>
      }
    >(),
  )
  const closedByKindRef = useRef<Record<VscodeAiTerminalKind, Set<string>>>({
    ask: new Set(),
    plan: new Set(),
    agent: new Set(),
  })
  // 第九期：agent 会话实例挂「记读、写时带期望版本」拦截器；按 chat 维度一份，
  // 实例重建（fsMode/reset）后延续该会话对文件的已知版本；ask/plan 只读、无需挂。
  const revisionMemoryRef = useRef(new Map<string, readonly QuickJsSyscallInterceptor[]>())
  const interceptorsForSession = useCallback((session: VscodeTerminalSession) => {
    if (session.kind !== 'agent') return undefined
    const key = session.ownerChatId ?? session.id
    let list = revisionMemoryRef.current.get(key)
    if (!list) {
      list = [createFsRevisionMemoryInterceptor()]
      revisionMemoryRef.current.set(key, list)
    }
    return list
  }, [])

  const workspaceRoot = workspaceFolder.trim() || PRODUDE_DEFAULT_WORKSPACE

  const bindHandle = useCallback((sessionId: string, handle: TerminalReplHandle | null) => {
    if (handle) {
      handlesRef.current.set(sessionId, handle)
      const waiter = waitersRef.current.get(sessionId)
      if (waiter) {
        waiter.resolve(handle)
        waitersRef.current.delete(sessionId)
      }
    } else {
      handlesRef.current.delete(sessionId)
    }
  }, [])

  const waitForHandle = useCallback((sessionId: string) => {
    const existing = handlesRef.current.get(sessionId)
    if (existing) return Promise.resolve(existing)
    const pending = waitersRef.current.get(sessionId)
    if (pending) return pending.promise
    let resolve!: (handle: TerminalReplHandle) => void
    let reject!: (error: Error) => void
    const promise = new Promise<TerminalReplHandle>((res, rej) => {
      resolve = res
      reject = rej
    })
    waitersRef.current.set(sessionId, { resolve, reject, promise })
    window.setTimeout(() => {
      const current = waitersRef.current.get(sessionId)
      if (current?.promise !== promise) return
      waitersRef.current.delete(sessionId)
      reject(new Error('终端实例创建超时'))
    }, 8_000)
    return promise
  }, [])

  const closeAiTerminal = useCallback((kind: VscodeAiTerminalKind, chatSessionId: string) => {
    const session = sessionsRef.current.find(
      (item) => item.kind === kind && item.ownerChatId === chatSessionId,
    )
    if (!session) return
    closedByKindRef.current[kind].add(chatSessionId)
    handlesRef.current.delete(session.id)
    const waiter = waitersRef.current.get(session.id)
    if (waiter) {
      waiter.reject(new Error('终端已关闭'))
      waitersRef.current.delete(session.id)
    }
    setSessions((prev) => prev.filter((item) => item.id !== session.id))
  }, [])

  const ensureAiTerminal = useCallback(
    async (
      kind: VscodeAiTerminalKind,
      chatSessionId: string,
      chatTitle: string,
    ): Promise<VscodeAgentTerminalEnsureResult> => {
      const existing = sessionsRef.current.find(
        (item) => item.kind === kind && item.ownerChatId === chatSessionId,
      )
      if (existing) {
        try {
          const handle = await waitForHandle(existing.id)
          return {
            handle,
            sessionId: existing.id,
            created: false,
            reason: 'reused',
            kind,
          }
        } catch {
          // 超时则重建
        }
      }

      const closedSet = closedByKindRef.current[kind]
      const reason = closedSet.has(chatSessionId) ? 'rebuilt' : 'new'
      closedSet.delete(chatSessionId)
      const session = createAiTerminalSession(kind, chatSessionId, chatTitle)
      setSessions((prev) => [
        ...prev.filter((item) => !(item.kind === kind && item.ownerChatId === chatSessionId)),
        session,
      ])
      const handle = await waitForHandle(session.id)
      return {
        handle,
        sessionId: session.id,
        created: true,
        reason,
        kind,
      }
    },
    [waitForHandle],
  )

  const getAiTerminalHandle = useCallback(
    (kind: VscodeAiTerminalKind, chatSessionId: string) => {
      const session = sessionsRef.current.find(
        (item) => item.kind === kind && item.ownerChatId === chatSessionId,
      )
      if (!session) return undefined
      return handlesRef.current.get(session.id)
    },
    [],
  )

  const getAiTerminalSnapshot = useCallback(
    (kind: VscodeAiTerminalKind, chatSessionId: string): VscodeAgentTerminalSnapshot => {
      const session = sessionsRef.current.find(
        (item) => item.kind === kind && item.ownerChatId === chatSessionId,
      )
      if (session) {
        const handle = handlesRef.current.get(session.id)
        if (handle) {
          return {
            sessionId: session.id,
            cwd: handle.getCwd(),
            tmpdir: handle.getTmpDir(),
            status: 'alive',
          }
        }
        return {
          sessionId: session.id,
          cwd: workspaceRoot,
          status: 'alive',
          recovering: true,
        }
      }
      if (closedByKindRef.current[kind].has(chatSessionId)) {
        return { status: 'closed' }
      }
      return { status: 'none' }
    },
    [workspaceRoot],
  )

  const api = useMemo<ProdudeTerminalHostApi>(
    () => ({
      ensureAiTerminal,
      getAiTerminalHandle,
      getAiTerminalSnapshot,
      closeAiTerminal,
    }),
    [closeAiTerminal, ensureAiTerminal, getAiTerminalHandle, getAiTerminalSnapshot],
  )

  useEffect(() => {
    onApiChange(api)
    return () => onApiChange(null)
  }, [api, onApiChange])

  useEffect(() => {
    setSessions([])
    handlesRef.current.clear()
    for (const waiter of waitersRef.current.values()) {
      waiter.reject(new Error('工作区已变更'))
    }
    waitersRef.current.clear()
  }, [workspaceRoot])

  return (
    <div class="produde-app__terminal-host" aria-hidden="true">
      {sessions.map((session) => (
        <div key={`${session.id}:${workspaceRoot}`} class="produde-app__terminal-slot">
          <TerminalReplPanel
            workspaceRoot={workspaceRoot}
            handleRef={(handle) => bindHandle(session.id, handle)}
            className="produde-app__terminal-panel"
            welcomeLines={[]}
            ariaLabel={session.title}
            fsMode={session.fsMode}
            interceptors={interceptorsForSession(session)}
          />
        </div>
      ))}
    </div>
  )
}
