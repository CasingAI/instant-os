import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { DevConsoleInfoTab, DevConsoleSettingsTab } from './DevConsolePanels.tsx'
import {
  clearDevLogs,
  readDevLogs,
  subscribeDevLogs,
  type DevLogCategory,
  type DevLogEntry,
} from './instant-os-dev-log.ts'
import { hasDevAiCredentials, resolveInstantOsRuntimeMode } from './instant-os-runtime.ts'
import { subscribeDevSettings } from './instant-os-dev-settings.ts'
import { FLOAT_BALL_SIZE_PX, useDraggableFloatBall } from './use-draggable-float-ball.ts'
import './DevConsole.css'

type DevConsoleSection = 'logs' | 'settings' | 'info'
type DevLogTab = 'all' | DevLogCategory

const LOG_TABS: Array<{ id: DevLogTab; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'lifecycle', label: '生命周期' },
  { id: 'bridge-out', label: '发出' },
  { id: 'bridge-in', label: '收到' },
  { id: 'ai', label: 'AI' },
  { id: 'system', label: '系统' },
]

const SECTION_TABS: Array<{ id: DevConsoleSection; label: string }> = [
  { id: 'logs', label: '日志' },
  { id: 'settings', label: '配置' },
  { id: 'info', label: '信息' },
]

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
}

function formatDetail(detail: unknown): string {
  if (detail === undefined) {
    return ''
  }

  try {
    return JSON.stringify(detail, undefined, 2)
  } catch {
    return String(detail)
  }
}

function categoryLabel(category: DevLogCategory): string {
  switch (category) {
    case 'lifecycle':
      return '生命周期'
    case 'bridge-out':
      return '发出'
    case 'bridge-in':
      return '收到'
    case 'ai':
      return 'AI'
    case 'system':
      return '系统'
    default:
      return category
  }
}

function DevConsoleItem({ entry }: { entry: DevLogEntry }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetail = entry.detail !== undefined

  return (
    <article class="dev-console__item">
      <div class="dev-console__item-top">
        <div class="dev-console__meta">
          <span class="dev-console__tag">{categoryLabel(entry.category)}</span>
          <span class={`dev-console__level dev-console__level--${entry.level}`}>{entry.level}</span>
        </div>
        <time class="dev-console__time">{formatTime(entry.timestamp)}</time>
      </div>
      <p class="dev-console__message">{entry.message}</p>
      {hasDetail ? (
        <button
          type="button"
          class="dev-console__action"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? '收起详情' : '查看详情'}
        </button>
      ) : undefined}
      {expanded && hasDetail ? <pre class="dev-console__detail">{formatDetail(entry.detail)}</pre> : undefined}
    </article>
  )
}

export function DevConsole() {
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState<DevConsoleSection>('logs')
  const [logTab, setLogTab] = useState<DevLogTab>('all')
  const [revision, setRevision] = useState(0)

  const toggleOpen = useCallback(() => {
    setOpen((value) => !value)
  }, [])

  const { position, pointerHandlers } = useDraggableFloatBall(toggleOpen)

  useEffect(() => subscribeDevLogs(() => setRevision((value) => value + 1)), [])
  useEffect(() => subscribeDevSettings(() => setRevision((value) => value + 1)), [])

  const logs = useMemo(() => {
    void revision
    const all = readDevLogs()
    if (logTab === 'all') {
      return all
    }
    return all.filter((entry) => entry.category === logTab)
  }, [revision, logTab])

  const runtimeMode = resolveInstantOsRuntimeMode()
  const aiModeLabel = hasDevAiCredentials() ? '真实 API' : 'Mock'
  const panelStyle = {
    left: `${Math.min(Math.max(position.x - 8, 12), Math.max(12, window.innerWidth - 360))}px`,
    right: '12px',
    bottom: `${Math.max(12, window.innerHeight - position.y + 12)}px`,
  }

  return (
    <div class="dev-console">
      {open ? (
        <section class="dev-console__panel" style={panelStyle} aria-label="Instant OS 开发控制台">
          <header class="dev-console__header">
            <div>
              <h2 class="dev-console__title">Instant OS DevTools</h2>
              <p class="dev-console__message">
                模式 {runtimeMode} · AI {aiModeLabel}
              </p>
            </div>
            <div class="dev-console__actions">
              {section === 'logs' ? (
                <button type="button" class="dev-console__action" onClick={() => clearDevLogs()}>
                  清空日志
                </button>
              ) : undefined}
              <button type="button" class="dev-console__action" onClick={() => setOpen(false)}>
                关闭
              </button>
            </div>
          </header>

          <div class="dev-console__tabs dev-console__tabs--primary" role="tablist" aria-label="面板分类">
            {SECTION_TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                class={`dev-console__tab${section === item.id ? ' dev-console__tab--active' : ''}`}
                onClick={() => setSection(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          {section === 'logs' ? (
            <>
              <div class="dev-console__tabs" role="tablist" aria-label="日志分类">
                {LOG_TABS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    class={`dev-console__tab${logTab === item.id ? ' dev-console__tab--active' : ''}`}
                    onClick={() => setLogTab(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div class="dev-console__list">
                {logs.length === 0 ? (
                  <p class="dev-console__empty">暂无日志。启动应用或调用 AI 接口后会显示桥接记录。</p>
                ) : (
                  logs.map((entry) => <DevConsoleItem key={entry.id} entry={entry} />)
                )}
              </div>
            </>
          ) : undefined}

          {section === 'settings' ? <DevConsoleSettingsTab /> : undefined}
          {section === 'info' ? <DevConsoleInfoTab /> : undefined}
        </section>
      ) : undefined}

      <button
        type="button"
        class={`dev-console__float-ball${open ? ' dev-console__float-ball--active' : ''}`}
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: `${FLOAT_BALL_SIZE_PX}px`,
          height: `${FLOAT_BALL_SIZE_PX}px`,
        }}
        aria-expanded={open}
        aria-label="Instant OS 开发工具"
        {...pointerHandlers}
      >
        <span class="dev-console__float-ball-label">OS</span>
        {logs.length > 0 ? <span class="dev-console__badge">{Math.min(logs.length, 99)}</span> : undefined}
      </button>
    </div>
  )
}
