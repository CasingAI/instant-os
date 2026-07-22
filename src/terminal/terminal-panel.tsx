import { useEffect, useRef, useState } from 'preact/hooks'
import type { Ref } from 'preact'
import {
  terminalColorsToStyle,
  type TerminalColors,
} from './terminal-colors.ts'
import { TerminalMarkdown } from './terminal-markdown.tsx'
import { createTerminalSession, type TerminalSession } from './terminal-session.ts'
import { completeTerminalTab } from './terminal-tab-complete.ts'
import type { TerminalHandle, TerminalLine, TerminalSessionSnapshot } from './terminal-types.ts'
import './terminal-panel.css'

export type TerminalPanelProps = {
  /** 未传入时由面板内部创建会话 */
  session?: TerminalSession
  usageActor?: string
  initialCwd?: string
  thinkingEnabled?: boolean
  className?: string
  /**
   * 宿主注入的终端配色。未传时使用默认深色；
   * 可传局部字段，其余回落默认。
   */
  colors?: Partial<TerminalColors>
  /** 外部命令下发句柄 */
  handleRef?: Ref<TerminalHandle | null>
  onBusyChange?: (busy: boolean) => void
  onCwdChange?: (cwd: string) => void
}

/** Braille 旋转帧，表示模型仍在执行（工具调用 / 输出等） */
const STATUS_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

function TerminalStatusSpinner() {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setFrame((prev) => (prev + 1) % STATUS_SPINNER_FRAMES.length)
    }, 80)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <span class="terminal-panel__status-spinner" aria-hidden="true">
      {STATUS_SPINNER_FRAMES[frame]}
    </span>
  )
}

function formatPrompt(cwd: string): string {
  return `${cwd} $`
}

function LineBody({ line }: { line: TerminalLine }) {
  if (line.format === 'markdown') {
    return <TerminalMarkdown text={line.text} />
  }
  return line.text
}

function LineView({ line }: { line: TerminalLine }) {
  if (line.kind === 'input') {
    const marker = line.source === 'program' ? '»' : '$'
    return (
      <div class={`terminal-panel__line terminal-panel__line--input terminal-panel__line--${line.source ?? 'user'}`}>
        <span class="terminal-panel__prompt-marker">{marker}</span>
        <span class="terminal-panel__input-text">{line.text}</span>
      </div>
    )
  }

  if (line.kind === 'status') {
    return (
      <div class="terminal-panel__line terminal-panel__line--status" aria-live="polite">
        <TerminalStatusSpinner />
        <span class="terminal-panel__status-text">
          <LineBody line={line} />
        </span>
      </div>
    )
  }

  if (line.kind === 'error') {
    return (
      <div class="terminal-panel__line terminal-panel__line--error">
        <LineBody line={line} />
      </div>
    )
  }

  // AI 流式占位：尚未有正文时不占行（live block 会单独出现）
  if (!line.text && line.format !== 'markdown') {
    return undefined
  }

  return (
    <div
      class={`terminal-panel__line terminal-panel__line--output${line.format === 'markdown' ? ' terminal-panel__line--markdown' : ''}${line.streaming ? ' terminal-panel__line--streaming' : ''}`}
    >
      <LineBody line={line} />
    </div>
  )
}

export function TerminalPanel({
  session: externalSession,
  usageActor = 'terminal',
  initialCwd,
  thinkingEnabled = false,
  className,
  colors,
  handleRef,
  onBusyChange,
  onCwdChange,
}: TerminalPanelProps) {
  const ownedSessionRef = useRef<TerminalSession | undefined>(undefined)
  if (!externalSession && !ownedSessionRef.current) {
    ownedSessionRef.current = createTerminalSession({
      usageActor,
      initialCwd,
      thinkingEnabled,
    })
  }
  const ownedSession = ownedSessionRef.current
  const session = externalSession ?? ownedSession
  if (!session) {
    throw new Error('TerminalPanel 需要 session')
  }

  const [snapshot, setSnapshot] = useState<TerminalSessionSnapshot>(() => session.getSnapshot())
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const wasBusyRef = useRef(false)
  const completingRef = useRef(false)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const imeComposingRef = useRef(false)
  /** 刚提交：挡住输入法把已上屏的词再写回空输入框 */
  const justSubmittedRef = useRef(false)
  /** 组字结束后紧跟的 Enter 多半是「确认选词」，不要当成提交 */
  const imeGuardUntilRef = useRef(0)

  const focusInput = () => {
    const node = inputRef.current
    if (!node) return
    // 对话框/按钮抢走焦点后，下一帧再抢回更稳
    requestAnimationFrame(() => {
      node.focus({ preventScroll: true })
    })
  }

  const clearDraft = () => {
    draftRef.current = ''
    setDraft('')
  }

  const submitDraft = () => {
    const line = draftRef.current
    justSubmittedRef.current = true
    imeGuardUntilRef.current = Date.now() + 150
    clearDraft()
    void session.submit(line, { source: 'user' })
    focusInput()
    requestAnimationFrame(() => {
      clearDraft()
      if (inputRef.current?.value) {
        inputRef.current.value = ''
      }
      window.setTimeout(() => {
        justSubmittedRef.current = false
      }, 150)
    })
  }

  const applyTabComplete = async () => {
    if (completingRef.current) return
    completingRef.current = true
    try {
      const result = await completeTerminalTab(draftRef.current, session.getCwd())
      if (result.nextDraft !== draftRef.current) {
        setDraft(result.nextDraft)
      }
      if (result.candidates && result.candidates.length > 0) {
        session.write(result.candidates.join('  '))
      }
      focusInput()
    } finally {
      completingRef.current = false
    }
  }

  useEffect(() => {
    session.setThinkingEnabled(thinkingEnabled)
  }, [session, thinkingEnabled])

  useEffect(() => {
    return session.subscribe((next) => {
      setSnapshot(next)
    })
  }, [session])

  useEffect(() => {
    return () => {
      ownedSessionRef.current?.destroy()
      ownedSessionRef.current = undefined
    }
  }, [])

  // 挂载后立刻可键入，对齐真实终端「焦点始终在提示符」
  useEffect(() => {
    focusInput()
  }, [session])

  useEffect(() => {
    onBusyChange?.(snapshot.busy)
  }, [onBusyChange, snapshot.busy])

  useEffect(() => {
    onCwdChange?.(snapshot.cwd)
  }, [onCwdChange, snapshot.cwd])

  // 命令结束（含 abort）后把焦点拉回输入区；busy 期间也不用 disabled，避免浏览器强制失焦
  useEffect(() => {
    if (wasBusyRef.current && !snapshot.busy) {
      focusInput()
    }
    wasBusyRef.current = snapshot.busy
  }, [snapshot.busy])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [snapshot.lines, snapshot.busy])

  useEffect(() => {
    const handle: TerminalHandle = {
      exec: (line) => session.submit(line, { source: 'program' }),
      runPrivilege: (request) => session.runPrivilege(request),
      write: (text) => session.write(text),
      upsertBlock: (block) => session.upsertBlock(block),
      removeBlock: (key) => session.removeBlock(key),
      clear: () => session.clear(),
      abort: () => session.abort(),
      getCwd: () => session.getCwd(),
      cd: (path) => session.cd(path),
      getSnapshot: () => session.getSnapshot(),
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
  }, [handleRef, session])

  const classNames = ['terminal-panel', className].filter(Boolean).join(' ')
  const colorStyle = colors ? terminalColorsToStyle(colors) : undefined

  return (
    <div
      class={classNames}
      style={colorStyle}
      onClick={() => {
        // 有选区时不抢焦点，方便复制输出；否则点哪都回到提示符
        const selection = typeof window !== 'undefined' ? window.getSelection() : undefined
        if (selection && !selection.isCollapsed && selection.toString().length > 0) return
        focusInput()
      }}
      role="application"
      aria-label="终端"
    >
      <div
        class="terminal-panel__scroll"
        ref={scrollRef}
        onMouseDown={() => {
          // 在输出区按下时让出焦点，否则选区建不起来 / ⌘C 会落到 input
          const input = inputRef.current
          if (input && document.activeElement === input) {
            input.blur()
          }
        }}
      >
        {snapshot.lines.map((line) => (
          <LineView key={line.id} line={line} />
        ))}
      </div>
      <div class="terminal-panel__input-row">
        <span class="terminal-panel__cwd-prompt">{formatPrompt(snapshot.cwd)}</span>
        <input
          ref={inputRef}
          class="terminal-panel__input"
          type="text"
          value={draft}
          spellcheck={false}
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          placeholder={snapshot.busy ? '执行中…可继续输入排队' : undefined}
          onCompositionStart={() => {
            imeComposingRef.current = true
          }}
          onCompositionEnd={() => {
            imeComposingRef.current = false
            // 确认选词用的 Enter 常紧跟在 compositionend 后，短窗内不提交
            imeGuardUntilRef.current = Math.max(imeGuardUntilRef.current, Date.now() + 80)
            if (justSubmittedRef.current) {
              requestAnimationFrame(() => {
                clearDraft()
                if (inputRef.current?.value) inputRef.current.value = ''
              })
            }
          }}
          onInput={(event) => {
            const value = (event.target as HTMLInputElement).value
            if (justSubmittedRef.current && !imeComposingRef.current) {
              clearDraft()
              if (inputRef.current) inputRef.current.value = ''
              return
            }
            setDraft(value)
          }}
          onKeyDown={(event) => {
            const composing =
              imeComposingRef.current ||
              event.isComposing ||
              // 旧 Chromium / 部分 IME：组字中 keyCode 为 229
              event.keyCode === 229

            if (event.key === 'Tab') {
              if (composing) return
              event.preventDefault()
              void applyTabComplete()
              return
            }
            if (event.key === 'Enter') {
              if (composing || Date.now() < imeGuardUntilRef.current) {
                return
              }
              event.preventDefault()
              submitDraft()
            } else if (event.key === 'c' && (event.metaKey || event.ctrlKey) && snapshot.busy) {
              event.preventDefault()
              session.abort()
              focusInput()
            }
          }}
        />
        {snapshot.busy ? (
          <button
            type="button"
            class="terminal-panel__stop"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              session.abort()
              focusInput()
            }}
          >
            停止
          </button>
        ) : undefined}
      </div>
    </div>
  )
}
