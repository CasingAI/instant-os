import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { Ref } from 'preact'
import {
  createQuickJsInstance,
  formatFatalErrorMessage,
  isQuickJsWasmBoundaryFatalError,
  QUICKJS_MAX_CONSOLE_LINE_CHARS,
  QUICKJS_MAX_CONSOLE_LINES,
  type QuickJsConsoleLine,
  type QuickJsInstance,
} from '../../quickjs/quickjs-public.ts'
import { useDevExtApps } from '../../os/dev-ext-apps-context.tsx'
import { useGeneratedApps } from '../../os/generated-apps-context.tsx'
import { useOs } from '../../os/os-context.tsx'
import { useFlip3dScene } from '../../window/flip3d-context.tsx'
import {
  terminalColorsToStyle,
  type TerminalColors,
} from '../../terminal/terminal-colors.ts'
import { createTerminalInstantShellHost } from '../../terminal/instant-shell/create-terminal-instant-shell-host.ts'
import '../../terminal/terminal-panel.css'
import './terminal-repl-shell.css'
import { formatTerminalReplValue } from './terminal-repl-format.ts'
import { wrapTerminalProgramEval } from './terminal-repl-program-eval.ts'
import {
  buildReplCompletionEval,
  caretFromReplCompletionCycle,
  createReplCompletionCycle,
  cycleMatchesDraft,
  draftFromReplCompletionCycle,
  formatReplCompletionHint,
  HOST_REPL_DOT_COMMANDS,
  parseHostDotTarget,
  parseReplCompletionTarget,
  stepReplCompletionCycle,
  type ReplCompletionCycle,
} from './terminal-repl-tab-complete.ts'
import { formatTerminalChangeSummary } from '../../terminal/terminal-changeset.ts'
import type { TerminalChangeSet } from '../../terminal/terminal-changeset.ts'
import type { TerminalFsMode } from '../../terminal/terminal-fs-mode.ts'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import { terminalTmpDir } from '../files/files-tmp.ts'

export type TerminalReplRunSource = 'user' | 'program'

export type TerminalReplHandle = {
  runCode: (code: string, options?: { source?: TerminalReplRunSource }) => Promise<string>
  getCwd: () => string
  chdir: (path: string) => Promise<void>
  clear: () => void
  abort: () => void
  focus: () => void
  /** 向终端输出区追加一行信息（不经过 REPL 执行） */
  appendInfo: (text: string) => void
  getLastChanges: () => TerminalChangeSet | undefined
  /** 仅清除「上一轮可撤销」记录（文件已由外部回滚时用） */
  clearLastChanges: () => void
  /**
   * 回滚上一轮 ChangeSet，并轮换 sessionId、重建 QuickJS。
   * @returns 是否成功撤销（有可撤销变更时为 true）
   */
  revertLastChanges: () => Promise<boolean>
  /**
   * 轮换 sessionId 并重建 QuickJS（不回滚文件）。
   * 用于外部已回滚 ChangeSet 后仍需作废内存状态。
   */
  rebuildInstance: () => Promise<void>
  /** 当前终端 session UUID（对应 `/tmp/Terminal/{id}`） */
  getTerminalSessionId: () => string
  /** 当前 `os.tmpdir()` 路径 */
  getTmpDir: () => string
  /** 当前文件系统工作模式 */
  getFsMode: () => TerminalFsMode
}

export type TerminalReplPanelProps = {
  workspaceRoot: string
  colors?: Partial<TerminalColors>
  className?: string
  handleRef?: Ref<TerminalReplHandle | null>
  welcomeLines?: readonly string[]
  ariaLabel?: string
  /**
   * 文件系统工作模式（创建实例时冻结，切换会重建实例）。
   * - normal：可写，不记账
   * - readonly：禁止写
   * - controlled：可写并记录 ChangeSet
   */
  fsMode?: TerminalFsMode
  /** 受控模式下是否有可撤销的上一轮变更 */
  onChangesAvailable?: (available: boolean) => void
}

type DisplayLine =
  | { id: string; kind: 'input'; text: string; source: TerminalReplRunSource }
  | { id: string; kind: 'output'; level: QuickJsConsoleLine['level']; text: string }
  | { id: string; kind: 'result'; text: string }
  | { id: string; kind: 'error'; text: string }
  | { id: string; kind: 'info'; text: string }

const MAX_DISPLAY_LINES = QUICKJS_MAX_CONSOLE_LINES
const MAX_DISPLAY_LINE_CHARS = QUICKJS_MAX_CONSOLE_LINE_CHARS

function clipDisplayText(text: string): string {
  if (text.length <= MAX_DISPLAY_LINE_CHARS) return text
  return `${text.slice(0, MAX_DISPLAY_LINE_CHARS)}…`
}

function trimDisplayLines(lines: DisplayLine[]): DisplayLine[] {
  if (lines.length <= MAX_DISPLAY_LINES) return lines
  return lines.slice(-MAX_DISPLAY_LINES)
}

function consoleLevelClass(level: QuickJsConsoleLine['level']): string {
  if (level === 'error') return 'terminal-panel__line--error'
  if (level === 'warn') return 'terminal-panel__line--error'
  return ''
}

function formatEvalOutput(result: Awaited<ReturnType<QuickJsInstance['eval']>>): string {
  const consoleText = result.consoleLines.map((line) => line.text).join('\n').trim()
  const parts: string[] = []

  if (!result.ok) {
    parts.push(`【error】\n${result.error}`)
    if (consoleText) {
      parts.push(`【console】\n${consoleText}`)
    }
    return parts.join('\n\n')
  }

  if (consoleText) {
    parts.push(`【console】\n${consoleText}`)
  }
  const formatted = formatTerminalReplValue(result.value)
  if (formatted !== 'undefined') {
    parts.push(`【return】\n${formatted}`)
  }
  if (result.exitCode !== 0) {
    parts.push(`【exit】\nexitCode=${result.exitCode}`)
  }
  return parts.join('\n\n') || '（无输出）'
}

function formatRuntimeFatalMessage(reason: string): string {
  return (
    `【运行时致命错误】QuickJS 实例已销毁并重建；勿依赖此前内存变量；cwd 已重置为工作区根目录；webview 需重新 create。原因: ${reason}`
  )
}

export function TerminalReplPanel({
  workspaceRoot,
  colors,
  className,
  handleRef,
  welcomeLines,
  ariaLabel = '终端',
  fsMode = 'normal',
  onChangesAvailable,
}: TerminalReplPanelProps) {
  const {
    windows,
    openApp,
    openGeneratedApp,
    openExtApp,
    focusWindow,
    closeWindow,
    closeWindowsForApp,
    minimizeWindow,
    restoreWindow,
    toggleFullscreen,
    toggleMaximize,
  } = useOs()
  const { enterFlip3d } = useFlip3dScene()
  const { installedApps } = useGeneratedApps()
  const { sessionExtApps } = useDevExtApps()
  const modal = useWindowModal()

  const terminalSessionIdRef = useRef(crypto.randomUUID())
  const rotateTerminalSessionId = useCallback(() => {
    terminalSessionIdRef.current = crypto.randomUUID()
  }, [])
  const instanceRef = useRef<QuickJsInstance | undefined>(undefined)
  /** 合并并发 createInstance（mount boot 与 Agent runCode/ensureInstance 竞态）。 */
  const createInFlightRef = useRef<Promise<void> | undefined>(undefined)
  const mountedRef = useRef(true)
  const lineSeqRef = useRef(0)
  const windowsRef = useRef(windows)
  windowsRef.current = windows
  const installedAppsRef = useRef(installedApps)
  installedAppsRef.current = installedApps
  const sessionExtAppsRef = useRef(sessionExtApps)
  sessionExtAppsRef.current = sessionExtApps
  const openAppRef = useRef(openApp)
  openAppRef.current = openApp
  const openGeneratedAppRef = useRef(openGeneratedApp)
  openGeneratedAppRef.current = openGeneratedApp
  const openExtAppRef = useRef(openExtApp)
  openExtAppRef.current = openExtApp
  const focusWindowRef = useRef(focusWindow)
  focusWindowRef.current = focusWindow
  const closeWindowRef = useRef(closeWindow)
  closeWindowRef.current = closeWindow
  const closeWindowsForAppRef = useRef(closeWindowsForApp)
  closeWindowsForAppRef.current = closeWindowsForApp
  const minimizeWindowRef = useRef(minimizeWindow)
  minimizeWindowRef.current = minimizeWindow
  const restoreWindowRef = useRef(restoreWindow)
  restoreWindowRef.current = restoreWindow
  const toggleFullscreenRef = useRef(toggleFullscreen)
  toggleFullscreenRef.current = toggleFullscreen
  const toggleMaximizeRef = useRef(toggleMaximize)
  toggleMaximizeRef.current = toggleMaximize
  const modalRef = useRef(modal)
  modalRef.current = modal
  /** 当前 busy 切片开始时间；用于关窗确认（短交互命令不弹，长任务中途 close 才确认）。 */
  const busySinceRef = useRef<number | undefined>(undefined)
  const seenConsoleIdsRef = useRef(new Set<string>())
  const unsubRef = useRef<(() => void) | undefined>(undefined)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const draftRef = useRef('')
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const historyDraftRef = useRef('')
  const imeComposingRef = useRef(false)
  const imeGuardUntilRef = useRef(0)
  const justSubmittedRef = useRef(false)
  const completingRef = useRef(false)
  const tabCompletingRef = useRef(false)
  const completeCycleRef = useRef<ReplCompletionCycle | undefined>(undefined)
  const caretRef = useRef<number | undefined>(undefined)
  const workspaceRootRef = useRef(workspaceRoot)
  workspaceRootRef.current = workspaceRoot
  const fsModeRef = useRef(fsMode)
  fsModeRef.current = fsMode
  const onChangesAvailableRef = useRef(onChangesAvailable)
  onChangesAvailableRef.current = onChangesAvailable

  const [lines, setLines] = useState<DisplayLine[]>(() =>
    (welcomeLines ?? []).map((text, index) => ({
      id: `tr-welcome-${index}`,
      kind: 'info' as const,
      text,
    })),
  )
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [booting, setBooting] = useState(true)
  const [cwd, setCwd] = useState(workspaceRoot)
  const [bootError, setBootError] = useState<string | undefined>(undefined)
  const [completeHint, setCompleteHint] = useState('')

  const nextLineId = useCallback(() => {
    lineSeqRef.current += 1
    return `tr-${lineSeqRef.current}`
  }, [])

  const appendLine = useCallback((line: Omit<DisplayLine, 'id'>) => {
    const withId = {
      ...line,
      id: nextLineId(),
      text: clipDisplayText(line.text),
    } as DisplayLine
    setLines((prev) => trimDisplayLines([...prev, withId]))
  }, [nextLineId])

  const focusInput = useCallback(() => {
    inputRef.current?.focus()
  }, [])

  const clearCompletion = useCallback(() => {
    completeCycleRef.current = undefined
    setCompleteHint('')
  }, [])

  const syncConsoleFromInstance = useCallback((instance: QuickJsInstance) => {
    const consoleLines = instance.getSnapshot().consoleLines
    const fresh: DisplayLine[] = []
    for (const line of consoleLines) {
      if (seenConsoleIdsRef.current.has(line.id)) {
        continue
      }
      seenConsoleIdsRef.current.add(line.id)
      fresh.push({
        id: line.id,
        kind: 'output',
        level: line.level,
        text: clipDisplayText(line.text),
      })
    }
    const liveIds = new Set(consoleLines.map((line) => line.id))
    for (const id of [...seenConsoleIdsRef.current]) {
      if (!liveIds.has(id)) {
        seenConsoleIdsRef.current.delete(id)
      }
    }
    if (fresh.length > 0) {
      setLines((prev) => trimDisplayLines([...prev, ...fresh]))
    }
  }, [])

  const bindInstance = useCallback(
    (instance: QuickJsInstance) => {
      if (!mountedRef.current) {
        instance.destroy()
        return
      }
      unsubRef.current?.()
      instanceRef.current?.destroy()
      instanceRef.current = instance
      seenConsoleIdsRef.current = new Set()
      unsubRef.current = instance.subscribe(() => {
        if (!mountedRef.current || instanceRef.current !== instance) {
          return
        }
        const snap = instance.getSnapshot()
        if (tabCompletingRef.current) {
          setCwd(snap.cwd)
          if (snap.destroyed) {
            instanceRef.current = undefined
          }
          return
        }
        syncConsoleFromInstance(instance)
        if (snap.busy) {
          if (busySinceRef.current === undefined) {
            busySinceRef.current = Date.now()
          }
        } else {
          busySinceRef.current = undefined
        }
        setCwd(snap.cwd)
        setBusy(snap.busy)
        if (snap.destroyed) {
          instanceRef.current = undefined
        }
      })
      setCwd(instance.getSnapshot().cwd)
      setBootError(undefined)
      setBooting(false)
      setBusy(false)
      busySinceRef.current = undefined
    },
    [syncConsoleFromInstance],
  )

  const createInstance = useCallback(async (options?: { force?: boolean }) => {
    // handle 会在实例 boot 完成前就挂上；Agent 可能立刻 runCode → ensureInstance。
    // 若不合并，第二次 create 的 bindInstance 会 destroy 掉正在 eval 的实例。
    // force：reset / fsMode / process.exit 重建，等完当前 in-flight 后再开一轮。
    if (createInFlightRef.current) {
      await createInFlightRef.current
      if (!options?.force) {
        return
      }
    }

    const run = (async () => {
      setBooting(true)
      setBootError(undefined)
      try {
        const root = workspaceRootRef.current
        const instantShellHost = createTerminalInstantShellHost({
          getWindows: () => windowsRef.current,
          openApp: (appId, options) => {
            openAppRef.current(appId, options)
          },
          openGeneratedApp: (appId, title) => {
            openGeneratedAppRef.current(appId, title)
          },
          openExtApp: (appId, title) => {
            openExtAppRef.current(appId, title)
          },
          getInstalledGeneratedApps: () => installedAppsRef.current,
          getSessionExtApps: () => sessionExtAppsRef.current,
          focusWindow: (windowId) => {
            focusWindowRef.current(windowId)
          },
          closeWindow: (windowId) => {
            closeWindowRef.current(windowId)
          },
          closeWindowsForApp: (appId) => {
            closeWindowsForAppRef.current(appId)
          },
          minimizeWindow: (windowId) => {
            minimizeWindowRef.current(windowId)
          },
          restoreWindow: (windowId) => {
            restoreWindowRef.current(windowId)
          },
          toggleFullscreen: (windowId) => {
            toggleFullscreenRef.current(windowId)
          },
          toggleMaximize: (windowId) => {
            toggleMaximizeRef.current(windowId)
          },
          getCwd: () => instanceRef.current?.getSnapshot().cwd ?? workspaceRootRef.current,
          getFsMode: () => fsModeRef.current,
          getTerminalSessionId: () => terminalSessionIdRef.current,
          noteExternalChangeSet: (changeSet) => {
            if (changeSet.changes.length > 0) {
              onChangesAvailableRef.current?.(true)
            }
          },
          isBusy: () => {
            // 调用 instant.close 时当前 eval 必然 busy；用持续时间区分「空闲下的短命令」与「长任务中途关窗」。
            if (!(instanceRef.current?.getSnapshot().busy ?? false)) {
              return false
            }
            const since = busySinceRef.current
            if (since === undefined) {
              return false
            }
            return Date.now() - since >= 300
          },
          confirmClose: async (message) =>
            modalRef.current.confirm({
              title: '确认关闭',
              message,
              confirmLabel: '关闭',
              cancelLabel: '取消',
            }),
        })
        const instance = await createQuickJsInstance({
          workspaceRoot: root,
          cwd: root,
          fsMode: fsModeRef.current,
          terminalSessionId: terminalSessionIdRef.current,
          instantShellHost,
          webviewHost: {
            terminalSessionId: terminalSessionIdRef.current,
            openApp: (appId, options) => {
              return openAppRef.current(appId, options)
            },
            getWindows: () => windowsRef.current,
            focusWindow: (windowId) => {
              focusWindowRef.current(windowId)
            },
            restoreWindow: (windowId) => {
              restoreWindowRef.current(windowId)
            },
            closeWindow: (windowId) => {
              closeWindowRef.current(windowId)
            },
            openDevToolsApp: (documentId) => {
              openAppRef.current('page-devtools', { documentId })
            },
          },
        })
        bindInstance(instance)
      } catch (error) {
        if (!mountedRef.current) return
        instanceRef.current = undefined
        const message = error instanceof Error ? error.message : String(error)
        setBootError(message)
        setBooting(false)
      }
    })()

    createInFlightRef.current = run
    try {
      await run
    } finally {
      if (createInFlightRef.current === run) {
        createInFlightRef.current = undefined
      }
    }
  }, [bindInstance])

  useEffect(() => {
    mountedRef.current = true
    void createInstance()

    return () => {
      mountedRef.current = false
      unsubRef.current?.()
      unsubRef.current = undefined
      instanceRef.current?.destroy()
      instanceRef.current = undefined
    }
  }, [createInstance])

  // fsMode 变化时轮换 session 并重建实例（权限在创建时冻结，不可中途变更）
  const firstFsModeRef = useRef(true)
  useEffect(() => {
    if (firstFsModeRef.current) {
      firstFsModeRef.current = false
      return
    }
    onChangesAvailableRef.current?.(false)
    rotateTerminalSessionId()
    void createInstance({ force: true })
  }, [fsMode, createInstance, rotateTerminalSessionId])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [lines, busy])

  useEffect(() => {
    if (!booting) {
      focusInput()
    }
  }, [booting, focusInput])

  const clearScreen = useCallback(() => {
    setLines([])
    instanceRef.current?.clearConsole()
    seenConsoleIdsRef.current = new Set()
    focusInput()
  }, [focusInput])

  const resetInstance = useCallback(async () => {
    if (busy) {
      instanceRef.current?.abort()
    }
    appendLine({ kind: 'info', text: '── 重建 QuickJS 实例 ──' })
    seenConsoleIdsRef.current = new Set()
    unsubRef.current?.()
    unsubRef.current = undefined
    instanceRef.current?.destroy()
    instanceRef.current = undefined
    rotateTerminalSessionId()
    await createInstance({ force: true })
    focusInput()
  }, [appendLine, busy, createInstance, focusInput, rotateTerminalSessionId])

  const ensureInstance = useCallback(async (): Promise<QuickJsInstance | undefined> => {
    if (createInFlightRef.current) {
      await createInFlightRef.current
    }
    let instance = instanceRef.current
    if (instance === undefined || instance.getSnapshot().destroyed) {
      await createInstance()
      instance = instanceRef.current
    }
    return instance
  }, [createInstance])

  const runCode = useCallback(
    async (code: string, options?: { source?: TerminalReplRunSource }): Promise<string> => {
      const trimmed = code.trim()
      if (!trimmed) {
        return '命令为空'
      }

      if (trimmed === '.reset') {
        await resetInstance()
        return '实例已重建'
      }

      if (trimmed === '.flip3d') {
        appendLine({ kind: 'input', text: code, source: options?.source ?? 'user' } as Omit<DisplayLine, 'id'>)
        const result = enterFlip3d()
        if (result === 'empty') {
          appendLine({ kind: 'error', text: '没有可切换的窗口' })
          return '没有可切换的窗口'
        }
        if (result === 'already-active') {
          appendLine({ kind: 'info', text: '已在 Flip 3D' })
          return '已在 Flip 3D'
        }
        appendLine({ kind: 'info', text: 'Flip 3D · 方向键切换窗口 · Esc 退出' })
        inputRef.current?.blur()
        return 'Flip 3D'
      }

      const source = options?.source ?? 'user'
      appendLine({ kind: 'input', text: code, source } as Omit<DisplayLine, 'id'>)

      const instance = await ensureInstance()
      if (instance === undefined || instance.getSnapshot().destroyed) {
        appendLine({ kind: 'error', text: '实例不可用' })
        return '实例不可用'
      }

      if (instance.getSnapshot().busy) {
        appendLine({ kind: 'error', text: '上一条仍在执行，请稍候或点「停止」' })
        return '上一条仍在执行'
      }

      setBusy(true)
      try {
        const evalCode = source === 'program' ? wrapTerminalProgramEval(code) : code
        const result = await instance.eval(evalCode, {
          waitUntilIdle: source === 'program',
        })
        syncConsoleFromInstance(instance)
        setCwd(instance.getSnapshot().cwd)

        if (result.ok) {
          if (result.changes && result.changes.changes.length > 0) {
            appendLine({
              kind: 'info',
              text: formatTerminalChangeSummary(result.changes),
            })
            onChangesAvailableRef.current?.(true)
          }
          if (result.exited) {
            appendLine({
              kind: 'info',
              text: `process.exit(${result.exitCode}) · 实例已结束`,
            })
            unsubRef.current?.()
            unsubRef.current = undefined
            if (!instance.getSnapshot().destroyed) {
              instance.destroy()
            }
            instanceRef.current = undefined
            await createInstance({ force: true })
            return `process.exit(${result.exitCode})`
          }
          const formatted = formatTerminalReplValue(result.value)
          if (formatted !== 'undefined') {
            appendLine({ kind: 'result', text: formatted })
          }
          if (result.exitCode !== 0) {
            appendLine({ kind: 'info', text: `exitCode=${result.exitCode}` })
          }
          return formatEvalOutput(result)
        }

        if (result.changes && result.changes.changes.length > 0) {
          appendLine({
            kind: 'info',
            text: formatTerminalChangeSummary(result.changes),
          })
          onChangesAvailableRef.current?.(true)
        }

        if (result.fatal) {
          const message = formatRuntimeFatalMessage(result.error)
          appendLine({ kind: 'error', text: message })
          unsubRef.current?.()
          unsubRef.current = undefined
          if (!instance.getSnapshot().destroyed) {
            instance.destroy()
          }
          instanceRef.current = undefined
          await createInstance({ force: true })
          appendLine({ kind: 'info', text: '── 运行时致命错误后已重建 QuickJS 实例 ──' })
          return message
        }

        appendLine({ kind: 'error', text: result.error })
        return formatEvalOutput(result)
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error)
        if (isQuickJsWasmBoundaryFatalError(error)) {
          const message = formatRuntimeFatalMessage(formatFatalErrorMessage(error))
          appendLine({ kind: 'error', text: message })
          unsubRef.current?.()
          unsubRef.current = undefined
          if (instanceRef.current && !instanceRef.current.getSnapshot().destroyed) {
            instanceRef.current.destroy()
          }
          instanceRef.current = undefined
          await createInstance({ force: true })
          appendLine({ kind: 'info', text: '── 运行时致命错误后已重建 QuickJS 实例 ──' })
          return message
        }
        appendLine({ kind: 'error', text: raw })
        return raw
      } finally {
        const snap = instanceRef.current?.getSnapshot()
        setBusy(snap?.busy ?? false)
        focusInput()
      }
    },
    [appendLine, createInstance, ensureInstance, enterFlip3d, focusInput, resetInstance, syncConsoleFromInstance],
  )

  const chdir = useCallback(
    async (path: string) => {
      const instance = await ensureInstance()
      if (instance === undefined || instance.getSnapshot().destroyed) {
        return
      }
      if (instance.getSnapshot().cwd === path) {
        return
      }
      if (instance.getSnapshot().busy) {
        return
      }
      const escaped = JSON.stringify(path)
      await instance.eval(`process.chdir(${escaped})`)
      setCwd(instance.getSnapshot().cwd)
    },
    [ensureInstance],
  )

  const handleAbort = useCallback(() => {
    instanceRef.current?.abort()
    setBusy(false)
    focusInput()
  }, [focusInput])

  const getLastChanges = useCallback((): TerminalChangeSet | undefined => {
    return instanceRef.current?.getLastChanges()
  }, [])

  const clearLastChanges = useCallback(() => {
    instanceRef.current?.clearLastChanges()
  }, [])

  const revertLastChanges = useCallback(async (): Promise<boolean> => {
    const instance = instanceRef.current
    if (!instance || instance.getSnapshot().destroyed) {
      return false
    }
    const before = instance.getLastChanges()
    if (!before || before.changes.length === 0) {
      return false
    }
    try {
      await instance.revertLastChanges()
      appendLine({ kind: 'info', text: '已撤销上一轮改动，终端已重建' })
      onChangesAvailableRef.current?.(false)
      seenConsoleIdsRef.current = new Set()
      unsubRef.current?.()
      unsubRef.current = undefined
      instanceRef.current?.destroy()
      instanceRef.current = undefined
      rotateTerminalSessionId()
      await createInstance({ force: true })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      appendLine({ kind: 'error', text: `撤销失败：${message}` })
      return false
    }
  }, [appendLine, createInstance, rotateTerminalSessionId])

  const rebuildInstance = useCallback(async () => {
    if (busy) {
      instanceRef.current?.abort()
    }
    appendLine({ kind: 'info', text: '── 重建 QuickJS 实例 ──' })
    seenConsoleIdsRef.current = new Set()
    unsubRef.current?.()
    unsubRef.current = undefined
    instanceRef.current?.destroy()
    instanceRef.current = undefined
    rotateTerminalSessionId()
    await createInstance({ force: true })
  }, [appendLine, busy, createInstance, rotateTerminalSessionId])

  const appendInfo = useCallback(
    (text: string) => {
      appendLine({ kind: 'info', text })
    },
    [appendLine],
  )

  useEffect(() => {
    const handle: TerminalReplHandle = {
      runCode,
      getCwd: () => instanceRef.current?.getSnapshot().cwd ?? cwd,
      chdir,
      clear: clearScreen,
      abort: handleAbort,
      focus: focusInput,
      appendInfo,
      getLastChanges,
      clearLastChanges,
      revertLastChanges,
      rebuildInstance,
      getTerminalSessionId: () => terminalSessionIdRef.current,
      getTmpDir: () => terminalTmpDir(terminalSessionIdRef.current),
      getFsMode: () => fsModeRef.current,
    }

    if (typeof handleRef === 'function') {
      handleRef(handle)
      return () => handleRef(null)
    }
    if (handleRef && typeof handleRef === 'object') {
      handleRef.current = handle
      return () => {
        handleRef.current = null
      }
    }
    return undefined
  }, [
    appendInfo,
    chdir,
    clearLastChanges,
    clearScreen,
    cwd,
    focusInput,
    getLastChanges,
    handleAbort,
    handleRef,
    rebuildInstance,
    revertLastChanges,
    runCode,
  ])

  const rememberCommand = useCallback((line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    const history = historyRef.current
    if (history[history.length - 1] === trimmed) return
    historyRef.current = [...history, trimmed].slice(-200)
  }, [])

  const applyDraft = useCallback((value: string, caret?: number) => {
    draftRef.current = value
    caretRef.current = caret
    setDraft(value)
    if (inputRef.current) {
      inputRef.current.value = value
      if (caret !== undefined) {
        inputRef.current.setSelectionRange(caret, caret)
      }
    }
  }, [])

  useEffect(() => {
    const caret = caretRef.current
    const input = inputRef.current
    if (caret === undefined || !input) return
    input.setSelectionRange(caret, caret)
  }, [draft])

  const clearDraft = useCallback(() => {
    applyDraft('')
  }, [applyDraft])

  const submitDraft = useCallback(() => {
    const line = draftRef.current
    rememberCommand(line)
    historyIndexRef.current = -1
    historyDraftRef.current = ''
    justSubmittedRef.current = true
    imeGuardUntilRef.current = Date.now() + 150
    clearCompletion()
    clearDraft()
    void runCode(line, { source: 'user' })
    window.setTimeout(() => {
      justSubmittedRef.current = false
    }, 150)
  }, [clearCompletion, clearDraft, rememberCommand, runCode])

  const browseHistory = useCallback(
    (direction: 'older' | 'newer') => {
      const history = historyRef.current
      if (history.length === 0) return
      clearCompletion()

      let index = historyIndexRef.current
      if (direction === 'older') {
        if (index === -1) {
          historyDraftRef.current = draftRef.current
          index = history.length - 1
        } else if (index > 0) {
          index -= 1
        }
      } else if (index === -1) {
        return
      } else {
        index += 1
        if (index >= history.length) {
          historyIndexRef.current = -1
          applyDraft(historyDraftRef.current)
          historyDraftRef.current = ''
          return
        }
      }

      historyIndexRef.current = index
      applyDraft(history[index] ?? '')
    },
    [applyDraft, clearCompletion],
  )

  const applyCompletionCycle = useCallback(
    (cycle: ReplCompletionCycle) => {
      completeCycleRef.current = cycle
      applyDraft(draftFromReplCompletionCycle(cycle), caretFromReplCompletionCycle(cycle))
      setCompleteHint(formatReplCompletionHint(cycle))
    },
    [applyDraft],
  )

  const applyTabComplete = useCallback(
    async (direction: 1 | -1) => {
      const draft = draftRef.current
      const existing = completeCycleRef.current
      if (existing && cycleMatchesDraft(existing, draft)) {
        applyCompletionCycle(stepReplCompletionCycle(existing, direction))
        focusInput()
        return
      }

      if (completingRef.current) return
      const instance = instanceRef.current
      if (
        instance === undefined ||
        instance.getSnapshot().destroyed ||
        instance.getSnapshot().busy
      ) {
        return
      }

      const cursor = inputRef.current?.selectionStart ?? draft.length
      const hostTarget = parseHostDotTarget(draft, cursor)
      if (hostTarget) {
        const cycle = createReplCompletionCycle(draft, hostTarget, HOST_REPL_DOT_COMMANDS, direction)
        if (cycle) applyCompletionCycle(cycle)
        else clearCompletion()
        focusInput()
        return
      }

      const target = parseReplCompletionTarget(draft, cursor)
      if (target === undefined) {
        clearCompletion()
        return
      }

      completingRef.current = true
      tabCompletingRef.current = true
      try {
        const evalResult = await instance.eval(buildReplCompletionEval(target.objectExpr), {
          silent: true,
          timeoutMs: 100,
          waitUntilIdle: false,
        })
        if (!evalResult.ok || !Array.isArray(evalResult.value)) {
          clearCompletion()
          return
        }
        const names = evalResult.value.filter((item): item is string => typeof item === 'string')
        const cycle = createReplCompletionCycle(draft, target, names, direction)
        if (cycle) applyCompletionCycle(cycle)
        else clearCompletion()
      } catch {
        clearCompletion()
      } finally {
        tabCompletingRef.current = false
        completingRef.current = false
        focusInput()
      }
    },
    [applyCompletionCycle, clearCompletion, focusInput],
  )

  const promptLabel = `node ${cwd}>`
  const panelClass = ['terminal-panel', className].filter(Boolean).join(' ')

  return (
    <div
      class={panelClass}
      style={terminalColorsToStyle(colors)}
      onClick={() => {
        const selection = typeof window !== 'undefined' ? window.getSelection() : undefined
        if (selection && !selection.isCollapsed && selection.toString().length > 0) return
        focusInput()
      }}
      role="application"
      aria-label={ariaLabel}
    >
      {bootError ? (
        <div class="terminal-repl-shell__banner" role="alert">
          实例启动失败：{bootError}
        </div>
      ) : undefined}
      {fsMode === 'readonly' ? (
        <div class="terminal-repl-shell__banner terminal-repl-shell__banner--readonly">
          只读模式 · 写操作将被拒绝
        </div>
      ) : fsMode === 'controlled' ? (
        <div class="terminal-repl-shell__banner terminal-repl-shell__banner--controlled">
          受控模式 · 本轮改动将被记录
        </div>
      ) : undefined}
      <div
        class="terminal-panel__scroll"
        ref={scrollRef}
        onMouseDown={() => {
          const input = inputRef.current
          if (input && document.activeElement === input) {
            input.blur()
          }
        }}
      >
        {lines.map((line) => {
          if (line.kind === 'input') {
            const marker = line.source === 'program' ? '»' : '>'
            return (
              <div
                key={line.id}
                class={`terminal-panel__line terminal-panel__line--input terminal-panel__line--${line.source}`}
              >
                <span class="terminal-panel__prompt-marker">{marker}</span>
                <span class="terminal-panel__input-text">{line.text}</span>
              </div>
            )
          }
          if (line.kind === 'output') {
            return (
              <div
                key={line.id}
                class={`terminal-panel__line ${consoleLevelClass(line.level)}`.trim()}
              >
                {line.text}
              </div>
            )
          }
          if (line.kind === 'result') {
            return (
              <div key={line.id} class="terminal-panel__line terminal-panel__line--program">
                {line.text}
              </div>
            )
          }
          if (line.kind === 'error') {
            return (
              <div key={line.id} class="terminal-panel__line terminal-panel__line--error">
                {line.text}
              </div>
            )
          }
          return (
            <div key={line.id} class="terminal-panel__line" style={{ color: 'var(--terminal-muted)' }}>
              {line.text}
            </div>
          )
        })}
        {busy ? (
          <div class="terminal-panel__line terminal-panel__line--status" aria-live="polite">
            <span class="terminal-panel__status-spinner" aria-hidden="true">
              ⠋
            </span>
            <span class="terminal-panel__status-text">执行中…</span>
          </div>
        ) : undefined}
      </div>
      <div class="terminal-panel__input-row">
        <span class="terminal-panel__cwd-prompt">{promptLabel}</span>
        <input
          ref={inputRef}
          class="terminal-panel__input"
          type="text"
          value={draft}
          spellcheck={false}
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          disabled={booting || bootError !== undefined}
          placeholder={booting ? '正在启动 QuickJS…' : busy ? '执行中…' : undefined}
          onCompositionStart={() => {
            imeComposingRef.current = true
          }}
          onCompositionEnd={() => {
            imeComposingRef.current = false
            imeGuardUntilRef.current = Math.max(imeGuardUntilRef.current, Date.now() + 80)
          }}
          onInput={(event) => {
            const value = (event.target as HTMLInputElement).value
            caretRef.current = undefined
            clearCompletion()
            if (justSubmittedRef.current && !imeComposingRef.current) {
              clearDraft()
              return
            }
            setDraft(value)
            draftRef.current = value
          }}
          onKeyDown={(event) => {
            if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              clearScreen()
              return
            }
            const composing =
              imeComposingRef.current || event.isComposing || event.keyCode === 229
            if (event.key === 'Tab') {
              if (composing) return
              event.preventDefault()
              if (booting || bootError !== undefined || busy) return
              void applyTabComplete(event.shiftKey ? -1 : 1)
              return
            }
            if (event.key === 'Escape' && completeHint) {
              event.preventDefault()
              clearCompletion()
              return
            }
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              if (composing) return
              event.preventDefault()
              browseHistory(event.key === 'ArrowUp' ? 'older' : 'newer')
              return
            }
            if (event.key === 'Enter') {
              if (composing || Date.now() < imeGuardUntilRef.current) {
                return
              }
              event.preventDefault()
              submitDraft()
            } else if (event.key === 'c' && (event.metaKey || event.ctrlKey) && busy) {
              event.preventDefault()
              handleAbort()
            }
          }}
        />
        {completeHint ? (
          <span class="terminal-panel__complete-hint" title={completeHint}>
            {completeHint}
          </span>
        ) : undefined}
        {busy ? (
          <button
            type="button"
            class="terminal-panel__stop"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              handleAbort()
            }}
          >
            停止
          </button>
        ) : undefined}
      </div>
    </div>
  )
}
