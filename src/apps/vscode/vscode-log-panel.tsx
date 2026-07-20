import { useEffect, useState } from 'preact/hooks'
import {
  clearVscodeInternalLogs,
  formatVscodeInternalLogTime,
  getVscodeInternalLogs,
  subscribeVscodeInternalLogs,
  type VscodeInternalLogEntry,
  type VscodeInternalLogLevel,
} from './vscode-internal-log.ts'

function levelLabel(level: VscodeInternalLogLevel): string {
  if (level === 'error') return '错误'
  if (level === 'warn') return '警告'
  return '信息'
}

function formatLogLine(entry: VscodeInternalLogEntry): string {
  return `${formatVscodeInternalLogTime(entry.at)}\t${levelLabel(entry.level)}\t[${entry.scope}]\t${entry.message}`
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.left = '-9999px'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    } catch {
      return false
    }
  }
}

export function VscodeLogPanel() {
  const [logs, setLogs] = useState<readonly VscodeInternalLogEntry[]>(() => getVscodeInternalLogs())
  const [copyHint, setCopyHint] = useState<string | undefined>(undefined)

  useEffect(() => {
    return subscribeVscodeInternalLogs(() => {
      setLogs([...getVscodeInternalLogs()])
    })
  }, [])

  const copyAll = async () => {
    if (logs.length === 0) {
      setCopyHint('暂无日志')
      window.setTimeout(() => setCopyHint(undefined), 1500)
      return
    }
    const text = [...logs].map(formatLogLine).join('\n')
    const ok = await copyText(text)
    setCopyHint(ok ? '已复制全部' : '复制失败')
    window.setTimeout(() => setCopyHint(undefined), 1500)
  }

  return (
    <div class="vscode__logs">
      <div class="vscode__logs-toolbar">
        <span class="vscode__logs-toolbar-label">
          内部运行日志{copyHint ? ` · ${copyHint}` : ''}
        </span>
        <div class="vscode__logs-toolbar-actions">
          <button type="button" class="vscode__logs-clear" onClick={() => void copyAll()}>
            复制全部
          </button>
          <button type="button" class="vscode__logs-clear" onClick={() => clearVscodeInternalLogs()}>
            清空
          </button>
        </div>
      </div>
      {logs.length === 0 ? (
        <div class="vscode__logs-empty">暂无日志。打开 TypeScript 文件时会记录模块解析与 Worker 状态。</div>
      ) : (
        <div class="vscode__logs-list" role="log" aria-label="内部日志" aria-live="polite">
          {[...logs].reverse().map((entry) => (
            <div
              key={entry.id}
              class={`vscode__logs-item vscode__logs-item--${entry.level}`}
            >
              <span class="vscode__logs-time">{formatVscodeInternalLogTime(entry.at)}</span>
              <span class={`vscode__logs-level vscode__logs-level--${entry.level}`}>
                {levelLabel(entry.level)}
              </span>
              <span class="vscode__logs-scope">[{entry.scope}]</span>
              <span class="vscode__logs-message">{entry.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
