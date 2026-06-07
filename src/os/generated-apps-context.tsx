import type { ComponentChildren } from 'preact'
import { createContext } from 'preact'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { nextAppVersion, normalizeAppVersion } from '../apps/appstore/app-version.ts'
import {
  appendVersionSnapshot,
  canRollbackApp,
  getAppVersionCount,
  migrateAppRecord,
  pruneArchivedVersions,
  rollbackAppRecord,
} from '../apps/appstore/generated-app-versions.ts'
import { generateAppHtmlStreaming } from '../apps/appstore/generate-app-stream.ts'
import { resolveListingDetailContext } from '../apps/appstore/resolve-listing-detail-context.ts'
import {
  generateListingDetailStreaming,
  generateListingReviewsStreaming,
  generateStoreListingsStreaming,
  toGeneratedAppId,
} from '../apps/appstore/store-agent.ts'
import type {
  GeneratedAppRecord,
  PendingInstall,
  StoreListing,
  StoreListingDetail,
  StoreReview,
} from '../apps/appstore/types.ts'
import { DeviceStorageFullError } from './device-storage.ts'
import { clearGeneratedAppData } from './generated-app-data-storage.ts'
import { loadInstalledApps, saveInstalledApps } from './generated-apps-storage.ts'
import { loadListingDetails, saveListingDetails } from './listing-details-storage.ts'
import { loadListingReviews as loadStoredListingReviews, saveListingReviews } from './listing-reviews-storage.ts'
import { loadStoreListings, saveStoreListings } from './store-listings-storage.ts'
import { useOs } from './os-context.tsx'
import type { GeneratedAppId } from './types.ts'

type GeneratedAppsContextValue = {
  listings: StoreListing[]
  installedApps: GeneratedAppRecord[]
  pendingInstalls: PendingInstall[]
  listingsLoading: boolean
  listingsError: string | undefined
  refreshListings: (topic?: string) => Promise<void>
  loadListingDetail: (
    listing: StoreListing,
    onUpdate?: (partial: Partial<StoreListingDetail>) => void,
  ) => Promise<StoreListingDetail>
  getCachedListingDetail: (slug: string) => StoreListingDetail | undefined
  saveListingDetail: (slug: string, patch: Partial<StoreListingDetail>) => void
  loadListingReviews: (
    listing: StoreListing,
    onReview?: (review: StoreReview) => void,
  ) => Promise<StoreReview[]>
  getCachedListingReviews: (slug: string) => StoreReview[]
  addUserReview: (slug: string, body: string, rating?: number) => boolean
  hasPendingUpdate: (slug: string) => boolean
  canRollbackApp: (slug: string) => boolean
  getAppVersionCount: (slug: string) => number
  rollbackAppVersion: (slug: string) => boolean
  pruneAppVersionHistory: (appId: GeneratedAppId) => boolean
  openAppStoreDetail: (slug: string) => void
  pendingAppStoreDetailSlug: string | undefined
  clearPendingAppStoreDetail: () => void
  installListing: (listing: StoreListing, detail?: Partial<StoreListingDetail>) => Promise<void>
  openInstalledApp: (appId: GeneratedAppId) => void
  uninstallApp: (appId: GeneratedAppId) => void
  clearAppData: (appId: GeneratedAppId) => void
  getAppDataRevision: (appId: GeneratedAppId) => number
  storageRevision: number
  getInstalledApp: (appId: GeneratedAppId) => GeneratedAppRecord | undefined
  getPendingInstall: (appId: GeneratedAppId) => PendingInstall | undefined
  pendingUpdateCount: number
}

const GeneratedAppsContext = createContext<GeneratedAppsContextValue | undefined>(undefined)

function createPendingInstall(appId: GeneratedAppId, listing: StoreListing): PendingInstall {
  return {
    id: appId,
    listing,
    progress: 0,
    textLength: 0,
    phase: 'waiting',
  }
}

function buildGenerationContext(
  detail: Partial<StoreListingDetail> | undefined,
  reviews: StoreReview[],
) {
  return {
    detail,
    reviews: reviews.length > 0 ? reviews : undefined,
  }
}

function replaceInstalledApp(
  apps: GeneratedAppRecord[],
  appId: GeneratedAppId,
  record: GeneratedAppRecord,
): GeneratedAppRecord[] {
  return [...apps.filter((app) => app.id !== appId), migrateAppRecord(record)]
}

class DuplicateAppInstallError extends Error {
  constructor(appId: GeneratedAppId) {
    super(`拒绝安装：应用 ID 已存在 (${appId})`)
    this.name = 'DuplicateAppInstallError'
  }
}

function assertNewInstallAllowed(apps: GeneratedAppRecord[], appId: GeneratedAppId): void {
  if (apps.some((app) => app.id === appId)) {
    const error = new DuplicateAppInstallError(appId)
    console.error(error.message)
    throw error
  }
}

export function GeneratedAppsProvider({ children }: { children: ComponentChildren }) {
  const { openGeneratedApp, closeWindowsForApp, openApp } = useOs()
  const [listings, setListings] = useState<StoreListing[]>(() => loadStoreListings())
  const [installedApps, setInstalledApps] = useState<GeneratedAppRecord[]>(() => loadInstalledApps())
  const [pendingInstalls, setPendingInstalls] = useState<PendingInstall[]>([])
  const [listingsLoading, setListingsLoading] = useState(false)
  const [listingsError, setListingsError] = useState<string | undefined>(undefined)
  const [listingDetailsCache, setListingDetailsCache] = useState<Record<string, StoreListingDetail>>(
    () => loadListingDetails(),
  )
  const [listingReviewsCache, setListingReviewsCache] = useState<Record<string, StoreReview[]>>(
    () => loadStoredListingReviews(),
  )
  const listingDetailPromisesRef = useRef(new Map<string, Promise<StoreListingDetail>>())
  const listingReviewPromisesRef = useRef(new Map<string, Promise<StoreReview[]>>())
  const [pendingAppStoreDetailSlug, setPendingAppStoreDetailSlug] = useState<string | undefined>(
    undefined,
  )
  const [appDataRevisions, setAppDataRevisions] = useState<Record<string, number>>({})
  const [storageRevision, setStorageRevision] = useState(0)

  useEffect(() => {
    if (!saveInstalledApps(installedApps)) {
      setListingsError('设备存储空间已满（5 MB 上限），无法保存应用数据。')
    }
  }, [installedApps])

  useEffect(() => {
    if (!saveStoreListings(listings)) {
      setListingsError('设备存储空间已满（5 MB 上限），无法保存应用商店列表。')
    }
  }, [listings])

  useEffect(() => {
    if (!saveListingDetails(listingDetailsCache)) {
      setListingsError('设备存储空间已满（5 MB 上限），无法保存应用详情。')
    }
  }, [listingDetailsCache])

  useEffect(() => {
    if (!saveListingReviews(listingReviewsCache)) {
      setListingsError('设备存储空间已满（5 MB 上限），无法保存应用评论。')
    }
  }, [listingReviewsCache])

  const refreshListings = useCallback(async (topic?: string) => {
    setListingsLoading(true)
    setListingsError(undefined)
    setListings([])
    try {
      await generateStoreListingsStreaming((listing) => {
        setListings((current) => [...current, listing])
      }, topic)
    } catch (error) {
      setListingsError(error instanceof Error ? error.message : '生成应用列表失败')
    } finally {
      setListingsLoading(false)
    }
  }, [])

  const getCachedListingDetail = useCallback(
    (slug: string) => listingDetailsCache[slug],
    [listingDetailsCache],
  )

  const getCachedListingReviews = useCallback(
    (slug: string) => listingReviewsCache[slug] ?? [],
    [listingReviewsCache],
  )

  const saveListingDetail = useCallback((slug: string, patch: Partial<StoreListingDetail>) => {
    setListingDetailsCache((current) => {
      const existing = current[slug]
      const merged: StoreListingDetail = {
        tagline: patch.tagline ?? existing?.tagline ?? '',
        longDescription: patch.longDescription ?? existing?.longDescription ?? '',
        developer: patch.developer ?? existing?.developer ?? '',
        compatibility: patch.compatibility ?? existing?.compatibility ?? '',
        language: patch.language ?? existing?.language ?? '',
      }
      return { ...current, [slug]: merged }
    })
  }, [])

  const loadListingDetail = useCallback(
    async (
      listing: StoreListing,
      onUpdate?: (partial: Partial<StoreListingDetail>) => void,
    ): Promise<StoreListingDetail> => {
      const cached = listingDetailsCache[listing.slug]
      if (cached) {
        onUpdate?.(cached)
        return cached
      }

      const inFlight = listingDetailPromisesRef.current.get(listing.slug)
      if (inFlight) {
        return inFlight
      }

      const promise = generateListingDetailStreaming(listing, (partial) => {
        onUpdate?.(partial)
      })
        .then((detail) => {
          setListingDetailsCache((current) => ({ ...current, [listing.slug]: detail }))
          listingDetailPromisesRef.current.delete(listing.slug)
          return detail
        })
        .catch((error) => {
          listingDetailPromisesRef.current.delete(listing.slug)
          throw error
        })

      listingDetailPromisesRef.current.set(listing.slug, promise)
      return promise
    },
    [listingDetailsCache],
  )

  const loadListingReviews = useCallback(
    async (
      listing: StoreListing,
      onReview?: (review: StoreReview) => void,
    ): Promise<StoreReview[]> => {
      const cached = listingReviewsCache[listing.slug]
      if (cached && cached.length > 0) {
        return cached
      }

      const inFlight = listingReviewPromisesRef.current.get(listing.slug)
      if (inFlight) {
        return inFlight
      }

      const promise = generateListingReviewsStreaming(listing, (review) => {
        setListingReviewsCache((current) => {
          const existing = current[listing.slug] ?? []
          if (existing.some((item) => item.id === review.id)) {
            return current
          }
          return { ...current, [listing.slug]: [...existing, review] }
        })
        onReview?.(review)
      })
        .then((reviews) => {
          setListingReviewsCache((current) => ({ ...current, [listing.slug]: reviews }))
          listingReviewPromisesRef.current.delete(listing.slug)
          return reviews
        })
        .catch((error) => {
          listingReviewPromisesRef.current.delete(listing.slug)
          throw error
        })

      listingReviewPromisesRef.current.set(listing.slug, promise)
      return promise
    },
    [listingReviewsCache],
  )

  const getInstalledApp = useCallback(
    (appId: GeneratedAppId) => installedApps.find((app) => app.id === appId),
    [installedApps],
  )

  const hasPendingUpdate = useCallback(
    (slug: string) => {
      const app = installedApps.find((item) => item.id === toGeneratedAppId(slug))
      return app?.pendingUpdate === true
    },
    [installedApps],
  )

  const canRollbackAppBySlug = useCallback(
    (slug: string) => {
      const app = installedApps.find((item) => item.id === toGeneratedAppId(slug))
      return app ? canRollbackApp(app) : false
    },
    [installedApps],
  )

  const getAppVersionCountBySlug = useCallback(
    (slug: string) => {
      const app = installedApps.find((item) => item.id === toGeneratedAppId(slug))
      return app ? getAppVersionCount(app) : 0
    },
    [installedApps],
  )

  const addUserReview = useCallback(
    (slug: string, body: string, rating = 5): boolean => {
      const trimmed = body.trim()
      if (!trimmed) {
        return false
      }

      const appId = toGeneratedAppId(slug)
      const app = installedApps.find((item) => item.id === appId)
      if (!app) {
        return false
      }

      const version = normalizeAppVersion(app.version)
      const review: StoreReview = {
        id: `user-${Date.now()}`,
        author: '你',
        rating: Math.max(1, Math.min(5, Math.round(rating))),
        body: trimmed,
        version,
        isUser: true,
        createdAt: Date.now(),
      }

      setListingReviewsCache((current) => ({
        ...current,
        [slug]: [...(current[slug] ?? []), review],
      }))

      setInstalledApps((current) =>
        current.map((item) => (item.id === appId ? { ...item, pendingUpdate: true } : item)),
      )
      return true
    },
    [installedApps],
  )

  const rollbackAppVersion = useCallback(
    (slug: string): boolean => {
      const appId = toGeneratedAppId(slug)
      const app = installedApps.find((item) => item.id === appId)
      if (!app) {
        return false
      }

      const rolledBack = rollbackAppRecord(app)
      if (!rolledBack) {
        return false
      }

      const nextApps = replaceInstalledApp(installedApps, appId, rolledBack)
      if (!saveInstalledApps(nextApps)) {
        setListingsError('设备存储空间已满（5 MB 上限），无法保存应用数据。')
        return false
      }

      setInstalledApps(nextApps)
      return true
    },
    [installedApps],
  )

  const pruneAppVersionHistory = useCallback(
    (appId: GeneratedAppId): boolean => {
      const app = installedApps.find((item) => item.id === appId)
      if (!app || getAppVersionCount(app) <= 1) {
        return false
      }

      const pruned = pruneArchivedVersions(app)
      const nextApps = replaceInstalledApp(installedApps, appId, pruned)
      if (!saveInstalledApps(nextApps)) {
        setListingsError('设备存储空间已满（5 MB 上限），无法保存应用数据。')
        return false
      }

      setInstalledApps(nextApps)
      return true
    },
    [installedApps],
  )

  const getPendingInstall = useCallback(
    (appId: GeneratedAppId) => pendingInstalls.find((item) => item.id === appId),
    [pendingInstalls],
  )

  const updatePendingInstall = useCallback((slug: string, patch: Partial<PendingInstall>) => {
    setPendingInstalls((current) =>
      current.map((item) => (item.listing.slug === slug ? { ...item, ...patch } : item)),
    )
  }, [])

  const runAppGeneration = useCallback(
    async (
      listing: StoreListing,
      detail: Partial<StoreListingDetail> | undefined,
      reviews: StoreReview[],
      existing?: GeneratedAppRecord,
    ) => {
      const appId = toGeneratedAppId(listing.slug)
      const currentVersion = normalizeAppVersion(existing?.version)
      const isUpdate = existing !== undefined && existing.pendingUpdate === true

      try {
        if (!isUpdate) {
          assertNewInstallAllowed(installedApps, appId)
        }

        if (pendingInstalls.some((item) => item.listing.slug === listing.slug)) {
          return
        }

        setListingsError(undefined)
        setPendingInstalls((current) => [...current, createPendingInstall(appId, listing)])

        const userFeedback = reviews.filter(
          (review) => review.isUser && normalizeAppVersion(review.version) === currentVersion,
        )
        const targetVersion = isUpdate ? nextAppVersion(currentVersion) : currentVersion

        const html = await generateAppHtmlStreaming(
          listing,
          (update) => {
            updatePendingInstall(listing.slug, {
              phase: update.phase,
              progress: update.progress,
              textLength: update.textLength,
            })
          },
          isUpdate && existing
            ? {
                ...buildGenerationContext(detail, reviews),
                update: {
                  existingHtml: existing.html,
                  currentVersion,
                  targetVersion,
                  userFeedback,
                },
              }
            : buildGenerationContext(detail, reviews),
        )

        const versions = appendVersionSnapshot(existing, targetVersion, html)
        const record: GeneratedAppRecord = migrateAppRecord({
          id: appId,
          name: listing.name,
          description: listing.description,
          category: listing.category,
          iconEmoji: listing.iconEmoji,
          themeColor: listing.themeColor,
          html,
          version: targetVersion,
          versions,
          pendingUpdate: false,
        })

        updatePendingInstall(listing.slug, { progress: 100, textLength: html.length, phase: 'generating' })

        await new Promise((resolve) => window.setTimeout(resolve, 320))

        if (!isUpdate) {
          assertNewInstallAllowed(loadInstalledApps(), appId)
        }

        const nextApps = replaceInstalledApp(installedApps, appId, record)
        if (!saveInstalledApps(nextApps)) {
          throw new DeviceStorageFullError()
        }

        setInstalledApps(nextApps)
        setPendingInstalls((current) => current.filter((item) => item.listing.slug !== listing.slug))
        openGeneratedApp(appId, listing.name)
      } catch (error) {
        setPendingInstalls((current) => current.filter((item) => item.listing.slug !== listing.slug))
        if (error instanceof DuplicateAppInstallError) {
          return
        }
        setListingsError(
          error instanceof DeviceStorageFullError
            ? error.message
            : error instanceof Error
              ? error.message
              : isUpdate
                ? '更新应用失败'
                : '生成应用失败',
        )
      }
    },
    [installedApps, pendingInstalls, openGeneratedApp, updatePendingInstall],
  )

  const installListing = useCallback(
    async (listing: StoreListing, detail?: Partial<StoreListingDetail>) => {
      const cachedDetail = getCachedListingDetail(listing.slug)
      const resolvedDetail = resolveListingDetailContext(listing, detail, cachedDetail)

      if (detail) {
        saveListingDetail(listing.slug, detail)
      }

      const appId = toGeneratedAppId(listing.slug)
      const existing = installedApps.find((app) => app.id === appId)
      const reviews = getCachedListingReviews(listing.slug)

      if (existing) {
        if (existing.pendingUpdate) {
          await runAppGeneration(listing, resolvedDetail, reviews, existing)
          return
        }
        openGeneratedApp(appId, existing.name)
        return
      }

      await runAppGeneration(listing, resolvedDetail, reviews)
    },
    [
      getCachedListingDetail,
      getCachedListingReviews,
      installedApps,
      openGeneratedApp,
      runAppGeneration,
      saveListingDetail,
    ],
  )

  const openInstalledApp = useCallback(
    (appId: GeneratedAppId) => {
      const app = installedApps.find((item) => item.id === appId)
      if (!app) return
      openGeneratedApp(appId, app.name)
    },
    [installedApps, openGeneratedApp],
  )

  const uninstallApp = useCallback(
    (appId: GeneratedAppId) => {
      setInstalledApps((current) => current.filter((app) => app.id !== appId))
      clearGeneratedAppData(appId)
      setAppDataRevisions((current) => {
        const next = { ...current }
        delete next[appId]
        return next
      })
      closeWindowsForApp(appId)
    },
    [closeWindowsForApp],
  )

  const clearAppData = useCallback((appId: GeneratedAppId) => {
    clearGeneratedAppData(appId)
    setAppDataRevisions((current) => ({
      ...current,
      [appId]: (current[appId] ?? 0) + 1,
    }))
    setStorageRevision((current) => current + 1)
  }, [])

  const getAppDataRevision = useCallback(
    (appId: GeneratedAppId) => appDataRevisions[appId] ?? 0,
    [appDataRevisions],
  )

  const pendingUpdateCount = useMemo(
    () => installedApps.filter((app) => app.pendingUpdate === true).length,
    [installedApps],
  )

  const openAppStoreDetail = useCallback(
    (slug: string) => {
      openApp('appstore')
      setPendingAppStoreDetailSlug(slug)
    },
    [openApp],
  )

  const clearPendingAppStoreDetail = useCallback(() => {
    setPendingAppStoreDetailSlug(undefined)
  }, [])

  const value = useMemo(
    () => ({
      listings,
      installedApps,
      pendingInstalls,
      listingsLoading,
      listingsError,
      refreshListings,
      loadListingDetail,
      getCachedListingDetail,
      saveListingDetail,
      loadListingReviews,
      getCachedListingReviews,
      addUserReview,
      hasPendingUpdate,
      canRollbackApp: canRollbackAppBySlug,
      getAppVersionCount: getAppVersionCountBySlug,
      rollbackAppVersion,
      pruneAppVersionHistory,
      openAppStoreDetail,
      pendingAppStoreDetailSlug,
      clearPendingAppStoreDetail,
      installListing,
      openInstalledApp,
      uninstallApp,
      clearAppData,
      getAppDataRevision,
      storageRevision,
      getInstalledApp,
      getPendingInstall,
      pendingUpdateCount,
    }),
    [
      listings,
      installedApps,
      pendingInstalls,
      listingsLoading,
      listingsError,
      refreshListings,
      loadListingDetail,
      getCachedListingDetail,
      saveListingDetail,
      loadListingReviews,
      getCachedListingReviews,
      addUserReview,
      hasPendingUpdate,
      canRollbackAppBySlug,
      getAppVersionCountBySlug,
      rollbackAppVersion,
      pruneAppVersionHistory,
      openAppStoreDetail,
      pendingAppStoreDetailSlug,
      clearPendingAppStoreDetail,
      installListing,
      openInstalledApp,
      uninstallApp,
      clearAppData,
      getAppDataRevision,
      storageRevision,
      getInstalledApp,
      getPendingInstall,
      pendingUpdateCount,
    ],
  )

  return <GeneratedAppsContext.Provider value={value}>{children}</GeneratedAppsContext.Provider>
}

export function useGeneratedApps() {
  const context = useContext(GeneratedAppsContext)
  if (!context) {
    throw new Error('useGeneratedApps must be used within GeneratedAppsProvider')
  }
  return context
}
