import type { ComponentChildren } from 'preact'
import { useCallback, useMemo, useState } from 'preact/hooks'
import { PlusIcon } from '../../icons/app-icons.tsx'
import { Page } from '../../ui/page.tsx'
import { PageHeader } from '../../ui/page-header.tsx'
import { PageStack, usePageStack } from '../../ui/page-stack.tsx'
import { SettingsChoiceField } from '../../ui/settings-choice-field.tsx'
import { SettingsNavRow } from '../../ui/settings-nav-row.tsx'
import { SettingsStepperRow } from '../../ui/settings-stepper-row.tsx'
import { SettingsSwitchRow } from '../../ui/settings-switch-row.tsx'
import { SettingsChoicePickerView } from '../settings/settings-choice-picker-view.tsx'
import { labelForVscodeModelPickerDisplay } from './vscode-ai-model-picker-data.ts'
import {
  decodeVscodeModelPickerValue,
  encodeVscodeModelPickerValue,
  formatVscodeAiModelRefKey,
  labelForVscodeModelSource,
  resolveVscodeAiContextWindowPrefForModelKey,
  resolveVscodeAiThinkingEffortPrefForModelKey,
  resolveVscodeCapabilityPickerModelKey,
  useVscodeAiTextModels,
  listVscodeAiVisionModels,
} from './vscode-ai-models.ts'
import {
  applySettingsModelContextChange,
  applySettingsModelThinkingChange,
  listSettingsModelContextOptions,
  listSettingsModelThinkingOptions,
  summaryForSettingsModelConfig,
  VscodeSettingsModelChoiceView,
  VscodeSettingsModelOptionsView,
  VscodeSettingsModelPickerView,
} from './vscode-settings-model-picker-view.tsx'
import type {
  VscodeCustomSubAgent,
  VscodeModelSource,
  VscodePrefs,
  VscodeSubAgentBuiltinOverride,
  VscodeSubAgentModelSource,
} from './vscode-prefs.ts'
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
  | 'subagent-vision'
  | 'subagent-custom'
  | 'model-picker'
  | 'model-options'
  | 'model-context'
  | 'model-thinking'

type ModelPickerSession = {
  back: Exclude<
    VscodeSettingsScreen,
    'model-picker' | 'model-options' | 'model-context' | 'model-thinking'
  >
  backLabel: string
  title: string
  selectionMode: 'agent' | 'completion' | 'vision'
  target:
    | { kind: 'completion' }
    | { kind: 'builtin'; id: 'explore' | 'general' | 'vision' }
    | { kind: 'custom' }
  editModelKey?: string
}

type VscodeSettingsPanelProps = {
  prefs: VscodePrefs
  dark?: boolean
  onChange: (patch: Partial<VscodePrefs>) => void
}

function themeLabel(theme: VscodePrefs['theme']): string {
  return VSCODE_THEME_OPTIONS.find((item) => item.id === theme)?.label ?? theme
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
    <Page
      header={
        <PageHeader
          title={title}
          backLabel={onBack ? (backLabel ?? '设置') : undefined}
          onBack={onBack}
          actions={trailing}
        />
      }
    >
      <div class="settings__content settings__content--compact">{children}</div>
    </Page>
  )
}

function builtinSummary(
  override: VscodeSubAgentBuiltinOverride | undefined,
  allowInheritParent?: boolean,
  defaultSource: VscodeSubAgentModelSource = 'text-secondary',
): string {
  if (override?.enabled === false) return '已禁用'
  if (allowInheritParent && !override?.modelSource) return '跟随主 Agent'
  return labelForVscodeModelSource(
    override?.modelSource ?? (allowInheritParent ? 'text' : defaultSource),
    override?.modelKey,
  )
}

function BuiltinSubAgentPage({
  override,
  allowInheritParent,
  modelDisabled,
  modelDisplay,
  modelConfigSummary,
  onOpenModelPicker,
  onOpenModelConfig,
  onChange,
}: {
  override: VscodeSubAgentBuiltinOverride | undefined
  allowInheritParent?: boolean
  modelDisabled?: boolean
  modelDisplay: string
  modelConfigSummary?: string
  onOpenModelPicker: () => void
  onOpenModelConfig?: () => void
  onChange: (next: VscodeSubAgentBuiltinOverride | undefined) => void
}) {
  const inheritParent = Boolean(allowInheritParent) && !override?.modelSource

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
        <>
          <SettingsNavRow
            label="模型"
            value={modelDisplay}
            disabled={modelDisabled}
            onClick={onOpenModelPicker}
          />
          {onOpenModelConfig ? (
            <SettingsNavRow
              label="配置"
              value={modelConfigSummary ?? ''}
              onClick={onOpenModelConfig}
            />
          ) : undefined}
        </>
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
  const visionModels = useMemo(() => listVscodeAiVisionModels(), [textModels])
  const {
    page: screen,
    stack,
    transition,
    navigate,
    handleMotionEnd,
  } = usePageStack<VscodeSettingsScreen>('root')

  const [draftId, setDraftId] = useState('')
  const [draftDescription, setDraftDescription] = useState('')
  const [draftPrompt, setDraftPrompt] = useState('')
  const [draftAccess, setDraftAccess] = useState<'readonly' | 'full'>('readonly')
  const [draftModelSource, setDraftModelSource] =
    useState<VscodeModelSource>('text-secondary')
  const [draftModelKey, setDraftModelKey] = useState<string | undefined>()
  const [formError, setFormError] = useState<string | undefined>()
  const [editingId, setEditingId] = useState<string | undefined>()
  const [modelPickerSession, setModelPickerSession] = useState<
    ModelPickerSession | undefined
  >()

  const reservedIds = useMemo(() => {
    const set = new Set(['explore', 'general', 'vision'])
    for (const agent of prefs.customSubAgents) {
      if (agent.id !== editingId) set.add(agent.id)
    }
    return set
  }, [editingId, prefs.customSubAgents])

  const openModelPicker = useCallback(
    (session: ModelPickerSession) => {
      setModelPickerSession(session)
      navigate('model-picker', 'push')
    },
    [navigate],
  )

  const openModelConfig = useCallback(
    (session: ModelPickerSession & { editModelKey: string }) => {
      setModelPickerSession(session)
      navigate('model-options', 'push')
    },
    [navigate],
  )

  const modelPickerValue = useMemo(() => {
    if (!modelPickerSession) return ''
    const { target } = modelPickerSession
    if (target.kind === 'completion') {
      return encodeVscodeModelPickerValue(
        prefs.completionModelSource,
        prefs.completionModelKey,
      )
    }
    if (target.kind === 'custom') {
      return encodeVscodeModelPickerValue(draftModelSource, draftModelKey)
    }
    const override = prefs.subAgentBuiltinOverrides[target.id]
    const allowInherit = target.id === 'general'
    if (allowInherit && !override?.modelSource) {
      return encodeVscodeModelPickerValue('text')
    }
    const defaultSource =
      target.id === 'vision'
        ? 'vision'
        : allowInherit
          ? 'text'
          : 'text-secondary'
    return encodeVscodeModelPickerValue(
      override?.modelSource ?? defaultSource,
      override?.modelKey,
    )
  }, [
    draftModelKey,
    draftModelSource,
    modelPickerSession,
    prefs.completionModelKey,
    prefs.completionModelSource,
    prefs.subAgentBuiltinOverrides,
  ])

  const applyModelPickerValue = useCallback(
    (encoded: string) => {
      if (!modelPickerSession) return
      const decoded = decodeVscodeModelPickerValue(encoded)
      const { target } = modelPickerSession
      if (target.kind === 'completion') {
        if (decoded.source === 'vision') return
        onChange({
          completionModelSource: decoded.source,
          completionModelKey:
            decoded.source === 'custom'
              ? decoded.modelKey
              : prefs.completionModelKey,
        })
        return
      }
      if (target.kind === 'custom') {
        if (decoded.source === 'vision') return
        setDraftModelSource(decoded.source)
        if (decoded.source === 'custom') {
          setDraftModelKey(decoded.modelKey)
        }
        return
      }
      const override = prefs.subAgentBuiltinOverrides[target.id]
      onChange({
        subAgentBuiltinOverrides: {
          ...prefs.subAgentBuiltinOverrides,
          [target.id]: {
            ...override,
            modelSource: decoded.source,
            modelKey:
              decoded.source === 'custom' ? decoded.modelKey : override?.modelKey,
          },
        },
      })
    },
    [modelPickerSession, onChange, prefs.completionModelKey, prefs.subAgentBuiltinOverrides],
  )

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
    (
      id: 'explore' | 'general' | 'vision',
      next: VscodeSubAgentBuiltinOverride | undefined,
    ) => {
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
    ? labelForVscodeModelPickerDisplay(
        encodeVscodeModelPickerValue(
          prefs.completionModelSource,
          prefs.completionModelKey,
        ),
        textModels,
        'completion',
      )
    : '已关闭'
  const agentSummary = [
    `${prefs.aiIdleTimeoutSeconds}s · 重试 ${prefs.aiIdleRetryCount}`,
    prefs.aiPlayCompletionSound ? '完成提示音' : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
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
        <div class="page keychain__picker-page">
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
        </div>
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
                <>
                  <SettingsNavRow
                    label="补全模型"
                    value={labelForVscodeModelPickerDisplay(
                      encodeVscodeModelPickerValue(
                        prefs.completionModelSource,
                        prefs.completionModelKey,
                      ),
                      textModels,
                      'completion',
                    )}
                    disabled={textModels.length === 0}
                    onClick={() =>
                      openModelPicker({
                        back: 'completion',
                        backLabel: '代码补全',
                        title: '补全模型',
                        selectionMode: 'completion',
                        target: { kind: 'completion' },
                      })
                    }
                  />
                  {(() => {
                    const encoded = encodeVscodeModelPickerValue(
                      prefs.completionModelSource,
                      prefs.completionModelKey,
                    )
                    const editKey =
                      resolveVscodeCapabilityPickerModelKey(encoded)
                    if (!editKey) return undefined
                    return (
                      <SettingsNavRow
                        label="配置"
                        value={
                          summaryForSettingsModelConfig(
                            encoded,
                            textModels,
                            prefs.aiModelOptions,
                          ) ?? ''
                        }
                        onClick={() =>
                          openModelConfig({
                            back: 'completion',
                            backLabel: '代码补全',
                            title: '补全模型',
                            selectionMode: 'completion',
                            target: { kind: 'completion' },
                            editModelKey: editKey,
                          })
                        }
                      />
                    )
                  })()}
                </>
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
                label="空闲超时"
                value={prefs.aiIdleTimeoutSeconds}
                min={5}
                max={600}
                unit="秒"
                onChange={(aiIdleTimeoutSeconds) => onChange({ aiIdleTimeoutSeconds })}
              />
              <SettingsStepperRow
                label="空闲重试次数"
                value={prefs.aiIdleRetryCount}
                min={0}
                max={50}
                onChange={(aiIdleRetryCount) => onChange({ aiIdleRetryCount })}
              />
              <SettingsSwitchRow
                label="完成时播放提示音"
                checked={prefs.aiPlayCompletionSound}
                onChange={(aiPlayCompletionSound) => onChange({ aiPlayCompletionSound })}
              />
            </div>
            <p class="settings__section-footnote">
              流式响应多久无新数据视为空闲超时（最短 5 秒）。超时后的额外重试次数不含首次；0
              表示超时后不重试。完成提示音仅在本轮结束且发送队列为空时播放；用户中止或还有排队任务时不播放。
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
                  class="settings__btn settings__btn--plain settings__btn--icon"
                  aria-label="添加"
                  title="添加"
                  onClick={() => openCustomForm()}
                >
                  <PlusIcon />
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
                  <SettingsNavRow
                    label="Vision"
                    value={
                      visionModels.length === 0
                        ? '无可用视觉模型'
                        : builtinSummary(
                            prefs.subAgentBuiltinOverrides.vision,
                            false,
                            'vision',
                          )
                    }
                    onClick={() => navigate('subagent-vision', 'push')}
                  />
                </div>
              </section>

              <section class="settings__section">
                <h2 class="settings__section-title">自定义</h2>
                {prefs.customSubAgents.length === 0 ? (
                  <p class="settings__section-footnote" style={{ marginTop: 0 }}>
                    暂无自定义 Sub Agent。点右上角「+」创建。
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
      const exploreEncoded = encodeVscodeModelPickerValue(
        prefs.subAgentBuiltinOverrides.explore?.modelSource ?? 'text-secondary',
        prefs.subAgentBuiltinOverrides.explore?.modelKey,
      )
      const exploreEditKey =
        resolveVscodeCapabilityPickerModelKey(exploreEncoded)
      return (
        <SettingsPageShell
          title="Explore"
          backLabel="Sub Agent"
          onBack={() => navigate('subagent', 'pop')}
        >
          <section class="settings__section">
            <BuiltinSubAgentPage
              override={prefs.subAgentBuiltinOverrides.explore}
              modelDisabled={textModels.length === 0}
              modelDisplay={labelForVscodeModelPickerDisplay(
                exploreEncoded,
                textModels,
                'agent',
              )}
              modelConfigSummary={summaryForSettingsModelConfig(
                exploreEncoded,
                textModels,
                prefs.aiModelOptions,
              )}
              onOpenModelPicker={() =>
                openModelPicker({
                  back: 'subagent-explore',
                  backLabel: 'Explore',
                  title: '模型',
                  selectionMode: 'agent',
                  target: { kind: 'builtin', id: 'explore' },
                })
              }
              onOpenModelConfig={
                exploreEditKey
                  ? () =>
                      openModelConfig({
                        back: 'subagent-explore',
                        backLabel: 'Explore',
                        title: '模型',
                        selectionMode: 'agent',
                        target: { kind: 'builtin', id: 'explore' },
                        editModelKey: exploreEditKey,
                      })
                  : undefined
              }
              onChange={(next) => patchBuiltin('explore', next)}
            />
          </section>
        </SettingsPageShell>
      )
    }

    if (target === 'subagent-general') {
      const generalEncoded = encodeVscodeModelPickerValue(
        prefs.subAgentBuiltinOverrides.general?.modelSource ?? 'text',
        prefs.subAgentBuiltinOverrides.general?.modelKey,
      )
      const generalEditKey =
        resolveVscodeCapabilityPickerModelKey(generalEncoded)
      return (
        <SettingsPageShell
          title="General"
          backLabel="Sub Agent"
          onBack={() => navigate('subagent', 'pop')}
        >
          <section class="settings__section">
            <BuiltinSubAgentPage
              override={prefs.subAgentBuiltinOverrides.general}
              allowInheritParent
              modelDisabled={textModels.length === 0}
              modelDisplay={labelForVscodeModelPickerDisplay(
                generalEncoded,
                textModels,
                'agent',
              )}
              modelConfigSummary={summaryForSettingsModelConfig(
                generalEncoded,
                textModels,
                prefs.aiModelOptions,
              )}
              onOpenModelPicker={() =>
                openModelPicker({
                  back: 'subagent-general',
                  backLabel: 'General',
                  title: '模型',
                  selectionMode: 'agent',
                  target: { kind: 'builtin', id: 'general' },
                })
              }
              onOpenModelConfig={
                generalEditKey
                  ? () =>
                      openModelConfig({
                        back: 'subagent-general',
                        backLabel: 'General',
                        title: '模型',
                        selectionMode: 'agent',
                        target: { kind: 'builtin', id: 'general' },
                        editModelKey: generalEditKey,
                      })
                  : undefined
              }
              onChange={(next) => patchBuiltin('general', next)}
            />
          </section>
        </SettingsPageShell>
      )
    }

    if (target === 'subagent-vision') {
      const visionEncoded = encodeVscodeModelPickerValue(
        prefs.subAgentBuiltinOverrides.vision?.modelSource ?? 'vision',
        prefs.subAgentBuiltinOverrides.vision?.modelKey,
      )
      const visionEditKey =
        resolveVscodeCapabilityPickerModelKey(visionEncoded)
      return (
        <SettingsPageShell
          title="Vision"
          backLabel="Sub Agent"
          onBack={() => navigate('subagent', 'pop')}
        >
          <section class="settings__section">
            <p class="settings__section-footnote" style={{ marginTop: 0 }}>
              专职识图。委派须传 image_paths，由宿主注入图片（无工具）。仅当主模型无视觉且平台有可用视觉模型时可见。
            </p>
            <BuiltinSubAgentPage
              override={prefs.subAgentBuiltinOverrides.vision}
              modelDisabled={visionModels.length === 0}
              modelDisplay={labelForVscodeModelPickerDisplay(
                visionEncoded,
                visionModels,
                'vision',
              )}
              modelConfigSummary={summaryForSettingsModelConfig(
                visionEncoded,
                visionModels,
                prefs.aiModelOptions,
              )}
              onOpenModelPicker={() =>
                openModelPicker({
                  back: 'subagent-vision',
                  backLabel: 'Vision',
                  title: '模型',
                  selectionMode: 'vision',
                  target: { kind: 'builtin', id: 'vision' },
                })
              }
              onOpenModelConfig={
                visionEditKey
                  ? () =>
                      openModelConfig({
                        back: 'subagent-vision',
                        backLabel: 'Vision',
                        title: '模型',
                        selectionMode: 'vision',
                        target: { kind: 'builtin', id: 'vision' },
                        editModelKey: visionEditKey,
                      })
                  : undefined
              }
              onChange={(next) => patchBuiltin('vision', next)}
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
              <SettingsNavRow
                label="模型"
                value={labelForVscodeModelPickerDisplay(
                  encodeVscodeModelPickerValue(draftModelSource, draftModelKey),
                  textModels,
                  'agent',
                )}
                disabled={textModels.length === 0}
                onClick={() =>
                  openModelPicker({
                    back: 'subagent-custom',
                    backLabel: editingId ? `编辑「${editingId}」` : '添加 Sub Agent',
                    title: '模型',
                    selectionMode: 'agent',
                    target: { kind: 'custom' },
                  })
                }
              />
              {(() => {
                const encoded = encodeVscodeModelPickerValue(
                  draftModelSource,
                  draftModelKey,
                )
                const editKey = resolveVscodeCapabilityPickerModelKey(encoded)
                if (!editKey) return undefined
                return (
                  <SettingsNavRow
                    label="配置"
                    value={
                      summaryForSettingsModelConfig(
                        encoded,
                        textModels,
                        prefs.aiModelOptions,
                      ) ?? ''
                    }
                    onClick={() =>
                      openModelConfig({
                        back: 'subagent-custom',
                        backLabel: editingId
                          ? `编辑「${editingId}」`
                          : '添加 Sub Agent',
                        title: '模型',
                        selectionMode: 'agent',
                        target: { kind: 'custom' },
                        editModelKey: editKey,
                      })
                    }
                  />
                )
              })()}
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

    if (target === 'model-picker' && modelPickerSession) {
      const pickerModels =
        modelPickerSession.selectionMode === 'vision' ? visionModels : textModels
      return (
        <VscodeSettingsModelPickerView
          title={modelPickerSession.title}
          backLabel={modelPickerSession.backLabel}
          value={modelPickerValue}
          models={pickerModels}
          selectionMode={modelPickerSession.selectionMode}
          onChange={applyModelPickerValue}
          onBack={() => navigate(modelPickerSession.back, 'pop')}
        />
      )
    }

    if (
      (target === 'model-options' ||
        target === 'model-context' ||
        target === 'model-thinking') &&
      modelPickerSession?.editModelKey
    ) {
      const editModelKey = modelPickerSession.editModelKey
      const editModel = textModels.find(
        (model) =>
          formatVscodeAiModelRefKey({
            providerEntryId: model.providerEntryId,
            modelId: model.modelId,
          }) === editModelKey,
      )

      if (target === 'model-options') {
        return (
          <VscodeSettingsModelOptionsView
            editModelKey={editModelKey}
            backLabel={modelPickerSession.backLabel}
            models={textModels}
            aiModelOptions={prefs.aiModelOptions}
            onAiModelOptionsChange={(aiModelOptions) =>
              onChange({ aiModelOptions })
            }
            onSelectModelKey={(nextKey) => {
              applyModelPickerValue(nextKey)
              setModelPickerSession({
                ...modelPickerSession,
                editModelKey: nextKey,
              })
            }}
            onOpenContext={() => navigate('model-context', 'push')}
            onOpenThinking={() => navigate('model-thinking', 'push')}
            onBack={() => navigate(modelPickerSession.back, 'pop')}
          />
        )
      }

      if (!editModel) {
        return (
          <VscodeSettingsModelOptionsView
            editModelKey={editModelKey}
            backLabel={modelPickerSession.backLabel}
            models={textModels}
            aiModelOptions={prefs.aiModelOptions}
            onAiModelOptionsChange={(aiModelOptions) =>
              onChange({ aiModelOptions })
            }
            onSelectModelKey={() => undefined}
            onOpenContext={() => undefined}
            onOpenThinking={() => undefined}
            onBack={() => navigate(modelPickerSession.back, 'pop')}
          />
        )
      }

      if (target === 'model-context') {
        const current = resolveVscodeAiContextWindowPrefForModelKey(
          editModelKey,
          prefs.aiModelOptions,
        )
        return (
          <VscodeSettingsModelChoiceView
            title="上下文长度"
            options={listSettingsModelContextOptions(
              editModel,
              prefs.aiModelOptions,
            )}
            value={String(current)}
            onChange={(raw) => {
              onChange({
                aiModelOptions: applySettingsModelContextChange(
                  prefs.aiModelOptions,
                  editModelKey,
                  raw,
                ),
              })
            }}
            onBack={() => navigate('model-options', 'pop')}
          />
        )
      }

      const current = resolveVscodeAiThinkingEffortPrefForModelKey(
        editModelKey,
        prefs.aiModelOptions,
      )
      return (
        <VscodeSettingsModelChoiceView
          title="思考深度"
          options={listSettingsModelThinkingOptions(editModel)}
          value={current}
          onChange={(raw) => {
            onChange({
              aiModelOptions: applySettingsModelThinkingChange(
                prefs.aiModelOptions,
                editModelKey,
                raw,
              ),
            })
          }}
          onBack={() => navigate('model-options', 'pop')}
        />
      )
    }

    return null
  }

  return (
    <div
      class={`settings vscode__settings${dark ? ' settings--dark' : ''}`}
      data-theme={dark ? 'dark' : undefined}
    >
      <PageStack
        stack={stack}
        page={screen}
        transition={transition}
        onMotionEnd={handleMotionEnd}
        renderPage={renderPage}
      />
    </div>
  )
}
