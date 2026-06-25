import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { IosSwitch } from '../../ui/ios-switch.tsx'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
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
  AI_PROVIDER_PRESETS,
  defaultProviderEntry,
  findAiProviderPreset,
  isCustomProvider,
  isProviderEntryValid,
  type AiModelEntry,
  type AiProviderEntry,
  type AiProviderId,
} from '../../ai/ai-providers.ts'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import '../../ui/ios-nav-back.css'
import './keychain.css'

type Screen = 'main' | 'provider-settings'

type FlatModelItem = {
  modelId: string
  name: string
  providerIndex: number
  providerEntryId: string
}

const PROVIDER_OPTIONS = AI_PROVIDER_PRESETS.map((item) => ({
  id: item.id,
  label: item.name,
}))

function flattenModels(providers: AiProviderEntry[]): FlatModelItem[] {
  const items: FlatModelItem[] = []
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i]
    for (const model of p.enabledModels) {
      items.push({
        modelId: model.modelId,
        name: model.name,
        providerIndex: i,
        providerEntryId: p.id,
      })
    }
  }
  return items
}

function providersEqual(
  a: AiProviderEntry[],
  b: AiProviderEntry[],
  prefA: number,
  prefB: number,
): boolean {
  if (prefA !== prefB || a.length !== b.length) return false
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
          m.name === other.enabledModels[j].name,
      )
    )
  })
}

function cloneProviders(providers: AiProviderEntry[]): AiProviderEntry[] {
  return providers.map((p) => ({
    ...p,
    enabledModels: p.enabledModels.map((m) => ({ ...m })),
  }))
}

function getProviderDisplayName(provider?: AiProviderEntry): string {
  if (!provider) return ''
  return (
    provider.name?.trim() ||
    findAiProviderPreset(provider.providerId)?.name ||
    provider.providerId
  )
}

export function KeychainApp() {
  const { windows, closeWindowsForApp, minimizeWindow, setAppWindowTitle } =
    useOs()
  const { showBuiltinAbout } = useAboutApp()
  const modal = useWindowModal()

  type SavedSnapshot =
    | { providers: AiProviderEntry[]; preferredIndex: number }
    | undefined

  const [savedSnapshot, setSavedSnapshot] = useState<SavedSnapshot>(() => {
    const stored = loadAccountSettings()
    if (stored && stored.providers.length > 0) {
      return {
        providers: cloneProviders(stored.providers),
        preferredIndex: stored.preferredIndex,
      }
    }
    return undefined
  })

  const [workingProviders, setWorkingProviders] = useState<AiProviderEntry[]>(
    () => {
      const stored = loadAccountSettings()
      if (stored && stored.providers.length > 0) {
        return cloneProviders(stored.providers)
      }
      return []
    },
  )

  const [preferredIndex, setPreferredIndex] = useState<number>(() => {
    const stored = loadAccountSettings()
    return stored?.preferredIndex ?? 0
  })

  const [screen, setScreen] = useState<Screen>('main')
  const [editingProviderIndex, setEditingProviderIndex] = useState<number>(-1)
  const [editingEntry, setEditingEntry] = useState<AiProviderEntry | undefined>(
    undefined,
  )

  const isDraggingRef = useRef(false)
  const [dragIndex, setDragIndex] = useState<number | undefined>(undefined)
  const [overIndex, setOverIndex] = useState<number | undefined>(undefined)

  const entryValid = useMemo(
    () => editingEntry && isProviderEntryValid(editingEntry),
    [editingEntry],
  )

  const flatModels = useMemo(
    () => flattenModels(workingProviders),
    [workingProviders],
  )

  const dirty = useMemo(() => {
    if (!savedSnapshot && workingProviders.length > 0) return true
    if (savedSnapshot && workingProviders.length === 0) return true
    if (!savedSnapshot && workingProviders.length === 0) return false

    return !providersEqual(
      workingProviders,
      savedSnapshot!.providers,
      preferredIndex,
      savedSnapshot!.preferredIndex,
    )
  }, [workingProviders, preferredIndex, savedSnapshot])

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
    const settings: AccountSettingsV2 = {
      version: 2,
      providers: workingProviders.map((p) => ({
        ...p,
        enabledModels: p.enabledModels.map((m) => ({ ...m })),
      })),
      preferredIndex,
    }
    saveAccountSettings(settings)
    setSavedSnapshot({
      providers: cloneProviders(settings.providers),
      preferredIndex: settings.preferredIndex,
    })
  }, [workingProviders, preferredIndex])

  const handleAddProvider = useCallback(() => {
    const entry = defaultProviderEntry()
    const newIndex = workingProviders.length
    setWorkingProviders((prev) => [...prev, entry])
    setEditingProviderIndex(newIndex)
    setEditingEntry(structuredClone(entry))
    setScreen('provider-settings')
  }, [workingProviders.length])

  const handleOpenProviderSettings = useCallback(
    (item: FlatModelItem) => {
      if (isDraggingRef.current) return
      const provider = workingProviders[item.providerIndex]
      if (!provider) return
      setEditingProviderIndex(item.providerIndex)
      setEditingEntry({
        ...provider,
        enabledModels: provider.enabledModels.map((m) => ({ ...m })),
      })
      setScreen('provider-settings')
    },
    [workingProviders],
  )

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
      return next
    })

    setScreen('main')
    setEditingEntry(undefined)
  }, [editingEntry, editingProviderIndex])

  const handleProviderDelete = useCallback(async () => {
    if (editingProviderIndex < 0) return

    const provider = workingProviders[editingProviderIndex]
    const displayName = getProviderDisplayName(provider)

    const confirmed = await modal.confirm({
      title: '删除供应商',
      message: `确定要删除「${displayName}」吗？该供应商的所有配置将被移除。`,
      destructive: true,
    })
    if (!confirmed) return

    const nextProviders = workingProviders.filter(
      (_, i) => i !== editingProviderIndex,
    )

    if (nextProviders.length === 0) {
      clearAccountSettings()
      setWorkingProviders([])
      setPreferredIndex(0)
      setSavedSnapshot(undefined)
      setScreen('main')
      setEditingEntry(undefined)
      return
    }

    let newPref = preferredIndex
    if (editingProviderIndex === newPref) {
      newPref = 0
    } else if (editingProviderIndex < newPref) {
      newPref--
    }

    setWorkingProviders(nextProviders)
    setPreferredIndex(newPref)
    setScreen('main')
    setEditingEntry(undefined)
  }, [editingProviderIndex, workingProviders, preferredIndex, modal])

  const handleDragStart = useCallback(
    (index: number, event: DragEvent) => {
      isDraggingRef.current = true
      setDragIndex(index)
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', String(index))
      }
    },
    [],
  )

  const handleDragOver = useCallback(
    (index: number, event: DragEvent) => {
      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move'
      }
      setOverIndex(index)
    },
    [],
  )

  const handleDragLeave = useCallback(() => {
    setOverIndex(undefined)
  }, [])

  const handleDrop = useCallback(
    (dropIndex: number) => {
      setDragIndex(undefined)
      setOverIndex(undefined)
      isDraggingRef.current = false

      if (dragIndex === undefined || dragIndex === dropIndex) return

      const items = [...flatModels]
      const moved = items[dragIndex]
      items.splice(dragIndex, 1)
      items.splice(dropIndex, 0, moved)

      const seenProviderIds: string[] = []
      const providerModels = new Map<string, AiModelEntry[]>()

      for (const item of items) {
        if (!providerModels.has(item.providerEntryId)) {
          providerModels.set(item.providerEntryId, [])
          seenProviderIds.push(item.providerEntryId)
        }
        providerModels.get(item.providerEntryId)!.push({
          modelId: item.modelId,
          name: item.name,
        })
      }

      const entryById = new Map<string, AiProviderEntry>()
      for (const p of workingProviders) {
        entryById.set(p.id, p)
      }

      const nextProviders: AiProviderEntry[] = seenProviderIds
        .map((id) => {
          const original = entryById.get(id)
          if (!original) return undefined
          const models = providerModels.get(id) ?? []
          return {
            ...original,
            enabledModels: models.map((m) => ({ ...m })),
            defaultModel: models[0]?.modelId ?? original.defaultModel,
          }
        })
        .filter((p): p is AiProviderEntry => p !== undefined)

      setWorkingProviders(nextProviders)
      setPreferredIndex(0)
    },
    [dragIndex, flatModels, workingProviders],
  )

  const handleDragEnd = useCallback(() => {
    setDragIndex(undefined)
    setOverIndex(undefined)
    isDraggingRef.current = false
  }, [])

  if (screen === 'provider-settings') {
    const settingsTitle =
      getProviderDisplayName(editingEntry ?? workingProviders[editingProviderIndex]) ||
      '供应商'

    return (
      <div class="keychain">
        <header class="keychain__toolbar">
          <IosNavBackButton
            label="钥匙串"
            disabled={!entryValid}
            onClick={handleProviderDone}
          />
          <span class="keychain__toolbar-title keychain__toolbar-title--center">
            {settingsTitle}
          </span>
          <button
            type="button"
            class="keychain__toolbar-btn keychain__toolbar-btn--danger keychain__toolbar-btn--action"
            onClick={handleProviderDelete}
          >
            删除
          </button>
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

      {flatModels.length === 0 ? (
        <div class="keychain__content keychain__content--empty">
          <span class="keychain__empty-title">尚未添加供应商</span>
          <span class="keychain__empty-hint">
            点击右上角「添加」来添加 AI 模型供应商
          </span>
        </div>
      ) : (
        <div class="keychain__content">
          <div class="keychain__list">
            {flatModels.map((item, index) => (
              <div
                key={`${item.providerEntryId}-${item.modelId}`}
                class={`keychain__list-item${
                  index === dragIndex ? ' keychain__list-item--dragging' : ''
                }${index === overIndex ? ' keychain__list-item--over' : ''}`}
                onClick={() => handleOpenProviderSettings(item)}
                onDragOver={(e) => handleDragOver(index, e)}
                onDragLeave={handleDragLeave}
                onDrop={() => handleDrop(index)}
              >
                <div
                  class="keychain__grip"
                  draggable
                  onDragStart={(e) => handleDragStart(index, e)}
                  onDragEnd={handleDragEnd}
                >
                  <span class="keychain__grip-line" />
                  <span class="keychain__grip-line" />
                  <span class="keychain__grip-line" />
                </div>

                <div class="keychain__model-info">
                  <span class="keychain__model-name">{item.name}</span>
                  <span class="keychain__model-provider">
                    {getProviderDisplayName(
                      workingProviders[item.providerIndex],
                    )}
                  </span>
                </div>

                {index === 0 && (
                  <span class="keychain__badge">激活</span>
                )}

                <span class="keychain__chevron">{'\u203A'}</span>
              </div>
            ))}
          </div>
          <div class="keychain__hint">
            拖拽排序，首位模型将被激活使用
          </div>
        </div>
      )}
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
  const isCustom = isCustomProvider(entry.providerId)
  const preset = findAiProviderPreset(entry.providerId)
  const showThinking =
    entry.providerId === 'deepseek' || entry.providerId === 'mimo' || entry.providerId === 'mimo-token-plan'

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
    const nextDefault =
      entry.defaultModel === modelId && enabled
        ? next[0]?.modelId ?? ''
        : entry.defaultModel
    onChange({ ...entry, enabledModels: next, defaultModel: nextDefault })
  }

  const handleSetDefault = (modelId: string) => {
    onChange({ ...entry, defaultModel: modelId })
  }

  const handleRemoveCustomModel = (modelId: string) => {
    const next = entry.enabledModels.filter((m) => m.modelId !== modelId)
    const nextDefault =
      entry.defaultModel === modelId
        ? next[0]?.modelId ?? ''
        : entry.defaultModel
    onChange({ ...entry, enabledModels: next, defaultModel: nextDefault })
  }

  const handleAddCustomModel = () => {
    const modelId = customModelInput.trim()
    if (!modelId) return
    if (entry.enabledModels.some((m) => m.modelId === modelId)) return
    const nextModels = [...entry.enabledModels, { modelId, name: modelId }]
    onChange({
      ...entry,
      enabledModels: nextModels,
      defaultModel: entry.defaultModel || modelId,
    })
    setCustomModelInput('')
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') handleAddCustomModel()
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
              name:
                (e.currentTarget as HTMLInputElement).value || undefined,
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

      {isCustom ? (
        <div class="keychain__field-group">
          <label class="keychain__field-label">启用的模型</label>
          <div class="keychain__model-list">
            {entry.enabledModels.length === 0 && (
              <div class="keychain__model-empty-hint">
                尚未添加模型，请在下方添加
              </div>
            )}
            {entry.enabledModels.map((model) => {
              const isDefault = entry.defaultModel === model.modelId
              return (
                <div
                  key={model.modelId}
                  class="keychain__model-row"
                >
                  <span class="keychain__model-check-name">
                    {model.name}
                  </span>
                  <div class="keychain__model-actions">
                    <button
                      type="button"
                      class={`keychain__inline-btn${
                        isDefault
                          ? ' keychain__inline-btn--default'
                          : ''
                      }`}
                      onClick={() => handleSetDefault(model.modelId)}
                    >
                      {isDefault ? '默认' : '设为默认'}
                    </button>
                    <button
                      type="button"
                      class="keychain__inline-btn keychain__inline-btn--remove"
                      onClick={() =>
                        handleRemoveCustomModel(model.modelId)
                      }
                    >
                      移除
                    </button>
                  </div>
                </div>
              )
            })}
            <div class="keychain__model-add-row">
              <input
                class="keychain__model-add-input"
                type="text"
                value={customModelInput}
                placeholder="添加模型..."
                autoComplete="off"
                onInput={(e) =>
                  setCustomModelInput(
                    (e.currentTarget as HTMLInputElement).value,
                  )
                }
                onKeyDown={handleKeyDown}
              />
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
        </div>
      ) : (
        <div class="keychain__field-group">
          <label class="keychain__field-label">启用的模型</label>
          <div class="keychain__model-list">
            {(() => {
              const presetModelIds = new Set(
                preset?.models.map((m) => m.id) ?? [],
              )
              const allModelIds = new Set<string>()
              const allModels: { modelId: string; name: string }[] = []

              for (const pm of preset?.models ?? []) {
                allModelIds.add(pm.id)
                allModels.push({ modelId: pm.id, name: pm.name })
              }
              for (const em of entry.enabledModels) {
                if (!allModelIds.has(em.modelId)) {
                  allModelIds.add(em.modelId)
                  allModels.push({ modelId: em.modelId, name: em.name })
                }
              }

              return allModels.map((model) => {
                const enabled = entry.enabledModels.some(
                  (m) => m.modelId === model.modelId,
                )
                const isDefault = entry.defaultModel === model.modelId
                const isFromPreset = presetModelIds.has(model.modelId)

                return (
                  <div
                    key={model.modelId}
                    class={`keychain__model-row${!enabled ? ' keychain__model-row--disabled' : ''}`}
                  >
                    <button
                      type="button"
                      class={`keychain__model-toggle${enabled ? ' keychain__model-toggle--on' : ''}`}
                      aria-pressed={enabled}
                      aria-label={enabled ? `禁用 ${model.name}` : `启用 ${model.name}`}
                      onClick={() =>
                        handleModelToggle(model.modelId, model.name)
                      }
                    >
                      {enabled && (
                        <span class="keychain__model-toggle-mark" aria-hidden="true">
                          ✓
                        </span>
                      )}
                    </button>
                    <span class="keychain__model-check-name">
                      {model.name}
                    </span>
                    <div class="keychain__model-actions">
                      <button
                        type="button"
                        class={`keychain__inline-btn${
                          isDefault
                            ? ' keychain__inline-btn--default'
                            : ''
                        }`}
                        disabled={!enabled}
                        onClick={() => handleSetDefault(model.modelId)}
                      >
                        {isDefault ? '默认' : '设为默认'}
                      </button>
                      {!isFromPreset && (
                        <button
                          type="button"
                          class="keychain__inline-btn keychain__inline-btn--remove"
                          onClick={() =>
                            handleRemoveCustomModel(model.modelId)
                          }
                        >
                          移除
                        </button>
                      )}
                    </div>
                  </div>
                )
              })
            })()}
            <div class="keychain__model-add-row">
              <input
                class="keychain__model-add-input"
                type="text"
                value={customModelInput}
                placeholder="添加自定义模型..."
                autoComplete="off"
                onInput={(e) =>
                  setCustomModelInput(
                    (e.currentTarget as HTMLInputElement).value,
                  )
                }
                onKeyDown={handleKeyDown}
              />
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
        </div>
      )}

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
