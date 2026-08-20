import { useCallback, useEffect, useState } from 'preact/hooks'
import { formatUsageTime } from '../../ai/ai-token-usage.ts'
import {
  clearSystemDebugLogs,
  dismissPreviousSessionSystemDebugLogs,
  formatSystemDebugLogLines,
  getPreviousSessionSystemDebugLogs,
  getPreviousSessionSystemDebugSavedAt,
  listSystemDebugLogs,
  SYSTEM_DEBUG_LOG_CHANGED_EVENT,
  type SystemDebugLogEntry,
} from '../../os/system-debug-log.ts'

function layerLabel(layer: SystemDebugLogEntry['layer']): string {
  switch (layer) {
    case 'npm':
      return 'npm'
    case 'qjs':
      return 'QuickJS'
    case 'qjs-fs':
      return 'fs'
    case 'vfs-resolve':
      return 'VFS'
    case 'require':
      return 'require'
    case 'system':
      return '系统'
  }
}

type SystemDebugLogPanelProps = {
  narrowLayout: boolean
}

export function SystemDebugLogPanel({ narrowLayout }: SystemDebugLogPanelProps) {
  const [entries, setEntries] = useState(() => listSystemDebugLogs())
  const [previous, setPrevious] = useState(() => getPreviousSessionSystemDebugLogs())
  const [previousSavedAt, setPreviousSavedAt] = useState(() =>
    getPreviousSessionSystemDebugSavedAt(),
  )

  const refresh = useCallback(() => {
    setEntries(listSystemDebugLogs())
    setPrevious(getPreviousSessionSystemDebugLogs())
    setPreviousSavedAt(getPreviousSessionSystemDebugSavedAt())
  }, [])

  useEffect(() => {
    const onChanged = () => refresh()
    window.addEventListener(SYSTEM_DEBUG_LOG_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(SYSTEM_DEBUG_LOG_CHANGED_EVENT, onChanged)
  }, [refresh])

  const handleCopy = async () => {
    const lines = [
      '=== 当前会话 ===',
      formatSystemDebugLogLines(entries),
      previous.length > 0 ? '\n=== 上次会话残留 ===' : '',
      previous.length > 0 ? formatSystemDebugLogLines(previous) : '',
    ]
      .filter((line) => line.length > 0)
      .join('\n')
    try {
      await navigator.clipboard.writeText(lines)
    } catch {
      // ignore
    }
  }

  const handleClear = () => {
    clearSystemDebugLogs()
    refresh()
  }

  const handleDismissPrevious = () => {
    dismissPreviousSessionSystemDebugLogs()
    refresh()
  }

  const displayEntries = [...entries].reverse()

  return (
    <div class={`event-log event-log--system${narrowLayout ? ' event-log--narrow' : ''}`}>
      <div class="event-log__system-toolbar">
        <p class="event-log__system-hint">
          采样记录 npm run / QuickJS / 文件系统面包屑（内存环 + localStorage 快照，可跨标签读取）。整页卡死后请新开标签页打开「事件日志 → 系统」，查看「上次会话残留」；卡死标签本身往往无法刷新。
        </p>
        <div class="event-log__system-actions">
          <button type="button" class="event-log__system-btn" onClick={() => void handleCopy()}>
            复制
          </button>
          <button type="button" class="event-log__system-btn" onClick={handleClear}>
            清空当前
          </button>
        </div>
      </div>

      {previous.length > 0 ? (
        <section class="event-log__system-residual">
          <div class="event-log__system-residual-head">
            <h3 class="event-log__system-residual-title">
              上次会话残留
              {previousSavedAt !== undefined
                ? `（${formatUsageTime(previousSavedAt)}）`
                : ''}
            </h3>
            <button
              type="button"
              class="event-log__system-btn event-log__system-btn--ghost"
              onClick={handleDismissPrevious}
            >
              隐藏
            </button>
          </div>
          <pre class="event-log__system-pre">
            {formatSystemDebugLogLines(previous.slice(-80))}
          </pre>
        </section>
      ) : undefined}

      <div class="event-log__system-list">
        {displayEntries.length === 0 ? (
          <p class="event-log__empty">暂无系统诊断记录</p>
        ) : (
          <ul class="event-log__system-lines">
            {displayEntries.map((entry) => (
              <li key={entry.id} class="event-log__system-line">
                <span class="event-log__system-time">{formatUsageTime(entry.at)}</span>
                <span class="event-log__system-layer">{layerLabel(entry.layer)}</span>
                <span class="event-log__system-op">{entry.op}</span>
                {entry.durationMs !== undefined ? (
                  <span class="event-log__system-dur">{entry.durationMs}ms</span>
                ) : undefined}
                {entry.detail ? (
                  <span class="event-log__system-detail">{entry.detail}</span>
                ) : undefined}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export function listRecentSystemDebugLogsForDialog(limit: number): SystemDebugLogEntry[] {
  return listSystemDebugLogs().slice(-limit)
}

export function copyRecentSystemDebugLogs(limit: number): string {
  return formatSystemDebugLogLines(listSystemDebugLogs().slice(-limit))
}
