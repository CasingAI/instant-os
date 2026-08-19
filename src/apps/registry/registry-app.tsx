import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { SettingsNavRow } from '../../ui/settings-nav-row.tsx'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import {
  APP_REGISTRY_QUOTA_BYTES,
  createGlobalRegistry,
  type GlobalNamespaceInfo,
} from '../../os/app-registry.ts'
import { entryValueType, type RegistryEntry } from '../../os/app-registry-db.ts'
import { APP_REGISTRY } from '../../os/app-registry.tsx'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import { KeychainNavStack, useKeychainNavStack } from '../keychain/keychain-nav-stack.tsx'
import { formatStorageSize } from '../../os/format-storage-size.ts'
import '../../ui/ios-nav-back.css'
import '../settings/settings.css'
import './registry.css'

const APP_ID = 'registry'
const DATE_TIME_LOCALE = 'zh-CN'

type Screen = 'root' | 'detail'

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length
}

function appLabel(appId: string): string {
  const builtin = APP_REGISTRY.find((app) => app.id === appId)
  if (builtin) {
    return `${builtin.name}（${appId}）`
  }
  if (appId.startsWith('gen:')) {
    return `生成应用：${appId.slice('gen:'.length)}`
  }
  return appId
}

function formatTimestamp(timestamp: number): string {
  if (!timestamp) {
    return '—'
  }
  return new Date(timestamp).toLocaleString(DATE_TIME_LOCALE)
}

function truncateValue(value: string, max = 180): string {
  if (value.length <= max) {
    return value
  }
  return `${value.slice(0, max)}…`
}

function valueTypeBadgeLabel(entry: RegistryEntry): string {
  const type = entryValueType(entry)
  if (type === 'json') {
    return 'JSON'
  }
  if (type === 'text') {
    return '文本'
  }
  return '未标注'
}

function summarizeEntryValue(entry: RegistryEntry): string {
  if (entryValueType(entry) !== 'json') {
    return truncateValue(entry.value)
  }
  try {
    return truncateValue(JSON.stringify(JSON.parse(entry.value) as unknown))
  } catch {
    return truncateValue(entry.value)
  }
}

type NamespaceListProps = {
  namespaces: GlobalNamespaceInfo[]
  onSelect: (appId: string) => void
}

function NamespaceList({ namespaces, onSelect }: NamespaceListProps) {
  return (
    <div class="settings__list">
      {namespaces
        .sort((left, right) => right.bytes - left.bytes)
        .map((namespace) => (
          <SettingsNavRow
            key={namespace.appId}
            label={
              <span class="registry__row-meta">
                <span>{appLabel(namespace.appId)}</span>
                <span class="settings__row-key-detail">
                  {namespace.keyCount} 键 · 更新于 {formatTimestamp(namespace.updatedAt)}
                </span>
              </span>
            }
            value={formatStorageSize(namespace.bytes)}
            onClick={() => onSelect(namespace.appId)}
          />
        ))}
    </div>
  )
}

type RegistryEntryRowProps = {
  entry: RegistryEntry
  deleting: boolean
  onDelete: () => void
}

function RegistryEntryRow({ entry, deleting, onDelete }: RegistryEntryRowProps) {
  return (
    <div class="settings__row settings__row--static registry__row--entry">
      <span class="registry__row-keys">
        <span class="registry__row-key-line">
          <span class="settings__row-key">{entry.key}</span>
          <span class="settings__row-badge">{valueTypeBadgeLabel(entry)}</span>
        </span>
        <span class="settings__row-key-detail">
          {summarizeEntryValue(entry)} · 更新于 {formatTimestamp(entry.updatedAt)}
        </span>
      </span>
      <span class="settings__row-size">{formatStorageSize(utf8Length(entry.value))}</span>
      <button
        type="button"
        class="settings__row-action"
        disabled={deleting}
        onClick={onDelete}
      >
        {deleting ? '删除中…' : '删除'}
      </button>
    </div>
  )
}

export function RegistryApp() {
  const { closeWindowsForApp, minimizeWindow, windows } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const modal = useWindowModal()

  const [namespaces, setNamespaces] = useState<GlobalNamespaceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedAppId, setSelectedAppId] = useState<string | undefined>(undefined)
  const [entries, setEntries] = useState<RegistryEntry[]>([])
  const [entriesLoading, setEntriesLoading] = useState(false)
  const [deletingKey, setDeletingKey] = useState<string | undefined>(undefined)
  const [clearing, setClearing] = useState(false)

  const {
    page: screen,
    stack: navStack,
    transition: navTransition,
    queuedTransition: navQueuedTransition,
    commitQueuedTransition: commitNavQueuedTransition,
    navigate: navigateTo,
    handleMotionEnd: handleStackMotionEnd,
  } = useKeychainNavStack<Screen>('root')

  const reloadNamespaces = useCallback(async () => {
    setLoading(true)
    try {
      setNamespaces(await createGlobalRegistry().listNamespaces())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reloadNamespaces()
  }, [reloadNamespaces])

  useEffect(() => {
    if (!selectedAppId) {
      setEntries([])
      return
    }
    let alive = true
    setEntriesLoading(true)
    createGlobalRegistry()
      .listNamespaceEntries(selectedAppId)
      .then((next) => {
        if (alive) {
          setEntries(next)
        }
      })
      .finally(() => {
        if (alive) {
          setEntriesLoading(false)
        }
      })
    return () => {
      alive = false
    }
  }, [selectedAppId])

  const handleDeleteKey = async (key: string) => {
    if (!selectedAppId || deletingKey !== undefined) {
      return
    }
    setDeletingKey(key)
    try {
      await createGlobalRegistry().removeItem(selectedAppId, key)
      setEntries((current) => current.filter((entry) => entry.key !== key))
      await reloadNamespaces()
    } finally {
      setDeletingKey(undefined)
    }
  }

  const handleClearNamespace = async () => {
    if (!selectedAppId || clearing) {
      return
    }
    setClearing(true)
    try {
      await createGlobalRegistry().clearNamespace(selectedAppId)
      setEntries([])
      await reloadNamespaces()
    } finally {
      setClearing(false)
    }
  }

  const handleConfirmClear = async () => {
    if (!selectedAppId || clearing) {
      return
    }
    const confirmed = await modal.confirm({
      title: `清空「${appLabel(selectedAppId)}」？`,
      message: '该应用在注册表中的全部数据将被删除，此操作不可撤销。',
      confirmLabel: '清空',
      confirmTone: 'danger',
    })
    if (!confirmed) {
      return
    }
    await handleClearNamespace()
  }

  const openNamespace = useCallback(
    (appId: string) => {
      setSelectedAppId(appId)
      navigateTo('detail', 'push')
    },
    [navigateTo],
  )

  const closeDetail = useCallback(() => {
    navigateTo('root', 'pop', () => setSelectedAppId(undefined))
  }, [navigateTo])

  const appWindow = windows.find((window) => window.appId === APP_ID && !window.minimized)

  const menuBar = useMemo<MenuDefinition[]>(() => {
    return [
      {
        label: '注册表',
        items: [
          ...aboutAppMenuPrefix('关于注册表', () => showBuiltinAbout('registry')),
          {
            type: 'action',
            label: '刷新',
            shortcut: '⌘R',
            onClick: () => void reloadNamespaces(),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '隐藏注册表',
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出注册表',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp(APP_ID),
          },
        ],
      },
    ]
  }, [appWindow, closeWindowsForApp, minimizeWindow, reloadNamespaces, showBuiltinAbout])

  useAppMenuBar(APP_ID, menuBar)

  const renderPage = (target: Screen) => {
    if (target === 'detail') {
      if (!selectedAppId) {
        return null
      }
      const namespace = namespaces.find((item) => item.appId === selectedAppId)
      return (
        <>
          <div class="settings__nav settings__nav--titled">
            <div class="settings__nav-bar">
              <IosNavBackButton label="注册表管理" onClick={closeDetail} />
              <h1 class="settings__nav-heading">{appLabel(selectedAppId)}</h1>
              {entries.length > 0 ? (
                <div class="settings__nav-trailing">
                  <button
                    type="button"
                    class="settings__btn settings__btn--danger"
                    disabled={clearing}
                    onClick={() => void handleConfirmClear()}
                  >
                    {clearing ? '清空中…' : '清空'}
                  </button>
                </div>
              ) : (
                <span class="settings__nav-trailing" aria-hidden="true" />
              )}
            </div>
          </div>
          <div class="settings__content settings__content--compact">
            <section class="settings__section">
              <p class="settings__section-footnote">
                {namespace?.keyCount ?? entries.length} 键 ·{' '}
                {formatStorageSize(namespace?.bytes ?? 0)} /{' '}
                {formatStorageSize(APP_REGISTRY_QUOTA_BYTES)}
              </p>
              {entriesLoading ? (
                <div class="settings__loading">
                  <div class="settings__loading-spinner" />
                  <span>加载中…</span>
                </div>
              ) : entries.length === 0 ? (
                <div class="settings__box settings__empty">该命名空间暂无数据</div>
              ) : (
                <div class="settings__list">
                  <div class="settings__list-head">
                    <span>键</span>
                    <span>大小</span>
                  </div>
                  <div class="settings__list-body settings__list-body--keys">
                    {entries.map((entry) => (
                      <RegistryEntryRow
                        key={entry.key}
                        entry={entry}
                        deleting={deletingKey === entry.key}
                        onDelete={() => void handleDeleteKey(entry.key)}
                      />
                    ))}
                  </div>
                </div>
              )}
              <p class="settings__section-footnote">
                内置应用按字段拆分为独立 key（cities / sessions / articles 等），便于单独查看与删除；
                生成应用则每个键独立存储。本工具只读 / 只删，不支持修改；删除后该应用下次写入会重建。
              </p>
            </section>
          </div>
        </>
      )
    }

    return (
      <>
        <div class="settings__nav settings__nav--titled">
          <div class="settings__nav-bar">
            <span class="settings__nav-heading-spacer" aria-hidden="true" />
            <h1 class="settings__nav-heading">注册表管理</h1>
            <span class="settings__nav-trailing" aria-hidden="true" />
          </div>
        </div>
        <div class="settings__content settings__content--compact">
          <section class="settings__section">
            <p class="settings__section-subtitle">
              应用注册表（IndexedDB）按应用命名空间存储数据，单个应用上限{' '}
              {formatStorageSize(APP_REGISTRY_QUOTA_BYTES)}
            </p>
            {loading ? (
              <div class="settings__loading">
                <div class="settings__loading-spinner" />
                <span>加载中…</span>
              </div>
            ) : namespaces.length === 0 ? (
              <div class="settings__box settings__empty">注册表暂无应用数据</div>
            ) : (
              <NamespaceList namespaces={namespaces} onSelect={openNamespace} />
            )}
            <p class="settings__section-footnote">
              点击命名空间可查看字段级键条目并删除单个键或清空整个命名空间。
            </p>
          </section>
        </div>
      </>
    )
  }

  return (
    <KeychainNavStack
      stack={navStack}
      page={screen}
      transition={navTransition}
      queuedTransition={navQueuedTransition}
      commitQueuedTransition={commitNavQueuedTransition}
      onMotionEnd={handleStackMotionEnd}
      renderPage={renderPage}
    />
  )
}
