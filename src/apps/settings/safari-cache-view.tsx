import { useEffect, useMemo, useState } from 'preact/hooks'
import { DATA_STORAGE_CHANGED_EVENT } from '../../os/device-data-storage.ts'
import {
  clearAllPageCache,
  clearSitePageCache,
  getBrowserPageCacheStorageBytes,
  getCachedPageCount,
  getSiteCacheSummaries,
  initBrowserPageCache,
} from '../browser/browser-page-cache.ts'
import { formatStorageSize } from './format-storage-size.ts'

const SITE_CACHE_PREVIEW_COUNT = 10

type SafariCacheViewProps = {
  onCacheChange?: () => void
}

export function SafariCacheView({ onCacheChange }: SafariCacheViewProps) {
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const refresh = () => {
      void initBrowserPageCache().then(() => setRevision((value) => value + 1))
    }
    refresh()
    window.addEventListener(DATA_STORAGE_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(DATA_STORAGE_CHANGED_EVENT, refresh)
  }, [])

  const cacheBytes = useMemo(() => getBrowserPageCacheStorageBytes(), [revision])
  const pageCount = useMemo(() => getCachedPageCount(), [revision])
  const sites = useMemo(() => getSiteCacheSummaries(), [revision])
  const [confirmClearAll, setConfirmClearAll] = useState(false)
  const [pendingSite, setPendingSite] = useState<string | undefined>(undefined)
  const [sitesExpanded, setSitesExpanded] = useState(false)

  const bump = () => {
    setRevision((value) => value + 1)
    onCacheChange?.()
  }

  const handleClearAll = () => {
    clearAllPageCache()
    setConfirmClearAll(false)
    bump()
  }

  const handleClearSite = (hostname: string) => {
    clearSitePageCache(hostname)
    setPendingSite(undefined)
    bump()
  }

  return (
    <>
      <section class="settings__section">
        <h2 class="settings__section-title">网页缓存</h2>
        <div class="settings__box">
          <dl class="settings__form-row">
            <dt>缓存占用</dt>
            <dd>{formatStorageSize(cacheBytes)}</dd>
          </dl>
          <dl class="settings__form-row">
            <dt>已缓存页面</dt>
            <dd>{pageCount.toLocaleString('zh-CN')} 页</dd>
          </dl>
        </div>

        {pageCount > 0 && (
          <div class="settings__actions settings__actions--inline">
            <button
              type="button"
              class="settings__btn settings__btn--danger"
              onClick={() => setConfirmClearAll(true)}
            >
              清空全部网页缓存
            </button>
          </div>
        )}
      </section>

      {sites.length > 0 && (
        <SiteCacheList
          sites={sites}
          expanded={sitesExpanded}
          onExpand={() => setSitesExpanded(true)}
          onClearSite={(hostname) => setPendingSite(hostname)}
        />
      )}

      {confirmClearAll && (
        <ConfirmSheet
          title="清空全部网页缓存？"
          message="所有已缓存的网络浏览器网页将被删除，下次访问需重新生成。"
          confirmLabel="清空"
          onCancel={() => setConfirmClearAll(false)}
          onConfirm={handleClearAll}
        />
      )}

      {pendingSite && (
        <ConfirmSheet
          title={`清空 ${pendingSite} 的缓存？`}
          message="该网站下所有已缓存页面将被删除，其他网站不受影响。"
          confirmLabel="清空"
          onCancel={() => setPendingSite(undefined)}
          onConfirm={() => handleClearSite(pendingSite)}
        />
      )}
    </>
  )
}

type SiteCacheListProps = {
  sites: ReturnType<typeof getSiteCacheSummaries>
  expanded: boolean
  onExpand: () => void
  onClearSite: (hostname: string) => void
}

function SiteCacheList({ sites, expanded, onExpand, onClearSite }: SiteCacheListProps) {
  const canExpand = sites.length > SITE_CACHE_PREVIEW_COUNT
  const showExpandTrigger = canExpand && !expanded
  const visibleSites = showExpandTrigger ? sites.slice(0, SITE_CACHE_PREVIEW_COUNT) : sites

  return (
    <section class="settings__section">
      <h2 class="settings__section-title">按网站</h2>
      <div class="settings__list">
        <div class="settings__list-head settings__list-head--cache">
          <span>域名</span>
          <span>页面</span>
          <span>占用</span>
          <span />
        </div>
        <div class="settings__list-body settings__list-body--apps">
          {visibleSites.map((entry) => (
            <div key={entry.hostname} class="settings__row settings__row--cache">
              <span class="settings__row-name">{entry.hostname}</span>
              <span class="settings__row-count">{entry.pageCount}</span>
              <span class="settings__row-size">{formatStorageSize(entry.bytes)}</span>
              <button
                type="button"
                class="settings__row-action"
                onClick={() => onClearSite(entry.hostname)}
              >
                清空
              </button>
            </div>
          ))}
          {showExpandTrigger && (
            <button type="button" class="settings__row settings__row--show-all" onClick={onExpand}>
              显示全部网站
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

type ConfirmSheetProps = {
  title: string
  message: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
}

function ConfirmSheet({ title, message, confirmLabel, onCancel, onConfirm }: ConfirmSheetProps) {
  return (
    <div class="settings__sheet-backdrop" role="presentation" onClick={onCancel}>
      <div
        class="settings__sheet"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="safari-cache-sheet-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div class="settings__sheet-body">
          <div class="settings__sheet-icon" aria-hidden="true">
            !
          </div>
          <div class="settings__sheet-copy">
            <h3 class="settings__sheet-title" id="safari-cache-sheet-title">
              {title}
            </h3>
            <p class="settings__sheet-message">{message}</p>
          </div>
        </div>
        <div class="settings__sheet-actions">
          <button type="button" class="settings__btn settings__btn--plain" onClick={onCancel}>
            取消
          </button>
          <button type="button" class="settings__btn settings__btn--danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
