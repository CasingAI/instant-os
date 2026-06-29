import { useEffect, useState } from 'preact/hooks'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import {
  EXTERNAL_BRIDGE_CONSENT_CHANGED_EVENT,
  listExternalBridgeConsents,
  revokeExternalBridgeConsent,
  type ExternalBridgeConsentRecord,
} from '../../bridge/external-bridge-consent-storage.ts'

type ExternalBridgeConsentsViewProps = {
  onBack: () => void
}

const NAV_LABEL = '外链 AI 授权'

function formatApprovedAt(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function formatOriginLabel(origin: string): string {
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

function resolveConsentLabel(record: ExternalBridgeConsentRecord): string {
  return record.appName?.trim() || record.appId
}

export function ExternalBridgeConsentsView({ onBack }: ExternalBridgeConsentsViewProps) {
  const [records, setRecords] = useState(() => listExternalBridgeConsents())

  useEffect(() => {
    const refresh = () => {
      setRecords(listExternalBridgeConsents())
    }

    window.addEventListener(EXTERNAL_BRIDGE_CONSENT_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(EXTERNAL_BRIDGE_CONSENT_CHANGED_EVENT, refresh)
  }, [])

  const handleRevoke = (record: ExternalBridgeConsentRecord) => {
    revokeExternalBridgeConsent(record.appId, record.origin)
    setRecords(listExternalBridgeConsents())
  }

  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label={NAV_LABEL} onClick={onBack} />
      </div>
      <div class="settings__content">
        <section class="settings__section">
          <h2 class="settings__section-title">{NAV_LABEL}</h2>
          <p class="settings__section-footnote settings__section-footnote--flush">
            管理已允许通过 Instant OS 代发 AI 请求的外部网站应用。在 Instant OS
            内打开的应用默认享有权限，不会出现在此列表中。
          </p>

          {records.length > 0 ? (
            <div class="settings__list settings__external-bridge-consent-list">
              <div class="settings__list-head settings__list-head--external-bridge-consent">
                <span>应用</span>
                <span>来源</span>
                <span>授权时间</span>
                <span>操作</span>
              </div>
              <div class="settings__list-body settings__list-body--apps">
                {records.map((record) => (
                  <div
                    class="settings__row settings__row--static settings__external-bridge-consent-row"
                    key={`${record.appId}|${record.origin}`}
                  >
                    <span class="settings__row-name">{resolveConsentLabel(record)}</span>
                    <span class="settings__row-hint" title={record.origin}>
                      {formatOriginLabel(record.origin)}
                    </span>
                    <span class="settings__row-hint">{formatApprovedAt(record.approvedAt)}</span>
                    <div class="settings__developer-app-actions">
                      <button
                        type="button"
                        class="settings__btn settings__btn--small settings__btn--danger"
                        onClick={() => handleRevoke(record)}
                      >
                        撤销
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p class="settings__section-footnote settings__section-footnote--flush">
              尚未授权任何外部应用。当外链应用通过桥接页请求 AI 代理且您选择「允许」后，会显示在此。
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
