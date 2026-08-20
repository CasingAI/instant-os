import { useEffect, useRef, useState } from 'preact/hooks'
import { formatTextLengthK } from '../apps/appstore/format-text-length.ts'
import type { CompletedInstall, FailedInstall, PendingInstall } from '../apps/appstore/types.ts'
import {
  GITHUB_DESKTOP_MISSING_EMAIL_COPY,
  GITHUB_DESKTOP_MISSING_EMAIL_SLUG,
  messageForGithubDesktopMissingEmail,
  openGithubDesktopGitPrefs,
  SHOW_GITHUB_DESKTOP_MISSING_EMAIL_NOTIFICATION_EVENT,
} from '../apps/github-desktop/github-desktop-missing-email.ts'
import { patchExperimentalSettings } from './experimental-settings-storage.ts'
import { useGeneratedApps } from './generated-apps-context.tsx'
import {
  detailBodyForMountDisconnected,
  messageForMountDisconnected,
  MOUNT_DISCONNECTED_COPY,
  MOUNT_DISCONNECTED_SLUG,
  SHOW_MOUNT_DISCONNECTED_NOTIFICATION_EVENT,
  type MountDisconnectedNotificationDetail,
} from './mount-disconnected.ts'
import { useNotificationCenter } from './notification-center-context.tsx'
import {
  dismissOsNotification,
  getOsNotification,
  postOsNotification,
} from './os-notifications.ts'
import {
  PROCESS_ISOLATION_FALLBACK_COPY,
  PROCESS_ISOLATION_FALLBACK_EMOJI,
  PROCESS_ISOLATION_FALLBACK_SLUG,
  SHOW_PROCESS_ISOLATION_FALLBACK_NOTIFICATION_EVENT,
} from './process-isolation-fallback.ts'
import {
  areAllStorageWarningsRecovered,
  DATA_STORAGE_CHANGED_EVENT,
  evaluateStorageWarning,
  messageForStorageWarning,
  openSettingsUsageView,
  STORAGE_CHANGED_EVENT,
  STORAGE_WARNING_SLUG,
} from './storage-warning.ts'

const STORAGE_TILE = { kind: 'tile' as const, emoji: '💾', color: '#6d7d8f' }
const ISOLATION_TILE = {
  kind: 'tile' as const,
  emoji: PROCESS_ISOLATION_FALLBACK_EMOJI,
  color: '#e09f3e',
}
const MOUNT_TILE = { kind: 'tile' as const, emoji: '⏏', color: '#6d7d8f' }

function generatedPhaseLabel(phase: PendingInstall['phase'], isUpdate?: boolean): string {
  if (phase === 'waiting') {
    return '正在连接 AI…'
  }
  if (phase === 'thinking') {
    return isUpdate ? '正在思考更新方案…' : '正在思考应用方案…'
  }
  return isUpdate ? '正在更新应用…' : '正在生成应用…'
}

function postGeneratedPending(
  item: PendingInstall,
  handlers: {
    onDismiss?: () => void
  },
) {
  postOsNotification(
    {
      id: item.listing.slug,
      title: item.listing.name,
      subtitle: generatedPhaseLabel(item.phase, item.isUpdate),
      phase: 'running',
      icon: {
        kind: 'tile',
        emoji: item.listing.iconEmoji,
        color: item.listing.themeColor,
      },
      progress: {
        percent: item.progress,
        statLabel: '已输出',
        statValue: formatTextLengthK(item.textLength),
        textLength: item.textLength,
      },
      banner: 'progress',
      streamSlug: item.listing.slug,
      streamKind: 'install',
    },
    handlers,
  )
}

function postGeneratedFailed(
  item: FailedInstall,
  handlers: {
    onAction: Record<string, () => void>
    onDismiss: () => void
  },
) {
  postOsNotification(
    {
      id: item.listing.slug,
      title: item.listing.name,
      subtitle: item.isUpdate ? '更新失败' : '生成失败',
      phase: 'failure',
      icon: {
        kind: 'tile',
        emoji: item.listing.iconEmoji,
        color: item.listing.themeColor,
      },
      body: item.error,
      banner: 'once',
      streamSlug: item.listing.slug,
      streamKind: 'install',
      actions: [
        { id: 'retry', label: '重试', tone: 'primary' },
        { id: 'dismiss', label: '忽略' },
      ],
    },
    handlers,
  )
}

function postGeneratedCompleted(
  item: CompletedInstall,
  handlers: {
    onAction: Record<string, () => void>
    onDismiss: () => void
  },
) {
  postOsNotification(
    {
      id: item.listing.slug,
      title: item.listing.name,
      subtitle: item.isUpdate ? '更新完成 · 已就绪' : '安装完成 · 已就绪',
      phase: 'success',
      icon: {
        kind: 'tile',
        emoji: item.listing.iconEmoji,
        color: item.listing.themeColor,
      },
      banner: 'once',
      streamSlug: item.listing.slug,
      streamKind: 'install',
      actions: [
        { id: 'open', label: '打开', tone: 'primary' },
        { id: 'dismiss', label: '忽略' },
      ],
    },
    handlers,
  )
}

function GeneratedAppNotificationSync() {
  const {
    pendingInstalls,
    failedInstalls,
    completedInstalls,
    installListing,
    dismissFailedInstall,
    dismissCompletedInstall,
    openInstalledApp,
  } = useGeneratedApps()
  const { closeDetail, closePanel } = useNotificationCenter()
  const managedIdsRef = useRef(new Set<string>())

  useEffect(() => {
    const jobIds = new Set<string>()

    for (const item of pendingInstalls) {
      jobIds.add(item.listing.slug)
      postGeneratedPending(item, {})
    }

    for (const item of failedInstalls) {
      jobIds.add(item.listing.slug)
      postGeneratedFailed(item, {
        onAction: {
          retry: () => {
            closeDetail()
            dismissFailedInstall(item.id)
            void installListing(item.listing)
          },
          dismiss: () => {
            closeDetail()
            dismissOsNotification(item.listing.slug)
          },
        },
        onDismiss: () => {
          dismissFailedInstall(item.id)
        },
      })
    }

    for (const item of completedInstalls) {
      jobIds.add(item.listing.slug)
      postGeneratedCompleted(item, {
        onAction: {
          open: () => {
            openInstalledApp(item.id)
            dismissOsNotification(item.listing.slug)
            closePanel()
          },
          dismiss: () => {
            closeDetail()
            dismissOsNotification(item.listing.slug)
          },
        },
        onDismiss: () => {
          dismissCompletedInstall(item.id)
        },
      })
    }

    for (const id of managedIdsRef.current) {
      if (!jobIds.has(id) && getOsNotification(id)) {
        dismissOsNotification(id, { skipOnDismiss: true })
      }
    }
    managedIdsRef.current = jobIds
  }, [
    pendingInstalls,
    failedInstalls,
    completedInstalls,
    installListing,
    dismissFailedInstall,
    dismissCompletedInstall,
    openInstalledApp,
    closeDetail,
    closePanel,
  ])

  return null
}

function StorageWarningNotificationWatcher() {
  const { storageRevision } = useGeneratedApps()
  const { closeDetail, closePanel } = useNotificationCenter()
  const checkGenerationRef = useRef(0)
  const closeDetailRef = useRef(closeDetail)
  const closePanelRef = useRef(closePanel)
  const [storageEventTick, setStorageEventTick] = useState(0)
  closeDetailRef.current = closeDetail
  closePanelRef.current = closePanel

  useEffect(() => {
    const handleStorageChanged = () => {
      setStorageEventTick((value) => value + 1)
    }
    window.addEventListener(STORAGE_CHANGED_EVENT, handleStorageChanged)
    window.addEventListener(DATA_STORAGE_CHANGED_EVENT, handleStorageChanged)
    return () => {
      window.removeEventListener(STORAGE_CHANGED_EVENT, handleStorageChanged)
      window.removeEventListener(DATA_STORAGE_CHANGED_EVENT, handleStorageChanged)
    }
  }, [])

  useEffect(() => {
    const postWarning = async () => {
      const generation = ++checkGenerationRef.current
      const warning = await evaluateStorageWarning()
      if (generation !== checkGenerationRef.current) {
        return
      }
      if (warning) {
        const { title, subtitle } = messageForStorageWarning(warning.level, warning.scope)
        postOsNotification(
          {
            id: STORAGE_WARNING_SLUG,
            title,
            subtitle,
            phase: 'warning',
            icon: STORAGE_TILE,
            banner: 'once',
            actions: [
              { id: 'usage', label: '查看用量', tone: 'primary' },
              { id: 'dismiss', label: '忽略' },
            ],
          },
          {
            onAction: {
              usage: () => {
                openSettingsUsageView()
                closePanelRef.current()
                dismissOsNotification(STORAGE_WARNING_SLUG)
              },
              dismiss: () => {
                closeDetailRef.current()
                dismissOsNotification(STORAGE_WARNING_SLUG)
              },
            },
          },
        )
        return
      }
      if (await areAllStorageWarningsRecovered()) {
        if (generation !== checkGenerationRef.current) {
          return
        }
        if (getOsNotification(STORAGE_WARNING_SLUG)) {
          dismissOsNotification(STORAGE_WARNING_SLUG)
        }
      }
    }

    void postWarning()
  }, [storageRevision, storageEventTick])

  return null
}

function ProcessIsolationFallbackNotificationWatcher() {
  const { closeDetail } = useNotificationCenter()

  useEffect(() => {
    const handleShow = () => {
      postOsNotification(
        {
          id: PROCESS_ISOLATION_FALLBACK_SLUG,
          title: PROCESS_ISOLATION_FALLBACK_COPY.listTitle,
          subtitle: PROCESS_ISOLATION_FALLBACK_COPY.listSubtitle,
          phase: 'warning',
          icon: ISOLATION_TILE,
          body: PROCESS_ISOLATION_FALLBACK_COPY.detailBody,
          banner: 'once',
          actions: [
            { id: 'disable', label: PROCESS_ISOLATION_FALLBACK_COPY.disableButton, tone: 'primary' },
            { id: 'dismiss', label: PROCESS_ISOLATION_FALLBACK_COPY.dismissButton },
          ],
        },
        {
          onAction: {
            disable: () => {
              patchExperimentalSettings({ generatedAppProcessIsolation: false })
              closeDetail()
              dismissOsNotification(PROCESS_ISOLATION_FALLBACK_SLUG)
            },
            dismiss: () => {
              closeDetail()
              dismissOsNotification(PROCESS_ISOLATION_FALLBACK_SLUG)
            },
          },
        },
      )
    }

    window.addEventListener(SHOW_PROCESS_ISOLATION_FALLBACK_NOTIFICATION_EVENT, handleShow)
    return () =>
      window.removeEventListener(SHOW_PROCESS_ISOLATION_FALLBACK_NOTIFICATION_EVENT, handleShow)
  }, [closeDetail])

  return null
}

function MountDisconnectedNotificationWatcher() {
  const { closeDetail } = useNotificationCenter()

  useEffect(() => {
    const handleShow = (event: Event) => {
      const detail = (event as CustomEvent<MountDisconnectedNotificationDetail>).detail
      const label = detail?.label?.trim()
      if (!label) return
      const { title, subtitle } = messageForMountDisconnected(label)
      postOsNotification(
        {
          id: MOUNT_DISCONNECTED_SLUG,
          title,
          subtitle,
          phase: 'warning',
          icon: MOUNT_TILE,
          body: detailBodyForMountDisconnected(label),
          banner: 'once',
          actions: [{ id: 'dismiss', label: MOUNT_DISCONNECTED_COPY.dismissButton }],
        },
        {
          onAction: {
            dismiss: () => {
              closeDetail()
              dismissOsNotification(MOUNT_DISCONNECTED_SLUG)
            },
          },
        },
      )
    }

    window.addEventListener(SHOW_MOUNT_DISCONNECTED_NOTIFICATION_EVENT, handleShow)
    return () =>
      window.removeEventListener(SHOW_MOUNT_DISCONNECTED_NOTIFICATION_EVENT, handleShow)
  }, [closeDetail])

  return null
}

function GithubDesktopMissingEmailNotificationWatcher() {
  const { closeDetail, closePanel } = useNotificationCenter()

  useEffect(() => {
    const handleShow = () => {
      const { title, subtitle } = messageForGithubDesktopMissingEmail()
      postOsNotification(
        {
          id: GITHUB_DESKTOP_MISSING_EMAIL_SLUG,
          title,
          subtitle,
          phase: 'warning',
          icon: { kind: 'app', appId: 'github-desktop' },
          body: GITHUB_DESKTOP_MISSING_EMAIL_COPY.detailBody,
          banner: 'once',
          actions: [
            {
              id: 'prefs',
              label: GITHUB_DESKTOP_MISSING_EMAIL_COPY.openSettingsButton,
              tone: 'primary',
            },
            { id: 'dismiss', label: GITHUB_DESKTOP_MISSING_EMAIL_COPY.dismissButton },
          ],
        },
        {
          onAction: {
            prefs: () => {
              openGithubDesktopGitPrefs()
              closePanel()
              dismissOsNotification(GITHUB_DESKTOP_MISSING_EMAIL_SLUG)
            },
            dismiss: () => {
              closeDetail()
              dismissOsNotification(GITHUB_DESKTOP_MISSING_EMAIL_SLUG)
            },
          },
        },
      )
    }

    window.addEventListener(SHOW_GITHUB_DESKTOP_MISSING_EMAIL_NOTIFICATION_EVENT, handleShow)
    return () =>
      window.removeEventListener(SHOW_GITHUB_DESKTOP_MISSING_EMAIL_NOTIFICATION_EVENT, handleShow)
  }, [closeDetail, closePanel])

  return null
}

export function OsNotificationSources() {
  return (
    <>
      <GeneratedAppNotificationSync />
      <StorageWarningNotificationWatcher />
      <ProcessIsolationFallbackNotificationWatcher />
      <MountDisconnectedNotificationWatcher />
      <GithubDesktopMissingEmailNotificationWatcher />
    </>
  )
}
