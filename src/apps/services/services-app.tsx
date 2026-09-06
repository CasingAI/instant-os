import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
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
  Nav,
  useNav,
  type NavFrameSpec,
} from '../../ui/nav.tsx'
import { Button } from '../../ui/button.tsx'
import { List } from '../../ui/list.tsx'
import { SettingsChoiceField } from '../../ui/settings-choice-field.tsx'
import { SettingsChoiceOptionList } from '../../ui/settings-choice-option-list.tsx'
import { SettingsNavRow } from '../../ui/settings-nav-row.tsx'
import '../settings/settings.css'
import './services.css'

const APP_ID = 'services' as const

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

export function ServicesApp() {
  const [services, setServices] = useState<WorkerHeapReport[]>(() => listWorkerHeapReports())
  // 初始不选中：窄屏首屏停在列表页；选中由下方 effect 补上（宽屏详情帧随之出内容）
  const [selectedId, setSelectedId] = useState<WorkerHeapServiceId | undefined>(undefined)
  const [settingsTick, setSettingsTick] = useState(0)

  // 单一真源是选中的服务：窄屏子页与分栏详情帧都从它派生，
  // 分栏切回子页栈的落点也由它推导。
  const nav = useNav({
    split: true,
    narrowPageForState: () => (selectedId ? 'detail' : 'list'),
    listPage: 'list',
  })

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
    if (nav.narrowLayout && nav.page === 'list') {
      nav.navigate('detail', 'push')
    }
  }

  const selectedStartupType = selected ? effectiveTypeOf(selected) : undefined
  const canStart =
    selected !== undefined &&
    (selected.status === 'stopped' || selected.status === 'failed')
  const canStop =
    selected !== undefined &&
    (selected.status === 'running' || selected.status === 'restarting')
  const canRestart = selected !== undefined

  // ── 页面渲染：外壳统一由 <Nav.Page> 绘制，返回键显隐与形变淡入淡出由
  // Nav 统一编排（应用只声明域事实：详情页有上一级「服务」）──

  // stacked = 窄屏子页行（SettingsNavRow）；分栏左栏用自绘选中行（渐变底）。
  const renderListPage = (stacked: boolean) => (
    <Nav.Page title="服务">
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          {services.length === 0 ? (
            <div class="settings__box settings__empty">暂无已注册的系统服务</div>
          ) : (
            <List>
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
            </List>
          )}
          <p class="settings__section-footnote">
            共 {services.length} 个服务 · {runningCount} 个运行中
          </p>
        </section>
      </div>
    </Nav.Page>
  )

  const renderDetailPage = () => (
    <Nav.Page
      title={selected?.label ?? '详情'}
      backLabel="服务"
      onBack={() => nav.navigate('list', 'pop')}
    >
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
            <List>
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
                  wideLayout={!nav.narrowLayout}
                  onNavigate={
                    nav.narrowLayout ? () => nav.navigate('startup-type', 'push') : undefined
                  }
                />
              )}
            </List>

            <div class="services__detail-actions">
              {canStart && (
                <Button
                  onClick={() =>
                    selected.id === 'ai-inference'
                      ? restartAiInference()
                      : startWorkerService(selected.id)
                  }
                >
                  开始
                </Button>
              )}
              {canStop && (
                <Button
                  tone="danger"
                  onClick={() =>
                    selected.id === 'ai-inference'
                      ? stopAiInference()
                      : stopWorkerService(selected.id)
                  }
                >
                  停止
                </Button>
              )}
              {canRestart && (
                <Button
                  onClick={() =>
                    selected.id === 'ai-inference'
                      ? restartAiInference()
                      : restartWorkerService(selected.id)
                  }
                >
                  重启
                </Button>
              )}
            </div>
          </section>
        )}
      </div>
    </Nav.Page>
  )

  const renderNarrowPage = (target: string) => {
    if (target === 'detail') {
      return renderDetailPage()
    }
    if (target === 'startup-type' && selected) {
      // 窄屏「启动类型」选择页：宽屏该字段是就地弹层，只有窄屏会推进到这里
      return (
        <Nav.Page
          title="启动类型"
          backLabel={selected.label}
          onBack={() => nav.navigate('detail', 'pop')}
        >
          <div class="settings__content settings__content--compact">
            <section class="settings__section">
              <SettingsChoiceOptionList
                options={STARTUP_TYPE_OPTIONS}
                value={selectedStartupType ?? 'manual'}
                ariaLabel="启动类型"
                onChange={(value) => {
                  if (STARTUP_TYPE_OPTIONS.some((option) => option.id === value)) {
                    changeStartupType(selected.id, value as ServiceStartupType)
                    nav.navigate('detail', 'pop')
                  }
                }}
              />
            </section>
          </div>
        </Nav.Page>
      )
    }
    return renderListPage(nav.narrowLayout)
  }

  // 分栏帧：详情帧静置不带返回（左栏列表即它的上级），A 型形变（窄→宽）
  // 顶帧临时挂回随滑轨淡出——由 Nav 统一编排。
  const renderWideFrames = (): NavFrameSpec[] => [
    {
      id: 'detail',
      content: renderDetailPage(),
    },
  ]

  return (
    <Nav
      controller={nav}
      class="services-host"
      renderNarrowPage={renderNarrowPage}
      renderWideFrames={renderWideFrames}
      listRatio={0.36}
    />
  )
}
