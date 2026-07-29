import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { AppIconTile } from '../../icons/app-icon-tile.tsx'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { getAppDefinition } from '../../os/app-registry.tsx'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import {
  getServiceStartupType,
  patchServiceStartupType,
  subscribeServiceStartupSettings,
} from '../../os/service-startup-settings-storage.ts'
import {
  restartWorkerService,
  setWorkerServiceStartupType,
  startWorkerService,
  stopWorkerService,
} from '../../os/service-supervisor.ts'
import {
  listWorkerHeapReports,
  SERVICE_STARTUP_TYPE_LABELS,
  SERVICE_STARTUP_TYPES,
  WORKER_HEAP_REPORTS_CHANGED_EVENT,
  WORKER_SERVICE_STATUS_LABELS,
  type ServiceStartupType,
  type WorkerHeapReport,
  type WorkerHeapServiceId,
} from '../../os/worker-heap-reports.ts'
import './services.css'

const APP_ID = 'services' as const

function formatHeartbeat(at: number): string {
  if (!at) return '—'
  try {
    return new Date(at).toLocaleString('zh-CN', {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return '—'
  }
}

function resolveEffectiveStartupType(service: WorkerHeapReport): ServiceStartupType {
  return getServiceStartupType(service.id, service.defaultStartupType)
}

export function ServicesApp() {
  const { closeWindowsForApp, minimizeWindow, windows } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const definition = getAppDefinition(APP_ID)
  const [services, setServices] = useState<WorkerHeapReport[]>(() => listWorkerHeapReports())
  const [selectedId, setSelectedId] = useState<WorkerHeapServiceId | undefined>(undefined)
  const [settingsTick, setSettingsTick] = useState(0)

  const refresh = useCallback(() => {
    setServices(listWorkerHeapReports())
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener(WORKER_HEAP_REPORTS_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(WORKER_HEAP_REPORTS_CHANGED_EVENT, refresh)
  }, [refresh])

  useEffect(() => {
    return subscribeServiceStartupSettings(() => {
      setSettingsTick((n) => n + 1)
      refresh()
    })
  }, [refresh])

  // 选中项若已不存在则清空
  useEffect(() => {
    if (selectedId && !services.some((s) => s.id === selectedId)) {
      setSelectedId(undefined)
    }
  }, [selectedId, services])

  const selected = useMemo(
    () => (selectedId ? services.find((s) => s.id === selectedId) : undefined),
    [selectedId, services],
  )

  // settingsTick 用于在启动类型变更后强制重算有效类型
  const effectiveTypeOf = useCallback(
    (service: WorkerHeapReport): ServiceStartupType => {
      void settingsTick
      return resolveEffectiveStartupType(service)
    },
    [settingsTick],
  )

  const runningCount = services.filter((s) => s.status === 'running').length

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === APP_ID && !window.minimized)
    const name = definition?.name ?? '服务'
    return [
      {
        label: name,
        items: [
          ...aboutAppMenuPrefix(`关于 ${name}`, () => showBuiltinAbout(APP_ID)),
          {
            type: 'action',
            label: `隐藏${name}`,
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: `退出${name}`,
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp(APP_ID),
          },
        ],
      },
    ]
  }, [closeWindowsForApp, definition?.name, minimizeWindow, showBuiltinAbout, windows])

  useAppMenuBar(APP_ID, menuBar)

  const changeStartupType = (id: WorkerHeapServiceId, type: ServiceStartupType): void => {
    patchServiceStartupType(id, type)
    setWorkerServiceStartupType(id, type)
  }

  return (
    <div class="services">
      <section class="services__section">
        <h2 class="services__title">服务</h2>
        <p class="services__subtitle">
          共 {services.length} 个服务 · {runningCount} 个运行中
        </p>

        {services.length === 0 ? (
          <p class="services__empty">暂无已注册的系统服务</p>
        ) : (
          <div class="services__table-wrap">
            <table class="services__table">
              <thead>
                <tr>
                  <th class="services__th services__th--name">名称</th>
                  <th class="services__th services__th--desc">描述</th>
                  <th class="services__th services__th--status">状态</th>
                  <th class="services__th services__th--startup">启动类型</th>
                  <th class="services__th services__th--restarts">重启</th>
                  <th class="services__th services__th--action">操作</th>
                </tr>
              </thead>
              <tbody>
                {services.map((service) => {
                  const startupType = effectiveTypeOf(service)
                  const isSelected = service.id === selectedId
                  const canStart =
                    service.status === 'stopped' || service.status === 'failed'
                  const canStop =
                    service.status === 'running' || service.status === 'restarting'
                  const canRestart = startupType !== 'disabled'
                  return (
                    <tr
                      key={service.id}
                      class={`services__tr${isSelected ? ' services__tr--selected' : ''}`}
                      onClick={() => setSelectedId(service.id)}
                    >
                      <td class="services__td services__td--name">
                        <span class="services__name-cell">
                          <span class="services__app-icon">
                            <AppIconTile color="#5a6a7a" size={28}>
                              <span style={{ fontSize: '15px' }}>⚙️</span>
                            </AppIconTile>
                          </span>
                          <span class="services__name-text">{service.label}</span>
                        </span>
                      </td>
                      <td class="services__td services__td--desc" title={service.description}>
                        {service.description || '—'}
                      </td>
                      <td class="services__td services__td--status">
                        {WORKER_SERVICE_STATUS_LABELS[service.status]}
                      </td>
                      <td class="services__td services__td--startup">
                        {SERVICE_STARTUP_TYPE_LABELS[startupType]}
                      </td>
                      <td class="services__td services__td--restarts">
                        {service.restartCount > 0 ? service.restartCount : '—'}
                      </td>
                      <td class="services__td services__td--action">
                        <span class="services__actions">
                          {canStart && (
                            <button
                              type="button"
                              class="services__btn"
                              disabled={startupType === 'disabled'}
                              onClick={(event) => {
                                event.stopPropagation()
                                startWorkerService(service.id)
                              }}
                            >
                              开始
                            </button>
                          )}
                          {canStop && (
                            <button
                              type="button"
                              class="services__btn services__btn--stop"
                              onClick={(event) => {
                                event.stopPropagation()
                                stopWorkerService(service.id)
                              }}
                            >
                              停止
                            </button>
                          )}
                          {canRestart && (
                            <button
                              type="button"
                              class="services__btn"
                              onClick={(event) => {
                                event.stopPropagation()
                                restartWorkerService(service.id)
                              }}
                            >
                              重启
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && (
        <section class="services__detail">
          <h3 class="services__detail-title">{selected.label}</h3>
          <p class="services__detail-desc">
            {selected.description || '暂无描述'}
          </p>
          <div class="services__detail-grid">
            <div class="services__detail-row">
              <span class="services__detail-label">服务 ID</span>
              <span class="services__detail-value services__detail-value--mono">{selected.id}</span>
            </div>
            <div class="services__detail-row">
              <span class="services__detail-label">状态</span>
              <span class="services__detail-value">
                {WORKER_SERVICE_STATUS_LABELS[selected.status]}
                {selected.restartCount > 0 ? ` · 重启 ${selected.restartCount} 次` : ''}
              </span>
            </div>
            <div class="services__detail-row">
              <span class="services__detail-label">启动类型</span>
              <select
                class="services__select"
                value={effectiveTypeOf(selected)}
                onChange={(event) => {
                  const value = (event.target as HTMLSelectElement).value
                  if ((SERVICE_STARTUP_TYPES as readonly string[]).includes(value)) {
                    changeStartupType(selected.id, value as ServiceStartupType)
                  }
                }}
              >
                {SERVICE_STARTUP_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {SERVICE_STARTUP_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>
            <div class="services__detail-row">
              <span class="services__detail-label">最近心跳</span>
              <span class="services__detail-value">
                {selected.status === 'running' || selected.status === 'restarting'
                  ? formatHeartbeat(selected.at)
                  : '—'}
              </span>
            </div>
          </div>
          <div class="services__detail-actions">
            {(selected.status === 'stopped' || selected.status === 'failed') && (
              <button
                type="button"
                class="services__btn"
                disabled={effectiveTypeOf(selected) === 'disabled'}
                onClick={() => startWorkerService(selected.id)}
              >
                开始
              </button>
            )}
            {(selected.status === 'running' || selected.status === 'restarting') && (
              <button
                type="button"
                class="services__btn services__btn--stop"
                onClick={() => stopWorkerService(selected.id)}
              >
                停止
              </button>
            )}
            {effectiveTypeOf(selected) !== 'disabled' && (
              <button
                type="button"
                class="services__btn"
                onClick={() => restartWorkerService(selected.id)}
              >
                重启
              </button>
            )}
          </div>
        </section>
      )}

      <p class="services__footnote">
        手动：按需拉起，停止后新请求仍会透明启动。禁用：功能不可用直到改回。自动（延迟）：开机约
        10 秒后启动；延迟等待期内有请求会立即拉起。自动：显式停止后需手动开始或下次开机恢复。
      </p>
    </div>
  )
}
