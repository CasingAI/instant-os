import { useMemo, useState } from 'preact/hooks'
import {
  DEFAULT_MODEL_CONTEXT_WINDOW,
  resolveModelEntryContextWindow,
  type AiContextWindowMode,
  type AiModelEntry,
  type AiProviderId,
} from '../../ai/ai-providers.ts'
import { formatCompactTokenCount } from '../browser/format-token-count.ts'
import { Page } from '../../ui/page.tsx'
import { PageHeader } from '../../ui/page-header.tsx'
import { SettingsCheckRow } from '../../ui/settings-check-row.tsx'
import { SettingsInlineInputRow } from '../../ui/settings-inline-input-row.tsx'

export type KeychainContextWindowSelection = {
  contextWindowMode?: AiContextWindowMode
  contextWindow?: number
}

export function formatKeychainContextWindowLabel(
  providerId: AiProviderId,
  entry: Pick<
    AiModelEntry,
    | 'modelId'
    | 'pricingModelKey'
    | 'manualPricing'
    | 'openRouterPricing'
    | 'contextWindowMode'
    | 'contextWindow'
  >,
): string {
  const mode = entry.contextWindowMode === 'manual' ? 'manual' : 'auto'
  const tokens = resolveModelEntryContextWindow(providerId, entry)
  const size = formatCompactTokenCount(tokens)
  return mode === 'manual' ? `手动 · ${size}` : `自动 · ${size}`
}

function parseManualTokens(raw: string): number | undefined {
  const trimmed = raw.trim().replace(/,/g, '')
  if (!trimmed) return undefined
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return undefined
  const tokens = Math.floor(value)
  return tokens >= 1 ? tokens : undefined
}

export function KeychainContextWindowFlow({
  backLabel,
  providerId,
  modelEntry,
  onChange,
  onClose,
}: {
  backLabel: string
  providerId: AiProviderId
  modelEntry: Pick<
    AiModelEntry,
    | 'modelId'
    | 'pricingModelKey'
    | 'manualPricing'
    | 'openRouterPricing'
    | 'contextWindowMode'
    | 'contextWindow'
  >
  onChange: (next: KeychainContextWindowSelection) => void
  onClose: () => void
}) {
  const mode: AiContextWindowMode =
    modelEntry.contextWindowMode === 'manual' ? 'manual' : 'auto'
  const resolved = resolveModelEntryContextWindow(providerId, modelEntry)
  const [manualDraft, setManualDraft] = useState(() =>
    mode === 'manual' && modelEntry.contextWindow !== undefined
      ? String(modelEntry.contextWindow)
      : String(DEFAULT_MODEL_CONTEXT_WINDOW),
  )

  const autoPreview = useMemo(
    () =>
      resolveModelEntryContextWindow(providerId, {
        ...modelEntry,
        contextWindowMode: 'auto',
        contextWindow: undefined,
      }),
    [providerId, modelEntry],
  )

  const setMode = (next: AiContextWindowMode) => {
    if (next === 'auto') {
      onChange({ contextWindowMode: 'auto', contextWindow: undefined })
      return
    }
    const tokens =
      parseManualTokens(manualDraft) ??
      modelEntry.contextWindow ??
      DEFAULT_MODEL_CONTEXT_WINDOW
    setManualDraft(String(tokens))
    onChange({ contextWindowMode: 'manual', contextWindow: tokens })
  }

  const handleManualInput = (value: string) => {
    setManualDraft(value)
    const tokens = parseManualTokens(value)
    if (tokens === undefined) return
    onChange({ contextWindowMode: 'manual', contextWindow: tokens })
  }

  return (
    <Page
      header={
        <PageHeader title="上下文" backLabel={backLabel} onBack={onClose} />
      }
    >
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <div class="settings__list keychain__context-options">
            <SettingsCheckRow
              label="自动"
              checked={mode === 'auto'}
              onChange={() => setMode('auto')}
            />
            <SettingsCheckRow
              label="手动"
              checked={mode === 'manual'}
              onChange={() => setMode('manual')}
            />
          </div>
          {mode === 'auto' ? (
            <p class="settings__section-footnote">
              优先使用 OpenRouter / 定价缓存的上下文长度，否则使用内置预设；都没有时为{' '}
              {formatCompactTokenCount(DEFAULT_MODEL_CONTEXT_WINDOW)}
              。当前：{formatCompactTokenCount(autoPreview)}。
            </p>
          ) : (
            <div class="keychain__form-group">
              <div class="settings__list">
                <SettingsInlineInputRow
                  label="长度"
                  value={manualDraft}
                  placeholder={String(DEFAULT_MODEL_CONTEXT_WINDOW)}
                  onChange={handleManualInput}
                />
              </div>
              <p class="settings__section-footnote">
                单位：token。当前生效：{formatCompactTokenCount(resolved)}。
              </p>
            </div>
          )}
        </section>
      </div>
    </Page>
  )
}
