import { useMemo, useState } from 'preact/hooks'
import { supportsThinkingParam } from '../../ai/ai-thinking.ts'
import type { FlatEnabledModel } from '../../ai/ai-providers.ts'
import { SearchIcon } from '../../icons/app-icons.tsx'
import { Page } from '../../ui/page.tsx'
import { PageHeader } from '../../ui/page-header.tsx'
import { SettingsChoiceOptionList } from '../../ui/settings-choice-option-list.tsx'
import { SettingsNavRow } from '../../ui/settings-nav-row.tsx'
import { SettingsSwitchRow } from '../../ui/settings-switch-row.tsx'
import {
  displayPartsForVscodeAiModel,
  formatVscodeAiContextWindowPrefLabel,
  formatVscodeAiThinkingEffortPrefLabel,
  labelForVscodeAiModelProvider,
  listVscodeAiContextWindowPrefOptions,
  listVscodeAiThinkingEffortPrefOptions,
  resolveVscodeAiFastPair,
  resolveVscodeAiSystemContextWindow,
  shouldShowVscodeAiThinkingEffortPicker,
} from './vscode-ai-model-display.ts'
import {
  filterModelsExcludingPinnedKeys,
  filterVscodeAiModelPickerPins,
  filterVscodeAiModelsByQuery,
  listVscodeAiModelCapabilityPins,
  withVscodeAiContextWindow,
  withVscodeAiThinkingEffort,
  withVscodeAiThinkingEnabled,
  type VscodeAiModelPickerSelectionMode,
} from './vscode-ai-model-picker-data.ts'
import {
  formatVscodeAiModelRefKey,
  labelForVscodeAiModel,
  resolveVscodeAiContextWindowPrefForModelKey,
  resolveVscodeAiThinkingEffortPrefForModelKey,
  resolveVscodeAiThinkingEnabledForModelKey,
  resolveVscodeCapabilityPickerModelKey,
} from './vscode-ai-models.ts'
import type {
  VscodeAiContextWindowPref,
  VscodeAiModelOptionPrefs,
  VscodeAiThinkingEffortPref,
} from './vscode-prefs.ts'
import '../settings/settings.css'

type VscodeSettingsModelPickerViewProps = {
  title?: string
  backLabel: string
  value: string
  models: readonly FlatEnabledModel[]
  selectionMode?: VscodeAiModelPickerSelectionMode
  onChange: (encoded: string) => void
  /** 缺省时不渲染返回键（分栏右栏的列表直推帧没有返回） */
  onBack?: () => void
  searchPlaceholder?: string
  closeOnSelect?: boolean
}

function ModelOptionRow({
  optionKey,
  primary,
  tag,
  secondary,
  selected,
  onSelect,
}: {
  optionKey: string
  primary: string
  tag?: string
  secondary?: string
  selected: boolean
  onSelect: (key: string) => void
}) {
  return (
    <button
      type="button"
      class={`settings__option-row settings__option-row--stacked${selected ? ' settings__option-row--selected' : ''}`}
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect(optionKey)}
    >
      <span class="settings__option-copy">
        <span class="settings__option-primary-row">
          <span class="settings__option-label">{primary}</span>
          {tag ? (
            <span class="settings__option-tag">{tag}</span>
          ) : undefined}
        </span>
        {secondary ? (
          <span class="settings__option-secondary">{secondary}</span>
        ) : undefined}
      </span>
      {selected ? (
        <span class="settings__option-check" aria-hidden="true">
          ✓
        </span>
      ) : undefined}
    </button>
  )
}

/** 设置栈内模型选择子页：搜索 + 能力钉 + Aqua 勾选列表。 */
export function VscodeSettingsModelPickerView({
  title = '模型',
  backLabel,
  value,
  models,
  selectionMode = 'agent',
  onChange,
  onBack,
  searchPlaceholder = '搜索模型',
  closeOnSelect = true,
}: VscodeSettingsModelPickerViewProps) {
  const [query, setQuery] = useState('')

  const pins = useMemo(
    () => listVscodeAiModelCapabilityPins(selectionMode),
    [selectionMode],
  )
  const visiblePins = useMemo(
    () => filterVscodeAiModelPickerPins(pins, query),
    [pins, query],
  )
  const filteredModels = useMemo(
    () =>
      filterModelsExcludingPinnedKeys(
        filterVscodeAiModelsByQuery(models, query),
        visiblePins,
      ),
    [models, query, visiblePins],
  )

  const handleSelect = (next: string) => {
    onChange(next)
    if (closeOnSelect) onBack?.()
  }

  const empty = visiblePins.length === 0 && filteredModels.length === 0

  return (
    <Page
      header={
        <PageHeader title={title} backLabel={backLabel} onBack={onBack} />
      }
    >
      <div class="settings__search-bar">
        <div class="settings__search">
          <span class="settings__search-icon" aria-hidden="true">
            <SearchIcon />
          </span>
          <input
            type="search"
            class="settings__search-input"
            value={query}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            spellcheck={false}
            enterkeyhint="search"
            onInput={(event) =>
              setQuery((event.currentTarget as HTMLInputElement).value)
            }
          />
        </div>
      </div>
      <div class="settings__content settings__content--compact">
        {visiblePins.length > 0 ? (
          <section class="settings__section">
            <h2 class="settings__section-title">快捷</h2>
            <div class="settings__list" role="radiogroup" aria-label="快捷模型">
              {visiblePins.map((pin) => (
                <ModelOptionRow
                  key={pin.key}
                  optionKey={pin.key}
                  primary={pin.primary}
                  tag={pin.tag}
                  secondary={pin.secondary}
                  selected={value === pin.key}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          </section>
        ) : undefined}

        <section class="settings__section">
          {visiblePins.length > 0 ? (
            <h2 class="settings__section-title">全部模型</h2>
          ) : undefined}
          {empty ? (
            <div class="settings__box settings__empty">
              {query.trim() ? '无匹配结果' : '暂无文本模型'}
            </div>
          ) : filteredModels.length > 0 ? (
            <div class="settings__list" role="radiogroup" aria-label={title}>
              {filteredModels.map((model) => {
                const key = formatVscodeAiModelRefKey({
                  providerEntryId: model.providerEntryId,
                  modelId: model.modelId,
                })
                return (
                  <ModelOptionRow
                    key={key}
                    optionKey={key}
                    primary={labelForVscodeAiModel(model)}
                    secondary={labelForVscodeAiModelProvider(model)}
                    selected={value === key}
                    onSelect={handleSelect}
                  />
                )
              })}
            </div>
          ) : undefined}
        </section>
      </div>
    </Page>
  )
}

/** 已选模型的配置摘要（供应商 · 思考 / 上下文等），供设置页「配置」行展示。 */
export function summaryForSettingsModelConfig(
  pickerValue: string,
  models: readonly FlatEnabledModel[],
  aiModelOptions: Record<string, VscodeAiModelOptionPrefs>,
): string | undefined {
  const modelKey = resolveVscodeCapabilityPickerModelKey(pickerValue)
  if (!modelKey) return undefined
  const model = models.find(
    (item) =>
      formatVscodeAiModelRefKey({
        providerEntryId: item.providerEntryId,
        modelId: item.modelId,
      }) === modelKey,
  )
  if (!model) return undefined
  const provider = labelForVscodeAiModelProvider(model)
  const bits = displayPartsForVscodeAiModel(model, aiModelOptions).configBits
  if (bits && bits.length > 0) return [provider, ...bits].join(' · ')
  return provider
}

type ModelOptionsPageProps = {
  editModelKey: string
  backLabel?: string
  models: readonly FlatEnabledModel[]
  aiModelOptions: Record<string, VscodeAiModelOptionPrefs>
  onAiModelOptionsChange: (next: Record<string, VscodeAiModelOptionPrefs>) => void
  onSelectModelKey: (modelKey: string) => void
  onOpenContext: () => void
  onOpenThinking: () => void
  /** 缺省时不渲染返回键（分栏右栏的列表直推帧没有返回） */
  onBack?: () => void
}

export function VscodeSettingsModelOptionsView({
  editModelKey,
  backLabel = '返回',
  models,
  aiModelOptions,
  onAiModelOptionsChange,
  onSelectModelKey,
  onOpenContext,
  onOpenThinking,
  onBack,
}: ModelOptionsPageProps) {
  const editModel = models.find(
    (model) =>
      formatVscodeAiModelRefKey({
        providerEntryId: model.providerEntryId,
        modelId: model.modelId,
      }) === editModelKey,
  )

  if (!editModel) {
    return (
      <Page
        header={
          <PageHeader title="选项" backLabel={backLabel} onBack={onBack} />
        }
      >
        <div class="settings__content settings__content--compact">
          <div class="settings__box settings__empty">模型不可用</div>
        </div>
      </Page>
    )
  }

  const showThinking = supportsThinkingParam(
    editModel.providerId,
    editModel.modelId,
  )
  const thinkingOn =
    showThinking &&
    resolveVscodeAiThinkingEnabledForModelKey(editModelKey, aiModelOptions)
  const thinkingEffort = resolveVscodeAiThinkingEffortPrefForModelKey(
    editModelKey,
    aiModelOptions,
  )
  const contextPref = resolveVscodeAiContextWindowPrefForModelKey(
    editModelKey,
    aiModelOptions,
  )
  const pair = resolveVscodeAiFastPair(editModel, models)
  const title = labelForVscodeAiModel(editModel)

  return (
    <Page
      header={
        <PageHeader title={title} backLabel={backLabel} onBack={onBack} />
      }
    >
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <div class="settings__list">
            <div class="settings__row settings__row--static">
              <span class="settings__row-name">供应商</span>
              <span class="settings__row-size">
                {labelForVscodeAiModelProvider(editModel)}
              </span>
            </div>
            {showThinking ? (
              <SettingsSwitchRow
                label="思考"
                checked={thinkingOn}
                onChange={(checked) => {
                  onAiModelOptionsChange(
                    withVscodeAiThinkingEnabled(
                      aiModelOptions,
                      editModelKey,
                      checked,
                    ),
                  )
                }}
              />
            ) : undefined}
            {thinkingOn &&
            shouldShowVscodeAiThinkingEffortPicker(
              editModel.providerId,
              editModel.modelId,
            ) ? (
              <SettingsNavRow
                label="思考深度"
                value={formatVscodeAiThinkingEffortPrefLabel(thinkingEffort)}
                onClick={onOpenThinking}
              />
            ) : undefined}
            {pair ? (
              <SettingsSwitchRow
                label="极速"
                checked={editModelKey === pair.fastKey}
                onChange={(checked) => {
                  onSelectModelKey(checked ? pair.fastKey : pair.baseKey)
                }}
              />
            ) : undefined}
            <SettingsNavRow
              label="上下文长度"
              value={formatVscodeAiContextWindowPrefLabel(
                contextPref,
                resolveVscodeAiSystemContextWindow(editModel),
              )}
              onClick={onOpenContext}
            />
          </div>
        </section>
      </div>
    </Page>
  )
}

type ModelChoicePageProps = {
  title: string
  backLabel?: string
  options: readonly { id: string; label: string }[]
  value: string
  onChange: (value: string) => void
  /** 缺省时不渲染返回键（分栏右栏的列表直推帧没有返回） */
  onBack?: () => void
}

export function VscodeSettingsModelChoiceView({
  title,
  backLabel = '选项',
  options,
  value,
  onChange,
  onBack,
}: ModelChoicePageProps) {
  return (
    <Page
      header={
        <PageHeader title={title} backLabel={backLabel} onBack={onBack} />
      }
    >
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <SettingsChoiceOptionList
            options={options}
            value={value}
            onChange={(next) => {
              onChange(next)
              onBack?.()
            }}
            ariaLabel={title}
          />
        </section>
      </div>
    </Page>
  )
}

export function listSettingsModelContextOptions(
  model: FlatEnabledModel,
  aiModelOptions?: Record<string, VscodeAiModelOptionPrefs>,
): { id: string; label: string }[] {
  return listVscodeAiContextWindowPrefOptions(model, aiModelOptions).map(
    (option) => ({
      id: String(option.value),
      label: option.label,
    }),
  )
}

export function listSettingsModelThinkingOptions(
  model: FlatEnabledModel,
): { id: string; label: string }[] {
  return listVscodeAiThinkingEffortPrefOptions(
    model.providerId,
    model.modelId,
  ).map((option) => ({
    id: option.value,
    label: option.label,
  }))
}

export function parseSettingsModelContextValue(
  raw: string,
): VscodeAiContextWindowPref {
  if (raw === 'system') return 'system'
  const n = Number(raw)
  return Number.isFinite(n) ? (n as VscodeAiContextWindowPref) : 'system'
}

export function applySettingsModelContextChange(
  options: Record<string, VscodeAiModelOptionPrefs>,
  modelKey: string,
  raw: string,
): Record<string, VscodeAiModelOptionPrefs> {
  return withVscodeAiContextWindow(
    options,
    modelKey,
    parseSettingsModelContextValue(raw),
  )
}

export function applySettingsModelThinkingChange(
  options: Record<string, VscodeAiModelOptionPrefs>,
  modelKey: string,
  raw: string,
): Record<string, VscodeAiModelOptionPrefs> {
  return withVscodeAiThinkingEffort(
    options,
    modelKey,
    raw as VscodeAiThinkingEffortPref,
  )
}
