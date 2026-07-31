import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { IosSwitch } from '../../ui/ios-switch.tsx'
import { useMemo, useState } from 'preact/hooks'
import {
  getDomainUsageList,
  loadBrowserTokenUsage,
} from '../browser/browser-token-usage.ts'
import {
  loadBrowserSettings,
  patchBrowserSettings,
} from '../browser/browser-settings-storage.ts'
import { formatTokenCount } from '../browser/format-token-count.ts'
import { SafariCacheView } from './safari-cache-view.tsx'
import { SafariHistoryView } from './safari-history-view.tsx'
const DOMAIN_USAGE_PREVIEW_COUNT = 10

type SafariUsageViewProps = {
  onBack: () => void
  onCacheChange?: () => void
  onHistoryChange?: () => void
}

export function SafariUsageView({ onBack, onCacheChange, onHistoryChange }: SafariUsageViewProps) {
  const usage = useMemo(() => loadBrowserTokenUsage(), [])
  const domains = useMemo(() => getDomainUsageList(usage), [usage])
  const [domainsExpanded, setDomainsExpanded] = useState(false)
  const [allowAiRefuseSite, setAllowAiRefuseSite] = useState(
    () => loadBrowserSettings().allowAiRefuseSite,
  )
  const canExpandDomains = domains.length > DOMAIN_USAGE_PREVIEW_COUNT
  const showExpandDomains = canExpandDomains && !domainsExpanded
  const visibleDomains = showExpandDomains
    ? domains.slice(0, DOMAIN_USAGE_PREVIEW_COUNT)
    : domains

  const handleToggleAiRefuseSite = (checked: boolean) => {
    if (!patchBrowserSettings({ allowAiRefuseSite: checked })) {
      return
    }
    setAllowAiRefuseSite(checked)
  }

  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="显示全部" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">生成</h2>
          <div class="settings__list">
            <div class="settings__toggle-row">
              <span class="settings__toggle-row-label">允许 AI 拒绝生成网站</span>
              <IosSwitch
                checked={allowAiRefuseSite}
                onChange={handleToggleAiRefuseSite}
                label="允许 AI 拒绝生成网站"
              />
            </div>
          </div>
          <p class="settings__section-footnote">
            开启后，AI 可出于各种理由拒绝生成页面，并由浏览器显示「此网站不存在」。默认关闭。
          </p>
        </section>

        <SafariCacheView onCacheChange={onCacheChange} />
        <SafariHistoryView onHistoryChange={onHistoryChange} />

        <section class="settings__section">
          <h2 class="settings__section-title">网页浏览器总用量</h2>
          <div class="settings__box">
            <dl class="settings__form-row">
              <dt>累计 Tokens</dt>
              <dd>{formatTokenCount(usage.totalTokens)}</dd>
            </dl>
            <dl class="settings__form-row">
              <dt>输入 Tokens</dt>
              <dd>{formatTokenCount(usage.totalPromptTokens)}</dd>
            </dl>
            <dl class="settings__form-row">
              <dt>输出 Tokens</dt>
              <dd>{formatTokenCount(usage.totalCompletionTokens)}</dd>
            </dl>
            <dl class="settings__form-row">
              <dt>已生成页面</dt>
              <dd>{usage.pageCount.toLocaleString('zh-CN')} 次</dd>
            </dl>
          </div>
        </section>

        <section class="settings__section">
          <h2 class="settings__section-title">按域名统计</h2>
          {domains.length === 0 ? (
            <div class="settings__box settings__empty">暂无网页浏览器网页生成记录</div>
          ) : (
            <div class="settings__list">
              <div class="settings__list-head settings__list-head--tokens">
                <span>域名</span>
                <span>页面</span>
                <span>Tokens</span>
              </div>
              <div class="settings__list-body settings__list-body--apps">
                {visibleDomains.map((entry) => (
                  <div key={entry.hostname} class="settings__row settings__row--tokens">
                    <span class="settings__row-name">{entry.hostname}</span>
                    <span class="settings__row-count">{entry.pageCount}</span>
                    <span class="settings__row-size">{formatTokenCount(entry.totalTokens)}</span>
                  </div>
                ))}
                {showExpandDomains && (
                  <button
                    type="button"
                    class="settings__row settings__row--show-all"
                    onClick={() => setDomainsExpanded(true)}
                  >
                    显示全部网站
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
