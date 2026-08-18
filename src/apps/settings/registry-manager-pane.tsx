import { useCallback, useEffect, useState } from 'preact/hooks'
import {
  createGlobalRegistry,
  APP_REGISTRY_QUOTA_BYTES,
  type GlobalNamespaceInfo,
} from '../../os/app-registry.ts'
import type { RegistryEntry } from '../../os/app-registry-db.ts'
import { APP_REGISTRY } from '../../os/app-registry.tsx'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { formatStorageSize } from './format-storage-size.ts'

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
  return new Date(timestamp).toLocaleString('zh-CN')
}

function truncateValue(value: string, max = 120): string {
  if (value.length <= max) {
    return value
  }
  return `${value.slice(0, max)}…`
}

type NamespaceListProps = {
  namespaces: GlobalNamespaceInfo[]
  loading: boolean
  onSelect: (appId: string) => void
}

function NamespaceList({ namespaces, loading, onSelect }: NamespaceListProps) {
  if (loading) {
    return <div class="settings__box settings__empty">加载中…</div>
  }
  if (namespaces.length === 0) {
    return <div class="settings__box settings__empty">注册表暂无应用数据</div>
  }

  return (
    <div class="settings__list">
      <div class="settings__list-head">
        <span>命名空间</span>
        <span>大小</span>
      </div>
      <div class="settings__list-body settings__list-body--apps">
        {namespaces
          .sort((left, right) => right.bytes - left.bytes)
          .map((namespace) => (
            <button
              key={namespace.appId}
              type="button"
              class="settings__row settings__row--button settings__row--nav"
              onClick={() => onSelect(namespace.appId)}
            >
              <span class="settings__row-name">
                <span>{appLabel(namespace.appId)}</span>
                <span class="settings__row-key-detail">
                  {namespace.keyCount} 键 · 更新于 {formatTimestamp(namespace.updatedAt)}
                </span>
              </span>
              <span class="settings__row-size">{formatStorageSize(namespace.bytes)}</span>
              <span class="settings__row-disclosure" aria-hidden="true">
                ›
              </span>
            </button>
          ))}
      </div>
    </div>
  )
}

type RegistryEntryRowProps = {
  entry: RegistryEntry
  deleting: boolean
  onDelete: () => void
}

/** 单条注册表条目：key 名 + 大小 + 更新时间 + 删除。（值可能很长，仅截断预览） */
function RegistryEntryRow({ entry, deleting, onDelete }: RegistryEntryRowProps) {
  return (
    <div class="settings__row settings__row--static settings__row--key">
      <span class="settings__row-name">
        <span class="settings__row-key">{entry.key}</span>
        <span class="settings__row-key-detail">
          {truncateValue(entry.value, 180)} · 更新于 {formatTimestamp(entry.updatedAt)}
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

export function RegistryManagerPane({ onBack }: { onBack: () => void }) {
  const [namespaces, setNamespaces] = useState<GlobalNamespaceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedAppId, setSelectedAppId] = useState<string | undefined>(undefined)
  const [entries, setEntries] = useState<RegistryEntry[]>([])
  const [entriesLoading, setEntriesLoading] = useState(false)
  const [deletingKey, setDeletingKey] = useState<string | undefined>(undefined)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)

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
      void createGlobalRegistry()
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
      setConfirmClear(false)
      await reloadNamespaces()
    } finally {
      setClearing(false)
    }
  }

  if (selectedAppId) {
    const namespace = namespaces.find((item) => item.appId === selectedAppId)
    return (
      <div class="settings">
        <div class="settings__nav">
          <IosNavBackButton label="注册表管理" onClick={() => setSelectedAppId(undefined)} />
        </div>
        <div class="settings__content settings__content--compact">
          <section class="settings__section">
            <h2 class="settings__section-title">{appLabel(selectedAppId)}</h2>
            <p class="settings__section-subtitle">
              {namespace?.keyCount ?? entries.length} 键 ·{' '}
              {formatStorageSize(namespace?.bytes ?? 0)} / {formatStorageSize(APP_REGISTRY_QUOTA_BYTES)}
            </p>
            {entriesLoading ? (
              <div class="settings__box settings__empty">加载中…</div>
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

            {entries.length > 0 && (
              <div class="settings__actions settings__actions--inline">
                <button
                  type="button"
                  class="settings__btn settings__btn--danger"
                  disabled={clearing}
                  onClick={() => setConfirmClear(true)}
                >
                  {clearing ? '清空中…' : '清空命名空间'}
                </button>
              </div>
            )}
            <p class="settings__section-footnote">
              内置应用按字段拆分为独立 key（cities / sessions / articles 等），便于单独查看与删除；
              生成应用则每个键独立存储。面板只读 / 只删，不支持修改；删除后该应用下次写入会重建。
            </p>
          </section>
        </div>

        {confirmClear && (
          <div
            class="settings__sheet-backdrop"
            role="presentation"
            onClick={() => !clearing && setConfirmClear(false)}
          >
            <div
              class="settings__sheet"
              role="alertdialog"
              aria-modal="true"
              onClick={(event) => event.stopPropagation()}
            >
              <div class="settings__sheet-body">
                <div class="settings__sheet-icon" aria-hidden="true">
                  !
                </div>
                <div class="settings__sheet-copy">
                  <h3 class="settings__sheet-title">清空「{appLabel(selectedAppId)}」？</h3>
                  <p class="settings__sheet-message">
                    该应用在注册表中的全部数据将被删除，此操作不可撤销。
                  </p>
                </div>
              </div>
              <div class="settings__sheet-actions">
                <button
                  type="button"
                  class="settings__btn settings__btn--plain"
                  disabled={clearing}
                  onClick={() => setConfirmClear(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  class="settings__btn settings__btn--danger"
                  disabled={clearing}
                  onClick={() => void handleClearNamespace()}
                >
                  {clearing ? '清空中…' : '清空'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="设置" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">注册表管理</h2>
          <p class="settings__section-subtitle">
            应用注册表（IndexedDB）按应用命名空间存储数据，单个应用上限{' '}
            {formatStorageSize(APP_REGISTRY_QUOTA_BYTES)}
          </p>
          <NamespaceList namespaces={namespaces} loading={loading} onSelect={setSelectedAppId} />
          <p class="settings__section-footnote">
            点击命名空间可查看字段级键条目并删除单个键或清空整个命名空间。
          </p>
        </section>
      </div>
    </div>
  )
}
