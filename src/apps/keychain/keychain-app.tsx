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
import {
  hasGithubCredentials,
  loadGithubCredentials,
  subscribeGithubCredentials,
} from '../../os/github-credentials-storage.ts'
import { ForwardIcon } from '../../icons/app-icons.tsx'
import { SettingsNavRow } from '../../ui/settings-nav-row.tsx'
import { SegmentedControl } from '../../ui/segmented-control.tsx'
import { GithubCredentialsDialog } from './github-credentials-dialog.tsx'
import '../../ui/ios-nav-back.css'
import '../../ui/ios-check-toggle.css'
import '../../ui/ai-model-capability-tags.css'
import '../settings/settings.css'
import './keychain.css'

type Screen = 'root' | 'github' | 'ai-providers' | 'provider-settings'

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

  const [screen, setScreen] = useState<Screen>('root')
  const [githubDialogOpen, setGithubDialogOpen] = useState(false)
  const [githubConfigured, setGithubConfigured] = useState(() =>
    hasGithubCredentials(),
  )
  const [githubTokenLength, setGithubTokenLength] = useState(
    () => loadGithubCredentials().token.length,
  )
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

  const refreshGithubStatus = useCallback(() => {
    const token = loadGithubCredentials().token
    setGithubConfigured(token.length > 0)
    setGithubTokenLength(token.length)
  }, [])

  useEffect(() => {
    return subscribeGithubCredentials(refreshGithubStatus)
  }, [refreshGithubStatus])

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

  const handleCancelChanges = useCallback(() => {
    if (!savedSnapshot) {
      setWorkingProviders([])
      setPreferredByCapability({})
      setCapabilityOrder({})
      return
    }

    const providers = cloneProviders(savedSnapshot.providers)
    const preferred = clonePreferred(savedSnapshot.preferredByCapability)
    setWorkingProviders(providers)
    setPreferredByCapability(preferred)

    const nextOrder: CapabilityOrderMap = {}
    for (const cap of AI_MODEL_CAPABILITIES) {
      const models = orderModelsForCapability(
        listEnabledModelsForCapability(providers, cap),
        undefined,
        preferred[cap],
      )
      if (models.length > 0) nextOrder[cap] = refsFromModels(models)
    }
    setCapabilityOrder(nextOrder)
  }, [savedSnapshot])

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
        setScreen('ai-providers')
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

    setScreen('ai-providers')
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

    setScreen('ai-providers')
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
      setScreen('ai-providers')
      setIsAddingProvider(false)
      setEditingEntry(undefined)
      return
    }

    const synced = syncPreferences(nextProviders, preferredByCapability)
    setWorkingProviders(synced.providers)
    setPreferredByCapability(synced.preferredByCapability)
    refreshCapabilityOrders(synced.providers, synced.preferredByCapability)
    setScreen('ai-providers')
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
      <div class="settings">
        <div class="settings__nav keychain__nav">
          <IosNavBackButton
            label="AI 模型供应商"
            disabled={!isAddingProvider && !entryValid}
            onClick={
              isAddingProvider ? handleProviderCancel : handleProviderDone
            }
          />
          {isAddingProvider ? (
            <button
              type="button"
              class="settings__btn settings__btn--default"
              disabled={!entryValid}
              onClick={handleProviderDone}
            >
              完成
            </button>
          ) : (
            <button
              type="button"
              class="settings__btn settings__btn--danger"
              onClick={handleProviderDelete}
            >
              删除
            </button>
          )}
        </div>
        <div class="settings__content settings__content--compact">
          <section class="settings__section">
            <h2 class="settings__section-title">{settingsTitle}</h2>
            {editingEntry && (
              <ProviderSettingsForm
                entry={editingEntry}
                onChange={setEditingEntry}
              />
            )}
          </section>
        </div>
      </div>
    )
  }

  if (screen === 'root') {
    const providerCount = workingProviders.length
    const aiStatus =
      providerCount === 0
        ? '未配置'
        : `${providerCount} 个供应商`

    return (
      <div class="settings">
        <div class="settings__content settings__content--compact">
          <section class="settings__section">
            <h2 class="settings__section-title">凭证</h2>
            <div class="settings__list">
              <SettingsNavRow
                label="GitHub"
                value={githubConfigured ? '已配置' : '未配置'}
                secretLength={
                  githubTokenLength > 0 ? githubTokenLength : undefined
                }
                onClick={() => setScreen('github')}
              />
              <SettingsNavRow
                label="AI 模型供应商"
                value={aiStatus}
                onClick={() => setScreen('ai-providers')}
              />
            </div>
            <p class="settings__section-footnote">
              管理本机保存的 API 凭证。配置仅保存在本机，不会上传到服务器。
            </p>
          </section>
        </div>
      </div>
    )
  }

  if (screen === 'github') {
    return (
      <div class="settings">
        <div class="settings__nav">
          <IosNavBackButton
            label="钥匙串"
            onClick={() => {
              setGithubDialogOpen(false)
              setScreen('root')
            }}
          />
        </div>
        <div class="settings__content settings__content--compact">
          <section class="settings__section">
            <h2 class="settings__section-title">GitHub</h2>
            <div class="settings__list">
              <SettingsNavRow
                label="Personal Access Token"
                value={githubConfigured ? '已配置' : '未配置'}
                secretLength={
                  githubTokenLength > 0 ? githubTokenLength : undefined
                }
                onClick={() => setGithubDialogOpen(true)}
              />
            </div>
            <p class="settings__section-footnote">
              用于访问 GitHub API。可在 GitHub 设置中创建，仅保存在本机。若要让 GitHub Desktop
              自动填真实提交邮箱，classic Token 需 user:email；细粒度 Token 需 Email addresses
              只读。
            </p>
          </section>
        </div>

        <GithubCredentialsDialog
          open={githubDialogOpen}
          onClose={() => setGithubDialogOpen(false)}
          onChanged={refreshGithubStatus}
        />
      </div>
    )
  }

  if (screen === 'ai-providers') {
    return (
      <div class="settings">
        <div class="settings__nav keychain__nav">
          {dirty ? (
            <button
              type="button"
              class="settings__btn settings__btn--plain"
              onClick={handleCancelChanges}
            >
              取消
            </button>
          ) : (
            <IosNavBackButton label="钥匙串" onClick={() => setScreen('root')} />
          )}
          {dirty ? (
            <button
              type="button"
              class="settings__btn settings__btn--default"
              onClick={handleSave}
            >
              保存
            </button>
          ) : (
            <button
              type="button"
              class="settings__btn settings__btn--plain"
              onClick={handleAddProvider}
            >
              添加
            </button>
          )}
        </div>
        <div class="settings__content settings__content--compact">
          <section class="settings__section">
            <h2 class="settings__section-title">AI 模型供应商</h2>
            {!hasAnyModel ? (
              <div class="settings__box settings__empty">
                尚未添加供应商。点击右上角「添加」来配置 AI 模型。
              </div>
            ) : (
              <>
                <SegmentedControl
                  value={activeCapability}
                  ariaLabel="模型能力"
                  className="keychain__capability-tabs"
                  items={AI_MODEL_CAPABILITIES.map((capability) => ({
                    id: capability,
                    label: AI_MODEL_CAPABILITY_LABELS[capability],
                  }))}
                  onChange={setActiveCapability}
                />
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
                <p class="settings__section-footnote">
                  拖拽排序，首位模型将作为当前类别的首选。
                </p>
              </>
            )}
          </section>
        </div>
      </div>
    )
  }
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
      <div class="settings__box settings__empty keychain__section-empty">
        暂无支持该能力的已启用模型
      </div>
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

          <span class="settings__disclosure" aria-hidden="true">
            <ForwardIcon size={13} />
          </span>
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
                      class="settings__btn settings__btn--small settings__btn--danger"
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
              class="settings__input ai-model-card__title-input"
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
                class="settings__btn settings__btn--small settings__btn--default"
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
    <div class="settings__form">
      <SettingsChoiceField
        label="供应商"
        value={entry.providerId}
        displayValue={preset?.name ?? entry.providerId}
        options={PROVIDER_OPTIONS}
        onChange={(value) => handleProviderChange(value)}
        wideLayout
        presentation="form"
      />

      <label class="settings__field">
        <span class="settings__field-label">名称（可选）</span>
        <input
          class="settings__input"
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
      </label>

      {isCustom && (
        <label class="settings__field">
          <span class="settings__field-label">Base URL</span>
          <input
            class="settings__input"
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
        </label>
      )}

      <label class="settings__field">
        <span class="settings__field-label">API Key</span>
        <input
          class="settings__input"
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
      </label>

      <div class="settings__field settings__field--stacked">
        <span class="settings__field-label">启用的模型</span>
        {renderModelCards()}
      </div>

      {showThinking && (
        <div class="settings__list">
          <div class="settings__row settings__row--switch">
            <span class="settings__row-name">思考模式</span>
            <IosSwitch
              checked={entry.thinkingEnabled}
              onChange={(thinkingEnabled) =>
                onChange({ ...entry, thinkingEnabled })
              }
              label="思考模式"
            />
          </div>
        </div>
      )}
    </div>
  )
}
