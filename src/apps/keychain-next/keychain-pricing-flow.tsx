import { useEffect, useMemo, useState } from 'preact/hooks'
import {
  formatPricePerMillion,
  subscribeModelPricingCache,
} from '../../ai/ai-model-pricing-cache.ts'
import {
  bindOpenRouterPricing,
  fetchOpenRouterEndpoints,
  searchOpenRouterModels,
  type OpenRouterEndpointHit,
  type OpenRouterModelSearchHit,
} from '../../ai/fetch-openrouter-pricing.ts'
import {
  getOpenRouterPricing,
  subscribeOpenRouterPricingCache,
} from '../../ai/openrouter-pricing-cache.ts'
import {
  listPricingModelOptions,
  resolvePricingByModelKey,
  type AiManualPricing,
  type AiOpenRouterPricingRef,
} from '../../ai/ai-providers.ts'
import { SettingsChoicePickerView } from '../settings/settings-choice-picker-view.tsx'
import { Button } from '../../ui/button.tsx'
import { Page } from '../../ui/page.tsx'
import { PageHeader } from '../../ui/page-header.tsx'
import { PageStack, usePageStack } from '../../ui/page-stack.tsx'
import { SettingsChoiceOptionList } from '../../ui/settings-choice-option-list.tsx'
import { SettingsInlineInputRow } from '../../ui/settings-inline-input-row.tsx'
import { SettingsNavRow } from '../../ui/settings-nav-row.tsx'
import { KeychainTextFieldDialog } from './keychain-text-field-dialog.tsx'

export const PRICING_NONE_OPTION_ID = ''
export const PRICING_CUSTOM_OPTION_ID = '__custom__'
export const PRICING_PRESET_OPTION_ID = '__preset__'

export type KeychainPricingSelection = {
  pricingModelKey?: string
  manualPricing?: AiManualPricing
  openRouterPricing?: AiOpenRouterPricingRef
}

type PricingMode = 'none' | 'custom' | 'preset'

type FlowScreen =
  | 'list'
  | 'preset'
  | 'source'
  | 'manual'
  | 'openrouter-results'
  | 'openrouter-providers'

function clearPricingSelection(): KeychainPricingSelection {
  return {
    pricingModelKey: undefined,
    manualPricing: undefined,
    openRouterPricing: undefined,
  }
}

function modeFromSelection(selection: KeychainPricingSelection): PricingMode {
  if (selection.manualPricing || selection.openRouterPricing) return 'custom'
  if (selection.pricingModelKey) return 'preset'
  return 'none'
}

export function formatKeychainPricingLabel(
  selection: KeychainPricingSelection,
): string {
  if (selection.manualPricing) {
    return `手动 · ${formatPricePerMillion({
      inputPricePerMillion: selection.manualPricing.inputPricePerMillion,
      outputPricePerMillion: selection.manualPricing.outputPricePerMillion,
      currency: selection.manualPricing.currency,
    })}`
  }
  if (selection.openRouterPricing) {
    const cached = getOpenRouterPricing(
      selection.openRouterPricing.modelId,
      selection.openRouterPricing.providerTag,
    )
    const price = formatPricePerMillion(cached)
    const model =
      cached?.modelName ?? selection.openRouterPricing.modelId
    const provider =
      cached?.providerName ?? selection.openRouterPricing.providerTag
    return price === '—'
      ? `OpenRouter · ${model} · ${provider}`
      : `OpenRouter · ${model} · ${provider}（${price}）`
  }
  if (selection.pricingModelKey) {
    const option = listPricingModelOptions().find(
      (item) => item.key === selection.pricingModelKey,
    )
    const pricing = resolvePricingByModelKey(selection.pricingModelKey)
    const price = formatPricePerMillion(pricing)
    const base = option?.label ?? selection.pricingModelKey
    return price === '—' ? base : `${base}（${price}）`
  }
  return '未匹配'
}

function formatPresetEntryValue(selection: KeychainPricingSelection): string {
  if (!selection.pricingModelKey) return '去选择'
  return formatKeychainPricingLabel({
    pricingModelKey: selection.pricingModelKey,
  })
}

function formatCustomEntryValue(selection: KeychainPricingSelection): string {
  if (!selection.manualPricing && !selection.openRouterPricing) return '去配置'
  return formatKeychainPricingLabel(selection)
}

type KeychainPricingFlowProps = {
  backLabel: string
  modelId: string
  selection: KeychainPricingSelection
  onChange: (next: KeychainPricingSelection) => void
  onClose: () => void
}

export function KeychainPricingFlow({
  backLabel,
  modelId,
  selection,
  onChange,
  onClose,
}: KeychainPricingFlowProps) {
  const {
    page: screen,
    stack,
    transition,
    navigate,
    handleMotionEnd,
  } = usePageStack<FlowScreen>('list')
  const [mode, setMode] = useState<PricingMode>(() => modeFromSelection(selection))
  const [pricingRevision, setPricingRevision] = useState(0)
  const [openRouterQueryDialogOpen, setOpenRouterQueryDialogOpen] = useState(false)
  const [openRouterQuery, setOpenRouterQuery] = useState(modelId)
  const [searchHits, setSearchHits] = useState<OpenRouterModelSearchHit[]>([])
  const [searchError, setSearchError] = useState<string | undefined>()
  const [selectedOpenRouterModel, setSelectedOpenRouterModel] = useState<
    OpenRouterModelSearchHit | undefined
  >()
  const [endpointHits, setEndpointHits] = useState<OpenRouterEndpointHit[]>([])
  const [endpointError, setEndpointError] = useState<string | undefined>()
  const [providersLoading, setProvidersLoading] = useState(false)
  const [bindingBusy, setBindingBusy] = useState(false)
  const [manualInput, setManualInput] = useState(
    selection.manualPricing?.inputPricePerMillion.toString() ?? '',
  )
  const [manualCachedInput, setManualCachedInput] = useState(
    selection.manualPricing?.cachedInputPricePerMillion.toString() ?? '',
  )
  const [manualOutput, setManualOutput] = useState(
    selection.manualPricing?.outputPricePerMillion.toString() ?? '',
  )

  useEffect(
    () =>
      subscribeModelPricingCache(() => setPricingRevision((value) => value + 1)),
    [],
  )
  useEffect(
    () =>
      subscribeOpenRouterPricingCache(() =>
        setPricingRevision((value) => value + 1),
      ),
    [],
  )

  const presetOptions = useMemo(() => {
    void pricingRevision
    return listPricingModelOptions().map((option) => {
      const pricing = resolvePricingByModelKey(option.key)
      const price = formatPricePerMillion(pricing)
      return {
        id: option.key,
        label: price === '—' ? option.label : `${option.label}（${price}）`,
      }
    })
  }, [pricingRevision])

  const modeOptions = [
    { id: 'none', label: '未匹配' },
    { id: 'custom', label: '自定义' },
    { id: 'preset', label: '预置库' },
  ]

  const handleModeChange = (nextId: string) => {
    if (nextId === 'none') {
      setMode('none')
      onChange(clearPricingSelection())
      return
    }
    if (nextId === 'custom') {
      setMode('custom')
      if (selection.pricingModelKey) {
        onChange(clearPricingSelection())
      }
      return
    }
    if (nextId === 'preset') {
      setMode('preset')
      if (selection.manualPricing || selection.openRouterPricing) {
        onChange(clearPricingSelection())
      }
    }
  }

  const runOpenRouterSearch = async (query: string) => {
    setOpenRouterQuery(query)
    setSearchError(undefined)
    setSearchHits([])
    try {
      const hits = await searchOpenRouterModels(query)
      setSearchHits(hits)
      if (hits.length === 0) {
        setSearchError('没有匹配的模型，请返回修改关键词')
      }
      navigate('openrouter-results', 'push')
    } catch (error) {
      setSearchHits([])
      setSearchError(error instanceof Error ? error.message : '搜索失败')
      navigate('openrouter-results', 'push')
    }
  }

  const openOpenRouterProviders = async (hit: OpenRouterModelSearchHit) => {
    if (providersLoading || bindingBusy) return
    setSelectedOpenRouterModel(hit)
    setProvidersLoading(true)
    setEndpointError(undefined)
    setEndpointHits([])
    navigate('openrouter-providers', 'push')
    try {
      const endpoints = await fetchOpenRouterEndpoints(hit.id)
      setEndpointHits(endpoints)
      if (endpoints.length === 0) {
        setEndpointError('该模型没有可用的 Provider')
      }
    } catch (error) {
      setEndpointError(error instanceof Error ? error.message : '获取 Provider 失败')
    } finally {
      setProvidersLoading(false)
    }
  }

  const bindProvider = async (endpoint: OpenRouterEndpointHit) => {
    if (!selectedOpenRouterModel || bindingBusy || providersLoading) return
    setBindingBusy(true)
    setEndpointError(undefined)
    try {
      await bindOpenRouterPricing({
        modelId: selectedOpenRouterModel.id,
        providerTag: endpoint.providerTag,
        modelName: selectedOpenRouterModel.name,
        providerName: endpoint.providerName,
      })
      onChange({
        ...clearPricingSelection(),
        openRouterPricing: {
          modelId: selectedOpenRouterModel.id,
          providerTag: endpoint.providerTag,
        },
      })
      onClose()
    } catch (error) {
      setEndpointError(error instanceof Error ? error.message : '绑定失败')
    } finally {
      setBindingBusy(false)
    }
  }

  const manualInputNum = Number(manualInput)
  const manualCachedInputNum = Number(manualCachedInput)
  const manualOutputNum = Number(manualOutput)
  const canSaveManual =
    Number.isFinite(manualInputNum) &&
    manualInputNum >= 0 &&
    Number.isFinite(manualCachedInputNum) &&
    manualCachedInputNum >= 0 &&
    Number.isFinite(manualOutputNum) &&
    manualOutputNum >= 0

  const openManualEditor = () => {
    setManualInput(
      selection.manualPricing?.inputPricePerMillion.toString() ?? '',
    )
    setManualCachedInput(
      selection.manualPricing?.cachedInputPricePerMillion.toString() ?? '',
    )
    setManualOutput(
      selection.manualPricing?.outputPricePerMillion.toString() ?? '',
    )
    navigate('manual', 'push')
  }

  const openOpenRouterQueryDialog = () => {
    setOpenRouterQuery(modelId.trim() || openRouterQuery)
    setOpenRouterQueryDialogOpen(true)
  }

  const renderFlowPage = (target: FlowScreen) => {
    if (target === 'preset') {
      return (
      <div class="page keychain__picker-page">
        <SettingsChoicePickerView
          title="预置库"
          backLabel="定价"
          options={presetOptions}
          value={selection.pricingModelKey ?? ''}
          searchable
          searchPlaceholder="搜索模型或供应商"
          titleInNav
          closeOnSelect={false}
          footnote={
            presetOptions.length === 0
              ? '暂无预置定价。可在「设置 → 背景刷新」中拉取 PriceToken 数据。'
              : undefined
          }
          onChange={(value) => {
            if (!value) return
            onChange({
              ...clearPricingSelection(),
              pricingModelKey: value,
            })
            navigate('list', 'pop')
          }}
          onBack={() => navigate('list', 'pop')}
        />
      </div>
    )
    }
    if (target === 'source') {
      return (
      <Page
        header={
          <PageHeader
            title="自定义定价"
            backLabel="定价"
            onBack={() => navigate('list', 'pop')}
          />
        }
      >
        <div class="settings__content settings__content--compact">
          <section class="settings__section">
            <div class="settings__list">
              <SettingsNavRow
                label="手动指定"
                value="去填写"
                onClick={openManualEditor}
              />
              <SettingsNavRow
                label="OpenRouter"
                value="去绑定"
                onClick={openOpenRouterQueryDialog}
              />
            </div>
            <p class="settings__section-footnote">
              手动填写输入 / 缓存输入 / 输出单价，或绑定 OpenRouter 上的模型与
              Provider。
            </p>
          </section>
        </div>
      </Page>
    )
    }
    if (target === 'manual') {
      return (
      <Page
        header={
          <PageHeader
            title="手动定价"
            backLabel="自定义定价"
            onBack={() => navigate('source', 'pop')}
            actions={
              <Button
                tone="primary"
                disabled={!canSaveManual}
                onClick={() => {
                  if (!canSaveManual) return
                  onChange({
                    ...clearPricingSelection(),
                    manualPricing: {
                      inputPricePerMillion: manualInputNum,
                      cachedInputPricePerMillion: manualCachedInputNum,
                      outputPricePerMillion: manualOutputNum,
                      currency: 'USD',
                    },
                  })
                  onClose()
                }}
              >
                完成
              </Button>
            }
          />
        }
      >
        <div class="settings__content settings__content--compact">
          <section class="settings__section">
            <div class="settings__list">
              <SettingsInlineInputRow
                label="输入"
                value={manualInput}
                placeholder="0"
                onChange={setManualInput}
              />
              <SettingsInlineInputRow
                label="缓存输入"
                value={manualCachedInput}
                placeholder="0"
                onChange={setManualCachedInput}
              />
              <SettingsInlineInputRow
                label="输出"
                value={manualOutput}
                placeholder="0"
                onChange={setManualOutput}
              />
            </div>
            <p class="settings__section-footnote">单位：美元 / 百万 token</p>
          </section>
        </div>
      </Page>
    )
    }
    if (target === 'openrouter-results') {
    const options = searchHits.map((hit) => {
      const price = formatPricePerMillion({
        inputPricePerMillion: hit.promptPerMillion,
        outputPricePerMillion: hit.completionPerMillion,
        currency: 'USD',
      })
      return {
        id: hit.id,
        label: `${hit.name} · ${hit.id}${price === '—' ? '' : `（${price}）`}`,
      }
    })
      return (
      <div class="page keychain__picker-page">
        <SettingsChoicePickerView
          title="OpenRouter 模型"
          backLabel="自定义定价"
          options={options}
          value=""
          titleInNav
          closeOnSelect={false}
          footnote={
            searchError
              ? searchError
              : '选择一个模型以继续选择 Provider。结果不对可返回重新输入。'
          }
          onChange={(value) => {
            if (providersLoading || bindingBusy) return
            const hit = searchHits.find((item) => item.id === value)
            if (hit) void openOpenRouterProviders(hit)
          }}
          onBack={() => navigate('source', 'pop')}
        />
      </div>
    )
    }
    if (target === 'openrouter-providers') {
    const options = endpointHits.map((hit) => {
      const price = formatPricePerMillion({
        inputPricePerMillion: hit.promptPerMillion,
        outputPricePerMillion: hit.completionPerMillion,
        currency: 'USD',
      })
      return {
        id: hit.providerTag,
        label: `${hit.providerName}${price === '—' ? '' : `（${price}）`}`,
      }
    })
    const providersBusy = providersLoading || bindingBusy
      return (
      <div class="page keychain__picker-page">
        <SettingsChoicePickerView
          title="选择 Provider"
          backLabel="OpenRouter 模型"
          options={options}
          value={selection.openRouterPricing?.providerTag ?? ''}
          titleInNav
          closeOnSelect={false}
          loading={providersBusy}
          loadingLabel={
            bindingBusy ? '正在绑定定价…' : '正在加载 Provider…'
          }
          footnote={
            endpointError
              ? endpointError
              : selectedOpenRouterModel
                ? `模型 ${selectedOpenRouterModel.id}`
                : undefined
          }
          onChange={(value) => {
            if (providersBusy) return
            const hit = endpointHits.find((item) => item.providerTag === value)
            if (hit) void bindProvider(hit)
          }}
          onBack={() => {
            if (providersBusy) return
            navigate('openrouter-results', 'pop')
          }}
        />
      </div>
    )
    }

    return (
      <Page
        header={
          <PageHeader title="定价" backLabel={backLabel} onBack={onClose} />
        }
      >
        <div class="settings__content settings__content--compact">
          <section class="settings__section">
            <SettingsChoiceOptionList
              options={modeOptions}
              value={mode}
              onChange={handleModeChange}
              ariaLabel="定价方式"
            />
          </section>

          {mode === 'custom' && (
            <section class="settings__section">
              <div class="settings__list">
                <SettingsNavRow
                  label="自定义配置"
                  value={formatCustomEntryValue(selection)}
                  onClick={() => navigate('source', 'push')}
                />
              </div>
              <p class="settings__section-footnote">
                手动填写单价，或绑定 OpenRouter 上的模型与 Provider。
              </p>
            </section>
          )}

          {mode === 'preset' && (
            <section class="settings__section">
              <div class="settings__list">
                <SettingsNavRow
                  label="预置模型"
                  value={formatPresetEntryValue(selection)}
                  onClick={() => navigate('preset', 'push')}
                />
              </div>
              <p class="settings__section-footnote">
                从 PriceToken 预置库中选择一条单价用于估算。
              </p>
            </section>
          )}
        </div>
      </Page>
    )
  }

  return (
    <div class="page keychain__flow-page">
      <PageStack
        stack={stack}
        page={screen}
        transition={transition}
        onMotionEnd={handleMotionEnd}
        renderPage={renderFlowPage}
      />
      <KeychainTextFieldDialog
        open={openRouterQueryDialogOpen}
        title="搜索 OpenRouter"
        label="模型名称或 ID"
        value={openRouterQuery}
        type="text"
        placeholder="例如 openai/gpt-4o"
        message="将用此关键词在 OpenRouter 上搜索模型。"
        allowEmpty={false}
        requireDirty={false}
        saveLabel="下一步"
        onClose={() => setOpenRouterQueryDialogOpen(false)}
        onSave={runOpenRouterSearch}
      />
    </div>
  )
}
