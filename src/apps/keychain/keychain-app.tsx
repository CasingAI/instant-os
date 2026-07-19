import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { IosSwitch } from '../../ui/ios-switch.tsx'
import { IosCheckToggle } from '../../ui/ios-check-toggle.tsx'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { AiModelCapabilityTags } from '../../ui/ai-model-capability-tags.tsx'
import { SettingsChoiceField } from '../../ui/settings-choice-field.tsx'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import {
  clearAccountSettings,
  loadAccountSettings,
  saveAccountSettings,
  type AccountSettingsV2,
} from '../../os/account-settings-storage.ts'
import {
  AI_MODEL_CAPABILITIES,
  AI_MODEL_CAPABILITY_LABELS,
  AI_PROVIDER_PRESETS,
  CURRENT_PRESET_SYNC_REVISION,
  applyTextPreferredToProviders,
  buildCustomModelCapabilities,
  defaultProviderEntry,
  findAiProviderPreset,
  isCustomProvider,
  isProviderEntryValid,
  listEnabledModelsForCapability,
  modelCapabilitiesEqual,
  normalizeCustomModelCapabilities,
  preferredByCapabilityEqual,
  reconcilePreferredByCapability,
  resolveModelCapabilities,
  type AiModelCapability,
  type AiModelEntry,
  type AiProviderEntry,
  type AiProviderId,
  type FlatEnabledModel,
  type PreferredByCapability,
  type PreferredModelRef,
} from '../../ai/ai-providers.ts'
import { subscribeOpenAiConfig } from '../../ai/openai-config-events.ts'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import '../../ui/ios-nav-back.css'
import '../../ui/ios-check-toggle.css'
import '../../ui/ai-model-capability-tags.css'
import './keychain.css'

type Screen = 'main' | 'provider-settings'

const PROVIDER_OPTIONS = AI_PROVIDER_PRESETS.map((item) => ({
  id: item.id,
  label: item.name,
}))

function providersEqual(
  a: AiProviderEntry[],
  b: AiProviderEntry[],
  prefA: PreferredByCapability,
  prefB: PreferredByCapability,
): boolean {
  if (!preferredByCapabilityEqual(prefA, prefB) || a.length !== b.length) {
    return false
  }
  return a.every((entry, i) => {
    const other = b[i]
    return (
      entry.id === other.id &&
      entry.providerId === other.providerId &&
      entry.name === other.name &&
      entry.apiKey === other.apiKey &&
      entry.baseURL === other.baseURL &&
      entry.defaultModel === other.defaultModel &&
      entry.thinkingEnabled === other.thinkingEnabled &&
      entry.enabledModels.length === other.enabledModels.length &&
      entry.enabledModels.every(
        (m, j) =>
          m.modelId === other.enabledModels[j].modelId &&
          m.name === other.enabledModels[j].name &&
          modelCapabilitiesEqual(
            m.capabilities,
            other.enabledModels[j].capabilities,
          ),
      )
    )
  })
}

function cloneProviders(providers: AiProviderEntry[]): AiProviderEntry[] {
  return providers.map((p) => ({
    ...p,
    enabledModels: p.enabledModels.map((m) => ({
      ...m,
      capabilities: m.capabilities ? [...m.capabilities] : undefined,
    })),
  }))
}

function clonePreferred(
  preferred: PreferredByCapability,
): PreferredByCapability {
  const next: PreferredByCapability = {}
  for (const cap of AI_MODEL_CAPABILITIES) {
    const ref = preferred[cap]
    if (ref) {
      next[cap] = { ...ref }
    }
  }
  return next
}

function modelRefKey(ref: Pick<PreferredModelRef, 'providerEntryId' | 'modelId'>): string {
  return `${ref.providerEntryId}:${ref.modelId}`
}

/** 按已保存顺序排列；缺省时把首选放到第一位 */
function orderModelsForCapability(
  available: FlatEnabledModel[],
  order: PreferredModelRef[] | undefined,
  preferred: PreferredModelRef | undefined,
): FlatEnabledModel[] {
  if (available.length === 0) return available

  const byKey = new Map(
    available.map((item) => [modelRefKey(item), item] as const),
  )
  const result: FlatEnabledModel[] = []
  const used = new Set<string>()

  const pushRef = (ref: PreferredModelRef | undefined) => {
    if (!ref) return
    const key = modelRefKey(ref)
    const item = byKey.get(key)
    if (!item || used.has(key)) return
    result.push(item)
    used.add(key)
  }

  if (order && order.length > 0) {
    for (const ref of order) pushRef(ref)
  } else {
    pushRef(preferred)
  }

  for (const item of available) {
    const key = modelRefKey(item)
    if (!used.has(key)) result.push(item)
  }
  return result
}

function refsFromModels(models: FlatEnabledModel[]): PreferredModelRef[] {
  return models.map((item) => ({
    providerEntryId: item.providerEntryId,
    modelId: item.modelId,
  }))
}

type CapabilityOrderMap = Partial<
  Record<AiModelCapability, PreferredModelRef[]>
>

function getProviderDisplayName(provider?: AiProviderEntry): string {
  if (!provider) return ''
  return (
    provider.name?.trim() ||
    findAiProviderPreset(provider.providerId)?.name ||
    provider.providerId
  )
}

function loadInitialState(): {
  providers: AiProviderEntry[]
  preferredByCapability: PreferredByCapability
  preferredIndex: number
} {
  const stored = loadAccountSettings()
  if (stored && stored.providers.length > 0) {
    return {
      providers: cloneProviders(stored.providers),
      preferredByCapability: clonePreferred(stored.preferredByCapability),
      preferredIndex: stored.preferredIndex,
    }
  }
  return {
    providers: [],
    preferredByCapability: {},
    preferredIndex: 0,
  }
}

export function KeychainApp() {
  const { windows, closeWindowsForApp, minimizeWindow, setAppWindowTitle } =
    useOs()
  const { showBuiltinAbout } = useAboutApp()
  const modal = useWindowModal()

  type SavedSnapshot =
    | {
        providers: AiProviderEntry[]
        preferredByCapability: PreferredByCapability
      }
    | undefined

  const initial = useMemo(() => loadInitialState(), [])

  const [savedSnapshot, setSavedSnapshot] = useState<SavedSnapshot>(() => {
    if (initial.providers.length === 0) return undefined
    return {
      providers: cloneProviders(initial.providers),
      preferredByCapability: clonePreferred(initial.preferredByCapability),
    }
  })

  const [workingProviders, setWorkingProviders] = useState<AiProviderEntry[]>(
    () => cloneProviders(initial.providers),
  )

  const [preferredByCapability, setPreferredByCapability] =
    useState<PreferredByCapability>(() =>
      clonePreferred(initial.preferredByCapability),
    )

  /** 各能力 Tab 内的模型展示顺序（首位 = 首选） */
  const [capabilityOrder, setCapabilityOrder] = useState<CapabilityOrderMap>(
    () => {
      const next: CapabilityOrderMap = {}
      for (const cap of AI_MODEL_CAPABILITIES) {
        const models = orderModelsForCapability(
          listEnabledModelsForCapability(initial.providers, cap),
          undefined,
          initial.preferredByCapability[cap],
        )
        if (models.length > 0) next[cap] = refsFromModels(models)
      }
      return next
    },
  )

  const [screen, setScreen] = useState<Screen>('main')
  const [activeCapability, setActiveCapability] =
    useState<AiModelCapability>('text')
  const [isAddingProvider, setIsAddingProvider] = useState(false)
  const [editingProviderIndex, setEditingProviderIndex] = useState<number>(-1)
  const [editingEntry, setEditingEntry] = useState<AiProviderEntry | undefined>(
    undefined,
  )

  const entryValid = useMemo(
    () => editingEntry && isProviderEntryValid(editingEntry),
    [editingEntry],
  )

  const hasAnyModel = useMemo(
    () => workingProviders.some((p) => p.enabledModels.length > 0),
    [workingProviders],
  )

  const dirty = useMemo(() => {
    if (!savedSnapshot && workingProviders.length > 0) return true
    if (savedSnapshot && workingProviders.length === 0) return true
    if (!savedSnapshot && workingProviders.length === 0) return false

    return !providersEqual(
      workingProviders,
      savedSnapshot!.providers,
      preferredByCapability,
      savedSnapshot!.preferredByCapability,
    )
  }, [workingProviders, preferredByCapability, savedSnapshot])

  const syncPreferences = useCallback(
    (
      providers: AiProviderEntry[],
      existing: PreferredByCapability,
    ): {
      providers: AiProviderEntry[]
      preferredByCapability: PreferredByCapability
      preferredIndex: number
    } => {
      const reconciled = reconcilePreferredByCapability(providers, existing)
      const nextProviders = applyTextPreferredToProviders(
        providers,
        reconciled.preferredByCapability,
      )
      return {
        providers: nextProviders,
        preferredByCapability: reconciled.preferredByCapability,
        preferredIndex: reconciled.preferredIndex,
      }
    },
    [],
  )

  useEffect(() => {
    setAppWindowTitle('keychain', '钥匙串')
  }, [setAppWindowTitle])

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find(
      (w) => w.appId === 'keychain' && !w.minimized,
    )
    return [
      {
        label: '钥匙串',
        items: [
          ...aboutAppMenuPrefix('关于钥匙串', () =>
            showBuiltinAbout('keychain'),
          ),
          {
            type: 'action',
            label: '隐藏钥匙串',
            shortcut: '\u2318H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出钥匙串',
            shortcut: '\u2318Q',
            onClick: () => closeWindowsForApp('keychain'),
          },
        ],
      },
    ]
  }, [closeWindowsForApp, minimizeWindow, showBuiltinAbout, windows])

  useAppMenuBar('keychain', menuBar)

  const handleSave = useCallback(() => {
    const synced = syncPreferences(workingProviders, preferredByCapability)
    const settings: AccountSettingsV2 = {
      version: 2,
      providers: synced.providers.map((p) => ({
        ...p,
        enabledModels: p.enabledModels.map((m) => ({ ...m })),
      })),
      preferredIndex: synced.preferredIndex,
      preferredByCapability: synced.preferredByCapability,
      presetSyncRevision: CURRENT_PRESET_SYNC_REVISION,
    }
    saveAccountSettings(settings)
    setWorkingProviders(cloneProviders(settings.providers))
    setPreferredByCapability(clonePreferred(settings.preferredByCapability))
    setSavedSnapshot({
      providers: cloneProviders(settings.providers),
      preferredByCapability: clonePreferred(settings.preferredByCapability),
    })
  }, [workingProviders, preferredByCapability, syncPreferences])

  const handleAddProvider = useCallback(() => {
    const entry = defaultProviderEntry()
    const newIndex = workingProviders.length
    setWorkingProviders((prev) => [...prev, entry])
    setEditingProviderIndex(newIndex)
    setEditingEntry(structuredClone(entry))
    setIsAddingProvider(true)
    setScreen('provider-settings')
  }, [workingProviders.length])

  const handleOpenProviderSettings = useCallback(
    (providerIndex: number) => {
      const provider = workingProviders[providerIndex]
      if (!provider) return
      setEditingProviderIndex(providerIndex)
      setEditingEntry({
        ...provider,
        enabledModels: provider.enabledModels.map((m) => ({ ...m })),
      })
      setIsAddingProvider(false)
      setScreen('provider-settings')
    },
    [workingProviders],
  )

  const handleSetPreferred = useCallback(
    (capability: AiModelCapability, ref: PreferredModelRef) => {
      setPreferredByCapability((prev) => ({ ...prev, [capability]: ref }))
      if (capability === 'text') {
        setWorkingProviders((providers) =>
          applyTextPreferredToProviders(providers, {
            ...preferredByCapability,
            text: ref,
          }),
        )
      }
    },
    [preferredByCapability],
  )

  const handleReorderCapability = useCallback(
    (capability: AiModelCapability, ordered: FlatEnabledModel[]) => {
      const refs = refsFromModels(ordered)
      setCapabilityOrder((prev) => ({ ...prev, [capability]: refs }))
      const first = refs[0]
      if (first) {
        handleSetPreferred(capability, first)
      }
    },
    [handleSetPreferred],
  )

  const refreshCapabilityOrders = useCallback(
    (
      providers: AiProviderEntry[],
      preferred: PreferredByCapability,
    ) => {
      setCapabilityOrder((prev) => {
        const next: CapabilityOrderMap = {}
        for (const cap of AI_MODEL_CAPABILITIES) {
          const models = orderModelsForCapability(
            listEnabledModelsForCapability(providers, cap),
            prev[cap],
            preferred[cap],
          )
          if (models.length > 0) next[cap] = refsFromModels(models)
        }
        return next
      })
    },
    [],
  )

  useEffect(() => {
    return subscribeOpenAiConfig(() => {
      const next = loadInitialState()
      setWorkingProviders(cloneProviders(next.providers))
      setPreferredByCapability(clonePreferred(next.preferredByCapability))
      refreshCapabilityOrders(next.providers, next.preferredByCapability)
      if (next.providers.length === 0) {
        setSavedSnapshot(undefined)
        setScreen('main')
        setIsAddingProvider(false)
        setEditingEntry(undefined)
      } else {
        setSavedSnapshot({
          providers: cloneProviders(next.providers),
          preferredByCapability: clonePreferred(next.preferredByCapability),
        })
      }
    })
  }, [refreshCapabilityOrders])

  const handleProviderDone = useCallback(() => {
    if (!editingEntry) return

    setWorkingProviders((prev) => {
      const next = [...prev]
      if (editingProviderIndex >= 0 && editingProviderIndex < next.length) {
        next[editingProviderIndex] = {
          ...editingEntry,
          enabledModels: editingEntry.enabledModels.map((m) => ({ ...m })),
        }
      } else {
        next.push({
          ...editingEntry,
          enabledModels: editingEntry.enabledModels.map((m) => ({ ...m })),
        })
      }
      const synced = syncPreferences(next, preferredByCapability)
      setPreferredByCapability(synced.preferredByCapability)
      refreshCapabilityOrders(synced.providers, synced.preferredByCapability)
      return synced.providers
    })

    setScreen('main')
    setIsAddingProvider(false)
    setEditingEntry(undefined)
  }, [
    editingEntry,
    editingProviderIndex,
    preferredByCapability,
    syncPreferences,
    refreshCapabilityOrders,
  ])

  const handleProviderCancel = useCallback(() => {
    if (isAddingProvider && editingProviderIndex >= 0) {
      setWorkingProviders((prev) =>
        prev.filter((_, i) => i !== editingProviderIndex),
      )
    }

    setScreen('main')
    setIsAddingProvider(false)
    setEditingEntry(undefined)
  }, [isAddingProvider, editingProviderIndex])

  const handleProviderDelete = useCallback(async () => {
    if (editingProviderIndex < 0) return

    const provider = workingProviders[editingProviderIndex]
    const displayName = getProviderDisplayName(provider)

    const confirmed = await modal.confirm({
      title: '删除供应商',
      message: `确定要删除「${displayName}」吗？该供应商的所有配置将被移除。`,
      confirmTone: 'danger',
    })
    if (!confirmed) return

    const nextProviders = workingProviders.filter(
      (_, i) => i !== editingProviderIndex,
    )

    if (nextProviders.length === 0) {
      const proceed = await modal.confirm({
        title: '清空全部账户？',
        message:
          '这是最后一个供应商。确认后将清空全部账户与 API Key，此操作不可恢复。',
        confirmLabel: '清空账户',
        confirmTone: 'danger',
      })
      if (!proceed) return

      clearAccountSettings()
      setWorkingProviders([])
      setPreferredByCapability({})
      setSavedSnapshot(undefined)
      refreshCapabilityOrders([], {})
      setScreen('main')
      setIsAddingProvider(false)
      setEditingEntry(undefined)
      return
    }

    const synced = syncPreferences(nextProviders, preferredByCapability)
    setWorkingProviders(synced.providers)
    setPreferredByCapability(synced.preferredByCapability)
    refreshCapabilityOrders(synced.providers, synced.preferredByCapability)
    setScreen('main')
    setIsAddingProvider(false)
    setEditingEntry(undefined)
  }, [
    editingProviderIndex,
    workingProviders,
    preferredByCapability,
    modal,
    syncPreferences,
    refreshCapabilityOrders,
  ])

  if (screen === 'provider-settings') {
    const settingsTitle =
      getProviderDisplayName(
        editingEntry ?? workingProviders[editingProviderIndex],
      ) || '供应商'

    return (
      <div class="keychain">
        <header class="keychain__toolbar">
          <IosNavBackButton
            label="钥匙串"
            disabled={!isAddingProvider && !entryValid}
            onClick={
              isAddingProvider ? handleProviderCancel : handleProviderDone
            }
          />
          <span class="keychain__toolbar-title keychain__toolbar-title--center">
            {settingsTitle}
          </span>
          {isAddingProvider ? (
            <button
              type="button"
              class="keychain__save-btn"
              disabled={!entryValid}
              onClick={handleProviderDone}
            >
              完成
            </button>
          ) : (
            <button
              type="button"
              class="keychain__toolbar-btn keychain__toolbar-btn--danger keychain__toolbar-btn--action"
              onClick={handleProviderDelete}
            >
              删除
            </button>
          )}
        </header>
        <div class="keychain__settings">
          <div class="keychain__settings-body">
            {editingEntry && (
              <ProviderSettingsForm
                entry={editingEntry}
                onChange={setEditingEntry}
              />
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div class="keychain">
      <header class="keychain__toolbar">
        {dirty ? (
          <button
            type="button"
            class="keychain__save-btn"
            onClick={handleSave}
          >
            保存
          </button>
        ) : (
          <span class="keychain__toolbar-spacer" />
        )}
        <span class="keychain__toolbar-title keychain__toolbar-title--center">
          钥匙串
        </span>
        <button
          type="button"
          class="keychain__toolbar-btn keychain__toolbar-btn--action"
          onClick={handleAddProvider}
        >
          添加
        </button>
      </header>

      {!hasAnyModel ? (
        <div class="keychain__content keychain__content--empty">
          <span class="keychain__empty-title">尚未添加供应商</span>
          <span class="keychain__empty-hint">
            点击右上角「添加」来添加 AI 模型供应商
          </span>
        </div>
      ) : (
        <>
          <div class="keychain__tabs" role="tablist" aria-label="模型能力">
            {AI_MODEL_CAPABILITIES.map((capability) => (
              <button
                key={capability}
                type="button"
                role="tab"
                aria-selected={activeCapability === capability}
                class={`keychain__tab${
                  activeCapability === capability ? ' keychain__tab--active' : ''
                }`}
                onClick={() => setActiveCapability(capability)}
              >
                {AI_MODEL_CAPABILITY_LABELS[capability]}
              </button>
            ))}
          </div>
          <div class="keychain__content">
            <CapabilitySection
              capability={activeCapability}
              providers={workingProviders}
              preferred={preferredByCapability[activeCapability]}
              order={capabilityOrder[activeCapability]}
              onReorder={(ordered) =>
                handleReorderCapability(activeCapability, ordered)
              }
              onOpenProvider={handleOpenProviderSettings}
            />
            <div class="keychain__hint">
              拖拽排序，首位模型将作为当前类别的首选
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function CapabilitySection({
  capability,
  providers,
  preferred,
  order,
  onReorder,
  onOpenProvider,
}: {
  capability: AiModelCapability
  providers: AiProviderEntry[]
  preferred: PreferredModelRef | undefined
  order: PreferredModelRef[] | undefined
  onReorder: (ordered: FlatEnabledModel[]) => void
  onOpenProvider: (providerIndex: number) => void
}) {
  const available = useMemo(
    () => listEnabledModelsForCapability(providers, capability),
    [providers, capability],
  )
  const models = useMemo(
    () => orderModelsForCapability(available, order, preferred),
    [available, order, preferred],
  )

  const isDraggingRef = useRef(false)
  const preventClickRef = useRef(false)
  const dragIndexRef = useRef<number | undefined>(undefined)
  const itemRefs = useRef<Map<number, HTMLElement>>(new Map())
  const [dragIndex, setDragIndex] = useState<number | undefined>(undefined)
  const [overIndex, setOverIndex] = useState<number | undefined>(undefined)
  const [gripActiveIndex, setGripActiveIndex] = useState<number | undefined>(
    undefined,
  )

  const resolveHoverIndex = useCallback(
    (clientY: number): number => {
      for (let i = 0; i < models.length; i++) {
        const el = itemRefs.current.get(i)
        if (!el) continue
        const rect = el.getBoundingClientRect()
        if (clientY < rect.top + rect.height / 2) {
          return i
        }
      }
      return Math.max(0, models.length - 1)
    },
    [models.length],
  )

  const applyReorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return
      const next = [...models]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      onReorder(next)
    },
    [models, onReorder],
  )

  const finishReorder = useCallback(
    (fromIndex: number | undefined, toIndex: number | undefined) => {
      setDragIndex(undefined)
      setOverIndex(undefined)
      setGripActiveIndex(undefined)
      isDraggingRef.current = false
      dragIndexRef.current = undefined

      if (fromIndex === undefined || toIndex === undefined) return
      applyReorder(fromIndex, toIndex)
    },
    [applyReorder],
  )

  const handleGripPointerDown = useCallback(
    (index: number, event: PointerEvent) => {
      if (event.button !== 0) return

      event.preventDefault()
      event.stopPropagation()

      const grip = event.currentTarget as HTMLElement
      isDraggingRef.current = true
      preventClickRef.current = false
      dragIndexRef.current = index
      setDragIndex(index)
      setGripActiveIndex(index)
      grip.setPointerCapture(event.pointerId)

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (dragIndexRef.current === undefined) return
        const nextOver = resolveHoverIndex(moveEvent.clientY)
        setOverIndex((prev) => {
          if (prev !== nextOver) {
            preventClickRef.current = true
          }
          return nextOver
        })
      }

      const onPointerEnd = (endEvent: PointerEvent) => {
        grip.releasePointerCapture(endEvent.pointerId)
        grip.removeEventListener('pointermove', onPointerMove)
        grip.removeEventListener('pointerup', onPointerEnd)
        grip.removeEventListener('pointercancel', onPointerEnd)

        const fromIndex = dragIndexRef.current
        const toIndex =
          fromIndex === undefined
            ? undefined
            : resolveHoverIndex(endEvent.clientY)
        if (
          fromIndex !== undefined &&
          toIndex !== undefined &&
          fromIndex !== toIndex
        ) {
          preventClickRef.current = true
        }
        finishReorder(fromIndex, toIndex)
      }

      grip.addEventListener('pointermove', onPointerMove)
      grip.addEventListener('pointerup', onPointerEnd)
      grip.addEventListener('pointercancel', onPointerEnd)
    },
    [finishReorder, resolveHoverIndex],
  )

  const handleOpenRow = useCallback(
    (providerIndex: number) => {
      if (isDraggingRef.current || preventClickRef.current) {
        preventClickRef.current = false
        return
      }
      onOpenProvider(providerIndex)
    },
    [onOpenProvider],
  )

  if (models.length === 0) {
    return (
      <div class="keychain__section-empty">暂无支持该能力的已启用模型</div>
    )
  }

  return (
    <div
      class={`keychain__list${
        dragIndex !== undefined ? ' keychain__list--reordering' : ''
      }`}
    >
      {models.map((item, index) => (
        <div
          key={`${capability}-${item.providerEntryId}-${item.modelId}`}
          ref={(el) => {
            if (el) {
              itemRefs.current.set(index, el)
            } else {
              itemRefs.current.delete(index)
            }
          }}
          class={`keychain__list-item${
            index === dragIndex ? ' keychain__list-item--dragging' : ''
          }${index === overIndex ? ' keychain__list-item--over' : ''}${
            index === 0 ? ' keychain__list-item--preferred' : ''
          }`}
          onClick={() => handleOpenRow(item.providerIndex)}
        >
          <div
            class={`keychain__grip${
              index === gripActiveIndex ? ' keychain__grip--active' : ''
            }`}
            onPointerDown={(e) => handleGripPointerDown(index, e)}
          >
            <span class="keychain__grip-line" />
            <span class="keychain__grip-line" />
            <span class="keychain__grip-line" />
          </div>

          <div class="keychain__model-info">
            <span class="keychain__model-name">{item.name}</span>
            <span class="keychain__model-provider">
              {getProviderDisplayName(providers[item.providerIndex])}
            </span>
          </div>

          {index === 0 && <span class="keychain__badge">首选</span>}

          <span class="keychain__chevron">{'\u203A'}</span>
        </div>
      ))}
    </div>
  )
}

function ProviderSettingsForm({
  entry,
  onChange,
}: {
  entry: AiProviderEntry
  onChange: (entry: AiProviderEntry) => void
}) {
  const [customModelInput, setCustomModelInput] = useState('')
  const [customModelSupportsVision, setCustomModelSupportsVision] =
    useState(false)
  const isCustom = isCustomProvider(entry.providerId)
  const preset = findAiProviderPreset(entry.providerId)
  const showThinking =
    entry.providerId === 'deepseek' ||
    entry.providerId === 'mimo' ||
    entry.providerId === 'mimo-token-plan'

  const handleProviderChange = (value: string) => {
    const providerId = value as AiProviderId
    if (providerId === entry.providerId) return
    const newEntry = defaultProviderEntry(providerId)
    newEntry.id = entry.id
    newEntry.name = entry.name
    newEntry.apiKey = entry.apiKey
    if (entry.baseURL) newEntry.baseURL = entry.baseURL
    onChange(newEntry)
  }

  const handleModelToggle = (modelId: string, name: string) => {
    const enabled = entry.enabledModels.some((m) => m.modelId === modelId)
    let next: AiModelEntry[]
    if (enabled) {
      next = entry.enabledModels.filter((m) => m.modelId !== modelId)
    } else {
      next = [...entry.enabledModels, { modelId, name }]
    }
    const nextDefault = next.some((m) => m.modelId === entry.defaultModel)
      ? entry.defaultModel
      : (next[0]?.modelId ?? '')
    onChange({ ...entry, enabledModels: next, defaultModel: nextDefault })
  }

  const handleRemoveCustomModel = (modelId: string) => {
    const next = entry.enabledModels.filter((m) => m.modelId !== modelId)
    const nextDefault = next.some((m) => m.modelId === entry.defaultModel)
      ? entry.defaultModel
      : (next[0]?.modelId ?? '')
    onChange({ ...entry, enabledModels: next, defaultModel: nextDefault })
  }

  const handleAddCustomModel = () => {
    const modelId = customModelInput.trim()
    if (!modelId) return
    if (entry.enabledModels.some((m) => m.modelId === modelId)) return
    const nextModels = [
      ...entry.enabledModels,
      {
        modelId,
        name: modelId,
        capabilities: buildCustomModelCapabilities(customModelSupportsVision),
      },
    ]
    onChange({
      ...entry,
      enabledModels: nextModels,
      defaultModel: entry.defaultModel || modelId,
    })
    setCustomModelInput('')
    setCustomModelSupportsVision(false)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') handleAddCustomModel()
  }

  const renderModelCards = () => {
    const rows: Array<{
      modelId: string
      name: string
      enabled: boolean
      isFromPreset: boolean
      capabilities: readonly AiModelCapability[]
    }> = []

    if (isCustom) {
      for (const model of entry.enabledModels) {
        rows.push({
          modelId: model.modelId,
          name: model.name,
          enabled: true,
          isFromPreset: false,
          capabilities: normalizeCustomModelCapabilities(model.capabilities),
        })
      }
    } else {
      const seen = new Set<string>()
      for (const pm of preset?.models ?? []) {
        seen.add(pm.id)
        rows.push({
          modelId: pm.id,
          name: pm.name,
          enabled: entry.enabledModels.some((m) => m.modelId === pm.id),
          isFromPreset: true,
          capabilities: resolveModelCapabilities(entry.providerId, pm.id),
        })
      }
      for (const em of entry.enabledModels) {
        if (seen.has(em.modelId)) continue
        seen.add(em.modelId)
        rows.push({
          modelId: em.modelId,
          name: em.name,
          enabled: true,
          isFromPreset: false,
          capabilities: normalizeCustomModelCapabilities(em.capabilities),
        })
      }
    }

    const addCapabilities = buildCustomModelCapabilities(
      customModelSupportsVision,
    )

    return (
      <div class="ai-model-cards">
        {rows.length === 0 && (
          <div class="ai-model-card__empty">尚未添加模型，请在下方添加</div>
        )}
        {rows.map((row) => {
          return (
            <div
              key={row.modelId}
              class={`ai-model-card${!row.enabled ? ' ai-model-card--disabled' : ''}`}
            >
              <div class="ai-model-card__header">
                {!isCustom && (
                  <IosCheckToggle
                    checked={row.enabled}
                    label={
                      row.enabled ? `禁用 ${row.name}` : `启用 ${row.name}`
                    }
                    onChange={() => handleModelToggle(row.modelId, row.name)}
                  />
                )}
                <span class="ai-model-card__title">{row.name}</span>
                {!row.isFromPreset && (
                  <div class="ai-model-card__actions">
                    <button
                      type="button"
                      class="keychain__inline-btn keychain__inline-btn--remove"
                      onClick={() => handleRemoveCustomModel(row.modelId)}
                    >
                      移除
                    </button>
                  </div>
                )}
              </div>
              <AiModelCapabilityTags capabilities={row.capabilities} />
            </div>
          )
        })}
        <div class="ai-model-card ai-model-card--add">
          <div class="ai-model-card__header">
            <input
              class="keychain__model-add-input ai-model-card__title-input"
              type="text"
              value={customModelInput}
              placeholder={isCustom ? '添加模型...' : '添加自定义模型...'}
              autoComplete="off"
              onInput={(e) =>
                setCustomModelInput((e.currentTarget as HTMLInputElement).value)
              }
              onKeyDown={handleKeyDown}
            />
            <div class="ai-model-card__actions">
              <button
                type="button"
                class="keychain__model-add-btn"
                disabled={!customModelInput.trim()}
                onClick={handleAddCustomModel}
              >
                添加
              </button>
            </div>
          </div>
          <AiModelCapabilityTags
            capabilities={addCapabilities}
            visionEditable
            onVisionChange={setCustomModelSupportsVision}
          />
        </div>
      </div>
    )
  }

  return (
    <>
      <SettingsChoiceField
        label="供应商"
        value={entry.providerId}
        displayValue={preset?.name ?? entry.providerId}
        options={PROVIDER_OPTIONS}
        onChange={(value) => handleProviderChange(value)}
        wideLayout
        presentation="form"
        fieldClass="keychain__field-group keychain__field-group--choice"
        labelClass="keychain__field-label"
      />

      <div class="keychain__field-group">
        <label class="keychain__field-label">名称（可选）</label>
        <input
          class="keychain__field-input"
          type="text"
          value={entry.name ?? ''}
          placeholder="为供应商取个名字"
          autoComplete="off"
          onInput={(e) =>
            onChange({
              ...entry,
              name: (e.currentTarget as HTMLInputElement).value || undefined,
            })
          }
        />
      </div>

      {isCustom && (
        <div class="keychain__field-group">
          <label class="keychain__field-label">Base URL</label>
          <input
            class="keychain__field-input"
            type="url"
            value={entry.baseURL ?? ''}
            placeholder="https://api.example.com/v1"
            autoComplete="off"
            onInput={(e) =>
              onChange({
                ...entry,
                baseURL:
                  (e.currentTarget as HTMLInputElement).value || undefined,
              })
            }
          />
        </div>
      )}

      <div class="keychain__field-group">
        <label class="keychain__field-label">API Key</label>
        <input
          class="keychain__field-input"
          type="password"
          value={entry.apiKey}
          placeholder="sk-..."
          autoComplete="off"
          onInput={(e) =>
            onChange({
              ...entry,
              apiKey: (e.currentTarget as HTMLInputElement).value,
            })
          }
        />
      </div>

      <div class="keychain__field-group">
        <label class="keychain__field-label">启用的模型</label>
        {renderModelCards()}
      </div>

      {showThinking && (
        <div class="keychain__switch-row">
          <span class="keychain__switch-label">思考模式</span>
          <IosSwitch
            checked={entry.thinkingEnabled}
            onChange={(thinkingEnabled) =>
              onChange({ ...entry, thinkingEnabled })
            }
            label="思考模式"
          />
        </div>
      )}
    </>
  )
}
