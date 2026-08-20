import { useEffect, useMemo, useState } from 'preact/hooks'
import { listMigratedLegacyStorageKeys } from '../../os/app-registry-migration.ts'
import { createGlobalRegistry, type GlobalNamespaceInfo } from '../../os/app-registry.ts'
import { APP_REGISTRY } from '../../os/app-registry.tsx'
import { getLocalStorageKeyBytes, STORAGE_CHANGED_EVENT } from '../../os/device-storage.ts'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { formatStorageSize } from './format-storage-size.ts'

type LegacyKeyEntry = {
  appId: string
  storageKey: string
  bytes: number
}

function appLabel(appId: string): string {
  const builtin = APP_REGISTRY.find((app) => app.id === appId)
  if (builtin) {
    return `${builtin.name}（${appId}）`
  }
  if (appId.startsWith('gen:')) {
    const name = appId.slice('gen:'.length)
    return `生成应用：${name}`
  }
  return appId
}

function collectLegacyKeys(): LegacyKeyEntry[] {
  return listMigratedLegacyStorageKeys()
    .map((item) => ({ ...item, bytes: getLocalStorageKeyBytes(item.storageKey) }))
    .filter((item) => item.bytes > 0)
    .sort((left, right) => right.bytes - left.bytes)
}

function removeLegacyKey(storageKey: string): void {
  try {
    localStorage.removeItem(storageKey)
  } catch {
    // 删除失败不阻塞其他键的清理
  }
  window.dispatchEvent(new Event(STORAGE_CHANGED_EVENT))
}

function formatTimestamp(timestamp: number): string {
  if (!timestamp) {
    return '—'
  }
  return new Date(timestamp).toLocaleString('zh-CN')
}

export function LegacyStorageCleanupView({ onBack }: { onBack: () => void }) {
  const [revision, setRevision] = useState(0)
  const [legacyKeys, setLegacyKeys] = useState<LegacyKeyEntry[]>([])
  const [namespaces, setNamespaces] = useState<GlobalNamespaceInfo[]>([])

  useEffect(() => {
    let alive = true
    const load = () => {
      setLegacyKeys(collectLegacyKeys())
      void createGlobalRegistry()
        .listNamespaces()
        .then((next) => {
          if (alive) {
            setNamespaces(next)
          }
        })
    }
    load()
    window.addEventListener(STORAGE_CHANGED_EVENT, load)
    return () => {
      alive = false
      window.removeEventListener(STORAGE_CHANGED_EVENT, load)
    }
  }, [revision])

  const registryTotalBytes = useMemo(
    () => namespaces.reduce((total, namespace) => total + namespace.bytes, 0),
    [namespaces],
  )

  const handleDelete = (entry: LegacyKeyEntry) => {
    removeLegacyKey(entry.storageKey)
    setRevision((value) => value + 1)
  }

  const handleDeleteAll = () => {
    for (const entry of legacyKeys) {
      removeLegacyKey(entry.storageKey)
    }
    setRevision((value) => value + 1)
  }

  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="存储空间" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">应用数据旧键</h2>
          <p class="settings__section-subtitle">
            已迁移到应用注册表的应用可能残留的 localStorage 旧键，删除后不会影响注册表数据
          </p>
          {legacyKeys.length === 0 ? (
            <div class="settings__box settings__empty">已无残留的 localStorage 旧键</div>
          ) : (
            <>
              <div class="settings__list">
                <div class="settings__list-head">
                  <span>名称</span>
                  <span>大小</span>
                </div>
                <div class="settings__list-body settings__list-body--keys">
                  {legacyKeys.map((entry) => (
                    <div
                      key={entry.storageKey}
                      class="settings__row settings__row--static settings__row--key"
                      title={entry.storageKey}
                    >
                      <span class="settings__row-name">
                        <span class="settings__row-key">{appLabel(entry.appId)}</span>
                        <span class="settings__row-key-detail">{entry.storageKey}</span>
                      </span>
                      <span class="settings__row-size">{formatStorageSize(entry.bytes)}</span>
                      <button
                        type="button"
                        class="settings__row-action"
                        onClick={() => handleDelete(entry)}
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div class="settings__actions settings__actions--inline">
                <button
                  type="button"
                  class="settings__btn settings__btn--danger"
                  onClick={handleDeleteAll}
                >
                  删除全部旧键
                </button>
              </div>
            </>
          )}
          <p class="settings__section-footnote">
            旧键由迁移过程自动清理；此处仅用于迁移异常或手动调整后的兜底清理。
          </p>
        </section>

        <section class="settings__section">
          <h2 class="settings__section-title">注册表用量</h2>
          <p class="settings__section-subtitle">
            应用注册表（IndexedDB）按应用命名空间记账，共 {formatStorageSize(registryTotalBytes)}
          </p>
          {namespaces.length === 0 ? (
            <div class="settings__box settings__empty">注册表暂无应用数据</div>
          ) : (
            <div class="settings__list">
              <div class="settings__list-head">
                <span>应用</span>
                <span>大小</span>
              </div>
              <div class="settings__list-body settings__list-body--keys">
                {namespaces
                  .sort((left, right) => right.bytes - left.bytes)
                  .map((namespace) => (
                    <div
                      key={namespace.appId}
                      class="settings__row settings__row--static settings__row--key"
                    >
                      <span class="settings__row-name">
                        <span class="settings__row-key">{appLabel(namespace.appId)}</span>
                        <span class="settings__row-key-detail">
                          {namespace.keyCount} 键 · 更新于 {formatTimestamp(namespace.updatedAt)}
                        </span>
                      </span>
                      <span class="settings__row-size">{formatStorageSize(namespace.bytes)}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
          <p class="settings__section-footnote">
            注册表计入数据空间总上限。详细的键级查看与删除见「注册表管理」。
          </p>
        </section>
      </div>
    </div>
  )
}
