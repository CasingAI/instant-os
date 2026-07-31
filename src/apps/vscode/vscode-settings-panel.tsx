import type { ComponentChildren } from 'preact'
import { useCallback, useMemo, useState } from 'preact/hooks'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { SettingsChoiceField } from '../../ui/settings-choice-field.tsx'
import { SettingsNavRow } from '../../ui/settings-nav-row.tsx'
import { SettingsStepperRow } from '../../ui/settings-stepper-row.tsx'
import { SettingsSwitchRow } from '../../ui/settings-switch-row.tsx'
import {
  KeychainNavStack,
  useKeychainNavStack,
} from '../keychain/keychain-nav-stack.tsx'
import { SettingsChoicePickerView } from '../settings/settings-choice-picker-view.tsx'
import { VscodeAiModelPicker } from './vscode-ai-model-picker.tsx'
import {
  decodeVscodeModelPickerValue,
  encodeVscodeModelPickerValue,
  labelForVscodeModelPickerValue,
  labelForVscodeModelSource,
  useVscodeAiCapabilityTags,
  useVscodeAiTextModels,
} from './vscode-ai-models.ts'
import type {
  VscodeCustomSubAgent,
  VscodeModelSource,
  VscodePrefs,
  VscodeSubAgentBuiltinOverride,
} from './vscode-prefs.ts'
import '../../ui/ios-nav-back.css'
import '../settings/settings.css'
import '../keychain/keychain.css'

export const VSCODE_THEME_OPTIONS = [
  { id: 'vs-dark', label: '深色' },
  { id: 'vs', label: '浅色' },
  { id: 'hc-black', label: '高对比' },
  { id: 'dark-plus', label: '深色+' },
  { id: 'light-plus', label: '浅色+' },
  { id: 'dark-modern', label: '现代深色' },
  { id: 'light-modern', label: '现代浅色' },
] as const

type VscodeSettingsScreen =
  | 'root'
  | 'theme'
  | 'completion'
  | 'agent'
  | 'subagent'
  | 'subagent-explore'
  | 'subagent-general'
  | 'subagent-custom'

type VscodeSettingsPanelProps = {
  prefs: VscodePrefs
  dark?: boolean
  onChange: (patch: Partial<VscodePrefs>) => void
}

function themeLabel(theme: VscodePrefs['theme']): string {
  return VSCODE_THEME_OPTIONS.find((item) => item.id === theme)?.label ?? theme
}

function SettingsAiModelNavRow({
  label,
  value,
  models,
  onChange,
  aiModelOptions,
  onAiModelOptionsChange,
  capabilityTags,
  selectionMode = 'agent',
  disabled,
  dark,
}: {
  label: string
  value: string
  models: ReturnType<typeof useVscodeAiTextModels>
  onChange: (modelKey: string) => void
  aiModelOptions: VscodePrefs['aiModelOptions']
  onAiModelOptionsChange: (next: VscodePrefs['aiModelOptions']) => void
  capabilityTags?: ReturnType<typeof useVscodeAiCapabilityTags>
  selectionMode?: 'agent' | 'completion'
  disabled?: boolean
  dark?: boolean
}) {
  return (
    <VscodeAiModelPicker
      label={label}
      ariaLabel={label}
      value={value}
      models={models}
      onChange={onChange}
      aiModelOptions={aiModelOptions}
      onAiModelOptionsChange={onAiModelOptionsChange}
      capabilityTags={capabilityTags}
      selectionMode={selectionMode}
      disabled={disabled}
      dark={dark}
    >
      {({ open, setOpen, triggerRef, displayValue, disabled: triggerDisabled }) => (
        <SettingsNavRow
          rowRef={triggerRef}
          label={label}
          value={displayValue}
          disabled={triggerDisabled}
          onClick={() => setOpen(!open)}
        />
      )}
    </VscodeAiModelPicker>
  )
}

function slugifySubAgentId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function SettingsPageShell({
  title,
  backLabel,
  onBack,
  trailing,
  children,
}: {
  title: string
  backLabel?: string
  onBack?: () => void
  trailing?: ComponentChildren
  children: ComponentChildren
}) {
  return (
    <>
      <div class="settings__nav settings__nav--titled">
        <div class="settings__nav-bar">
          {onBack ? (
            <IosNavBackButton label={backLabel ?? '设置'} onClick={onBack} />
          ) : (
            <span class="settings__nav-heading-spacer" aria-hidden="true" />
          )}
          <h1 class="settings__nav-heading">{title}</h1>
          {trailing ?? <span class="settings__nav-trailing" aria-hidden="true" />}
        </div>
      </div>
      <div class="settings__content settings__content--compact">{children}</div>
    </>
  )
}

function builtinSummary(
  override: VscodeSubAgentBuiltinOverride | undefined,
  allowInheritParent?: boolean,
): string {
  if (override?.enabled === false) return '已禁用'
  if (allowInheritParent && !override?.modelSource) return '跟随主 Agent'
  return labelForVscodeModelSource(
    override?.modelSource ?? (allowInheritParent ? 'text' : 'text-secondary'),
    override?.modelKey,
  )
}

function BuiltinSubAgentPage({
  override,
  allowInheritParent,
  dark,
  aiModelOptions,
  onAiModelOptionsChange,
  onChange,
}: {
  label: string
  override: VscodeSubAgentBuiltinOverride | undefined
  allowInheritParent?: boolean
  dark?: boolean
  aiModelOptions: VscodePrefs['aiModelOptions']
  onAiModelOptionsChange: (next: VscodePrefs['aiModelOptions']) => void
  onChange: (next: VscodeSubAgentBuiltinOverride | undefined) => void
}) {
  const textModels = useVscodeAiTextModels()
  const capabilityTags = useVscodeAiCapabilityTags()
  const inheritParent = Boolean(allowInheritParent) && !override?.modelSource
  const pickerValue = inheritParent
    ? ''
    : encodeVscodeModelPickerValue(
        override?.modelSource ?? (allowInheritParent ? 'custom' : 'text-secondary'),
        override?.modelKey,
      )

  return (
    <div class="settings__list">
      <SettingsSwitchRow
        label="启用"
        checked={override?.enabled !== false}
        onChange={(checked) => {
          onChange({
            ...override,
            enabled: checked,
          })
        }}
      />
      {allowInheritParent ? (
        <SettingsSwitchRow
          label="跟随主 Agent 模型"
          checked={inheritParent}
          onChange={(checked) => {
            if (checked) {
              onChange({
                enabled: override?.enabled,
              })
              return
            }
            onChange({
              ...override,
              modelSource: 'text',
            })
          }}
        />
      ) : undefined}
      {!inheritParent ? (
        <SettingsAiModelNavRow
          label="模型"
          selectionMode="agent"
          value={
            pickerValue ||
            encodeVscodeModelPickerValue(
              allowInheritParent ? 'text' : 'text-secondary',
              override?.modelKey,
            )
          }
          models={textModels}
          onChange={(encoded) => {
            const decoded = decodeVscodeModelPickerValue(encoded)
            onChange({
              ...override,
              modelSource: decoded.source,
              modelKey:
                decoded.source === 'custom' ? decoded.modelKey : override?.modelKey,
            })
          }}
          aiModelOptions={aiModelOptions}
          onAiModelOptionsChange={onAiModelOptionsChange}
          capabilityTags={capabilityTags}
          disabled={textModels.length === 0}
          dark={dark}
        />
      ) : undefined}
    </div>
  )
}

export function VscodeSettingsPanel({
  prefs,
  dark,
  onChange,
}: VscodeSettingsPanelProps) {
  const textModels = useVscodeAiTextModels()
  const capabilityTags = useVscodeAiCapabilityTags()
  const {
    page: screen,
    stack,
    transition,
    queuedTransition,
    commitQueuedTransition,
    navigate,
    handleMotionEnd,
  } = useKeychainNavStack<VscodeSettingsScreen>('root')

  const [draftId, setDraftId] = useState('')
  const [draftDescription, setDraftDescription] = useState('')
  const [draftPrompt, setDraftPrompt] = useState('')
  const [draftAccess, setDraftAccess] = useState<'readonly' | 'full'>('readonly')
  const [draftModelSource, setDraftModelSource] =
    useState<VscodeModelSource>('text-secondary')
  const [draftModelKey, setDraftModelKey] = useState<string | undefined>()
  const [formError, setFormError] = useState<string | undefined>()
  const [editingId, setEditingId] = useState<string | undefined>()

  const reservedIds = useMemo(() => {
    const set = new Set(['explore', 'general'])
    for (const agent of prefs.customSubAgents) {
      if (agent.id !== editingId) set.add(agent.id)
    }
    return set
  }, [editingId, prefs.customSubAgents])

  const resetDraft = useCallback(() => {
    setDraftId('')
    setDraftDescription('')
    setDraftPrompt('')
    setDraftAccess('readonly')
    setDraftModelSource('text-secondary')
    setDraftModelKey(undefined)
    setFormError(undefined)
    setEditingId(undefined)
  }, [])

  const openCustomForm = useCallback(
    (agent?: VscodeCustomSubAgent) => {
      if (agent) {
        setEditingId(agent.id)
        setDraftId(agent.id)
        setDraftDescription(agent.description)
        setDraftPrompt(agent.prompt)
        setDraftAccess(agent.access)
        setDraftModelSource(agent.modelSource ?? 'text-secondary')
        setDraftModelKey(agent.modelKey)
        setFormError(undefined)
      } else {
        resetDraft()
      }
      navigate('subagent-custom', 'push')
    },
    [navigate, resetDraft],
  )

  const popToSubagent = useCallback(() => {
    navigate('subagent', 'pop', resetDraft)
  }, [navigate, resetDraft])

  const saveCustom = useCallback(() => {
    const id = slugifySubAgentId(draftId)
    if (!id) {
      setFormError('请填写有效 id（字母数字、连字符）')
      return
    }
    if (reservedIds.has(id) && id !== editingId) {
      setFormError(`id「${id}」已占用（不可与内置或其他自定义重名）`)
      return
    }
    if (!draftPrompt.trim()) {
      setFormError('请填写 prompt')
      return
    }
    const nextAgent: VscodeCustomSubAgent = {
      id,
      description: draftDescription.trim() || id,
      prompt: draftPrompt,
      access: draftAccess,
      enabled: true,
      modelSource: draftModelSource,
      modelKey: draftModelSource === 'custom' ? draftModelKey : undefined,
    }
    const without = prefs.customSubAgents.filter(
      (item) => item.id !== editingId && item.id !== id,
    )
    onChange({ customSubAgents: [...without, nextAgent] })
    popToSubagent()
  }, [
    draftAccess,
    draftDescription,
    draftId,
    draftModelKey,
    draftModelSource,
    draftPrompt,
    editingId,
    onChange,
    popToSubagent,
    prefs.customSubAgents,
    reservedIds,
  ])

  const patchBuiltin = useCallback(
    (id: 'explore' | 'general', next: VscodeSubAgentBuiltinOverride | undefined) => {
      onChange({
        subAgentBuiltinOverrides: {
          ...prefs.subAgentBuiltinOverrides,
          [id]: next,
        },
      })
    },
    [onChange, prefs.subAgentBuiltinOverrides],
  )

  const completionSummary = prefs.completionEnabled
    ? labelForVscodeModelPickerValue(
        encodeVscodeModelPickerValue(
          prefs.completionModelSource,
          prefs.completionModelKey,
        ),
      )
    : '已关闭'
  const agentSummary = `重试 ${prefs.aiIdleRetryCount}`
  const subAgentSummary = prefs.subAgentsEnabled
    ? `已开启 · 并发 ${prefs.subAgentsMaxConcurrent}`
    : '已关闭'

  const renderPage = (target: VscodeSettingsScreen) => {
    if (target === 'root') {
      return (
        <SettingsPageShell title="设置">
          <section class="settings__section">
            <h2 class="settings__section-title">外观</h2>
            <div class="settings__list">
              <SettingsNavRow
                label="主题"
                value={themeLabel(prefs.theme)}
                onClick={() => navigate('theme', 'push')}
              />
              <SettingsStepperRow
                label="字号"
                value={prefs.fontSize}
                min={10}
                max={24}
                onChange={(fontSize) => onChange({ fontSize })}
              />
            </div>
          </section>

          <section class="settings__section">
            <h2 class="settings__section-title">AI</h2>
            <div class="settings__list">
              <SettingsNavRow
                label="代码补全"
                value={completionSummary}
                onClick={() => navigate('completion', 'push')}
              />
              <SettingsNavRow
                label="Agent"
                value={agentSummary}
                onClick={() => navigate('agent', 'push')}
              />
              <SettingsNavRow
                label="Sub Agent"
                value={subAgentSummary}
                onClick={() => navigate('subagent', 'push')}
              />
            </div>
          </section>

          <section class="settings__section">
            <h2 class="settings__section-title">编辑</h2>
            <div class="settings__list">
              <SettingsSwitchRow
                label="小地图"
                checked={prefs.minimap}
                onChange={(minimap) => onChange({ minimap })}
              />
              <SettingsSwitchRow
                label="自动换行"
                checked={prefs.wordWrap}
                onChange={(wordWrap) => onChange({ wordWrap })}
              />
            </div>
          </section>
        </SettingsPageShell>
      )
    }

    if (target === 'theme') {
      return (
        <SettingsChoicePickerView
          title="主题"
          backLabel="设置"
          titleInNav
          options={VSCODE_THEME_OPTIONS}
          value={prefs.theme}
          onChange={(value) =>
            onChange({ theme: value as VscodePrefs['theme'] })
          }
          onBack={() => navigate('root', 'pop')}
        />
      )
    }

    if (target === 'completion') {
      return (
        <SettingsPageShell
          title="代码补全"
          onBack={() => navigate('root', 'pop')}
        >
          <section class="settings__section">
            <div class="settings__list">
              <SettingsSwitchRow
                label="启用代码补全"
                checked={prefs.completionEnabled}
                onChange={(completionEnabled) => onChange({ completionEnabled })}
              />
              {prefs.completionEnabled ? (
                <SettingsAiModelNavRow
                  label="补全模型"
                  selectionMode="completion"
                  value={encodeVscodeModelPickerValue(
                    prefs.completionModelSource,
                    prefs.completionModelKey,
                  )}
                  models={textModels}
                  onChange={(encoded) => {
                    const decoded = decodeVscodeModelPickerValue(encoded)
                    onChange({
                      completionModelSource: decoded.source,
                      completionModelKey:
                        decoded.source === 'custom'
                          ? decoded.modelKey
                          : prefs.completionModelKey,
                    })
                  }}
                  aiModelOptions={prefs.aiModelOptions}
                  onAiModelOptionsChange={(aiModelOptions) =>
                    onChange({ aiModelOptions })
                  }
                  capabilityTags={capabilityTags}
                  disabled={textModels.length === 0}
                  dark={dark}
                />
              ) : undefined}
            </div>
          </section>
        </SettingsPageShell>
      )
    }

    if (target === 'agent') {
      return (
        <SettingsPageShell
          title="Agent"
          onBack={() => navigate('root', 'pop')}
        >
          <section class="settings__section">
            <div class="settings__list">
              <SettingsStepperRow
                label="空闲重试次数"
                value={prefs.aiIdleRetryCount}
                min={0}
                max={50}
                onChange={(aiIdleRetryCount) => onChange({ aiIdleRetryCount })}
              />
            </div>
            <p class="settings__section-footnote">
              流式响应空闲超时后的额外重试次数（不含首次）。0 表示超时后不重试。
            </p>
          </section>
        </SettingsPageShell>
      )
    }

    if (target === 'subagent') {
      return (
        <SettingsPageShell
          title="Sub Agent"
          onBack={() => navigate('root', 'pop')}
          trailing={
            prefs.subAgentsEnabled ? (
              <div class="settings__nav-trailing">
                <button
                  type="button"
                  class="settings__btn settings__btn--plain"
                  onClick={() => openCustomForm()}
                >
                  添加
                </button>
              </div>
            ) : undefined
          }
        >
          <section class="settings__section">
            <div class="settings__list">
              <SettingsSwitchRow
                label="启用 Sub Agent"
                checked={prefs.subAgentsEnabled}
                onChange={(subAgentsEnabled) => onChange({ subAgentsEnabled })}
              />
              {prefs.subAgentsEnabled ? (
                <SettingsStepperRow
                  label="并发上限"
                  value={prefs.subAgentsMaxConcurrent}
                  min={1}
                  max={20}
                  onChange={(subAgentsMaxConcurrent) =>
                    onChange({ subAgentsMaxConcurrent })
                  }
                />
              ) : undefined}
            </div>
          </section>

          {prefs.subAgentsEnabled ? (
            <>
              <section class="settings__section">
                <h2 class="settings__section-title">内置</h2>
                <div class="settings__list">
                  <SettingsNavRow
                    label="Explore"
                    value={builtinSummary(prefs.subAgentBuiltinOverrides.explore)}
                    onClick={() => navigate('subagent-explore', 'push')}
                  />
                  <SettingsNavRow
                    label="General"
                    value={builtinSummary(
                      prefs.subAgentBuiltinOverrides.general,
                      true,
                    )}
                    onClick={() => navigate('subagent-general', 'push')}
                  />
                </div>
              </section>

              <section class="settings__section">
                <h2 class="settings__section-title">自定义</h2>
                {prefs.customSubAgents.length === 0 ? (
                  <p class="settings__section-footnote" style={{ marginTop: 0 }}>
                    暂无自定义 Sub Agent。点右上角「添加」创建。
                  </p>
                ) : (
                  <div class="settings__list">
                    {prefs.customSubAgents.map((agent) => (
                      <SettingsNavRow
                        key={agent.id}
                        label={agent.id}
                        value={
                          agent.enabled === false
                            ? '已禁用'
                            : agent.access === 'readonly'
                              ? '只读'
                              : '可读写'
                        }
                        onClick={() => openCustomForm(agent)}
                      />
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : undefined}
        </SettingsPageShell>
      )
    }

    if (target === 'subagent-explore') {
      return (
        <SettingsPageShell
          title="Explore"
          backLabel="Sub Agent"
          onBack={() => navigate('subagent', 'pop')}
        >
          <section class="settings__section">
            <BuiltinSubAgentPage
              label="Explore"
              override={prefs.subAgentBuiltinOverrides.explore}
              dark={dark}
              aiModelOptions={prefs.aiModelOptions}
              onAiModelOptionsChange={(aiModelOptions) =>
                onChange({ aiModelOptions })
              }
              onChange={(next) => patchBuiltin('explore', next)}
            />
          </section>
        </SettingsPageShell>
      )
    }

    if (target === 'subagent-general') {
      return (
        <SettingsPageShell
          title="General"
          backLabel="Sub Agent"
          onBack={() => navigate('subagent', 'pop')}
        >
          <section class="settings__section">
            <BuiltinSubAgentPage
              label="General"
              override={prefs.subAgentBuiltinOverrides.general}
              allowInheritParent
              dark={dark}
              aiModelOptions={prefs.aiModelOptions}
              onAiModelOptionsChange={(aiModelOptions) =>
                onChange({ aiModelOptions })
              }
              onChange={(next) => patchBuiltin('general', next)}
            />
          </section>
        </SettingsPageShell>
      )
    }

    if (target === 'subagent-custom') {
      return (
        <SettingsPageShell
          title={editingId ? `编辑「${editingId}」` : '添加 Sub Agent'}
          backLabel="Sub Agent"
          onBack={popToSubagent}
          trailing={
            <div class="settings__nav-trailing">
              <button
                type="button"
                class="settings__btn settings__btn--default"
                onClick={saveCustom}
              >
                保存
              </button>
            </div>
          }
        >
          <section class="settings__section">
            <div class="settings__list">
              <label class="settings__row settings__row--static settings__row--inline-input">
                <span class="settings__row-name">id</span>
                <input
                  class="settings__input settings__input--list"
                  type="text"
                  value={draftId}
                  disabled={Boolean(editingId)}
                  placeholder="例如 reviewer"
                  onInput={(event) =>
                    setDraftId((event.target as HTMLInputElement).value)
                  }
                />
              </label>
              <label class="settings__row settings__row--static settings__row--inline-input">
                <span class="settings__row-name">描述</span>
                <input
                  class="settings__input settings__input--list"
                  type="text"
                  value={draftDescription}
                  placeholder="父 Agent 据此决定何时委派"
                  onInput={(event) =>
                    setDraftDescription((event.target as HTMLInputElement).value)
                  }
                />
              </label>
              <SettingsChoiceField
                label="权限"
                value={draftAccess}
                options={[
                  { id: 'readonly', label: '只读' },
                  { id: 'full', label: '可读写' },
                ]}
                onChange={(value) =>
                  setDraftAccess(value === 'readonly' ? 'readonly' : 'full')
                }
                wideLayout
                dark={dark}
              />
              {editingId ? (
                <SettingsSwitchRow
                  label="启用"
                  checked={
                    prefs.customSubAgents.find((item) => item.id === editingId)
                      ?.enabled !== false
                  }
                  onChange={(checked) => {
                    onChange({
                      customSubAgents: prefs.customSubAgents.map((item) =>
                        item.id === editingId
                          ? { ...item, enabled: checked }
                          : item,
                      ),
                    })
                  }}
                />
              ) : undefined}
            </div>
          </section>

          <section class="settings__section">
            <h2 class="settings__section-title">Prompt</h2>
            <textarea
              class="vscode__settings-textarea"
              rows={6}
              value={draftPrompt}
              placeholder="子 Agent 的系统提示词"
              onInput={(event) =>
                setDraftPrompt((event.target as HTMLTextAreaElement).value)
              }
            />
          </section>

          <section class="settings__section">
            <div class="settings__list">
              <SettingsAiModelNavRow
                label="模型"
                selectionMode="agent"
                value={encodeVscodeModelPickerValue(draftModelSource, draftModelKey)}
                models={textModels}
                onChange={(encoded) => {
                  const decoded = decodeVscodeModelPickerValue(encoded)
                  setDraftModelSource(decoded.source)
                  if (decoded.source === 'custom') {
                    setDraftModelKey(decoded.modelKey)
                  }
                }}
                aiModelOptions={prefs.aiModelOptions}
                onAiModelOptionsChange={(aiModelOptions) =>
                  onChange({ aiModelOptions })
                }
                capabilityTags={capabilityTags}
                disabled={textModels.length === 0}
                dark={dark}
              />
            </div>
            {formError ? (
              <p class="settings__section-footnote settings__form-status--error">
                {formError}
              </p>
            ) : undefined}
          </section>

          {editingId ? (
            <section class="settings__section">
              <div class="settings__actions settings__actions--form">
                <button
                  type="button"
                  class="settings__btn settings__btn--danger"
                  onClick={() => {
                    onChange({
                      customSubAgents: prefs.customSubAgents.filter(
                        (item) => item.id !== editingId,
                      ),
                    })
                    popToSubagent()
                  }}
                >
                  删除
                </button>
              </div>
            </section>
          ) : undefined}
        </SettingsPageShell>
      )
    }

    return null
  }

  return (
    <div class="vscode__settings">
      <KeychainNavStack
        stack={stack}
        page={screen}
        transition={transition}
        queuedTransition={queuedTransition}
        commitQueuedTransition={commitQueuedTransition}
        onMotionEnd={handleMotionEnd}
        renderPage={renderPage}
        settingsClassName={dark ? 'settings--dark' : undefined}
      />
    </div>
  )
}
