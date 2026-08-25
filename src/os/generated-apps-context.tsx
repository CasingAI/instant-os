import type { ComponentChildren } from 'preact'
import { osNowMs } from './os-clock.ts'
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
  CompletedInstall,
  FailedInstall,
  GeneratedAppRecord,
  PendingInstall,
  StoreListing,
  StoreListingDetail,
  StoreReview,
} from '../apps/appstore/types.ts'
import { DeviceStorageFullError } from './device-storage.ts'
import { getDataCapacityBytes } from './device-data-storage.ts'
import { formatStorageSize } from './format-storage-size.ts'
import { clearGeneratedAppData } from './generated-app-data-storage.ts'
import { loadInstalledApps, saveInstalledApps } from './generated-apps-storage.ts'
import { hydrateInstalledAppsFromFiles, rebuildVersionsLayoutRecord } from './generated-apps-store.ts'
import {
  bundleIcodeFormalVersion,
  copyInstalledAppToIcodePackage,
  createIcodeManagedAppPackage,
  migrateLegacyIcodeInternalProjectsOnce,
  newIcodeAppId,
  publishIcodeAppDraft,
  type IcodeAppIdentity,
} from './icode-managed-apps.ts'
import {
  createFormalVersionFrom,
  removeFormalVersionTree,
} from './generated-app-versions-layout.ts'
import { invalidateAppCatalogCache } from './app-catalog.ts'
import {
  loadLauncherLayout,
  removeAppFromLauncherLayout,
  saveLauncherLayout,
} from './launcher-layout-storage.ts'
import { clearPendingInstallStream, setPendingInstallStream } from './pending-install-stream.ts'
import { loadListingDetails, saveListingDetails } from './listing-details-storage.ts'
import { loadListingReviews as loadStoredListingReviews, saveListingReviews } from './listing-reviews-storage.ts'
import { loadStoreListings, saveStoreListings } from './store-listings-storage.ts'
import { useOs } from './os-context.tsx'
import type { GeneratedAppId } from './types.ts'

type GeneratedAppsContextValue = {
  listings: StoreListing[]
  installedApps: GeneratedAppRecord[]
  pendingInstalls: PendingInstall[]
  failedInstalls: FailedInstall[]
  completedInstalls: CompletedInstall[]
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
  removeUserReview: (slug: string, reviewId: string) => boolean
  hasPendingUpdate: (slug: string) => boolean
  canRollbackApp: (slug: string) => boolean
  getAppVersionCount: (slug: string) => number
  rollbackAppVersion: (slug: string) => boolean
  pruneAppVersionHistory: (appId: GeneratedAppId) => boolean
  openMarketplaceDetail: (slug: string) => void
  pendingMarketplaceDetailSlug: string | undefined
  clearPendingMarketplaceDetail: () => void
  openIcodeApp: (appId: GeneratedAppId) => void
  pendingIcodeAppId: GeneratedAppId | undefined
  clearPendingIcodeApp: () => void
  installListing: (listing: StoreListing, detail?: Partial<StoreListingDetail>) => Promise<void>
  openInstalledApp: (appId: GeneratedAppId) => void
  uninstallApp: (appId: GeneratedAppId) => void
  clearAppData: (appId: GeneratedAppId) => void
  getAppDataRevision: (appId: GeneratedAppId) => number
  storageRevision: number
  getInstalledApp: (appId: GeneratedAppId) => GeneratedAppRecord | undefined
  getPendingInstall: (appId: GeneratedAppId) => PendingInstall | undefined
  getFailedInstall: (appId: GeneratedAppId) => FailedInstall | undefined
  getCompletedInstall: (appId: GeneratedAppId) => CompletedInstall | undefined
  dismissFailedInstall: (appId: GeneratedAppId) => void
  dismissCompletedInstall: (appId: GeneratedAppId) => void
  clearDismissibleInstallNotifications: () => void
  pendingUpdateCount: number
  /** 第一期：创建一个 iCode 管理的版本布局应用包并注册桌面记录（占位身份） */
  createIcodeManagedApp: (input: {
    identity: IcodeAppIdentity
    icodeProjectId?: string
    templateFiles?: Array<{ path: string; text: string }>
  }) => Promise<GeneratedAppId | undefined>
  /** 发布/治理/导入之后：从包内最大正式版清单重建运行时记录 */
  refreshIcodeManagedApp: (appId: GeneratedAppId) => Promise<void>
  /** 发布：草稿升格为新最大正式号（含立即再拷新草稿），刷新桌面记录 */
  publishIcodeApp: (appId: GeneratedAppId) => Promise<number | undefined>
  /** 从商店/已安装应用复制出新身份的 iCode 应用（只带当前在跑的那一版） */
  copyInstalledAppToIcode: (appId: GeneratedAppId) => Promise<GeneratedAppId | undefined>
  /** 第二期·删除非最大号旧档 */
  deleteIcodeFormalVersion: (appId: GeneratedAppId, version: number) => Promise<boolean>
  /** 第二期·基于某一正式版再接一档新的最大号 */
  createIcodeAppVersionFrom: (
    appId: GeneratedAppId,
    baseVersion: number,
  ) => Promise<number | undefined>
}

const GeneratedAppsContext = createContext<GeneratedAppsContextValue | undefined>(undefined)

function createPendingInstall(appId: GeneratedAppId, listing: StoreListing, isUpdate = false): PendingInstall {
  return {
    id: appId,
    listing,
    progress: 0,
    textLength: 0,
    phase: 'waiting',
    isUpdate,
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
  const [failedInstalls, setFailedInstalls] = useState<FailedInstall[]>([])
  const [completedInstalls, setCompletedInstalls] = useState<CompletedInstall[]>([])
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
  const [pendingMarketplaceDetailSlug, setPendingMarketplaceDetailSlug] = useState<string | undefined>(
    undefined,
  )
  const [pendingIcodeAppId, setPendingIcodeAppId] = useState<GeneratedAppId | undefined>(undefined)
  const [appDataRevisions, setAppDataRevisions] = useState<Record<string, number>>({})
  const [storageRevision, setStorageRevision] = useState(0)

  // 启动 hydrate：从文件 Contents 载入完整记录到内存，同步 state 并失效 catalog 缓存。
  // boot 流程已先于 render hydrate，此 effect 作为兜底（失败/其他入口时重新载入）。
  // 第一期：hydrate 之后顺带做旧「iCode 内部项目」一次性迁移（改写成版本布局包）。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      await hydrateInstalledAppsFromFiles()
      const migration = await migrateLegacyIcodeInternalProjectsOnce({
        getInstalledApps: () => loadInstalledApps(),
      })
      if (migration.changed) {
        for (const appId of migration.appIds) {
          await rebuildVersionsLayoutRecord(appId)
        }
      }
      if (cancelled) return
      const fromCache = loadInstalledApps()
      setInstalledApps((current) =>
        fromCache.length === current.length &&
        fromCache.every((app, index) => app.id === current[index]?.id)
          ? current
          : fromCache,
      )
      invalidateAppCatalogCache()
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 持久化：installedApps 任一变化（含回滚/裁剪/卸载/发布等）差分写 Contents。
  // 采用 fire-and-forget（同步 API 保持调用点签名），失败时异步提示。
  useEffect(() => {
    void saveInstalledApps(installedApps).then((ok) => {
      if (!ok) {
        setListingsError(`数据空间已满（${formatStorageSize(getDataCapacityBytes())} 上限），无法保存应用。`)
      }
    })
  }, [installedApps])

  useEffect(() => {
    if (!saveStoreListings(listings)) {
      setListingsError('设备存储空间已满（5 MB 上限），无法保存应用集市列表。')
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
        id: `user-${osNowMs()}`,
        author: '你',
        rating: Math.max(1, Math.min(5, Math.round(rating))),
        body: trimmed,
        version,
        isUser: true,
        createdAt: osNowMs(),
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

  const removeUserReview = useCallback(
    (slug: string, reviewId: string): boolean => {
      const appId = toGeneratedAppId(slug)
      const app = installedApps.find((item) => item.id === appId)
      let removed = false
      let nextReviews: StoreReview[] = []

      setListingReviewsCache((current) => {
        const cached = current[slug]
        if (!cached) {
          return current
        }

        const review = cached.find((item) => item.id === reviewId)
        if (!review?.isUser) {
          return current
        }

        removed = true
        nextReviews = cached.filter((item) => item.id !== reviewId)
        return { ...current, [slug]: nextReviews }
      })

      if (!removed) {
        return false
      }

      if (app?.pendingUpdate) {
        const currentVersion = normalizeAppVersion(app.version)
        const hasFeedbackForVersion = nextReviews.some(
          (item) => item.isUser && normalizeAppVersion(item.version) === currentVersion,
        )
        if (!hasFeedbackForVersion) {
          setInstalledApps((current) =>
            current.map((item) => (item.id === appId ? { ...item, pendingUpdate: false } : item)),
          )
        }
      }

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
      void saveInstalledApps(nextApps).then((ok) => {
        if (!ok) setListingsError(`数据空间已满（${formatStorageSize(getDataCapacityBytes())} 上限），无法保存应用。`)
      })
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
      void saveInstalledApps(nextApps).then((ok) => {
        if (!ok) setListingsError(`数据空间已满（${formatStorageSize(getDataCapacityBytes())} 上限），无法保存应用。`)
      })

      setInstalledApps(nextApps)
      return true
    },
    [installedApps],
  )

  const getPendingInstall = useCallback(
    (appId: GeneratedAppId) => pendingInstalls.find((item) => item.id === appId),
    [pendingInstalls],
  )

  const getFailedInstall = useCallback(
    (appId: GeneratedAppId) => failedInstalls.find((item) => item.id === appId),
    [failedInstalls],
  )

  const dismissFailedInstall = useCallback((appId: GeneratedAppId) => {
    setFailedInstalls((current) => {
      const failed = current.find((item) => item.id === appId)
      if (!failed) {
        return current
      }
      clearPendingInstallStream(failed.listing.slug)
      return current.filter((item) => item.id !== appId)
    })
  }, [])

  const getCompletedInstall = useCallback(
    (appId: GeneratedAppId) => completedInstalls.find((item) => item.id === appId),
    [completedInstalls],
  )

  const dismissCompletedInstall = useCallback((appId: GeneratedAppId) => {
    setCompletedInstalls((current) => {
      const completed = current.find((item) => item.id === appId)
      if (!completed) {
        return current
      }
      clearPendingInstallStream(completed.listing.slug)
      return current.filter((item) => item.id !== appId)
    })
  }, [])

  const clearDismissibleInstallNotifications = useCallback(() => {
    setFailedInstalls((current) => {
      for (const item of current) {
        clearPendingInstallStream(item.listing.slug)
      }
      return []
    })
    setCompletedInstalls((current) => {
      for (const item of current) {
        clearPendingInstallStream(item.listing.slug)
      }
      return []
    })
  }, [])

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
        setFailedInstalls((current) => current.filter((item) => item.listing.slug !== listing.slug))
        setCompletedInstalls((current) => current.filter((item) => item.listing.slug !== listing.slug))
        setPendingInstallStream(listing.slug, { reasoningText: '', rawText: '' })
        setPendingInstalls((current) => [...current, createPendingInstall(appId, listing, isUpdate)])

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
          tags: listing.tags,
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

        const nextApps = replaceInstalledApp(loadInstalledApps(), appId, record)
        if (!(await saveInstalledApps(nextApps))) {
          throw new DeviceStorageFullError()
        }

        setInstalledApps(nextApps)
        setPendingInstalls((current) => current.filter((item) => item.listing.slug !== listing.slug))
        setCompletedInstalls((current) => [
          ...current.filter((item) => item.id !== appId),
          {
            id: appId,
            listing,
            isUpdate,
            completedAt: osNowMs(),
          },
        ])
        openGeneratedApp(appId, listing.name)
      } catch (error) {
        setPendingInstalls((current) => current.filter((item) => item.listing.slug !== listing.slug))
        closeWindowsForApp(appId)
        if (error instanceof DuplicateAppInstallError) {
          return
        }
        const message =
          error instanceof DeviceStorageFullError
            ? error.message
            : error instanceof Error
              ? error.message
              : isUpdate
                ? '更新应用失败'
                : '生成应用失败'
        setListingsError(message)
        setFailedInstalls((current) => [
          ...current.filter((item) => item.id !== appId),
          {
            id: appId,
            listing,
            error: message,
            isUpdate,
            failedAt: osNowMs(),
          },
        ])
      }
    },
    [installedApps, pendingInstalls, closeWindowsForApp, openGeneratedApp, updatePendingInstall],
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
      dismissFailedInstall(appId)
      dismissCompletedInstall(appId)
      clearGeneratedAppData(appId)
      setAppDataRevisions((current) => {
        const next = { ...current }
        delete next[appId]
        return next
      })
      saveLauncherLayout(removeAppFromLauncherLayout(loadLauncherLayout(), appId))
      closeWindowsForApp(appId)
    },
    [closeWindowsForApp, dismissCompletedInstall, dismissFailedInstall],
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

  const openMarketplaceDetail = useCallback(
    (slug: string) => {
      openApp('appstore')
      setPendingMarketplaceDetailSlug(slug)
    },
    [openApp],
  )

  const clearPendingMarketplaceDetail = useCallback(() => {
    setPendingMarketplaceDetailSlug(undefined)
  }, [])

  const openIcodeApp = useCallback(
    (appId: GeneratedAppId) => {
      openApp('icode')
      setPendingIcodeAppId(appId)
    },
    [openApp],
  )

  const clearPendingIcodeApp = useCallback(() => {
    setPendingIcodeAppId(undefined)
  }, [])

  // ---- 第一期：iCode 管理的版本布局应用 ----

  const refreshIcodeManagedApp = useCallback(async (appId: GeneratedAppId) => {
    const record = await rebuildVersionsLayoutRecord(appId)
    if (!record) return
    setInstalledApps((current) => {
      const next = replaceInstalledApp(current, appId, record)
      return next
    })
    invalidateAppCatalogCache()
  }, [])

  const createIcodeManagedApp = useCallback(
    async (input: {
      identity: IcodeAppIdentity
      icodeProjectId?: string
      templateFiles?: Array<{ path: string; text: string }>
    }): Promise<GeneratedAppId | undefined> => {
      const appId = newIcodeAppId()
      try {
        await createIcodeManagedAppPackage({ appId, ...input })
      } catch (error) {
        console.error('[icode] 创建应用包失败', error)
        return undefined
      }
      const record = await rebuildVersionsLayoutRecord(appId)
      if (!record) return undefined
      setInstalledApps((current) => [...current, record])
      invalidateAppCatalogCache()
      return appId
    },
    [],
  )

  const publishIcodeApp = useCallback(
    async (appId: GeneratedAppId): Promise<number | undefined> => {
      try {
        const version = await publishIcodeAppDraft(appId)
        // 升格之后立刻在用户浏览器里打单文件写入该号 Dist；
        // 工程树打包失败则该号无产物（桌面明确失败态），版本与草稿保持完好
        const bundle = await bundleIcodeFormalVersion(appId, version)
        if (bundle.kind === 'failed') {
          console.error('[icode] 发布打包失败', bundle.error)
        }
        await refreshIcodeManagedApp(appId)
        return version
      } catch (error) {
        console.error('[icode] 发布失败', error)
        return undefined
      }
    },
    [refreshIcodeManagedApp],
  )

  const copyInstalledAppToIcode = useCallback(
    async (appId: GeneratedAppId): Promise<GeneratedAppId | undefined> => {
      const record = installedApps.find((app) => app.id === appId)
      if (!record) return undefined
      const newAppId = newIcodeAppId()
      try {
        await copyInstalledAppToIcodePackage({ record, newAppId })
      } catch (error) {
        console.error('[icode] 复制应用失败', error)
        return undefined
      }
      const newRecord = await rebuildVersionsLayoutRecord(newAppId)
      if (!newRecord) return undefined
      setInstalledApps((current) => [...current, newRecord])
      invalidateAppCatalogCache()
      return newAppId
    },
    [installedApps],
  )

  const deleteIcodeFormalVersion = useCallback(
    async (appId: GeneratedAppId, version: number): Promise<boolean> => {
      try {
        await removeFormalVersionTree(appId, version)
        await refreshIcodeManagedApp(appId)
        return true
      } catch (error) {
        console.error('[icode] 删除旧档失败', error)
        return false
      }
    },
    [refreshIcodeManagedApp],
  )

  const createIcodeAppVersionFrom = useCallback(
    async (appId: GeneratedAppId, baseVersion: number): Promise<number | undefined> => {
      try {
        const version = await createFormalVersionFrom(appId, baseVersion)
        await refreshIcodeManagedApp(appId)
        return version
      } catch (error) {
        console.error('[icode] 基于旧档接新号失败', error)
        return undefined
      }
    },
    [refreshIcodeManagedApp],
  )

  const value = useMemo(
    () => ({
      listings,
      installedApps,
      pendingInstalls,
      failedInstalls,
      completedInstalls,
      listingsLoading,
      listingsError,
      refreshListings,
      loadListingDetail,
      getCachedListingDetail,
      saveListingDetail,
      loadListingReviews,
      getCachedListingReviews,
      addUserReview,
      removeUserReview,
      hasPendingUpdate,
      canRollbackApp: canRollbackAppBySlug,
      getAppVersionCount: getAppVersionCountBySlug,
      rollbackAppVersion,
      pruneAppVersionHistory,
      openMarketplaceDetail,
      pendingMarketplaceDetailSlug,
      clearPendingMarketplaceDetail,
      openIcodeApp,
      pendingIcodeAppId,
      clearPendingIcodeApp,
      installListing,
      openInstalledApp,
      uninstallApp,
      clearAppData,
      getAppDataRevision,
      storageRevision,
      getInstalledApp,
      getPendingInstall,
      getFailedInstall,
      getCompletedInstall,
      dismissFailedInstall,
      dismissCompletedInstall,
      clearDismissibleInstallNotifications,
      pendingUpdateCount,
      createIcodeManagedApp,
      refreshIcodeManagedApp,
      publishIcodeApp,
      copyInstalledAppToIcode,
      deleteIcodeFormalVersion,
      createIcodeAppVersionFrom,
    }),
    [
      listings,
      installedApps,
      pendingInstalls,
      failedInstalls,
      completedInstalls,
      listingsLoading,
      listingsError,
      refreshListings,
      loadListingDetail,
      getCachedListingDetail,
      saveListingDetail,
      loadListingReviews,
      getCachedListingReviews,
      addUserReview,
      removeUserReview,
      hasPendingUpdate,
      canRollbackAppBySlug,
      getAppVersionCountBySlug,
      rollbackAppVersion,
      pruneAppVersionHistory,
      openMarketplaceDetail,
      pendingMarketplaceDetailSlug,
      clearPendingMarketplaceDetail,
      openIcodeApp,
      pendingIcodeAppId,
      clearPendingIcodeApp,
      installListing,
      openInstalledApp,
      uninstallApp,
      clearAppData,
      getAppDataRevision,
      storageRevision,
      getInstalledApp,
      getPendingInstall,
      getFailedInstall,
      getCompletedInstall,
      dismissFailedInstall,
      dismissCompletedInstall,
      clearDismissibleInstallNotifications,
      pendingUpdateCount,
      createIcodeManagedApp,
      refreshIcodeManagedApp,
      publishIcodeApp,
      copyInstalledAppToIcode,
      deleteIcodeFormalVersion,
      createIcodeAppVersionFrom,
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
