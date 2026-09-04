import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks'
import { Page } from '../../ui/page.tsx'
import { PageHeader } from '../../ui/page-header.tsx'
import { Button } from '../../ui/button.tsx'
import { PageActionButton } from '../../ui/page-action-button.tsx'
import { PageButtonGroup } from '../../ui/page-button-group.tsx'
import { List, ListAddRow } from '../../ui/list.tsx'
import { ListItem } from '../../ui/list-item.tsx'
import { PageStack, usePageStack } from '../../ui/page-stack.tsx'
import {
  AdaptiveSplitNav,
  useAdaptiveSplitNav,
  type AdaptiveSplitNavPageContext,
} from '../../ui/adaptive-split-nav.tsx'
import { SettingsCheckRow } from '../../ui/settings-check-row.tsx'
import { SettingsChoiceField } from '../../ui/settings-choice-field.tsx'
import { SettingsInlineInputRow } from '../../ui/settings-inline-input-row.tsx'
import { SettingsSwitchRow } from '../../ui/settings-switch-row.tsx'
import { SETTINGS_WIDE_LAYOUT_MIN_WIDTH } from '../settings/settings-layout-breakpoints.ts'
import { KeychainTextFieldDialog } from './keychain-text-field-dialog.tsx'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
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
  AI_MODEL_OWNED_CAPABILITIES,
  AI_PROVIDER_PRESETS,
  AI_TOKENIZER_FAMILIES,
  AI_TOKENIZER_FAMILY_LABELS,
  CURRENT_PRESET_SYNC_REVISION,
  applyTextPreferredToProviders,
  buildCustomModelCapabilities,
  defaultProviderEntry,
  findAiModelPreset,
  findAiProviderPreset,
  isCustomProvider,
  isInstantFreeProvider,
  isOpencodeZenProvider,
  isProviderEntryValid,
  listEnabledModelsForCapability,
  matchPricingModelKey,
  modelCapabilitiesEqual,
  normalizeCustomModelCapabilities,
  preferredByCapabilityEqual,
  providerRequiresProxy,
  reconcilePreferredByCapability,
  resolveModelCapabilities,
  type AiContextWindowMode,
  type AiManualPricing,
  type AiModelCapability,
  type AiModelEntry,
  type AiOpenRouterPricingRef,
  type AiProviderEntry,
  type AiProviderId,
  type AiTokenizerFamily,
  type FlatEnabledModel,
  type PreferredByCapability,
  type PreferredModelRef,
} from '../../ai/ai-providers.ts'
import {
  formatKeychainPricingLabel,
  KeychainPricingFlow,
  type KeychainPricingSelection,
} from './keychain-pricing-flow.tsx'
import {
  formatKeychainContextWindowLabel,
  KeychainContextWindowFlow,
} from './keychain-context-window-flow.tsx'
import { subscribeOpenRouterPricingCache } from '../../ai/openrouter-pricing-cache.ts'
import { subscribeModelPricingCache } from '../../ai/ai-model-pricing-cache.ts'
import { resolveTokenizerFamily } from '../../ai/model-tokenizer.ts'
import { SettingsChoicePickerView } from '../settings/settings-choice-picker-view.tsx'
import { subscribeOpenAiConfig } from '../../ai/openai-config-events.ts'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import {
  hasGithubCredentials,
  loadGithubCredentials,
  subscribeGithubCredentials,
} from '../../os/github-credentials-storage.ts'
import { SettingsNavRow } from '../../ui/settings-nav-row.tsx'
import { SegmentedControl } from '../../ui/segmented-control.tsx'
import { GithubCredentialsDialog } from './github-credentials-dialog.tsx'
import '../settings/settings.css'
import './keychain.css'

type Screen =
  | 'root'
  | 'github'
  | 'ai-providers'
  | 'provider-settings'
  | 'model-settings'
  | 'add-model'

type FieldEditTarget = 'name' | 'baseURL' | 'apiKey'

const FIELD_EDIT_META: Record<
  FieldEditTarget,
  {
    title: string
    label: string
    type: 'text' | 'url' | 'password'
    placeholder: string
    message?: string
    allowEmpty?: boolean
  }
> = {
  name: {
    title: '名称',
    label: '名称',
    type: 'text',
    placeholder: '可选',
    allowEmpty: true,
  },
  baseURL: {
    title: 'Base URL',
    label: 'Base URL',
    type: 'url',
    placeholder: 'https://api.example.com/v1',
    message: 'OpenAI 兼容接口的 Base URL，通常以 /v1 结尾。',
    allowEmpty: false,
  },
  apiKey: {
    title: 'API Key',
    label: 'API Key',
    type: 'password',
    placeholder: 'sk-...',
    message: '填写供应商 API Key，仅保存在本机。',
    allowEmpty: false,
  },
}

const PROVIDER_OPTIONS = AI_PROVIDER_PRESETS.map((item) => ({
  id: item.id,
  label: item.name,
}))

function providerEntryEqual(a: AiProviderEntry, b: AiProviderEntry): boolean {
  return (
    a.id === b.id &&
    a.providerId === b.providerId &&
    a.name === b.name &&
    a.apiKey === b.apiKey &&
    a.baseURL === b.baseURL &&
    a.defaultModel === b.defaultModel &&
    a.thinkingEnabled === b.thinkingEnabled &&
    a.useProxy === b.useProxy &&
    a.enabledModels.length === b.enabledModels.length &&
    a.enabledModels.every(
      (m, j) =>
        m.modelId === b.enabledModels[j].modelId &&
        m.name === b.enabledModels[j].name &&
        m.pricingModelKey === b.enabledModels[j].pricingModelKey &&
        m.manualPricing?.inputPricePerMillion ===
          b.enabledModels[j].manualPricing?.inputPricePerMillion &&
        m.manualPricing?.cachedInputPricePerMillion ===
          b.enabledModels[j].manualPricing?.cachedInputPricePerMillion &&
        m.manualPricing?.outputPricePerMillion ===
          b.enabledModels[j].manualPricing?.outputPricePerMillion &&
        m.openRouterPricing?.modelId ===
          b.enabledModels[j].openRouterPricing?.modelId &&
        m.openRouterPricing?.providerTag ===
          b.enabledModels[j].openRouterPricing?.providerTag &&
        m.tokenizerFamily === b.enabledModels[j].tokenizerFamily &&
        m.contextWindowMode === b.enabledModels[j].contextWindowMode &&
        m.contextWindow === b.enabledModels[j].contextWindow &&
        modelCapabilitiesEqual(
          m.capabilities,
          b.enabledModels[j].capabilities,
        ),
    )
  )
}

function providersEqual(
  a: AiProviderEntry[],
  b: AiProviderEntry[],
  prefA: PreferredByCapability,
  prefB: PreferredByCapability,
): boolean {
  if (!preferredByCapabilityEqual(prefA, prefB) || a.length !== b.length) {
    return false
  }
  return a.every((entry, i) => providerEntryEqual(entry, b[i]))
}

function cloneEntry(entry: AiProviderEntry): AiProviderEntry {
  return {
    ...entry,
    enabledModels: entry.enabledModels.map((m) => ({
      ...m,
      capabilities: m.capabilities ? [...m.capabilities] : undefined,
    })),
  }
}

function cloneProviders(providers: AiProviderEntry[]): AiProviderEntry[] {
  return providers.map((p) => cloneEntry(p))
}

function formatCapabilitiesSummary(
  capabilities: readonly AiModelCapability[],
): string {
  if (capabilities.length === 0) return ''
  return capabilities.map((cap) => AI_MODEL_CAPABILITY_LABELS[cap]).join('、')
}

function listProviderModelRows(entry: AiProviderEntry): Array<{
  modelId: string
  name: string
  enabled: boolean
  isFromPreset: boolean
  free: boolean
  capabilities: readonly AiModelCapability[]
}> {
  const isCustom = isCustomProvider(entry.providerId)
  const preset = findAiProviderPreset(entry.providerId)
  const rows: Array<{
    modelId: string
    name: string
    enabled: boolean
    isFromPreset: boolean
    free: boolean
    capabilities: readonly AiModelCapability[]
  }> = []

  if (isCustom) {
    for (const model of entry.enabledModels) {
      rows.push({
        modelId: model.modelId,
        name: model.name,
        enabled: true,
        isFromPreset: false,
        free: false,
        capabilities: normalizeCustomModelCapabilities(model.capabilities),
      })
    }
    return rows
  }

  const seen = new Set<string>()
  for (const pm of preset?.models ?? []) {
    seen.add(pm.id)
    rows.push({
      modelId: pm.id,
      name: pm.name,
      enabled: entry.enabledModels.some((m) => m.modelId === pm.id),
      isFromPreset: true,
      free: Boolean(pm.free),
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
      free: Boolean(findAiModelPreset(entry.providerId, em.modelId)?.free),
      capabilities: normalizeCustomModelCapabilities(em.capabilities),
    })
  }
  return rows
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
  return { providers: [], preferredByCapability: {}, preferredIndex: 0 }
}

export function KeychainNextApp() {
  const { setAppWindowTitle } = useOs()
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

  // 打开链（root 之上的层序）是单一真源：窄屏子页栈与分栏右栏帧都从它
  // 派生。宽形态下 controller.navigate 的 push 是 no-op，帧进退完全由
  // chain 驱动（vscode 设置面板同款范式）。
  const [chain, setChain] = useState<Screen[]>([])
  const chainRef = useRef(chain)
  chainRef.current = chain

  const nav = useAdaptiveSplitNav({
    split: true,
    narrowPageForState: () =>
      chainRef.current[chainRef.current.length - 1] ?? 'root',
    listPage: 'root',
  })

  /** 派生的「当前屏」：窄屏 = 子页栈顶，宽屏 = 右栏栈顶帧 */
  const screen = chain.length > 0 ? chain[chain.length - 1] : 'root'

  /** 编辑会话序号：每次打开供应商编辑页递增，驱动三个编辑页按会话重挂载
   * （flat 引擎的 host 常驻，页内局部草稿与嵌套 picker 栈必须随会话重置） */
  const [editSession, setEditSession] = useState(0)

  /** 根列表行点击：整链替换。宽屏下换帧由 chain 驱动（深度回落 |Δ|=1 走
   * pop 退场、跨级重置立即整体替换）；窄屏 chain 恒空，等价普通 push */
  const openRootScreen = useCallback(
    (next: Screen) => {
      setChain([next])
      nav.navigate(next, 'push')
    },
    [nav],
  )

  /** 逐层推入（AI 供应商 → 供应商设置 → 模型设置/添加模型） */
  const pushScreen = useCallback(
    (next: Screen) => {
      setChain((prev) =>
        prev[prev.length - 1] === next ? prev : [...prev, next],
      )
      nav.navigate(next, 'push')
    },
    [nav],
  )

  /** 回退（可跨级到祖先或 root）：chain 截断 + pop。onSettled 窄屏在 pop
   * 动画落定后执行、宽屏立即执行（组件契约），只放与帧内容无关的收尾 */
  const popToScreen = useCallback(
    (target: Screen | 'root', onSettled?: () => void) => {
      setChain((prev) => {
        if (target === 'root') return []
        const idx = prev.lastIndexOf(target)
        return idx >= 0 ? prev.slice(0, idx + 1) : []
      })
      nav.navigate(target, 'pop', onSettled)
    },
    [nav],
  )

  const [githubDialogOpen, setGithubDialogOpen] = useState(false)
  const [githubConfigured, setGithubConfigured] = useState(() =>
    hasGithubCredentials(),
  )
  const [githubTokenLength, setGithubTokenLength] = useState(
    () => loadGithubCredentials().token.length,
  )
  const [activeCapability, setActiveCapability] =
    useState<AiModelCapability>('text')
  const [reorderEditing, setReorderEditing] = useState(false)
  const [isAddingProvider, setIsAddingProvider] = useState(false)
  const [editingProviderIndex, setEditingProviderIndex] = useState<number>(-1)
  const [editingEntry, setEditingEntry] = useState<AiProviderEntry | undefined>(
    undefined,
  )
  const [editingBaseline, setEditingBaseline] = useState<
    AiProviderEntry | undefined
  >(undefined)
  const [editingModelId, setEditingModelId] = useState<string | undefined>(
    undefined,
  )
  const [fieldDialog, setFieldDialog] = useState<FieldEditTarget | undefined>(
    undefined,
  )
  const providerSettingsHostRef = useRef<HTMLDivElement>(null)
  const [wideLayout, setWideLayout] = useState(false)

  const entryValid = useMemo(
    () => Boolean(editingEntry && isProviderEntryValid(editingEntry)),
    [editingEntry],
  )

  const providerFormDirty = useMemo(() => {
    if (!editingEntry || !editingBaseline) return false
    return !providerEntryEqual(editingEntry, editingBaseline)
  }, [editingEntry, editingBaseline])

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
    setAppWindowTitle('keychain-next', '钥匙串（新版）')
  }, [setAppWindowTitle])

  const refreshGithubStatus = useCallback(() => {
    const token = loadGithubCredentials().token
    setGithubConfigured(token.length > 0)
    setGithubTokenLength(token.length)
  }, [])

  useEffect(() => {
    return subscribeGithubCredentials(refreshGithubStatus)
  }, [refreshGithubStatus])

  useAppMenuBar('keychain-next', [])

  // TODO(切换): 平行验证期不监听 OPEN_KEYCHAIN_AI_PROVIDERS_EVENT（深链仍指原版
  // keychain，双开时避免抢消费 pending 标志）。切回原 id 时恢复整段深链 effect。


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
    // 仅写入 editing 状态，保存后再并入 workingProviders，避免转场动画期间列表闪现新模型
    setEditSession((n) => n + 1)
    setEditingProviderIndex(workingProviders.length)
    setEditingEntry(cloneEntry(entry))
    setEditingBaseline(cloneEntry(entry))
    setIsAddingProvider(true)
    setEditingModelId(undefined)
    setFieldDialog(undefined)
    pushScreen('provider-settings')
  }, [workingProviders.length, pushScreen])

  const handleOpenProviderSettings = useCallback(
    (providerIndex: number) => {
      const provider = workingProviders[providerIndex]
      if (!provider) return
      setEditSession((n) => n + 1)
      setEditingProviderIndex(providerIndex)
      setEditingEntry(cloneEntry(provider))
      setEditingBaseline(cloneEntry(provider))
      setIsAddingProvider(false)
      setEditingModelId(undefined)
      setFieldDialog(undefined)
      pushScreen('provider-settings')
    },
    [workingProviders, pushScreen],
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

  const persistProviders = useCallback(
    (
      providers: AiProviderEntry[],
      preferred: PreferredByCapability,
    ) => {
      const synced = syncPreferences(providers, preferred)
      const settings: AccountSettingsV2 = {
        version: 2,
        providers: synced.providers.map((p) => ({
            ...p,
            useProxy: providerRequiresProxy(p.providerId) ? true : p.useProxy,
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
      refreshCapabilityOrders(
        settings.providers,
        settings.preferredByCapability,
      )
      return synced
    },
    [syncPreferences, refreshCapabilityOrders],
  )

  const handleSave = useCallback(() => {
    persistProviders(workingProviders, preferredByCapability)
  }, [workingProviders, preferredByCapability, persistProviders])

  useEffect(() => {
    return subscribeOpenAiConfig(() => {
      const next = loadInitialState()
      setWorkingProviders(cloneProviders(next.providers))
      setPreferredByCapability(clonePreferred(next.preferredByCapability))
      refreshCapabilityOrders(next.providers, next.preferredByCapability)
      if (next.providers.length === 0) {
        setSavedSnapshot(undefined)
        // 外部配置被清空：收敛到供应商列表。宽形态右栏帧由 chain 驱动，
        // 栈必须保住 root（分栏左栏列表 host 由栈供给，剃掉会整栏空白），
        // 只在窄形态静默重置栈顶对齐 chain。
        setChain(['ai-providers'])
        if (nav.narrowLayout) {
          nav.setPageSilent('ai-providers')
        }
        // 字段编辑模态立即关；编辑态其余部分不清（同 pop 路径：宽形态
        // chain 2→1 走保帧滑出，同批清理会把滑出中的帧打空），下次打开
        // 供应商编辑页时全量重置
        setFieldDialog(undefined)
      } else {
        setSavedSnapshot({
          providers: cloneProviders(next.providers),
          preferredByCapability: clonePreferred(next.preferredByCapability),
        })
      }
    })
  }, [refreshCapabilityOrders, nav])

  const mergeEditingEntryIntoProviders = useCallback((): AiProviderEntry[] => {
    if (!editingEntry) return workingProviders
    const next = [...workingProviders]
    if (editingProviderIndex >= 0 && editingProviderIndex < next.length) {
      next[editingProviderIndex] = cloneEntry(editingEntry)
    } else {
      next.push(cloneEntry(editingEntry))
    }
    return next
  }, [editingEntry, editingProviderIndex, workingProviders])

  const handleProviderSave = useCallback(() => {
    if (!editingEntry || !isProviderEntryValid(editingEntry)) return
    const nextProviders = mergeEditingEntryIntoProviders()
    persistProviders(nextProviders, preferredByCapability)
    // pop 不清编辑态：宽形态下 onSettled 立即执行，清理会让滑出中的帧
    // 打空；编辑态由下次打开时全量重置（flat 引擎保帧滑出依赖内容稳定）
    popToScreen('ai-providers')
  }, [
    editingEntry,
    mergeEditingEntryIntoProviders,
    preferredByCapability,
    persistProviders,
    popToScreen,
  ])

  const handleProviderCancel = useCallback(() => {
    popToScreen('ai-providers')
  }, [popToScreen])

  const handleProviderBack = useCallback(() => {
    if (providerFormDirty || isAddingProvider) {
      handleProviderCancel()
      return
    }
    popToScreen('ai-providers')
  }, [providerFormDirty, isAddingProvider, handleProviderCancel, popToScreen])

  const handleProviderDelete = useCallback(async () => {
    if (editingProviderIndex < 0) return

    const provider = workingProviders[editingProviderIndex]
    const displayName = getProviderDisplayName(provider)

    if (isInstantFreeProvider(provider.providerId)) {
      await modal.confirm({
        title: '无法删除',
        message: '「Instant 共享AI」是内置供应商，不可删除。',
        confirmLabel: '知道了',
      })
      return
    }

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
      popToScreen('ai-providers')
      return
    }

    const synced = syncPreferences(nextProviders, preferredByCapability)
    setWorkingProviders(synced.providers)
    setPreferredByCapability(synced.preferredByCapability)
    refreshCapabilityOrders(synced.providers, synced.preferredByCapability)
    popToScreen('ai-providers')
  }, [
    editingProviderIndex,
    workingProviders,
    preferredByCapability,
    modal,
    syncPreferences,
    refreshCapabilityOrders,
    popToScreen,
  ])

  const handleOpenModelSettings = useCallback((modelId: string) => {
    setEditingModelId(modelId)
    pushScreen('model-settings')
  }, [pushScreen])

  const handleOpenAddModel = useCallback(() => {
    pushScreen('add-model')
  }, [pushScreen])

  const handleModelSettingsBack = useCallback(() => {
    // editingModelId 不在 pop 时清：宽形态 onSettled 立即执行会打空滑出帧，
    // 下次打开模型设置时会重新写入
    popToScreen('provider-settings')
  }, [popToScreen])

  const handleAddModelCancel = useCallback(() => {
    popToScreen('provider-settings')
  }, [popToScreen])

  const handleAddModelComplete = useCallback(
    (result: {
      modelId: string
      supportsVision: boolean
      pricingModelKey?: string
      manualPricing?: AiManualPricing
      openRouterPricing?: AiOpenRouterPricingRef
      tokenizerFamily?: AiTokenizerFamily
      contextWindowMode?: AiContextWindowMode
      contextWindow?: number
    }) => {
      setEditingEntry((prev) => {
        if (!prev) return prev
        if (prev.enabledModels.some((m) => m.modelId === result.modelId)) {
          return prev
        }
        return {
          ...prev,
          enabledModels: [
            ...prev.enabledModels,
            {
              modelId: result.modelId,
              name: result.modelId,
              capabilities: buildCustomModelCapabilities(result.supportsVision),
              ...(result.pricingModelKey
                ? { pricingModelKey: result.pricingModelKey }
                : {}),
              ...(result.manualPricing ? { manualPricing: result.manualPricing } : {}),
              ...(result.openRouterPricing
                ? { openRouterPricing: result.openRouterPricing }
                : {}),
              ...(result.tokenizerFamily
                ? { tokenizerFamily: result.tokenizerFamily }
                : {}),
              ...(result.contextWindowMode
                ? { contextWindowMode: result.contextWindowMode }
                : {}),
              ...(result.contextWindow !== undefined
                ? { contextWindow: result.contextWindow }
                : {}),
            },
          ],
          defaultModel: prev.defaultModel || result.modelId,
        }
      })
      popToScreen('provider-settings')
    },
    [popToScreen],
  )

  const handleOpenFieldDialog = useCallback((field: FieldEditTarget) => {
    setFieldDialog(field)
  }, [])

  const handleFieldDialogSave = useCallback(
    (field: FieldEditTarget, value: string) => {
      setEditingEntry((prev) => {
        if (!prev) return prev
        if (field === 'name') {
          return { ...prev, name: value || undefined }
        }
        if (field === 'baseURL') {
          return { ...prev, baseURL: value || undefined }
        }
        return { ...prev, apiKey: value }
      })
    },
    [],
  )

  useLayoutEffect(() => {
    if (
      screen !== 'provider-settings' &&
      screen !== 'model-settings' &&
      screen !== 'add-model'
    ) {
      return
    }
    const host = providerSettingsHostRef.current
    if (!host) return
    const sync = () => {
      setWideLayout(host.clientWidth >= SETTINGS_WIDE_LAYOUT_MIN_WIDTH)
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(host)
    return () => observer.disconnect()
  }, [screen])

  // 宽→窄形变落定交棒：深度 1 页（GitHub / AI 供应商，列表直推页）的返回
  // 键在分栏静置时不存在，落窄后才无中生有——给一次透明度 0→1 的短淡入
  // 代替硬蹦（services/nav-kit-demo 同款）。epoch 递增 + 双类名交替：320ms
  // 内背靠背再触发也能重播动画。必须用 layout effect：类要在面板移除的
  // 同一帧 paint 前挂上。
  const [backFadeEpoch, setBackFadeEpoch] = useState(0)
  const backFadeTimerRef = useRef(0)
  const prevMorphingRef = useRef(false)
  useLayoutEffect(() => {
    const was = prevMorphingRef.current
    prevMorphingRef.current = nav.morphing
    if (was === nav.morphing) return
    if (nav.morphing || !nav.narrowLayout || chainRef.current.length !== 1) return
    window.clearTimeout(backFadeTimerRef.current)
    setBackFadeEpoch((epoch) => epoch + 1)
    backFadeTimerRef.current = window.setTimeout(() => setBackFadeEpoch(0), 320)
  }, [nav.morphing, nav.narrowLayout])
  useEffect(() => () => window.clearTimeout(backFadeTimerRef.current), [])

  // 分栏帧的返回键 chrome：深度 ≥2 帧（供应商设置及更深）两种形态恒有
  // 返回；深度 1 帧（GitHub / AI 供应商）窄屏有、分栏静置没有——A 型形变
  // 期顶帧挂回随滑轨淡出，C 型落窄交棒后由 backFadeEpoch 短淡入。
  const topFrameId = chain.length > 0 ? chain[chain.length - 1] : ''
  const isDepth1Frame = (target: Screen) =>
    chainRef.current.length > 0 && chainRef.current[0] === target
  const showPaneBack = (
    target: Screen,
    ctx: AdaptiveSplitNavPageContext,
  ): boolean => {
    if (ctx.narrowLayout) {
      return !(ctx.morphing && ctx.morphKind === 'C')
    }
    if (!isDepth1Frame(target)) return true
    return ctx.morphing && ctx.morphKind === 'A' && target === topFrameId
  }
  const paneBackFadeClass = (
    target: Screen,
    ctx: AdaptiveSplitNavPageContext,
  ): string | undefined => {
    if (ctx.narrowLayout) {
      return backFadeEpoch > 0 &&
        target === nav.page &&
        chainRef.current.length === 1
        ? `keychain__back-fade-in-${backFadeEpoch % 2}`
        : undefined
    }
    return ctx.morphing &&
      ctx.morphKind === 'A' &&
      isDepth1Frame(target) &&
      target === topFrameId
      ? 'keychain__back-fade-out'
      : undefined
  }

  const renderScreen = (target: Screen, ctx: AdaptiveSplitNavPageContext) => {
    if (target === 'add-model' && editingEntry) {
      return (
        // key 按编辑会话：flat 引擎的页 host 常驻，重开时强制重挂载，
        // 内部草稿与嵌套 picker 子栈回到初始态
        <AddModelView
          key={`add-model:${editSession}`}
          providerId={editingEntry.providerId}
          existingModelIds={editingEntry.enabledModels.map((m) => m.modelId)}
          isCustomProvider={isCustomProvider(editingEntry.providerId)}
          onCancel={handleAddModelCancel}
          onComplete={handleAddModelComplete}
        />
      )
    }

    if (target === 'model-settings' && editingEntry && editingModelId) {
      const providerTitle = getProviderDisplayName(editingEntry) || '供应商'
      return (
        <ModelSettingsView
          key={`model-settings:${editSession}:${editingModelId}`}
          entry={editingEntry}
          modelId={editingModelId}
          backLabel={providerTitle}
          onBack={handleModelSettingsBack}
          onChange={setEditingEntry}
        />
      )
    }

    if (target === 'provider-settings') {
      const settingsTitle =
        getProviderDisplayName(
          editingEntry ?? workingProviders[editingProviderIndex],
        ) || '供应商'
      const showSave = isAddingProvider || providerFormDirty
      const showDelete =
        !isAddingProvider &&
        !providerFormDirty &&
        !isInstantFreeProvider(editingEntry?.providerId)
      const fieldMeta = fieldDialog
        ? fieldDialog === 'apiKey' && isOpencodeZenProvider(editingEntry?.providerId)
          ? {
              ...FIELD_EDIT_META.apiKey,
              placeholder: '可选：免费模型可留空',
              message: '免费模型（标「免费」）无需密钥；填写后解锁全部付费模型。',
              allowEmpty: true,
            }
          : FIELD_EDIT_META[fieldDialog]
        : undefined
      const fieldValue =
        editingEntry && fieldDialog
          ? fieldDialog === 'name'
            ? (editingEntry.name ?? '')
            : fieldDialog === 'baseURL'
              ? (editingEntry.baseURL ?? '')
              : editingEntry.apiKey
          : ''

      return (
        <>
        <Page
          key={`provider-settings:${editSession}`}
          class="keychain__custom-page"
          header={
            <PageHeader
              title={settingsTitle}
              backLabel={showSave ? undefined : 'AI 模型供应商'}
              onBack={showSave ? undefined : handleProviderBack}
              actions={
                showSave ? (
                  <PageButtonGroup>
                    <PageActionButton onClick={handleProviderCancel}>
                      取消
                    </PageActionButton>
                    <PageActionButton
                      tone="default"
                      disabled={!entryValid}
                      onClick={handleProviderSave}
                    >
                      保存
                    </PageActionButton>
                  </PageButtonGroup>
                ) : showDelete ? (
                  <Button
                    tone="danger"
                    onClick={handleProviderDelete}
                  >
                    删除
                  </Button>
                ) : undefined
              }
            />
          }
        >
          <div
            class="settings__content settings__content--compact"
            ref={providerSettingsHostRef}
          >
            <section class="settings__section">
              {editingEntry && (
                <ProviderSettingsForm
                  entry={editingEntry}
                  wideLayout={wideLayout}
                  onChange={setEditingEntry}
                  onOpenModel={handleOpenModelSettings}
                  onAddModel={handleOpenAddModel}
                  onOpenFieldEdit={handleOpenFieldDialog}
                />
              )}
            </section>
          </div>
        </Page>

        {editingEntry && fieldMeta && fieldDialog && (
          <KeychainTextFieldDialog
            open
            title={fieldMeta.title}
            label={fieldMeta.label}
            value={fieldValue}
            type={fieldMeta.type}
            placeholder={fieldMeta.placeholder}
            message={fieldMeta.message}
            allowEmpty={fieldMeta.allowEmpty}
            onClose={() => setFieldDialog(undefined)}
            onSave={(value) => handleFieldDialogSave(fieldDialog, value)}
          />
        )}

        </>
      )
    }

    if (target === 'root') {
      const providerCount = workingProviders.length
      const aiStatus =
        providerCount === 0
          ? '未配置'
          : `${providerCount} 个供应商`

      return (
        <>
        <Page header={<PageHeader title="钥匙串" />}>
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
                  onClick={() => openRootScreen('github')}
                />
                <SettingsNavRow
                  label="AI 模型供应商"
                  value={aiStatus}
                  onClick={() => openRootScreen('ai-providers')}
                />
              </div>
              <p class="settings__section-footnote">
                管理本机保存的 API 凭证。配置仅保存在本机，不会上传到服务器。
              </p>
            </section>
          </div>
        </Page>
        </>
      )
    }

    if (target === 'github') {
      const showBack = showPaneBack(target, ctx)
      const fadeClass = paneBackFadeClass(target, ctx)
      return (
        <>
        <Page
          header={
            <PageHeader
              title="GitHub"
              backLabel="钥匙串"
              onBack={
                showBack
                  ? () => {
                      setGithubDialogOpen(false)
                      popToScreen('root')
                    }
                  : undefined
              }
              class={fadeClass}
            />
          }
        >
          <div class="settings__content settings__content--compact">
            <section class="settings__section">
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
        </Page>

        <GithubCredentialsDialog
          open={githubDialogOpen}
          onClose={() => setGithubDialogOpen(false)}
          onChanged={refreshGithubStatus}
        />

        </>
      )
    }

    if (target === 'ai-providers') {
      const showBack = showPaneBack(target, ctx)
      const fadeClass = paneBackFadeClass(target, ctx)
      return (
        <>
        <Page
          class="keychain__custom-page"
          header={
            <PageHeader
              class={fadeClass}
              title="AI 模型供应商"
              backLabel={showBack && !dirty ? '钥匙串' : undefined}
              onBack={showBack && !dirty ? () => popToScreen('root') : undefined}
              actions={
                <PageButtonGroup>
                  {dirty
                    ? [
                        <PageActionButton
                          key="cancel"
                          onClick={handleCancelChanges}
                        >
                          取消
                        </PageActionButton>,
                        <PageActionButton
                          key="save"
                          tone="default"
                          onClick={handleSave}
                        >
                          保存
                        </PageActionButton>,
                      ]
                    : [
                        ...(hasAnyModel
                          ? [
                              <PageActionButton
                                key="edit"
                                activated={reorderEditing}
                                onClick={() =>
                                  setReorderEditing((value) => !value)
                                }
                              >
                                {reorderEditing ? '完成' : '编辑'}
                              </PageActionButton>,
                            ]
                          : []),
                        <PageActionButton
                          key="add"
                          onClick={handleAddProvider}
                        >
                          添加
                        </PageActionButton>,
                      ]}
                </PageButtonGroup>
              }
            />
          }
        >
          <div class="settings__content settings__content--compact">
            <section class="settings__section">
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
                    editing={reorderEditing}
                    onReorder={(ordered) =>
                      handleReorderCapability(activeCapability, ordered)
                    }
                    onOpenProvider={handleOpenProviderSettings}
                  />
                  <p class="settings__section-footnote">
                    点「编辑」后拖动排序，首位模型将作为当前类别的首选。
                  </p>
                </>
              )}
            </section>
          </div>
        </Page>
        </>
      )
    }
    return null
  }

  return (
    <AdaptiveSplitNav
      class="keychain-app"
      controller={nav}
      engine="flat"
      frames={chain}
      renderPage={(page, ctx) => renderScreen(page as Screen, ctx)}
    />
  )
}


function CapabilitySection({
  capability,
  providers,
  preferred,
  order,
  editing,
  onReorder,
  onOpenProvider,
}: {
  capability: AiModelCapability
  providers: AiProviderEntry[]
  preferred: PreferredModelRef | undefined
  order: PreferredModelRef[] | undefined
  editing: boolean
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

  if (models.length === 0) {
    return (
      <div class="settings__box settings__empty keychain__section-empty">
        暂无支持该能力的已启用模型
      </div>
    )
  }

  const rowId = (item: FlatEnabledModel) =>
    `${item.providerEntryId}:${item.modelId}`

  return (
    <List
      class="keychain__capability-list"
      editing={editing}
      onReorder={(fromId, toId) => {
        const fromIndex = models.findIndex((item) => rowId(item) === fromId)
        const toIndex = models.findIndex((item) => rowId(item) === toId)
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return
        const next = [...models]
        const [moved] = next.splice(fromIndex, 1)
        next.splice(toIndex, 0, moved)
        onReorder(next)
      }}
    >
      {models.map((item, index) => (
        <ListItem
          key={`${capability}-${item.providerEntryId}-${item.modelId}`}
          id={rowId(item)}
          label={item.name}
          subtitle={getProviderDisplayName(providers[item.providerIndex])}
          badge={index === 0 ? '首选' : undefined}
          accessory="disclosure"
          onClick={() => onOpenProvider(item.providerIndex)}
        />
      ))}
    </List>
  )
}

function ProviderSettingsForm({
  entry,
  wideLayout,
  onChange,
  onOpenModel,
  onAddModel,
  onOpenFieldEdit,
}: {
  entry: AiProviderEntry
  wideLayout: boolean
  onChange: (entry: AiProviderEntry) => void
  onOpenModel: (modelId: string) => void
  onAddModel: () => void
  onOpenFieldEdit: (field: FieldEditTarget) => void
}) {
  const isCustom = isCustomProvider(entry.providerId)
  const isFree = isInstantFreeProvider(entry.providerId)
  const isZen = isOpencodeZenProvider(entry.providerId)
  const preset = findAiProviderPreset(entry.providerId)
  const modelRows = listProviderModelRows(entry)
  const providerLabel = preset?.name ?? entry.providerId
  const nameValue = entry.name?.trim() || '可选'
  const baseUrlValue = entry.baseURL?.trim() || '未设置'
  const apiKeyConfigured = entry.apiKey.length > 0
  const providerOptions = PROVIDER_OPTIONS.filter(
    (option) => option.id !== 'instant-free',
  )
  const customName = entry.name?.trim()

  const handleProviderChange = (value: string) => {
    const providerId = value as AiProviderId
    if (providerId === entry.providerId) return
    const newEntry = defaultProviderEntry(providerId)
    newEntry.id = entry.id
    newEntry.name = entry.name
    newEntry.apiKey = entry.apiKey
    newEntry.useProxy = providerRequiresProxy(providerId)
      ? true
      : entry.useProxy
    if (entry.baseURL) newEntry.baseURL = entry.baseURL
    onChange(newEntry)
  }

  return (
    <div class="keychain__form-stack">
      {isFree ? (
        <>
          <div class="keychain__form-group">
            <div class="settings__list">
              <div class="settings__row settings__row--static">
                <span class="settings__row-name">供应商</span>
                <span class="settings__row-size">{providerLabel}</span>
              </div>
              {customName ? (
                <div class="settings__row settings__row--static">
                  <span class="settings__row-name">名称</span>
                  <span class="settings__row-size">{customName}</span>
                </div>
              ) : undefined}
              <div class="settings__row settings__row--static">
                <span class="settings__row-name">API Key</span>
                <span class="settings__row-hint">无需密钥</span>
              </div>
            </div>
          </div>

          <div class="keychain__form-group">
            <h3 class="keychain__form-group-title">启用的模型</h3>
            <List>
              {modelRows.map((row) => (
                <ListItem
                  key={row.modelId}
                  label={row.name}
                  value={
                    row.enabled
                      ? formatCapabilitiesSummary(row.capabilities) || '已启用'
                      : '未启用'
                  }
                />
              ))}
            </List>
          </div>
        </>
      ) : (
        <>
          <div class="keychain__form-group">
            <div class="settings__list">
              <SettingsChoiceField
                label="供应商"
                value={entry.providerId}
                displayValue={providerLabel}
                options={providerOptions}
                onChange={(value) => handleProviderChange(value)}
                wideLayout
                presentation="list"
              />
              {wideLayout ? (
                <>
                  <SettingsInlineInputRow
                    label="名称"
                    type="text"
                    value={entry.name ?? ''}
                    placeholder="可选"
                    onChange={(name) =>
                      onChange({ ...entry, name: name || undefined })
                    }
                  />
                  {isCustom && (
                    <SettingsInlineInputRow
                      label="Base URL"
                      type="url"
                      value={entry.baseURL ?? ''}
                      placeholder="https://api.example.com/v1"
                      onChange={(baseURL) =>
                        onChange({ ...entry, baseURL: baseURL || undefined })
                      }
                    />
                  )}
                  <SettingsInlineInputRow
                    label="API Key"
                    type="password"
                    value={entry.apiKey}
                    placeholder={isZen ? '可选：免费模型可留空' : 'sk-...'}
                    onChange={(apiKey) => onChange({ ...entry, apiKey })}
                  />
                  {isZen && (
                    <div class="settings__row settings__row--static">
                      <span class="settings__row-hint">
                        免费模型（标「免费」）无需密钥；填写后解锁全部付费模型。
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <SettingsNavRow
                    label="名称"
                    value={nameValue}
                    onClick={() => onOpenFieldEdit('name')}
                  />
                  {isCustom && (
                    <SettingsNavRow
                      label="Base URL"
                      value={baseUrlValue}
                      onClick={() => onOpenFieldEdit('baseURL')}
                    />
                  )}
                  <SettingsNavRow
                    label="API Key"
                    value={
                      isZen
                        ? apiKeyConfigured
                          ? '已配置'
                          : '可选（免费模型免密钥）'
                        : apiKeyConfigured
                          ? '已配置'
                          : '未配置'
                    }
                    secretLength={
                      apiKeyConfigured ? entry.apiKey.length : undefined
                    }
                    onClick={() => onOpenFieldEdit('apiKey')}
                  />
                  {isZen && (
                    <div class="settings__row settings__row--static">
                      <span class="settings__row-hint">
                        免费模型（标「免费」）无需密钥；填写后解锁全部付费模型。
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div class="keychain__form-group">
            <h3 class="keychain__form-group-title">启用的模型</h3>
            <List>
              {modelRows.length === 0 ? (
                <ListItem label="尚未添加模型" />
              ) : (
                modelRows.map((row) => (
                  <ListItem
                    key={row.modelId}
                    label={
                      row.free ? (
                        <>
                          {row.name}
                          <span class="ai-model-free-badge">免费</span>
                        </>
                      ) : (
                        row.name
                      )
                    }
                    value={
                      row.enabled
                        ? formatCapabilitiesSummary(row.capabilities) ||
                          '已启用'
                        : '未启用'
                    }
                    accessory="disclosure"
                    onClick={() => onOpenModel(row.modelId)}
                  />
                ))
              )}
              <ListAddRow
                label={isCustom ? '添加模型…' : '添加自定义模型…'}
                onClick={onAddModel}
              />
            </List>
          </div>
        </>
      )}

      <div class="keychain__form-group">
        <div class="settings__list">
          <SettingsSwitchRow
            label="思考模式"
            checked={entry.thinkingEnabled}
            disabled={isFree}
            onChange={(thinkingEnabled) =>
              onChange({ ...entry, thinkingEnabled })
            }
          />
          {!isFree && (
            <SettingsSwitchRow
              label="使用代理服务器访问"
              checked={
                providerRequiresProxy(entry.providerId)
                  ? true
                  : entry.useProxy
              }
              disabled={providerRequiresProxy(entry.providerId)}
              detail={
                providerRequiresProxy(entry.providerId)
                  ? '该供应商需经代理服务器访问，无法关闭。'
                  : undefined
              }
              onChange={(useProxy) => {
                if (providerRequiresProxy(entry.providerId)) return
                onChange({ ...entry, useProxy })
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

const TOKENIZER_NONE_OPTION_ID = ''

/** 词表「自动」选项文案：能按 modelId 推断时附带当前识别族 */
function formatKeychainTokenizerAutoLabel(modelId: string | undefined): string {
  const resolved = resolveTokenizerFamily(modelId)
  if (!resolved) return '自动'
  return `自动（${AI_TOKENIZER_FAMILY_LABELS[resolved]}）`
}

function formatKeychainTokenizerLabel(
  modelId: string | undefined,
  tokenizerFamily: AiTokenizerFamily | undefined,
): string {
  if (!tokenizerFamily) {
    return formatKeychainTokenizerAutoLabel(modelId)
  }
  return AI_TOKENIZER_FAMILY_LABELS[tokenizerFamily]
}

type AddModelPicker = 'pricing' | 'tokenizer' | 'context'

function AddModelView({
  providerId,
  existingModelIds,
  isCustomProvider: customProvider,
  onCancel,
  onComplete,
}: {
  providerId: AiProviderId
  existingModelIds: readonly string[]
  isCustomProvider: boolean
  onCancel: () => void
  onComplete: (result: {
    modelId: string
    supportsVision: boolean
    pricingModelKey?: string
    manualPricing?: AiManualPricing
    openRouterPricing?: AiOpenRouterPricingRef
    tokenizerFamily?: AiTokenizerFamily
    contextWindowMode?: AiContextWindowMode
    contextWindow?: number
  }) => void
}) {
  const [draftModelId, setDraftModelId] = useState('')
  const [supportsVision, setSupportsVision] = useState(false)
  const [detailsRevealed, setDetailsRevealed] = useState(false)
  const [pricingSelection, setPricingSelection] = useState<KeychainPricingSelection>(
    {},
  )
  const [tokenizerFamily, setTokenizerFamily] = useState<
    AiTokenizerFamily | undefined
  >()
  const [contextWindowMode, setContextWindowMode] = useState<
    AiContextWindowMode | undefined
  >()
  const [contextWindow, setContextWindow] = useState<number | undefined>()
  const [pricingTouched, setPricingTouched] = useState(false)
  const [tokenizerTouched, setTokenizerTouched] = useState(false)
  const [modelIdDialogOpen, setModelIdDialogOpen] = useState(false)
  const {
    page: pickerPage,
    stack: pickerStack,
    transition: pickerTransition,
    navigate: navigatePicker,
    handleMotionEnd: handlePickerMotionEnd,
  } = usePageStack<'form' | AddModelPicker>('form')

  const trimmed = draftModelId.trim()
  const duplicate = trimmed.length > 0 && existingModelIds.includes(trimmed)
  const canSubmit = trimmed.length > 0 && !duplicate
  const capabilities = buildCustomModelCapabilities(supportsVision)
  const title = customProvider ? '添加模型' : '添加自定义模型'

  const tokenizerOptions = useMemo(
    () => [
      {
        id: TOKENIZER_NONE_OPTION_ID,
        label: formatKeychainTokenizerAutoLabel(trimmed),
      },
      ...AI_TOKENIZER_FAMILIES.map((family) => ({
        id: family,
        label: AI_TOKENIZER_FAMILY_LABELS[family],
      })),
    ],
    [trimmed],
  )

  const pricingLabel = formatKeychainPricingLabel(pricingSelection)
  const tokenizerLabel = formatKeychainTokenizerLabel(trimmed, tokenizerFamily)
  const contextEntry: AiModelEntry = {
    modelId: trimmed || 'draft',
    name: trimmed || 'draft',
    ...pricingSelection,
    contextWindowMode,
    contextWindow,
  }
  const contextLabel = formatKeychainContextWindowLabel(providerId, contextEntry)

  const applyModelId = (next: string) => {
    setDraftModelId(next)
    const nextTrimmed = next.trim()
    if (!nextTrimmed) return

    setDetailsRevealed(true)

    const matchedPricing = matchPricingModelKey(providerId, nextTrimmed)
    if (!pricingTouched) {
      setPricingSelection(
        matchedPricing ? { pricingModelKey: matchedPricing } : {},
      )
    }

    // 默认保持「自动」：不写入 tokenizerFamily，运行时按 modelId 推断
    if (!tokenizerTouched) {
      setTokenizerFamily(undefined)
    }

    const matchedPreset =
      findAiModelPreset(providerId, nextTrimmed) ??
      AI_PROVIDER_PRESETS.flatMap((item) => [...item.models]).find(
        (model) => model.id === nextTrimmed,
      )
    if (matchedPreset?.capabilities.includes('vision')) {
      setSupportsVision(true)
    }
  }

  const handleCapabilityToggle = (
    capability: AiModelCapability,
    checked: boolean,
  ) => {
    if (capability !== 'vision') return
    setSupportsVision(checked)
  }

  const renderPickerPage = (page: 'form' | AddModelPicker) => {
    if (page === 'pricing') {
      return (
        <KeychainPricingFlow
        backLabel={title}
        modelId={trimmed}
        selection={pricingSelection}
        onChange={(next) => {
          setPricingTouched(true)
          setPricingSelection(next)
        }}
        onClose={() => navigatePicker('form', 'pop')}
        />
      )
    }
    if (page === 'tokenizer') {
      return (
      <div class="page keychain__picker-page">
        <SettingsChoicePickerView
        title="词表"
        backLabel={title}
        options={tokenizerOptions}
        value={tokenizerFamily ?? TOKENIZER_NONE_OPTION_ID}
        searchable
        searchPlaceholder="搜索词表"
        titleInNav
        closeOnSelect={false}
        onChange={(value) => {
          setTokenizerTouched(true)
          setTokenizerFamily(
            value ? (value as AiTokenizerFamily) : undefined,
          )
        }}
        onBack={() => navigatePicker('form', 'pop')}
        />
      </div>
      )
    }
    if (page === 'context') {
      return (
      <KeychainContextWindowFlow
          backLabel={title}
          providerId={providerId}
          modelEntry={contextEntry}
          onChange={(next) => {
            setContextWindowMode(next.contextWindowMode)
            setContextWindow(next.contextWindow)
          }}
          onClose={() => navigatePicker('form', 'pop')}
        />
      )
    }
    return (
      <Page
        class="keychain__custom-page"
        header={
          <PageHeader
            title={title}
            actions={
              <PageButtonGroup>
                <PageActionButton onClick={onCancel}>取消</PageActionButton>
                <PageActionButton
                  tone="default"
                  disabled={!canSubmit}
                  onClick={() =>
                    onComplete({
                      modelId: trimmed,
                      supportsVision,
                      ...pricingSelection,
                      tokenizerFamily,
                      ...(contextWindowMode ? { contextWindowMode } : {}),
                      ...(contextWindow !== undefined ? { contextWindow } : {}),
                    })
                  }
                >
                  下一步
                </PageActionButton>
              </PageButtonGroup>
            }
          />
        }
      >
        <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <div class="keychain__form-stack">
            <div class="keychain__form-group">
              <div class="settings__list">
                <SettingsNavRow
                  label="模型 ID"
                  value={trimmed || '未设置'}
                  onClick={() => setModelIdDialogOpen(true)}
                />
              </div>
              {duplicate && (
                <p class="settings__section-footnote settings__form-status--error">
                  该模型已存在
                </p>
              )}
            </div>

            {detailsRevealed && (
              <>
                <div class="keychain__form-group">
                  <h3 class="keychain__form-group-title">能力</h3>
                  <div class="settings__list">
                    {AI_MODEL_OWNED_CAPABILITIES.map((capability) => {
                      const active = capabilities.includes(capability)
                      const label = AI_MODEL_CAPABILITY_LABELS[capability]
                      const canToggle = capability === 'vision'
                      const checked = capability === 'text' ? true : active

                      return (
                        <SettingsCheckRow
                          key={capability}
                          label={label}
                          checked={checked}
                          disabled={!canToggle}
                          onChange={(next) =>
                            handleCapabilityToggle(capability, next)
                          }
                        />
                      )
                    })}
                  </div>
                  <p class="settings__section-footnote">
                    自定义模型始终支持基座；可开启图像识别。语音识别与合成暂不支持手动标注。
                  </p>
                </div>

                <div class="keychain__form-group">
                  <h3 class="keychain__form-group-title">补充信息</h3>
                  <div class="settings__list">
                    <SettingsNavRow
                      label="定价"
                      value={pricingLabel}
                      onClick={() => navigatePicker('pricing', 'push')}
                    />
                    <SettingsNavRow
                      label="词表"
                      value={tokenizerLabel}
                      onClick={() => navigatePicker('tokenizer', 'push')}
                    />
                    <SettingsNavRow
                      label="上下文"
                      value={contextLabel}
                      onClick={() => navigatePicker('context', 'push')}
                    />
                  </div>
                  <p class="settings__section-footnote">
                    定价用于事件日志估算成本；词表用于本地 token 预估；上下文用于占用展示。未自动匹配时可手动选择。
                  </p>
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      <KeychainTextFieldDialog
        open={modelIdDialogOpen}
        title="模型 ID"
        label="模型 ID"
        value={draftModelId}
        type="text"
        placeholder="model-id"
        message="填写要添加的模型 ID。"
        allowEmpty
        onClose={() => setModelIdDialogOpen(false)}
        onSave={applyModelId}
      />
        </Page>
      )
    }

  return (
    <div class="page keychain__flow-page">
      <PageStack
        stack={pickerStack}
        page={pickerPage}
        transition={pickerTransition}
        onMotionEnd={handlePickerMotionEnd}
        renderPage={renderPickerPage}
      />
    </div>
  )
}


function ModelSettingsView({
  entry,
  modelId,
  backLabel,
  onBack,
  onChange,
}: {
  entry: AiProviderEntry
  modelId: string
  backLabel: string
  onBack: () => void
  onChange: (entry: AiProviderEntry) => void
}) {
  const isCustomProviderEntry = isCustomProvider(entry.providerId)
  const rows = listProviderModelRows(entry)
  const editingRow = rows.find((row) => row.modelId === modelId)
  const modelEntry = entry.enabledModels.find((m) => m.modelId === modelId)
  const title = editingRow?.name ?? modelId
  const {
    page: pickerPage,
    stack: pickerStack,
    transition: pickerTransition,
    navigate: navigatePicker,
    handleMotionEnd: handlePickerMotionEnd,
  } = usePageStack<'form' | AddModelPicker>('form')
  const modal = useWindowModal()
  const [pricingRevision, setPricingRevision] = useState(0)

  useEffect(() => {
    const bump = () => setPricingRevision((value) => value + 1)
    const unsubA = subscribeModelPricingCache(bump)
    const unsubB = subscribeOpenRouterPricingCache(bump)
    return () => {
      unsubA()
      unsubB()
    }
  }, [])

  const tokenizerOptions = useMemo(
    () => [
      {
        id: TOKENIZER_NONE_OPTION_ID,
        label: formatKeychainTokenizerAutoLabel(modelId),
      },
      ...AI_TOKENIZER_FAMILIES.map((family) => ({
        id: family,
        label: AI_TOKENIZER_FAMILY_LABELS[family],
      })),
    ],
    [modelId],
  )

  const updateModelEntry = (patch: Partial<AiModelEntry>) => {
    const applyPatch = (m: AiModelEntry): AiModelEntry => {
      const merged = { ...m, ...patch }
      // 定价三选一：显式写入某一源时清掉另外两源
      if ('manualPricing' in patch || 'openRouterPricing' in patch || 'pricingModelKey' in patch) {
        if (patch.manualPricing) {
          delete merged.pricingModelKey
          delete merged.openRouterPricing
        } else if (patch.openRouterPricing) {
          delete merged.pricingModelKey
          delete merged.manualPricing
        } else if (patch.pricingModelKey) {
          delete merged.manualPricing
          delete merged.openRouterPricing
        } else {
          delete merged.pricingModelKey
          delete merged.manualPricing
          delete merged.openRouterPricing
        }
      }
      if ('contextWindowMode' in patch || 'contextWindow' in patch) {
        if (merged.contextWindowMode !== 'manual') {
          delete merged.contextWindowMode
          delete merged.contextWindow
        } else if (merged.contextWindow === undefined) {
          delete merged.contextWindow
        }
      }
      return merged
    }

    const index = entry.enabledModels.findIndex((m) => m.modelId === modelId)
    if (index < 0) {
      const name = editingRow?.name ?? modelId
      const created = applyPatch({ modelId, name })
      onChange({
        ...entry,
        enabledModels: [...entry.enabledModels, created],
        defaultModel: entry.defaultModel || modelId,
      })
      return
    }

    const next = entry.enabledModels.map((m) =>
      m.modelId === modelId ? applyPatch(m) : m,
    )
    onChange({ ...entry, enabledModels: next })
  }

  const handleToggleEnabled = (enabled: boolean) => {
    if (!editingRow) return
    const { modelId: id, name } = editingRow
    let next: AiModelEntry[]
    if (enabled) {
      if (entry.enabledModels.some((m) => m.modelId === id)) return
      next = [...entry.enabledModels, { modelId: id, name }]
    } else {
      next = entry.enabledModels.filter((m) => m.modelId !== id)
    }
    const nextDefault = next.some((m) => m.modelId === entry.defaultModel)
      ? entry.defaultModel
      : (next[0]?.modelId ?? '')
    onChange({ ...entry, enabledModels: next, defaultModel: nextDefault })
  }

  const handleRemove = async () => {
    const confirmed = await modal.confirm({
      title: '移除模型',
      message: `确定要移除「${title}」吗？该模型在此供应商下的配置将被移除。`,
      confirmTone: 'danger',
    })
    if (!confirmed) return
    const next = entry.enabledModels.filter((m) => m.modelId !== modelId)
    const nextDefault = next.some((m) => m.modelId === entry.defaultModel)
      ? entry.defaultModel
      : (next[0]?.modelId ?? '')
    onChange({ ...entry, enabledModels: next, defaultModel: nextDefault })
    onBack()
  }

  const handleVisionChange = (supportsVision: boolean) => {
    updateModelEntry({
      capabilities: [...buildCustomModelCapabilities(supportsVision)],
    })
  }

  const showRemove = Boolean(editingRow && !editingRow.isFromPreset)
  const showEnableSwitch = Boolean(
    editingRow && editingRow.isFromPreset && !isCustomProviderEntry,
  )
  const capabilitiesEditable = Boolean(
    editingRow && !editingRow.isFromPreset,
  )
  const displayedCapabilities = editingRow?.capabilities ?? []
  const tokenizerFamily = modelEntry?.tokenizerFamily
  const pricingSelection: KeychainPricingSelection = {
    pricingModelKey: modelEntry?.pricingModelKey,
    manualPricing: modelEntry?.manualPricing,
    openRouterPricing: modelEntry?.openRouterPricing,
  }
  void pricingRevision
  const pricingLabel = formatKeychainPricingLabel(pricingSelection)
  const tokenizerLabel = formatKeychainTokenizerLabel(modelId, tokenizerFamily)
  const contextModelEntry: AiModelEntry = modelEntry ?? {
    modelId,
    name: editingRow?.name ?? modelId,
  }
  const contextLabel = formatKeychainContextWindowLabel(
    entry.providerId,
    contextModelEntry,
  )
  const showSupplement = Boolean(capabilitiesEditable || editingRow)

  const handleCapabilityToggle = (
    capability: AiModelCapability,
    checked: boolean,
  ) => {
    if (!capabilitiesEditable) return
    if (capability !== 'vision') return
    handleVisionChange(checked)
  }

  const renderPickerPage = (page: 'form' | AddModelPicker) => {
    if (page === 'pricing') {
      return (
        <KeychainPricingFlow
        backLabel={title}
        modelId={modelId}
        selection={pricingSelection}
        onChange={(next) => {
          updateModelEntry({
            pricingModelKey: next.pricingModelKey,
            manualPricing: next.manualPricing,
            openRouterPricing: next.openRouterPricing,
          })
        }}
        onClose={() => navigatePicker('form', 'pop')}
        />
      )
    }
    if (page === 'tokenizer') {
      return (
      <div class="page keychain__picker-page">
        <SettingsChoicePickerView
        title="词表"
        backLabel={title}
        options={tokenizerOptions}
        value={tokenizerFamily ?? TOKENIZER_NONE_OPTION_ID}
        searchable
        searchPlaceholder="搜索词表"
        titleInNav
        closeOnSelect={false}
        onChange={(value) =>
          updateModelEntry({
            tokenizerFamily: value
              ? (value as AiTokenizerFamily)
              : undefined,
          })
        }
        onBack={() => navigatePicker('form', 'pop')}
        />
      </div>
      )
    }
    if (page === 'context') {
      return (
      <KeychainContextWindowFlow
          backLabel={title}
          providerId={entry.providerId}
          modelEntry={contextModelEntry}
          onChange={(next) => {
            updateModelEntry({
              contextWindowMode: next.contextWindowMode,
              contextWindow: next.contextWindow,
            })
          }}
          onClose={() => navigatePicker('form', 'pop')}
        />
      )
    }
    return (
      <Page
        header={
          <PageHeader
            title={title}
            backLabel={backLabel}
            onBack={onBack}
            actions={
              showRemove ? (
                <Button tone="danger" onClick={handleRemove}>
                  移除
                </Button>
              ) : undefined
            }
          />
        }
      >
        <div class="settings__content settings__content--compact">
        <section class="settings__section">
          {editingRow ? (
            <div class="keychain__form-stack">
              <div class="keychain__form-group">
                <div class="settings__list">
                  <div class="settings__row settings__row--static">
                    <span class="settings__row-name">名称</span>
                    <span class="settings__row-size">{editingRow.name}</span>
                  </div>
                  <div class="settings__row settings__row--static">
                    <span class="settings__row-name">模型 ID</span>
                    <span class="settings__row-size">{editingRow.modelId}</span>
                  </div>
                  {showEnableSwitch && (
                    <SettingsSwitchRow
                      label="启用"
                      checked={editingRow.enabled}
                      onChange={handleToggleEnabled}
                    />
                  )}
                </div>
              </div>

              <div class="keychain__form-group">
                <h3 class="keychain__form-group-title">能力</h3>
                <div class="settings__list">
                  {AI_MODEL_OWNED_CAPABILITIES.map((capability) => {
                    const active = displayedCapabilities.includes(capability)
                    const label = AI_MODEL_CAPABILITY_LABELS[capability]
                    const canToggle =
                      capabilitiesEditable && capability === 'vision'
                    const checked =
                      capability === 'text' && capabilitiesEditable
                        ? true
                        : active

                    return (
                      <SettingsCheckRow
                        key={capability}
                        label={label}
                        checked={checked}
                        disabled={!canToggle}
                        onChange={(next) =>
                          handleCapabilityToggle(capability, next)
                        }
                      />
                    )
                  })}
                </div>
                {capabilitiesEditable && (
                  <p class="settings__section-footnote">
                    自定义模型始终支持基座；可开启图像识别。语音识别与合成暂不支持手动标注。
                  </p>
                )}
              </div>

              {showSupplement && (
                <div class="keychain__form-group">
                  <h3 class="keychain__form-group-title">补充信息</h3>
                  <div class="settings__list">
                    {capabilitiesEditable && (
                      <>
                        <SettingsNavRow
                          label="定价"
                          value={pricingLabel}
                          onClick={() => navigatePicker('pricing', 'push')}
                        />
                        <SettingsNavRow
                          label="词表"
                          value={tokenizerLabel}
                          onClick={() => navigatePicker('tokenizer', 'push')}
                        />
                      </>
                    )}
                    <SettingsNavRow
                      label="上下文"
                      value={contextLabel}
                      onClick={() => navigatePicker('context', 'push')}
                    />
                  </div>
                  <p class="settings__section-footnote">
                    {capabilitiesEditable
                      ? '定价用于事件日志估算成本；词表用于本地 token 预估；上下文用于占用展示。'
                      : '上下文用于占用展示。自动时优先使用已匹配定价模型的长度。'}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div class="settings__box settings__empty">找不到该模型</div>
          )}
        </section>
        </div>
      </Page>
    )
  }

  return (
    <div class="page keychain__flow-page">
      <PageStack
        stack={pickerStack}
        page={pickerPage}
        transition={pickerTransition}
        onMotionEnd={handlePickerMotionEnd}
        renderPage={renderPickerPage}
      />
    </div>
  )
}
