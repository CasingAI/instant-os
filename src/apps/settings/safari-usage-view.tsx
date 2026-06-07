import { BackIcon } from '../../icons/app-icons.tsx'
import { useMemo } from 'preact/hooks'
import {
  getDomainUsageList,
  loadBrowserTokenUsage,
} from '../browser/browser-token-usage.ts'
import { formatTokenCount } from '../browser/format-token-count.ts'
import { SafariCacheView } from './safari-cache-view.tsx'
import { SafariHistoryView } from './safari-history-view.tsx'

type SafariUsageViewProps = {
  onBack: () => void
  onCacheChange?: () => void
  onHistoryChange?: () => void
}

export function SafariUsageView({ onBack, onCacheChange, onHistoryChange }: SafariUsageViewProps) {
  const usage = useMemo(() => loadBrowserTokenUsage(), [])
  const domains = useMemo(() => getDomainUsageList(usage), [usage])

  return (
    <div class="settings">
      <div class="settings__nav">
        <button type="button" class="settings__nav-back" onClick={onBack}>
          <span class="settings__nav-back-icon" aria-hidden="true">
            <BackIcon size={13} />
          </span>
          显示全部
        </button>
      </div>
      <div class="settings__content settings__content--compact">
        <SafariCacheView onCacheChange={onCacheChange} />
        <SafariHistoryView onHistoryChange={onHistoryChange} />

        <section class="settings__section">
          <h2 class="settings__section-title">Safari 总用量</h2>
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
            <div class="settings__box settings__empty">暂无 Safari 网页生成记录</div>
          ) : (
            <div class="settings__list">
              <div class="settings__list-head settings__list-head--tokens">
                <span>域名</span>
                <span>页面</span>
                <span>Tokens</span>
              </div>
              <div class="settings__list-body">
                {domains.map((entry) => (
                  <div key={entry.hostname} class="settings__row settings__row--tokens">
                    <span class="settings__row-name">{entry.hostname}</span>
                    <span class="settings__row-count">{entry.pageCount}</span>
                    <span class="settings__row-size">{formatTokenCount(entry.totalTokens)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p class="settings__section-footnote">
            统计每次在 Safari 中由 AI 生成的网页所消耗的 Token，按目标 URL 域名汇总。
          </p>
        </section>
      </div>
    </div>
  )
}
