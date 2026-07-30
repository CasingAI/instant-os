import { useMemo, useState } from 'preact/hooks'
import { IosSwitch } from '../../ui/ios-switch.tsx'
import { VscodeAiModelPicker } from './vscode-ai-model-picker.tsx'
import {
  decodeVscodeModelPickerValue,
  encodeVscodeModelPickerValue,
  useVscodeAiCapabilityTags,
  useVscodeAiTextModels,
} from './vscode-ai-models.ts'
import type {
  VscodeCustomSubAgent,
  VscodeModelSource,
  VscodePrefs,
  VscodeSubAgentBuiltinOverride,
} from './vscode-prefs.ts'

function slugifySubAgentId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

type BuiltinModelPickerProps = {
  label: string
  override: VscodeSubAgentBuiltinOverride | undefined
  /** general：无 override.modelSource 表示跟随主 Agent */
  allowInheritParent?: boolean
  dark?: boolean
  aiModelOptions: VscodePrefs['aiModelOptions']
  onAiModelOptionsChange: (next: VscodePrefs['aiModelOptions']) => void
  onChange: (next: VscodeSubAgentBuiltinOverride | undefined) => void
}

function BuiltinSubAgentModelRow({
  label,
  override,
  allowInheritParent,
  dark,
  aiModelOptions,
  onAiModelOptionsChange,
  onChange,
}: BuiltinModelPickerProps) {
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
    <div class="vscode__subagent-block">
      <div class="vscode__setting vscode__setting--row">
        <span>{label}</span>
        <IosSwitch
          checked={override?.enabled !== false}
          onChange={(checked) => {
            onChange({
              ...override,
              enabled: checked,
            })
          }}
          label={label}
        />
      </div>
      {allowInheritParent ? (
        <div class="vscode__setting vscode__setting--row">
          <span>跟随主 Agent 模型</span>
          <IosSwitch
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
            label="跟随主 Agent 模型"
          />
        </div>
      ) : undefined}
      {!inheritParent ? (
        <VscodeAiModelPicker
          label={`${label}模型`}
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
          presentation="form"
          fieldClass="vscode__setting"
          labelClass=""
          dark={dark}
        />
      ) : undefined}
    </div>
  )
}

export type VscodeSubAgentSettingsProps = {
  prefs: Pick<
    VscodePrefs,
    | 'subAgentsEnabled'
    | 'subAgentsMaxConcurrent'
    | 'subAgentBuiltinOverrides'
    | 'customSubAgents'
    | 'aiModelOptions'
  >
  dark?: boolean
  onChange: (patch: Partial<VscodePrefs>) => void
}

export function VscodeSubAgentSettings({
  prefs,
  dark,
  onChange,
}: VscodeSubAgentSettingsProps) {
  const textModels = useVscodeAiTextModels()
  const capabilityTags = useVscodeAiCapabilityTags()
  const [draftId, setDraftId] = useState('')
  const [draftDescription, setDraftDescription] = useState('')
  const [draftPrompt, setDraftPrompt] = useState('')
  const [draftAccess, setDraftAccess] = useState<'readonly' | 'full'>('readonly')
  const [draftModelSource, setDraftModelSource] = useState<VscodeModelSource>('text-secondary')
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

  const resetDraft = () => {
    setDraftId('')
    setDraftDescription('')
    setDraftPrompt('')
    setDraftAccess('readonly')
    setDraftModelSource('text-secondary')
    setDraftModelKey(undefined)
    setFormError(undefined)
    setEditingId(undefined)
  }

  const startEdit = (agent: VscodeCustomSubAgent) => {
    setEditingId(agent.id)
    setDraftId(agent.id)
    setDraftDescription(agent.description)
    setDraftPrompt(agent.prompt)
    setDraftAccess(agent.access)
    setDraftModelSource(agent.modelSource ?? 'text-secondary')
    setDraftModelKey(agent.modelKey)
    setFormError(undefined)
  }

  const saveCustom = () => {
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
    resetDraft()
  }

  const patchBuiltin = (
    id: 'explore' | 'general',
    next: VscodeSubAgentBuiltinOverride | undefined,
  ) => {
    onChange({
      subAgentBuiltinOverrides: {
        ...prefs.subAgentBuiltinOverrides,
        [id]: next,
      },
    })
  }

  return (
    <div class="vscode__subagent-settings">
      <div class="vscode__sidebar-subheader">Sub Agent</div>
      <div class="vscode__setting vscode__setting--row">
        <span>启用 Sub Agent</span>
        <IosSwitch
          checked={prefs.subAgentsEnabled}
          onChange={(checked) => onChange({ subAgentsEnabled: checked })}
          label="启用 Sub Agent"
        />
      </div>
      {prefs.subAgentsEnabled ? (
        <>
          <label class="vscode__setting">
            <span>并发上限</span>
            <input
              type="number"
              min={1}
              max={20}
              value={prefs.subAgentsMaxConcurrent}
              onInput={(event) => {
                const value = Number((event.target as HTMLInputElement).value)
                if (!Number.isFinite(value)) return
                onChange({
                  subAgentsMaxConcurrent: Math.min(20, Math.max(1, Math.round(value))),
                })
              }}
            />
          </label>

          <div class="vscode__sidebar-subheader">内置</div>
          <BuiltinSubAgentModelRow
            label="Explore"
            override={prefs.subAgentBuiltinOverrides.explore}
            dark={dark}
            aiModelOptions={prefs.aiModelOptions}
            onAiModelOptionsChange={(aiModelOptions) => onChange({ aiModelOptions })}
            onChange={(next) => patchBuiltin('explore', next)}
          />
          <BuiltinSubAgentModelRow
            label="General"
            override={prefs.subAgentBuiltinOverrides.general}
            allowInheritParent
            dark={dark}
            aiModelOptions={prefs.aiModelOptions}
            onAiModelOptionsChange={(aiModelOptions) => onChange({ aiModelOptions })}
            onChange={(next) => patchBuiltin('general', next)}
          />

          <div class="vscode__sidebar-subheader">自定义</div>
          {prefs.customSubAgents.length === 0 ? (
            <p class="vscode__subagent-hint">暂无自定义 Sub Agent</p>
          ) : (
            <ul class="vscode__subagent-list">
              {prefs.customSubAgents.map((agent) => (
                <li key={agent.id} class="vscode__subagent-list-item">
                  <div class="vscode__subagent-list-main">
                    <strong>{agent.id}</strong>
                    <span>
                      {agent.access === 'readonly' ? '只读' : '可读写'}
                      {agent.enabled === false ? ' · 已禁用' : ''}
                    </span>
                    <span class="vscode__subagent-list-desc">{agent.description}</span>
                  </div>
                  <div class="vscode__subagent-list-actions">
                    <button
                      type="button"
                      class="vscode__subagent-btn"
                      onClick={() =>
                        onChange({
                          customSubAgents: prefs.customSubAgents.map((item) =>
                            item.id === agent.id
                              ? { ...item, enabled: item.enabled === false }
                              : item,
                          ),
                        })
                      }
                    >
                      {agent.enabled === false ? '启用' : '禁用'}
                    </button>
                    <button
                      type="button"
                      class="vscode__subagent-btn"
                      onClick={() => startEdit(agent)}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      class="vscode__subagent-btn vscode__subagent-btn--danger"
                      onClick={() =>
                        onChange({
                          customSubAgents: prefs.customSubAgents.filter(
                            (item) => item.id !== agent.id,
                          ),
                        })
                      }
                    >
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div class="vscode__subagent-form">
            <div class="vscode__sidebar-subheader">
              {editingId ? `编辑「${editingId}」` : '添加自定义 Sub Agent'}
            </div>
            <label class="vscode__setting">
              <span>id</span>
              <input
                type="text"
                value={draftId}
                disabled={Boolean(editingId)}
                placeholder="例如 reviewer"
                onInput={(event) =>
                  setDraftId((event.target as HTMLInputElement).value)
                }
              />
            </label>
            <label class="vscode__setting">
              <span>描述（路由）</span>
              <input
                type="text"
                value={draftDescription}
                placeholder="父 Agent 据此决定何时委派"
                onInput={(event) =>
                  setDraftDescription((event.target as HTMLInputElement).value)
                }
              />
            </label>
            <label class="vscode__setting">
              <span>权限</span>
              <select
                value={draftAccess}
                onChange={(event) =>
                  setDraftAccess(
                    (event.target as HTMLSelectElement).value === 'readonly'
                      ? 'readonly'
                      : 'full',
                  )
                }
              >
                <option value="readonly">只读</option>
                <option value="full">可读写</option>
              </select>
            </label>
            <label class="vscode__setting">
              <span>Prompt</span>
              <textarea
                class="vscode__subagent-textarea"
                rows={5}
                value={draftPrompt}
                placeholder="子 Agent 的系统提示词"
                onInput={(event) =>
                  setDraftPrompt((event.target as HTMLTextAreaElement).value)
                }
              />
            </label>
            <VscodeAiModelPicker
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
              onAiModelOptionsChange={(aiModelOptions) => onChange({ aiModelOptions })}
              capabilityTags={capabilityTags}
              disabled={textModels.length === 0}
              presentation="form"
              fieldClass="vscode__setting"
              labelClass=""
              dark={dark}
            />
            {formError ? <p class="vscode__subagent-error">{formError}</p> : undefined}
            <div class="vscode__subagent-list-actions">
              <button type="button" class="vscode__subagent-btn" onClick={saveCustom}>
                {editingId ? '保存' : '添加'}
              </button>
              {editingId ? (
                <button type="button" class="vscode__subagent-btn" onClick={resetDraft}>
                  取消
                </button>
              ) : undefined}
            </div>
          </div>
        </>
      ) : undefined}
    </div>
  )
}
