import { filesStat } from '../apps/files/files-api.ts'
import { resolveActorLabel } from '../ai/ai-usage-context.ts'
import { isStreamAbortError } from '../ai/stream-abort.ts'
import { osNowMs } from '../os/os-clock.ts'
import { getResolvedSystemEnv } from '../os/system-env-settings-storage.ts'
import { askTerminalAgent } from './terminal-agent.ts'
import { runTerminalLiveDemo } from './terminal-demo.ts'
import { TERMINAL_HELP_TEXT } from './terminal-help-text.ts'
import { runTerminalLocalLs } from './terminal-local-ls.ts'
import {
  runTerminalLocalPrivilegeCommand,
  runTerminalPrivilegeRequest,
} from './terminal-local-privilege.ts'
import { getDefaultTerminalCwd, resolveTerminalPath } from './terminal-path.ts'
import type { TerminalPrivilegeRequest } from './terminal-privilege-types.ts'
import type {
  TerminalLine,
  TerminalSessionListener,
  TerminalSessionSnapshot,
  TerminalSubmitOptions,
  TerminalUpsertBlockOptions,
} from './terminal-types.ts'

export type TerminalSessionOptions = {
  initialCwd?: string
  /** 会话初始环境变量；未传则拷贝系统默认 env。 */
  initialEnv?: Record<string, string>
  usageActor: string
  thinkingEnabled?: boolean
}

export type TerminalSession = {
  subscribe: (listener: TerminalSessionListener) => () => void
  getSnapshot: () => TerminalSessionSnapshot
  submit: (line: string, options?: TerminalSubmitOptions) => Promise<void>
  /** 执行外部注入的特权操作（含确认对话框与审计输出） */
  runPrivilege: (request: TerminalPrivilegeRequest) => Promise<void>
  write: (text: string) => void
  upsertBlock: (options: TerminalUpsertBlockOptions) => void
  removeBlock: (key: string) => void
  clear: () => void
  abort: () => void
  getCwd: () => string
  /** 当前会话环境变量浅拷贝（含随 cwd 更新的 PWD）。 */
  getEnv: () => Record<string, string>
  cd: (path: string) => Promise<void>
  setThinkingEnabled: (enabled: boolean) => void
  getThinkingEnabled: () => boolean
  destroy: () => void
}

type QueueItem = {
  line: string
  options: TerminalSubmitOptions
  resolve: () => void
  reject: (error: unknown) => void
}

let lineSeq = 0

function nextLineId(): string {
  lineSeq += 1
  return `term-line-${lineSeq}-${osNowMs()}`
}

function cloneLines(lines: TerminalLine[]): TerminalLine[] {
  return lines.map((line) => ({ ...line }))
}

function looksLikeMarkdown(text: string): boolean {
  return (
    /^\s{0,3}#{1,6}\s/m.test(text) ||
    /^\s*\|.+\|/m.test(text) ||
    /^\s*```/m.test(text) ||
    /^\s*>\s/m.test(text) ||
    /\*\*[^*]+\*\*/.test(text)
  )
}

export function createTerminalSession(options: TerminalSessionOptions): TerminalSession {
  let cwd = options.initialCwd?.trim() || getDefaultTerminalCwd()
  const env: Record<string, string> = {
    ...(options.initialEnv !== undefined ? { ...options.initialEnv } : getResolvedSystemEnv()),
  }
  env.PWD = cwd
  let lines: TerminalLine[] = []
  let busy = false
  let thinkingEnabled = options.thinkingEnabled ?? false
  let destroyed = false
  let abortController: AbortController | undefined
  const listeners = new Set<TerminalSessionListener>()
  const queue: QueueItem[] = []
  let draining = false

  const snapshot = (): TerminalSessionSnapshot => ({
    cwd,
    lines: cloneLines(lines),
    busy,
  })

  const emit = () => {
    const next = snapshot()
    for (const listener of listeners) {
      listener(next)
    }
  }

  const appendLine = (line: Omit<TerminalLine, 'id'> & { id?: string }): TerminalLine => {
    const full: TerminalLine = {
      id: line.id ?? nextLineId(),
      kind: line.kind,
      text: line.text,
      source: line.source,
      streaming: line.streaming,
      format: line.format,
      blockKey: line.blockKey,
    }
    lines = [...lines, full]
    emit()
    return full
  }

  const patchLine = (
    id: string,
    patch: Partial<Pick<TerminalLine, 'text' | 'streaming' | 'kind' | 'format' | 'blockKey'>>,
  ) => {
    lines = lines.map((line) => (line.id === id ? { ...line, ...patch } : line))
    emit()
  }

  const upsertBlock = (block: TerminalUpsertBlockOptions) => {
    if (destroyed) return
    const key = block.key.trim()
    if (!key) return
    const format = block.format ?? 'markdown'
    const kind = block.kind ?? 'output'
    const existing = lines.find((line) => line.blockKey === key)
    if (existing) {
      patchLine(existing.id, {
        text: block.text,
        streaming: block.streaming,
        format,
        kind,
        blockKey: key,
      })
      return
    }
    appendLine({
      kind,
      text: block.text,
      format,
      streaming: block.streaming,
      blockKey: key,
    })
  }

  const removeBlock = (keyRaw: string) => {
    if (destroyed) return
    const key = keyRaw.trim()
    if (!key) return
    const next = lines.filter((line) => line.blockKey !== key)
    if (next.length === lines.length) return
    lines = next
    emit()
  }

  const setBusy = (next: boolean) => {
    if (busy === next) return
    busy = next
    emit()
  }

  const changeCwd = async (path: string) => {
    const resolved = resolveTerminalPath(cwd, path)
    const entry = await filesStat(resolved)
    if (!entry) {
      throw new Error(`目录不存在: ${resolved}`)
    }
    if (entry.kind !== 'folder') {
      throw new Error(`不是目录: ${resolved}`)
    }
    cwd = entry.path
    env.PWD = cwd
    emit()
  }

  const runLocalOrAgent = async (rawLine: string, submitOptions: TerminalSubmitOptions) => {
    const source = submitOptions.source ?? 'user'
    const trimmed = rawLine.replace(/\r$/, '')
    const display = trimmed.length > 0 ? trimmed : ''

    appendLine({
      kind: 'input',
      text: display,
      source,
    })

    const command = trimmed.trim()
    if (!command) {
      return
    }

    const firstSpace = command.search(/\s/)
    let head = (firstSpace === -1 ? command : command.slice(0, firstSpace)).toLowerCase()
    let rest = firstSpace === -1 ? '' : command.slice(firstSpace + 1).trim()

    // 容忍 cd/、ls/user 等无空格写法
    const cdAttached = command.match(/^cd(\/.*)$/i)
    if (cdAttached) {
      head = 'cd'
      rest = cdAttached[1] || '/'
    }
    const lsAttached = command.match(/^ls(\/.*)$/i)
    if (lsAttached) {
      head = 'ls'
      rest = lsAttached[1] || '/'
    }

    if (head === 'help') {
      appendLine({ kind: 'output', text: TERMINAL_HELP_TEXT })
      return
    }

    if (head === 'clear') {
      lines = []
      emit()
      return
    }

    if (head === 'pwd') {
      appendLine({ kind: 'output', text: cwd })
      return
    }

    if (head === 'cd') {
      try {
        await changeCwd(rest || getDefaultTerminalCwd())
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        appendLine({ kind: 'error', text: message })
      }
      return
    }

    if (head === 'ls') {
      const result = await runTerminalLocalLs(cwd, rest)
      if ('error' in result) {
        appendLine({ kind: 'error', text: result.error })
      } else {
        appendLine({ kind: 'output', text: result.text, format: result.format })
      }
      return
    }

    if (head === 'demo') {
      abortController = new AbortController()
      const signal = abortController.signal
      try {
        await runTerminalLiveDemo(
          {
            write: (text, format = 'plain') => {
              appendLine({ kind: 'output', text, format })
            },
            upsertBlock,
            removeBlock,
          },
          signal,
        )
      } catch (error) {
        if (isStreamAbortError(error, signal)) {
          appendLine({ kind: 'error', text: '^C' })
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        appendLine({ kind: 'error', text: message })
      } finally {
        abortController = undefined
      }
      return
    }

    const privilege = await runTerminalLocalPrivilegeCommand(head, rest, {
      source: source === 'program' ? 'program' : 'user',
      actorLabel:
        source === 'program' ? resolveActorLabel(options.usageActor) : '终端',
    })
    if (privilege.handled) {
      if (privilege.message) {
        appendLine({ kind: 'output', text: privilege.message })
      }
      if (privilege.error) {
        appendLine({ kind: 'error', text: privilege.error })
      }
      return
    }

    abortController = new AbortController()
    const signal = abortController.signal
    const outputId = nextLineId()
    const statusId = nextLineId()
    const screenLines = lines.map((line) => ({
      kind: line.kind,
      text: line.text,
      source: line.source,
    }))
    appendLine({
      id: outputId,
      kind: 'output',
      text: '',
      streaming: true,
    })
    appendLine({
      id: statusId,
      kind: 'status',
      text: '执行中…',
    })

    try {
      const result = await askTerminalAgent(command, {
        cwd,
        usageActor: options.usageActor,
        thinkingEnabled: submitOptions.thinkingEnabled ?? thinkingEnabled,
        screenLines,
        signal,
        upsertBlock,
        removeBlock,
        clearScreen: () => {
          lines = []
          emit()
        },
        onProgress: (progress) => {
          patchLine(outputId, {
            text: progress.text,
            streaming: true,
            format: looksLikeMarkdown(progress.text) ? 'markdown' : 'plain',
          })
          if (progress.statusLabel) {
            patchLine(statusId, { text: progress.statusLabel })
          }
        },
      })

      if (result.clearedScreen) {
        // 清屏已抹掉占位行；不再回写最终汇报
        return
      }

      lines = lines.filter((line) => line.id !== statusId)
      if (result.text.trim()) {
        const format = looksLikeMarkdown(result.text) ? 'markdown' : 'plain'
        patchLine(outputId, {
          text: result.text,
          streaming: false,
          format,
        })
        if (!lines.some((line) => line.id === outputId)) {
          appendLine({ kind: 'output', text: result.text, format })
        }
      } else {
        lines = lines.filter((line) => line.id !== outputId)
        emit()
      }
    } catch (error) {
      lines = lines.filter((line) => line.id !== statusId && line.id !== outputId)
      emit()
      if (isStreamAbortError(error, signal)) {
        appendLine({ kind: 'error', text: '^C' })
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      appendLine({ kind: 'error', text: message })
    } finally {
      abortController = undefined
    }
  }

  const drainQueue = async () => {
    if (draining || destroyed) return
    draining = true
    setBusy(true)

    while (queue.length > 0 && !destroyed) {
      const item = queue.shift()
      if (!item) break
      try {
        await runLocalOrAgent(item.line, item.options)
        item.resolve()
      } catch (error) {
        item.reject(error)
      }
    }

    setBusy(false)
    draining = false
  }

  const session: TerminalSession = {
    subscribe: (listener) => {
      listeners.add(listener)
      listener(snapshot())
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: snapshot,
    submit: (line, submitOptions = {}) => {
      if (destroyed) {
        return Promise.reject(new Error('终端会话已销毁'))
      }
      return new Promise<void>((resolve, reject) => {
        queue.push({
          line,
          options: submitOptions,
          resolve,
          reject,
        })
        void drainQueue()
      })
    },
    runPrivilege: async (request) => {
      if (destroyed) {
        throw new Error('终端会话已销毁')
      }
      setBusy(true)
      appendLine({
        kind: 'status',
        text: `特权操作：${request.actorLabel?.trim() || request.source} → ${request.kind}`,
      })
      try {
        const result = await runTerminalPrivilegeRequest(request)
        lines = lines.filter((line) => line.kind !== 'status')
        if (result.message) {
          appendLine({ kind: 'output', text: result.message })
        }
        if (result.error) {
          appendLine({ kind: 'error', text: result.error })
        }
      } finally {
        setBusy(false)
      }
    },
    write: (text) => {
      if (destroyed) return
      const content = text.endsWith('\n') ? text.slice(0, -1) : text
      if (!content) return
      appendLine({ kind: 'output', text: content })
    },
    upsertBlock,
    removeBlock,
    clear: () => {
      if (destroyed) return
      lines = []
      emit()
    },
    abort: () => {
      abortController?.abort()
      // Reject queued items that haven't started
      while (queue.length > 0) {
        const item = queue.shift()
        item?.reject(new DOMException('Aborted', 'AbortError'))
      }
    },
    getCwd: () => cwd,
    getEnv: () => ({ ...env }),
    cd: async (path) => {
      await changeCwd(path)
    },
    setThinkingEnabled: (enabled) => {
      thinkingEnabled = enabled
    },
    getThinkingEnabled: () => thinkingEnabled,
    destroy: () => {
      destroyed = true
      abortController?.abort()
      queue.length = 0
      listeners.clear()
    },
  }

  return session
}
