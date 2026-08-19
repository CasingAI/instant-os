import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Ref } from 'preact'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { SettingsNavRow } from '../../ui/settings-nav-row.tsx'
import { useAppNarrowLayout } from '../../ui/use-app-narrow-layout.ts'
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

function sortedNamespaces(namespaces: GlobalNamespaceInfo[]): GlobalNamespaceInfo[] {
  return [...namespaces].sort((left, right) => right.bytes - left.bytes)
}

/** 与 `.settings` 面板纵向渐变 (#ececec → #d8d8d8) 对齐 */
function settingsPanelColorAt(ratio: number): string {
  const t = Math.min(1, Math.max(0, ratio))
  const channel = (top: number, bottom: number) =>
    Math.round(top + (bottom - top) * t)
  const r = channel(0xec, 0xd8)
  const g = channel(0xec, 0xd8)
  const b = channel(0xec, 0xd8)
  return `rgb(${r}, ${g}, ${b})`
}

type NamespaceListProps = {
  namespaces: GlobalNamespaceInfo[]
  selectedAppId?: string
  selectedRowRef?: Ref<HTMLButtonElement>
  onSelect: (appId: string) => void
}

function NamespaceList({
  namespaces,
  selectedAppId,
  selectedRowRef,
  onSelect,
}: NamespaceListProps) {
  return (
    <div class="settings__list">
      {sortedNamespaces(namespaces).map((namespace) => (
        <SettingsNavRow
          key={namespace.appId}
          selected={namespace.appId === selectedAppId}
          rowRef={namespace.appId === selectedAppId ? selectedRowRef : undefined}
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

type RegistryRootPaneProps = {
  namespaces: GlobalNamespaceInfo[]
  loading: boolean
  selectedAppId?: string
  selectedRowRef?: Ref<HTMLButtonElement>
  footnote: string
  onSelect: (appId: string) => void
}

function RegistryRootPane({
  namespaces,
  loading,
  selectedAppId,
  selectedRowRef,
  footnote,
  onSelect,
}: RegistryRootPaneProps) {
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
            <NamespaceList
              namespaces={namespaces}
              selectedAppId={selectedAppId}
              selectedRowRef={selectedRowRef}
              onSelect={onSelect}
            />
          )}
          <p class="settings__section-footnote">{footnote}</p>
        </section>
      </div>
    </>
  )
}

type RegistryDetailPaneProps = {
  selectedAppId: string
  namespace: GlobalNamespaceInfo | undefined
  entries: RegistryEntry[]
  entriesLoading: boolean
  deletingKey: string | undefined
  clearing: boolean
  showBack: boolean
  onBack?: () => void
  onDeleteKey: (key: string) => void
  onConfirmClear: () => void
}

function RegistryDetailPane({
  selectedAppId,
  namespace,
  entries,
  entriesLoading,
  deletingKey,
  clearing,
  showBack,
  onBack,
  onDeleteKey,
  onConfirmClear,
}: RegistryDetailPaneProps) {
  return (
    <>
      <div class="settings__nav settings__nav--titled">
        <div class="settings__nav-bar">
          {showBack && onBack ? (
            <IosNavBackButton label="注册表管理" onClick={onBack} />
          ) : (
            <span class="settings__nav-heading-spacer" aria-hidden="true" />
          )}
          <h1 class="settings__nav-heading">{appLabel(selectedAppId)}</h1>
          {entries.length > 0 ? (
            <div class="settings__nav-trailing">
              <button
                type="button"
                class="settings__btn settings__btn--danger"
                disabled={clearing}
                onClick={onConfirmClear}
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
          {entriesLoading && entries.length === 0 ? (
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
                    onDelete={() => onDeleteKey(entry.key)}
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

function RegistryDetailEmpty() {
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
        <div class="settings__box settings__empty">选择左侧应用以查看注册表键</div>
      </div>
    </>
  )
}

export function RegistryApp() {
  const { closeWindowsForApp, minimizeWindow, windows } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const modal = useWindowModal()
  const { hostRef, narrowLayout, layoutReady } = useAppNarrowLayout()
  const prevNarrowLayoutRef = useRef<boolean | undefined>(undefined)
  const splitRef = useRef<HTMLDivElement>(null)
  const listPaneRef = useRef<HTMLDivElement>(null)
  const detailPanelRef = useRef<HTMLDivElement>(null)
  const selectedRowRef = useRef<HTMLButtonElement>(null)
  const [caretPos, setCaretPos] = useState<
    { x: number; y: number; fill: string } | undefined
  >(undefined)

  const [namespaces, setNamespaces] = useState<GlobalNamespaceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedAppId, setSelectedAppId] = useState<string | undefined>(undefined)
  const [detailAppId, setDetailAppId] = useState<string | undefined>(undefined)
  const [entries, setEntries] = useState<RegistryEntry[]>([])
  const [entriesLoading, setEntriesLoading] = useState(false)
  const [deletingKey, setDeletingKey] = useState<string | undefined>(undefined)
  const [clearing, setClearing] = useState(false)
  const entriesCacheRef = useRef(new Map<string, RegistryEntry[]>())
  const hasDisplayedDetailRef = useRef(false)

  const {
    page: screen,
    stack: navStack,
    transition: navTransition,
    queuedTransition: navQueuedTransition,
    commitQueuedTransition: commitNavQueuedTransition,
    navigate: navigateTo,
    handleMotionEnd: handleStackMotionEnd,
    setPage: setPageSilent,
  } = useKeychainNavStack<Screen>('root')

  const applyDisplayedEntries = useCallback((appId: string, next: RegistryEntry[]) => {
    entriesCacheRef.current.set(appId, next)
    hasDisplayedDetailRef.current = true
    setDetailAppId(appId)
    setEntries(next)
    setEntriesLoading(false)
  }, [])

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
      hasDisplayedDetailRef.current = false
      setDetailAppId(undefined)
      setEntries([])
      setEntriesLoading(false)
      return
    }

    const cached = entriesCacheRef.current.get(selectedAppId)
    if (cached) {
      applyDisplayedEntries(selectedAppId, cached)
    } else if (!hasDisplayedDetailRef.current) {
      setEntriesLoading(true)
    }

    let alive = true
    createGlobalRegistry()
      .listNamespaceEntries(selectedAppId)
      .then((next) => {
        if (alive) {
          applyDisplayedEntries(selectedAppId, next)
        }
      })
      .catch(() => {
        if (alive) {
          setEntriesLoading(false)
        }
      })
    return () => {
      alive = false
    }
  }, [applyDisplayedEntries, selectedAppId])

  useEffect(() => {
    if (namespaces.length === 0) {
      return
    }
    let alive = true
    const registry = createGlobalRegistry()
    for (const namespace of namespaces) {
      if (entriesCacheRef.current.has(namespace.appId)) {
        continue
      }
      void registry.listNamespaceEntries(namespace.appId).then((next) => {
        if (!alive) {
          return
        }
        entriesCacheRef.current.set(namespace.appId, next)
      })
    }
    return () => {
      alive = false
    }
  }, [namespaces])

  useEffect(() => {
    if (!layoutReady || narrowLayout || selectedAppId || namespaces.length === 0) {
      return
    }
    const first = sortedNamespaces(namespaces)[0]
    if (first) {
      setSelectedAppId(first.appId)
      const cached = entriesCacheRef.current.get(first.appId)
      if (cached) {
        applyDisplayedEntries(first.appId, cached)
      }
    }
  }, [applyDisplayedEntries, layoutReady, narrowLayout, namespaces, selectedAppId])

  useEffect(() => {
    if (loading || !selectedAppId) {
      return
    }
    if (namespaces.some((namespace) => namespace.appId === selectedAppId)) {
      return
    }
    if (narrowLayout) {
      setSelectedAppId(undefined)
      setPageSilent('root')
      return
    }
    setSelectedAppId(sortedNamespaces(namespaces)[0]?.appId)
  }, [loading, namespaces, selectedAppId, narrowLayout, setPageSilent])

  useLayoutEffect(() => {
    if (!layoutReady) {
      return
    }

    const previous = prevNarrowLayoutRef.current
    if (previous === undefined) {
      prevNarrowLayoutRef.current = narrowLayout
      return
    }

    prevNarrowLayoutRef.current = narrowLayout

    if (!previous && narrowLayout && selectedAppId !== undefined) {
      setPageSilent('detail')
      return
    }

    if (!narrowLayout) {
      setPageSilent('root')
    }
  }, [layoutReady, narrowLayout, selectedAppId, setPageSilent])

  const syncCaretPos = useCallback(() => {
    if (narrowLayout) {
      setCaretPos(undefined)
      return
    }
    const row = selectedRowRef.current
    const split = splitRef.current
    const panel = detailPanelRef.current
    if (!row || !split || !panel) {
      setCaretPos(undefined)
      return
    }
    const rowRect = row.getBoundingClientRect()
    const splitRect = split.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    const rowCenterY = rowRect.top + rowRect.height / 2
    const gradientT =
      panelRect.height > 0 ? (rowCenterY - panelRect.top) / panelRect.height : 0
    setCaretPos({
      x: panelRect.left - splitRect.left,
      y: rowCenterY - splitRect.top,
      fill: settingsPanelColorAt(gradientT),
    })
  }, [narrowLayout])

  useLayoutEffect(() => {
    syncCaretPos()
  }, [syncCaretPos, selectedAppId, namespaces, loading, narrowLayout])

  useEffect(() => {
    const listPane = listPaneRef.current
    const split = splitRef.current
    const panel = detailPanelRef.current
    const row = selectedRowRef.current
    listPane?.addEventListener('scroll', syncCaretPos, { passive: true })
    panel?.addEventListener('scroll', syncCaretPos, { passive: true })
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            syncCaretPos()
          })
        : undefined
    if (split) {
      observer?.observe(split)
    }
    if (panel) {
      observer?.observe(panel)
    }
    if (listPane) {
      observer?.observe(listPane)
    }
    if (row) {
      observer?.observe(row)
    }
    window.addEventListener('resize', syncCaretPos)
    return () => {
      listPane?.removeEventListener('scroll', syncCaretPos)
      panel?.removeEventListener('scroll', syncCaretPos)
      observer?.disconnect()
      window.removeEventListener('resize', syncCaretPos)
    }
  }, [syncCaretPos, selectedAppId, namespaces, narrowLayout])

  const handleDeleteKey = async (key: string) => {
    if (!selectedAppId || deletingKey !== undefined) {
      return
    }
    setDeletingKey(key)
    try {
      await createGlobalRegistry().removeItem(selectedAppId, key)
      setEntries((current) => {
        const next = current.filter((entry) => entry.key !== key)
        entriesCacheRef.current.set(selectedAppId, next)
        return next
      })
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
      entriesCacheRef.current.set(selectedAppId, [])
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

  const selectNamespace = useCallback(
    (appId: string) => {
      setSelectedAppId(appId)
      const cached = entriesCacheRef.current.get(appId)
      if (cached) {
        applyDisplayedEntries(appId, cached)
      }
      if (narrowLayout) {
        navigateTo('detail', 'push')
      }
    },
    [applyDisplayedEntries, narrowLayout, navigateTo],
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

  const selectedNamespace = namespaces.find((item) => item.appId === selectedAppId)
  const displayedAppId = detailAppId ?? selectedAppId
  const displayedNamespace = namespaces.find((item) => item.appId === displayedAppId)
  const displayedEntries = detailAppId === selectedAppId || !narrowLayout ? entries : []
  const displayedLoading =
    Boolean(selectedAppId) &&
    (narrowLayout ? detailAppId !== selectedAppId : !detailAppId && entriesLoading)

  const renderPage = (target: Screen) => {
    if (target === 'detail') {
      if (!selectedAppId) {
        return null
      }
      return (
        <RegistryDetailPane
          selectedAppId={selectedAppId}
          namespace={selectedNamespace}
          entries={displayedEntries}
          entriesLoading={displayedLoading}
          deletingKey={deletingKey}
          clearing={clearing}
          showBack
          onBack={closeDetail}
          onDeleteKey={(key) => void handleDeleteKey(key)}
          onConfirmClear={() => void handleConfirmClear()}
        />
      )
    }

    return (
      <RegistryRootPane
        namespaces={namespaces}
        loading={loading}
        onSelect={selectNamespace}
        footnote="点击命名空间可查看字段级键条目并删除单个键或清空整个命名空间。"
      />
    )
  }

  return (
    <div
      ref={hostRef}
      class={narrowLayout ? 'registry registry--narrow' : 'registry registry--wide'}
    >
      {narrowLayout ? (
        <KeychainNavStack
          stack={navStack}
          page={screen}
          transition={navTransition}
          queuedTransition={navQueuedTransition}
          commitQueuedTransition={commitNavQueuedTransition}
          onMotionEnd={handleStackMotionEnd}
          renderPage={renderPage}
        />
      ) : (
        <div
          ref={splitRef}
          class="registry__split"
          style={
            caretPos
              ? ({
                  ['--registry-caret-x' as string]: `${caretPos.x}px`,
                  ['--registry-caret-y' as string]: `${caretPos.y}px`,
                  ['--registry-caret-fill' as string]: caretPos.fill,
                } as Record<string, string>)
              : undefined
          }
        >
          <div ref={listPaneRef} class="registry__list-pane settings">
            <RegistryRootPane
              namespaces={namespaces}
              loading={loading}
              selectedAppId={selectedAppId}
              selectedRowRef={selectedRowRef}
              onSelect={selectNamespace}
              footnote="点击应用可在右侧查看注册表键。"
            />
          </div>
          <div
            ref={detailPanelRef}
            class="registry__detail-pane settings"
          >
            {selectedAppId && displayedAppId ? (
              <RegistryDetailPane
                selectedAppId={displayedAppId}
                namespace={displayedNamespace}
                entries={displayedEntries}
                entriesLoading={displayedLoading}
                deletingKey={deletingKey}
                clearing={clearing}
                showBack={false}
                onDeleteKey={(key) => void handleDeleteKey(key)}
                onConfirmClear={() => void handleConfirmClear()}
              />
            ) : (
              <RegistryDetailEmpty />
            )}
          </div>
          {selectedAppId && caretPos ? (
            <span class="registry__detail-caret" aria-hidden="true" />
          ) : undefined}
        </div>
      )}
    </div>
  )
}
