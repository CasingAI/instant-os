import { useMemo } from 'preact/hooks'
import { GeneratedAppIcon } from '../generated/generated-app-icon.tsx'
import { toGeneratedAppId } from './store-agent.ts'
import type { GeneratedAppRecord, PendingInstall, StoreListing } from './types.ts'
import { ListingMixedTagsRow } from './listing-tags-view.tsx'

export type ListingGridProps = {
  listings: StoreListing[]
  installedApps: GeneratedAppRecord[]
  loading: boolean
  getPendingBySlug: (slug: string) => PendingInstall | undefined
  hasPendingUpdate: (slug: string) => boolean
  apiReady: boolean
  emptyMessage: string
  entering?: boolean
  onInstall: (listing: StoreListing) => Promise<void>
  onSelect: (slug: string) => void
}

function installedActionLabel(busy: boolean, pendingUpdate: boolean): string {
  if (busy) {
    return pendingUpdate ? '更新中' : '下载中'
  }
  return pendingUpdate ? '更新' : '打开'
}

export function ListingGrid({
  listings,
  installedApps,
  loading,
  getPendingBySlug,
  hasPendingUpdate,
  apiReady,
  emptyMessage,
  entering,
  onInstall,
  onSelect,
}: ListingGridProps) {
  if (!apiReady) {
    return <EmptyState message="请在系统设置 → 账户中配置 API Key" />
  }

  if (loading && listings.length === 0) {
    return <LoadingGrid />
  }

  if (!loading && listings.length === 0) {
    return <EmptyState message={emptyMessage} />
  }

  return (
    <div class="appstore__grid">
      {listings.map((listing) => {
        const pending = getPendingBySlug(listing.slug)
        const busy = pending !== undefined
        const installed = installedApps.some((app) => app.id === toGeneratedAppId(listing.slug))
        const pendingUpdate = installed && hasPendingUpdate(listing.slug)

        return (
          <ListingCard
            key={listing.slug}
            listing={listing}
            busy={busy}
            installed={installed}
            pendingUpdate={pendingUpdate}
            progress={pending?.progress}
            textLength={pending?.textLength}
            onInstall={() => void onInstall(listing)}
            onSelect={() => onSelect(listing.slug)}
            entering={entering}
          />
        )
      })}
      {loading && <LoadingCard />}
    </div>
  )
}

type ListingCardProps = {
  listing: StoreListing
  busy: boolean
  installed: boolean
  pendingUpdate: boolean
  progress: number | undefined
  textLength: number | undefined
  entering?: boolean
  onInstall: () => void
  onSelect: () => void
}

function ListingCard({
  listing,
  busy,
  installed,
  pendingUpdate,
  progress,
  textLength,
  entering,
  onInstall,
  onSelect,
}: ListingCardProps) {
  const actionLabel = installed
    ? installedActionLabel(busy, pendingUpdate)
    : busy
      ? '下载中'
      : '获取'

  return (
    <article class={`appstore__card${entering ? ' appstore__card--enter' : ''}`}>
      <button type="button" class="appstore__card-body" onClick={onSelect}>
        <div class="appstore__icon-wrap">
          <GeneratedAppIcon
            emoji={listing.iconEmoji}
            themeColor={listing.themeColor}
            size={64}
            progress={progress}
            textLength={textLength}
          />
        </div>
        <div class="appstore__meta">
          <h3>{listing.name}</h3>
          <p>{listing.description}</p>
          <ListingMixedTagsRow category={listing.category} tags={listing.tags} />
        </div>
      </button>
      <button
        type="button"
        class={`appstore__get${installed && pendingUpdate ? ' appstore__get--update' : ''}`}
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation()
          onInstall()
        }}
      >
        {actionLabel}
      </button>
    </article>
  )
}

function LoadingGrid() {
  return (
    <div class="appstore__grid">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} class="appstore__card appstore__card--skeleton" />
      ))}
    </div>
  )
}

function LoadingCard() {
  return <div class="appstore__card appstore__card--skeleton appstore__card--pulse" />
}

function EmptyState({ message }: { message: string }) {
  return (
    <div class="appstore__empty">
      <p>{message}</p>
    </div>
  )
}

export function InstalledGrid({
  apps,
  getPendingByAppId,
  onSelect,
  onAction,
}: {
  apps: GeneratedAppRecord[]
  getPendingByAppId: (appId: GeneratedAppRecord['id']) => PendingInstall | undefined
  onSelect: (app: GeneratedAppRecord) => void
  onAction: (app: GeneratedAppRecord) => void
}) {
  const sortedApps = useMemo(
    () =>
      [...apps].sort(
        (a, b) => Number(b.pendingUpdate === true) - Number(a.pendingUpdate === true),
      ),
    [apps],
  )

  if (sortedApps.length === 0) {
    return <EmptyState message="还没有安装任何 AI 应用，去「发现」页获取吧" />
  }

  return (
    <div class="appstore__grid">
      {sortedApps.map((app) => {
        const pending = getPendingByAppId(app.id)
        const busy = pending !== undefined
        const pendingUpdate = app.pendingUpdate === true
        const actionLabel = installedActionLabel(busy, pendingUpdate)

        return (
          <article key={app.id} class="appstore__card">
            <button type="button" class="appstore__card-body" onClick={() => onSelect(app)}>
              <div class="appstore__icon-wrap">
                <GeneratedAppIcon
                  emoji={app.iconEmoji}
                  themeColor={app.themeColor}
                  size={64}
                  progress={pending?.progress}
                  textLength={pending?.textLength}
                />
              </div>
              <div class="appstore__meta">
                <h3>{app.name}</h3>
                <p>{app.description}</p>
                <ListingMixedTagsRow category={app.category} tags={app.tags ?? []} />
              </div>
            </button>
            <button
              type="button"
              class={`appstore__get${pendingUpdate ? ' appstore__get--update' : ''}`}
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation()
                onAction(app)
              }}
            >
              {actionLabel}
            </button>
          </article>
        )
      })}
    </div>
  )
}
