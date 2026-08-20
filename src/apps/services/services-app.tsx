import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
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
import { restartAiInference, stopAiInference } from '../../ai/ai-inference-service.ts'
import {
  listWorkerHeapReports,
  WORKER_HEAP_REPORTS_CHANGED_EVENT,
  WORKER_SERVICE_STATUS_LABELS,
  type ServiceStartupType,
  type WorkerHeapReport,
  type WorkerHeapServiceId,
} from '../../os/worker-heap-reports.ts'
import {
  KeychainNavStack,
  useKeychainNavStack,
} from '../keychain/keychain-nav-stack.tsx'
import { IosButton } from '../../ui/ios-button.tsx'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { SettingsChoiceField } from '../../ui/settings-choice-field.tsx'
import { SettingsNavRow } from '../../ui/settings-nav-row.tsx'
import { useAppNarrowLayout } from '../../ui/use-app-narrow-layout.ts'
import { SettingsChoicePickerView } from '../settings/settings-choice-picker-view.tsx'
import '../../ui/ios-nav-back.css'
import '../settings/settings.css'
import '../keychain/keychain.css'
import './services.css'

const APP_ID = 'services' as const

type ServicesScreen = 'list' | 'detail' | 'startup-type'

const STARTUP_TYPE_OPTIONS = [
  { id: 'auto', label: '自动启动' },
  { id: 'auto-delayed', label: '延迟启动' },
  { id: 'manual', label: '手动' },
] as const satisfies ReadonlyArray<{ id: ServiceStartupType; label: string }>

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

/** 与 `.settings` 面板纵向渐变 (#ececec → #d8d8d8) 对齐 */
function settingsPanelColorAt(ratio: number): string {
  const t = Math.min(1, Math.max(0, ratio))
  const channel = (top: number, bottom: number) =>
    Math.round(top + (bottom - top) * t)
  const r = channel(0xec, 0xd8)
  const g = channel(0xec, 0xd8)
  const b = channel(0xec, 0xd8)
  return `rgb(${r}, ${g}, ${b})`
}

export function ServicesApp() {
  const { hostRef, narrowLayout, layoutReady } = useAppNarrowLayout()
  const [services, setServices] = useState<WorkerHeapReport[]>(() => listWorkerHeapReports())
  const [selectedId, setSelectedId] = useState<WorkerHeapServiceId | undefined>(() => {
    const initial = listWorkerHeapReports()
    return initial[0]?.id
  })
  const [settingsTick, setSettingsTick] = useState(0)
  const [caretPos, setCaretPos] = useState<
    { x: number; y: number; fill: string } | undefined
  >(undefined)
  const prevNarrowLayoutRef = useRef<boolean | undefined>(undefined)
  const splitRef = useRef<HTMLDivElement>(null)
  const listPaneRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const detailPanelRef = useRef<HTMLDivElement>(null)
  const selectedRowRef = useRef<HTMLButtonElement>(null)

  const {
    page: screen,
    stack: navStack,
    transition: navTransition,
    queuedTransition: navQueuedTransition,
    commitQueuedTransition: commitNavQueuedTransition,
    navigate: navigateTo,
    handleMotionEnd: handleStackMotionEnd,
    setPage: resetNavPage,
  } = useKeychainNavStack<ServicesScreen>('list')

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

  useEffect(() => {
    if (services.length === 0) {
      setSelectedId(undefined)
      return
    }
    if (!selectedId || !services.some((s) => s.id === selectedId)) {
      setSelectedId(services[0]?.id)
    }
  }, [selectedId, services])

  useLayoutEffect(() => {
    if (!layoutReady) {
      return
    }

    const previous = prevNarrowLayoutRef.current
    if (previous === undefined) {
      prevNarrowLayoutRef.current = narrowLayout
      return
    }

    prevNarrowLayoutRef.current = narrowLayout

    if (previous && !narrowLayout) {
      resetNavPage('list')
    }
  }, [layoutReady, narrowLayout, resetNavPage])

  const selected = useMemo(
    () => (selectedId ? services.find((s) => s.id === selectedId) : undefined),
    [selectedId, services],
  )

  const effectiveTypeOf = useCallback(
    (service: WorkerHeapReport): ServiceStartupType => {
      void settingsTick
      return resolveEffectiveStartupType(service)
    },
    [settingsTick],
  )

  const runningCount = services.filter((s) => s.status === 'running').length

  useAppMenuBar(APP_ID, [])

  const changeStartupType = (id: WorkerHeapServiceId, type: ServiceStartupType): void => {
    patchServiceStartupType(id, type)
    setWorkerServiceStartupType(id, type)
  }

  const handleSelectService = (id: WorkerHeapServiceId): void => {
    setSelectedId(id)
    if (narrowLayout) {
      navigateTo('detail', 'push')
    }
  }

  const syncCaretPos = useCallback(() => {
    if (narrowLayout) {
      setCaretPos(undefined)
      return
    }
    const row = selectedRowRef.current
    const split = splitRef.current
    const panel = detailPanelRef.current
    if (!row || !split || !panel) {
      setCaretPos(undefined)
      return
    }
    const rowRect = row.getBoundingClientRect()
    const splitRect = split.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    const rowCenterY = rowRect.top + rowRect.height / 2
    const gradientT =
      panelRect.height > 0 ? (rowCenterY - panelRect.top) / panelRect.height : 0
    setCaretPos({
      x: panelRect.left - splitRect.left,
      y: rowCenterY - splitRect.top,
      fill: settingsPanelColorAt(gradientT),
    })
  }, [narrowLayout])

  useLayoutEffect(() => {
    syncCaretPos()
  }, [syncCaretPos, selectedId, services, narrowLayout])

  useEffect(() => {
    const listPane = listPaneRef.current
    const split = splitRef.current
    const panel = detailPanelRef.current
    const row = selectedRowRef.current
    listPane?.addEventListener('scroll', syncCaretPos, { passive: true })
    panel?.addEventListener('scroll', syncCaretPos, { passive: true })
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            syncCaretPos()
          })
        : undefined
    if (split) {
      observer?.observe(split)
    }
    if (panel) {
      observer?.observe(panel)
    }
    if (listPane) {
      observer?.observe(listPane)
    }
    if (row) {
      observer?.observe(row)
    }
    window.addEventListener('resize', syncCaretPos)
    return () => {
      listPane?.removeEventListener('scroll', syncCaretPos)
      panel?.removeEventListener('scroll', syncCaretPos)
      observer?.disconnect()
      window.removeEventListener('resize', syncCaretPos)
    }
  }, [syncCaretPos, selectedId, services, narrowLayout])

  const selectedStartupType = selected ? effectiveTypeOf(selected) : undefined
  const canStart =
    selected !== undefined &&
    (selected.status === 'stopped' || selected.status === 'failed')
  const canStop =
    selected !== undefined &&
    (selected.status === 'running' || selected.status === 'restarting')
  const canRestart = selected !== undefined

  const renderListNav = () => (
    <div class="settings__nav settings__nav--titled">
      <div class="settings__nav-bar">
        <span class="settings__nav-heading-spacer" aria-hidden="true" />
        <h1 class="settings__nav-heading">服务</h1>
        <span class="settings__nav-trailing" aria-hidden="true" />
      </div>
    </div>
  )

  const renderListContent = (stacked: boolean) => (
    <div class="settings__content settings__content--compact">
      <section class="settings__section">
        {services.length === 0 ? (
          <div class="settings__box settings__empty">暂无已注册的系统服务</div>
        ) : (
          <div ref={listRef} class="settings__list">
            {services.map((service) => {
              const isSelected = service.id === selectedId
              if (stacked) {
                return (
                  <SettingsNavRow
                    key={service.id}
                    label={service.label}
                    value={WORKER_SERVICE_STATUS_LABELS[service.status]}
                    onClick={() => handleSelectService(service.id)}
                  />
                )
              }
              return (
                <button
                  key={service.id}
                  ref={isSelected ? selectedRowRef : undefined}
                  type="button"
                  class={`settings__row services__pick-row${isSelected ? ' services__pick-row--selected' : ''}`}
                  onClick={() => handleSelectService(service.id)}
                >
                  <span class="settings__row-name">{service.label}</span>
                  <span class="settings__row-size">
                    {WORKER_SERVICE_STATUS_LABELS[service.status]}
                  </span>
                </button>
              )
            })}
          </div>
        )}
        <p class="settings__section-footnote">
          共 {services.length} 个服务 · {runningCount} 个运行中
        </p>
      </section>
    </div>
  )

  const renderDetailNav = (stacked: boolean) => (
    <div class="settings__nav settings__nav--titled">
      <div class="settings__nav-bar">
        {stacked ? (
          <IosNavBackButton
            label="服务"
            onClick={() => navigateTo('list', 'pop')}
          />
        ) : (
          <span class="settings__nav-heading-spacer" aria-hidden="true" />
        )}
        <h1 class="settings__nav-heading">{selected?.label ?? '详情'}</h1>
        <span class="settings__nav-trailing" aria-hidden="true" />
      </div>
    </div>
  )

  const renderDetailContent = () => (
    <div class="settings__content settings__content--compact">
      {!selected ? (
        <section class="settings__section">
          <div class="settings__box settings__empty">选择一个服务以查看详情。</div>
        </section>
      ) : (
        <section class="settings__section">
          <p class="settings__section-footnote services__detail-lead">
            {selected.description || '暂无描述'}
          </p>
          <div class="settings__list">
            <div class="settings__row">
              <span class="settings__row-name">服务 ID</span>
              <span class="settings__row-size settings__row-size--mono">{selected.id}</span>
            </div>
            <div class="settings__row">
              <span class="settings__row-name">状态</span>
              <span class="settings__row-size">
                {WORKER_SERVICE_STATUS_LABELS[selected.status]}
                {selected.restartCount > 0 ? ` · 重启 ${selected.restartCount} 次` : ''}
              </span>
            </div>
            <div class="settings__row">
              <span class="settings__row-name">最近心跳</span>
              <span class="settings__row-size">
                {selected.status === 'running' || selected.status === 'restarting'
                  ? formatHeartbeat(selected.at)
                  : '—'}
              </span>
            </div>
            {selected.id !== 'ai-inference' && (
              <SettingsChoiceField
                label="启动类型"
                value={selectedStartupType ?? 'manual'}
                options={STARTUP_TYPE_OPTIONS}
                onChange={(value) => {
                  if (STARTUP_TYPE_OPTIONS.some((option) => option.id === value)) {
                    changeStartupType(selected.id, value as ServiceStartupType)
                  }
                }}
                wideLayout={!narrowLayout}
                onNavigate={
                  narrowLayout ? () => navigateTo('startup-type', 'push') : undefined
                }
              />
            )}
          </div>

          <div class="services__detail-actions">
            {canStart && (
              <IosButton
                size="compact"
                onClick={() =>
                  selected.id === 'ai-inference'
                    ? restartAiInference()
                    : startWorkerService(selected.id)
                }
              >
                开始
              </IosButton>
            )}
            {canStop && (
              <IosButton
                size="compact"
                tone="danger"
                onClick={() =>
                  selected.id === 'ai-inference'
                    ? stopAiInference()
                    : stopWorkerService(selected.id)
                }
              >
                停止
              </IosButton>
            )}
            {canRestart && (
              <IosButton
                size="compact"
                onClick={() =>
                  selected.id === 'ai-inference'
                    ? restartAiInference()
                    : restartWorkerService(selected.id)
                }
              >
                重启
              </IosButton>
            )}
          </div>
        </section>
      )}
    </div>
  )

  const renderScreen = (target: ServicesScreen) => {
    if (target === 'startup-type' && selected) {
      return (
        <SettingsChoicePickerView
          title="启动类型"
          backLabel={selected.label}
          options={STARTUP_TYPE_OPTIONS}
          value={selectedStartupType ?? 'manual'}
          titleInNav
          onChange={(value) => {
            if (STARTUP_TYPE_OPTIONS.some((option) => option.id === value)) {
              changeStartupType(selected.id, value as ServiceStartupType)
            }
          }}
          onBack={() => navigateTo('detail', 'pop')}
        />
      )
    }
    if (target === 'detail') {
      return (
        <>
          {renderDetailNav(true)}
          {renderDetailContent()}
        </>
      )
    }
    return (
      <>
        {renderListNav()}
        {renderListContent(true)}
      </>
    )
  }

  if (narrowLayout) {
    return (
      <div ref={hostRef} class="services-host services-host--narrow">
        <KeychainNavStack
          stack={navStack}
          page={screen}
          transition={navTransition}
          queuedTransition={navQueuedTransition}
          commitQueuedTransition={commitNavQueuedTransition}
          onMotionEnd={handleStackMotionEnd}
          renderPage={renderScreen}
        />
      </div>
    )
  }

  return (
    <div ref={hostRef} class="services-host">
      <div
        ref={splitRef}
        class="services-split"
        style={
          caretPos
            ? ({
                ['--services-caret-x' as string]: `${caretPos.x}px`,
                ['--services-caret-y' as string]: `${caretPos.y}px`,
                ['--services-caret-fill' as string]: caretPos.fill,
              } as Record<string, string>)
            : undefined
        }
      >
        <div
          ref={listPaneRef}
          class="settings services-split__pane services-split__pane--list"
        >
          {renderListNav()}
          {renderListContent(false)}
        </div>
        <div
          ref={detailPanelRef}
          class="settings services-split__pane services-split__pane--detail"
        >
          {renderDetailNav(false)}
          {renderDetailContent()}
        </div>
        {selected && caretPos ? (
          <span class="services__detail-caret" aria-hidden="true" />
        ) : undefined}
      </div>
    </div>
  )
}
