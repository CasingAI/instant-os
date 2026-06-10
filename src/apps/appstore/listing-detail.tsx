import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { GeneratedAppIcon } from '../generated/generated-app-icon.tsx'
import { useGeneratedApps } from '../../os/generated-apps-context.tsx'
import { normalizeAppVersion } from './app-version.ts'
import { normalizeVersionSnapshots } from './generated-app-versions.ts'
import { EditableDetailField } from './editable-detail-field.tsx'
import { ListingReviewsSection } from './listing-reviews-section.tsx'
import { ListingMixedTagsRow } from './listing-tags-view.tsx'
import { ReviewBrowseModal } from './review-browse-modal.tsx'
import { ReviewComposeModal } from './review-compose-modal.tsx'
import { resolveListingDetailContext } from './resolve-listing-detail-context.ts'
import { sortReviewsForDisplay } from './review-display.ts'
import { toGeneratedAppId } from './store-agent.ts'
import { VersionRollbackModal } from './version-rollback-modal.tsx'
import type { StoreListing, StoreListingDetail, StoreReview } from './types.ts'

type ListingDetailProps = {
  listing: StoreListing
  installed: boolean
  busy: boolean
  progress: number | undefined
  textLength: number | undefined
  onBack: () => void
  onInstall: (detail?: Partial<StoreListingDetail>) => void
}

type DetailField = keyof StoreListingDetail

function actionLabel(installed: boolean, pendingUpdate: boolean, busy: boolean): string {
  if (busy) {
    return installed && pendingUpdate ? '更新中' : '下载中'
  }
  if (installed && pendingUpdate) {
    return '更新'
  }
  if (installed) {
    return '打开'
  }
  return '获取'
}

export function ListingDetail({
  listing,
  installed,
  busy,
  progress,
  textLength,
  onBack,
  onInstall,
}: ListingDetailProps) {
  const {
    loadListingDetail,
    getCachedListingDetail,
    saveListingDetail,
    loadListingReviews,
    getCachedListingReviews,
    addUserReview,
    removeUserReview,
    hasPendingUpdate,
    canRollbackApp,
    getAppVersionCount,
    rollbackAppVersion,
    getInstalledApp,
  } = useGeneratedApps()

  const [detail, setDetail] = useState<Partial<StoreListingDetail> | undefined>(() =>
    getCachedListingDetail(listing.slug),
  )
  const [detailStreaming, setDetailStreaming] = useState(() => !getCachedListingDetail(listing.slug))
  const [detailError, setDetailError] = useState<string | undefined>(undefined)

  const [reviews, setReviews] = useState<StoreReview[]>(() => getCachedListingReviews(listing.slug))
  const [reviewsStreaming, setReviewsStreaming] = useState(
    () => getCachedListingReviews(listing.slug).length === 0,
  )
  const [reviewsError, setReviewsError] = useState<string | undefined>(undefined)
  const [browseOpen, setBrowseOpen] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const [rollbackOpen, setRollbackOpen] = useState(false)

  const pendingUpdate = hasPendingUpdate(listing.slug)
  const installedApp = getInstalledApp(toGeneratedAppId(listing.slug))
  const appVersion = installed ? normalizeAppVersion(installedApp?.version) : undefined
  const versionCount = installed ? getAppVersionCount(listing.slug) : 0
  const canRollback = installed && canRollbackApp(listing.slug) && !busy
  const versionSnapshots = installedApp ? normalizeVersionSnapshots(installedApp) : []
  const previousVersion =
    versionSnapshots.length > 1
      ? versionSnapshots[versionSnapshots.length - 2].version
      : undefined

  useEffect(() => {
    const cached = getCachedListingDetail(listing.slug)
    if (cached) {
      setDetail(cached)
      setDetailStreaming(false)
      return
    }

    let cancelled = false
    setDetail(undefined)
    setDetailStreaming(true)
    setDetailError(undefined)

    void loadListingDetail(listing, (partial) => {
      if (!cancelled) {
        setDetail((current) => ({ ...current, ...partial }))
      }
    })
      .catch((error) => {
        if (!cancelled) {
          setDetailError(error instanceof Error ? error.message : '生成详情失败')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailStreaming(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [listing, loadListingDetail, getCachedListingDetail])

  useEffect(() => {
    const cached = getCachedListingReviews(listing.slug)
    if (cached.length > 0) {
      setReviews(cached)
      setReviewsStreaming(false)
      return
    }

    let cancelled = false
    setReviews([])
    setReviewsStreaming(true)
    setReviewsError(undefined)

    void loadListingReviews(listing, (review) => {
      if (!cancelled) {
        setReviews((current) => {
          if (current.some((item) => item.id === review.id)) {
            return current
          }
          return [...current, review]
        })
      }
    })
      .catch((error) => {
        if (!cancelled) {
          setReviewsError(error instanceof Error ? error.message : '生成评论失败')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setReviewsStreaming(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [listing, loadListingReviews, getCachedListingReviews])

  useEffect(() => {
    setReviews(getCachedListingReviews(listing.slug))
  }, [listing.slug, getCachedListingReviews, pendingUpdate])

  useEffect(() => {
    if (browseOpen && reviews.length <= 1) {
      setBrowseOpen(false)
    }
  }, [browseOpen, reviews.length])

  const saveField = useCallback(
    (field: DetailField, value: string) => {
      saveListingDetail(listing.slug, { [field]: value })
      setDetail((current) => ({ ...current, [field]: value }))
    },
    [listing.slug, saveListingDetail],
  )

  const editable = !detailStreaming
  const installDetail = resolveListingDetailContext(listing, detail, getCachedListingDetail(listing.slug))
  const taglineDisplay = installDetail.tagline ?? listing.description
  const longDescriptionDisplay = installDetail.longDescription ?? listing.description
  const developerDisplay = installDetail.developer ?? 'Instant AI'
  const compatibilityDisplay = installDetail.compatibility ?? 'Instant OS'
  const languageDisplay = installDetail.language ?? '简体中文'

  const primaryAction = actionLabel(installed, pendingUpdate, busy)
  const sortedReviews = useMemo(() => sortReviewsForDisplay(reviews), [reviews])

  const handleSubmitReview = useCallback(
    (body: string, rating: number) => {
      const ok = addUserReview(listing.slug, body, rating)
      if (ok) {
        setComposeOpen(false)
      }
      return ok
    },
    [addUserReview, listing.slug],
  )

  const handleDeleteUserReview = useCallback(
    (reviewId: string) => {
      removeUserReview(listing.slug, reviewId)
    },
    [listing.slug, removeUserReview],
  )

  const handleConfirmRollback = useCallback(() => {
    if (rollbackAppVersion(listing.slug)) {
      setRollbackOpen(false)
    }
  }, [listing.slug, rollbackAppVersion])

  return (
    <div class="appstore-detail">
      <header class="appstore-detail__nav">
        <IosNavBackButton label="应用集市" onClick={onBack} />
      </header>

      <div class="appstore-detail__scroll">
        <section class="appstore-detail__hero">
          <div class="appstore-detail__icon-wrap">
            <GeneratedAppIcon
              emoji={listing.iconEmoji}
              themeColor={listing.themeColor}
              size={120}
              progress={progress}
              textLength={textLength}
            />
          </div>
          <div class="appstore-detail__hero-meta">
            <ListingMixedTagsRow
              category={listing.category}
              tags={listing.tags}
              categoryClassName="appstore-detail__eyebrow appstore-detail__eyebrow--inline"
            />
            <h2 class="appstore-detail__name">{listing.name}</h2>
            {!detail?.tagline && detailStreaming ? (
              <div class="appstore-detail__skeleton appstore-detail__skeleton--tagline" />
            ) : (
              <p class="appstore-detail__tagline appstore-detail__stream-in">
                <EditableDetailField
                  value={taglineDisplay}
                  disabled={!editable}
                  onSave={(value) => saveField('tagline', value)}
                />
              </p>
            )}
            <div class="appstore-detail__actions">
              <button
                type="button"
                class={`appstore-detail__get${pendingUpdate ? ' appstore-detail__get--update' : ''}`}
                disabled={busy}
                onClick={() => onInstall(installDetail)}
              >
                {primaryAction}
              </button>
            </div>
          </div>
        </section>

        {detailError && (
          <div class="appstore__notice appstore__notice--error appstore-detail__notice">
            {detailError}
          </div>
        )}

        {!detailStreaming && (
          <p class="appstore-detail__edit-hint">双击副标题、简介或信息栏可编辑，修改后将作为生成应用的上下文</p>
        )}

        <section class="appstore-detail__section">
          <h3 class="appstore-detail__section-title">简介</h3>
          {!detail?.longDescription && detailStreaming ? (
            <div class="appstore-detail__skeleton-block">
              <div class="appstore-detail__skeleton appstore-detail__skeleton--line" />
              <div class="appstore-detail__skeleton appstore-detail__skeleton--line" />
              <div class="appstore-detail__skeleton appstore-detail__skeleton--line appstore-detail__skeleton--short" />
            </div>
          ) : (
            <>
              <div class="appstore-detail__description appstore-detail__stream-in">
                <EditableDetailField
                  value={longDescriptionDisplay}
                  multiline
                  disabled={!editable}
                  onSave={(value) => saveField('longDescription', value)}
                />
              </div>
              {!detailStreaming && (
                <p class="appstore-detail__description appstore-detail__description--muted appstore-detail__stream-in">
                  这是一款由 AI 为 Instant OS 现场生成的轻量微应用，安装后即可在桌面窗口中独立运行。
                  适合在 320～860px 宽的窗口中使用，开箱即用、无需额外配置。
                </p>
              )}
            </>
          )}
        </section>

        <ListingReviewsSection
          reviews={reviews}
          reviewsStreaming={reviewsStreaming}
          reviewsError={reviewsError}
          installed={installed}
          onOpenBrowse={() => setBrowseOpen(true)}
          onOpenCompose={() => setComposeOpen(true)}
          onDeleteUserReview={handleDeleteUserReview}
        />

        <section class="appstore-detail__section">
          <h3 class="appstore-detail__section-title">信息</h3>
          <dl class="appstore-detail__info">
            {installed && appVersion && (
              <div class="appstore-detail__info-row">
                <dt>当前版本</dt>
                <dd>{appVersion}</dd>
              </div>
            )}
            {installed && versionCount > 1 && (
              <div class="appstore-detail__info-row">
                <dt>已保留版本</dt>
                <dd>{versionCount} 个</dd>
              </div>
            )}
            <div class="appstore-detail__info-row">
              <dt>类别</dt>
              <dd>{listing.category}</dd>
            </div>
            <div class="appstore-detail__info-row">
              <dt>开发者</dt>
              <dd>
                {!detail?.developer && detailStreaming ? (
                  <span class="appstore-detail__skeleton appstore-detail__skeleton--inline" />
                ) : (
                  <EditableDetailField
                    value={developerDisplay}
                    disabled={!editable}
                    class="appstore-detail__stream-in"
                    onSave={(value) => saveField('developer', value)}
                  />
                )}
              </dd>
            </div>
            <div class="appstore-detail__info-row">
              <dt>兼容性</dt>
              <dd>
                {!detail?.compatibility && detailStreaming ? (
                  <span class="appstore-detail__skeleton appstore-detail__skeleton--inline" />
                ) : (
                  <EditableDetailField
                    value={compatibilityDisplay}
                    disabled={!editable}
                    class="appstore-detail__stream-in"
                    onSave={(value) => saveField('compatibility', value)}
                  />
                )}
              </dd>
            </div>
            <div class="appstore-detail__info-row">
              <dt>语言</dt>
              <dd>
                {!detail?.language && detailStreaming ? (
                  <span class="appstore-detail__skeleton appstore-detail__skeleton--inline" />
                ) : (
                  <EditableDetailField
                    value={languageDisplay}
                    disabled={!editable}
                    class="appstore-detail__stream-in"
                    onSave={(value) => saveField('language', value)}
                  />
                )}
              </dd>
            </div>
          </dl>
          {canRollback && appVersion && previousVersion && (
            <button
              type="button"
              class="appstore-detail__rollback"
              onClick={() => setRollbackOpen(true)}
            >
              退回上一版本（{previousVersion}）
            </button>
          )}
        </section>
      </div>

      {browseOpen && (
        <ReviewBrowseModal
          reviews={sortedReviews}
          onClose={() => setBrowseOpen(false)}
          onDeleteUserReview={handleDeleteUserReview}
        />
      )}

      {composeOpen && (
        <ReviewComposeModal
          appVersion={appVersion}
          onClose={() => setComposeOpen(false)}
          onSubmit={handleSubmitReview}
        />
      )}

      {rollbackOpen && appVersion && previousVersion && (
        <VersionRollbackModal
          currentVersion={appVersion}
          previousVersion={previousVersion}
          onCancel={() => setRollbackOpen(false)}
          onConfirm={handleConfirmRollback}
        />
      )}
    </div>
  )
}
