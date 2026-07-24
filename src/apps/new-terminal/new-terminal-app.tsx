import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  createQuickJsInstance,
  type QuickJsConsoleLine,
  type QuickJsInstance,
} from '../../quickjs/quickjs-public.ts'
import { terminalColorsToStyle } from '../../terminal/terminal-colors.ts'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import '../../terminal/terminal-panel.css'
import './new-terminal-app.css'

const APP_ID = 'new-terminal' as const
const WORKSPACE_ROOT = '/user'

type DisplayLine =
  | { id: string; kind: 'input'; text: string }
  | { id: string; kind: 'output'; level: QuickJsConsoleLine['level']; text: string }
  | { id: string; kind: 'result'; text: string }
  | { id: string; kind: 'error'; text: string }
  | { id: string; kind: 'info'; text: string }

function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (
    value === undefined ||
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value)
  }
  if (typeof value === 'object' && value !== null && 'default' in value) {
    const record = value as { default: unknown }
    if (Object.keys(value).length === 1 || record.default !== undefined) {
      try {
        return formatValue(record.default)
      } catch {
        // fall through
      }
    }
  }
  try {
    return JSON.stringify(value, undefined, 2)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

function consoleLevelClass(level: QuickJsConsoleLine['level']): string {
  if (level === 'error') return 'terminal-panel__line--error'
  if (level === 'warn') return 'terminal-panel__line--error'
  return ''
}

export function NewTerminalApp() {
  const { closeWindowsForApp, minimizeWindow, windows } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const instanceRef = useRef<QuickJsInstance | undefined>(undefined)
  const mountedRef = useRef(true)
  const lineSeqRef = useRef(0)
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

  const [lines, setLines] = useState<DisplayLine[]>(() => [
    {
      id: 'nt-welcome-1',
      kind: 'info',
      text: '新终端 · Node 风格 QuickJS REPL（共享 Virtual JS 运行时）',
    },
    {
      id: 'nt-welcome-2',
      kind: 'info',
      text: `工作区 ${WORKSPACE_ROOT} · 回车执行 · ⌘K 清屏 · .reset 重建实例`,
    },
  ])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [booting, setBooting] = useState(true)
  const [cwd, setCwd] = useState(WORKSPACE_ROOT)
  const [bootError, setBootError] = useState<string | undefined>(undefined)

  const nextLineId = useCallback(() => {
    lineSeqRef.current += 1
    return `nt-${lineSeqRef.current}`
  }, [])

  const appendLine = useCallback((line: Omit<DisplayLine, 'id'>) => {
    const withId = { ...line, id: nextLineId() } as DisplayLine
    setLines((prev) => [...prev, withId])
  }, [nextLineId])

  const focusInput = useCallback(() => {
    inputRef.current?.focus()
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
        text: line.text,
      })
    }
    if (fresh.length > 0) {
      setLines((prev) => [...prev, ...fresh])
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
        syncConsoleFromInstance(instance)
        const snap = instance.getSnapshot()
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
    },
    [syncConsoleFromInstance],
  )

  const createInstance = useCallback(async () => {
    setBooting(true)
    setBootError(undefined)
    try {
      const instance = await createQuickJsInstance({ workspaceRoot: WORKSPACE_ROOT })
      bindInstance(instance)
    } catch (error) {
      if (!mountedRef.current) return
      instanceRef.current = undefined
      const message = error instanceof Error ? error.message : String(error)
      setBootError(message)
      setBooting(false)
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
    await createInstance()
    focusInput()
  }, [appendLine, busy, createInstance, focusInput])

  const ensureInstance = useCallback(async (): Promise<QuickJsInstance | undefined> => {
    let instance = instanceRef.current
    if (instance === undefined || instance.getSnapshot().destroyed) {
      await createInstance()
      instance = instanceRef.current
    }
    return instance
  }, [createInstance])

  const runCode = useCallback(
    async (code: string) => {
      const trimmed = code.trim()
      if (!trimmed) {
        return
      }

      if (trimmed === '.reset') {
        await resetInstance()
        return
      }

      appendLine({ kind: 'input', text: code })

      const instance = await ensureInstance()
      if (instance === undefined || instance.getSnapshot().destroyed) {
        appendLine({ kind: 'error', text: '实例不可用' })
        return
      }

      if (instance.getSnapshot().busy) {
        appendLine({ kind: 'error', text: '上一条仍在执行，请稍候或点「停止」' })
        return
      }

      setBusy(true)
      try {
        const result = await instance.eval(code)
        syncConsoleFromInstance(instance)
        setCwd(instance.getSnapshot().cwd)

        if (result.ok) {
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
            await createInstance()
            return
          }
          const formatted = formatValue(result.value)
          if (formatted !== 'undefined') {
            appendLine({ kind: 'result', text: formatted })
          }
          if (result.exitCode !== 0) {
            appendLine({ kind: 'info', text: `exitCode=${result.exitCode}` })
          }
        } else {
          appendLine({ kind: 'error', text: result.error })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        appendLine({ kind: 'error', text: message })
      } finally {
        const snap = instanceRef.current?.getSnapshot()
        setBusy(snap?.busy ?? false)
        focusInput()
      }
    },
    [appendLine, createInstance, ensureInstance, focusInput, resetInstance, syncConsoleFromInstance],
  )

  const rememberCommand = useCallback((line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    const history = historyRef.current
    if (history[history.length - 1] === trimmed) return
    historyRef.current = [...history, trimmed].slice(-200)
  }, [])

  const applyDraft = useCallback((value: string) => {
    draftRef.current = value
    setDraft(value)
    if (inputRef.current) {
      inputRef.current.value = value
    }
  }, [])

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
    clearDraft()
    void runCode(line)
    window.setTimeout(() => {
      justSubmittedRef.current = false
    }, 150)
  }, [clearDraft, rememberCommand, runCode])

  const browseHistory = useCallback(
    (direction: 'older' | 'newer') => {
      const history = historyRef.current
      if (history.length === 0) return

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
    [applyDraft],
  )

  const handleAbort = useCallback(() => {
    instanceRef.current?.abort()
    setBusy(false)
    focusInput()
  }, [focusInput])

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === APP_ID && !window.minimized)

    return [
      {
        label: '新终端',
        items: [
          ...aboutAppMenuPrefix('关于新终端', () => showBuiltinAbout(APP_ID)),
          {
            type: 'action',
            label: '隐藏新终端',
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出新终端',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp(APP_ID),
          },
        ],
      },
      {
        label: '编辑',
        items: [
          {
            type: 'action',
            label: '清屏',
            shortcut: '⌘K',
            onClick: clearScreen,
          },
          {
            type: 'action',
            label: '重建实例',
            onClick: () => void resetInstance(),
          },
          {
            type: 'action',
            label: '停止',
            disabled: !busy,
            onClick: handleAbort,
          },
        ],
      },
    ]
  }, [
    busy,
    clearScreen,
    closeWindowsForApp,
    handleAbort,
    minimizeWindow,
    resetInstance,
    showBuiltinAbout,
    windows,
  ])

  useAppMenuBar(APP_ID, menuBar)

  const promptLabel = `node ${cwd}>`

  return (
    <div class="new-terminal-app">
      <div
        class="terminal-panel"
        style={terminalColorsToStyle()}
        onClick={() => {
          const selection = typeof window !== 'undefined' ? window.getSelection() : undefined
          if (selection && !selection.isCollapsed && selection.toString().length > 0) return
          focusInput()
        }}
        role="application"
        aria-label="新终端"
      >
        {bootError ? (
          <div class="new-terminal-app__banner" role="alert">
            实例启动失败：{bootError}
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
              return (
                <div
                  key={line.id}
                  class="terminal-panel__line terminal-panel__line--input terminal-panel__line--user"
                >
                  <span class="terminal-panel__prompt-marker">&gt;</span>
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
    </div>
  )
}
