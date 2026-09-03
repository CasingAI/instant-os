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
import { Page } from '../../ui/page.tsx'
import { PageHeader } from '../../ui/page-header.tsx'
import {
  AdaptiveSplitNav,
  useAdaptiveSplitNav,
  type AdaptiveFrameSpec,
} from '../../ui/adaptive-split-nav.tsx'
import { IosButton } from '../../ui/ios-button.tsx'
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
  const nav = useAdaptiveSplitNav({
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

  // ── 形变期返回键对齐（nav-kit-demo 同款）：详情页/详情帧的返回键只在窄
  // 形态有、分栏静置没有。A 型（窄→宽）先挂着随滑轨淡出；C 型（宽→窄）
  // 落定交棒后才出现，给一次透明度 0→1 的短淡入代替硬蹦。
  const [backFadeEpoch, setBackFadeEpoch] = useState(0)
  const backFadeTimerRef = useRef(0)
  const prevMorphingRef = useRef(false)
  useLayoutEffect(() => {
    const was = prevMorphingRef.current
    prevMorphingRef.current = nav.morphing
    if (was === nav.morphing) return
    if (nav.morphing || !nav.narrowLayout || !selectedId) return
    window.clearTimeout(backFadeTimerRef.current)
    setBackFadeEpoch((epoch) => epoch + 1)
    backFadeTimerRef.current = window.setTimeout(() => setBackFadeEpoch(0), 320)
  }, [nav.morphing, nav.narrowLayout, selectedId])
  useEffect(() => () => window.clearTimeout(backFadeTimerRef.current), [])

  // ── 页面渲染：同一份内容同时供给窄屏子页与分栏帧（返回键按形态挂/摘）──

  // stacked = 窄屏子页行（SettingsNavRow）；分栏左栏用自绘选中行（渐变底）。
  const renderListPage = (stacked: boolean) => (
    <Page header={<PageHeader title="服务" />}>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          {services.length === 0 ? (
            <div class="settings__box settings__empty">暂无已注册的系统服务</div>
          ) : (
            <div class="settings__list">
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
            </div>
          )}
          <p class="settings__section-footnote">
            共 {services.length} 个服务 · {runningCount} 个运行中
          </p>
        </section>
      </div>
    </Page>
  )

  const renderDetailPage = (showBack: boolean, headerClass?: string) => (
    <Page
      header={
        <PageHeader
          class={headerClass}
          title={selected?.label ?? '详情'}
          backLabel={showBack ? '服务' : undefined}
          onBack={showBack ? () => nav.navigate('list', 'pop') : undefined}
        />
      }
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
                  wideLayout={!nav.narrowLayout}
                  onNavigate={
                    nav.narrowLayout ? () => nav.navigate('startup-type', 'push') : undefined
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
    </Page>
  )

  const renderNarrowPage = (target: string) => {
    if (target === 'detail') {
      return renderDetailPage(
        true,
        backFadeEpoch > 0 && target === nav.page
          ? `services__back-fade-in-${backFadeEpoch % 2}`
          : undefined,
      )
    }
    if (target === 'startup-type' && selected) {
      // 窄屏「启动类型」选择页：宽屏该字段是就地弹层，只有窄屏会推进到这里
      return (
        <Page
          header={
            <PageHeader
              title="启动类型"
              backLabel={selected.label}
              onBack={() => nav.navigate('detail', 'pop')}
            />
          }
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
        </Page>
      )
    }
    return renderListPage(nav.narrowLayout)
  }

  // 分栏帧：详情帧静置不带返回（左栏列表即它的上级），A 型形变（窄→宽）
  // 先挂着返回随滑轨淡出。
  const keepDetailBack = nav.morphing && nav.morphKind === 'A' && selected !== undefined

  const renderWideFrames = (): AdaptiveFrameSpec[] => [
    {
      id: 'detail',
      content: renderDetailPage(
        keepDetailBack,
        keepDetailBack ? 'services__back-fade-out' : undefined,
      ),
    },
  ]

  return (
    <AdaptiveSplitNav
      controller={nav}
      class="services-host"
      renderNarrowPage={renderNarrowPage}
      renderWideFrames={renderWideFrames}
      listRatio={0.36}
    />
  )
}
