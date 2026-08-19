import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Ref } from 'preact'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { SettingsNavRow } from '../../ui/settings-nav-row.tsx'
import { useAppNarrowLayout } from '../../ui/use-app-narrow-layout.ts'
import { ForwardIcon } from '../../icons/app-icons.tsx'
import {
  APP_REGISTRY_QUOTA_BYTES,
  createGlobalRegistry,
  type GlobalNamespaceInfo,
} from '../../os/app-registry.ts'
import { entryValueType, type RegistryEntry } from '../../os/app-registry-db.ts'
import { APP_REGISTRY } from '../../os/app-registry.tsx'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import { KeychainNavStack, useKeychainNavStack } from '../keychain/keychain-nav-stack.tsx'
import { formatStorageSize } from '../../os/format-storage-size.ts'
import {
  formatNodeForEditor,
  getAtPath,
  isJsonContainer,
  jsonKindLabel,
  jsonNodeKind,
  jsonOpenMode,
  listJsonChildren,
  longestValidPrefix,
  nodeByteLength,
  parseEditorDraft,
  parseJsonValue,
  pathTitle,
  setAtPath,
  summarizeJson,
  utf8Length,
  type JsonChild,
  type JsonNodeKind,
  type JsonPath,
} from './registry-json-path.ts'
import '../../ui/ios-nav-back.css'
import '../keychain/keychain.css'
import '../settings/settings.css'
import './registry.css'

const APP_ID = 'registry'
const DATE_TIME_LOCALE = 'zh-CN'
const PAGE_ROOT = 'root'
const PAGE_KEYS = 'keys'
const PAGE_EDIT = 'edit'
const WIDE_STACK_MS = 380

function browsePageId(depth: number): string {
  return `b:${depth}`
}

function parseBrowseDepth(page: string): number | undefined {
  if (!page.startsWith('b:')) {
    return undefined
  }
  const depth = Number(page.slice(2))
  return Number.isInteger(depth) && depth >= 0 ? depth : undefined
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
    return summarizeJson(entry.value)
  }
  const parsed = parseJsonValue(entry.value)
  if (!parsed.ok) {
    return summarizeJson(entry.value)
  }
  return summarizeJson(parsed.value)
}

function parsedJsonRoot(entry: RegistryEntry): unknown | undefined {
  if (entryValueType(entry) !== 'json') {
    return undefined
  }
  const parsed = parseJsonValue(entry.value)
  return parsed.ok ? parsed.value : undefined
}

function writeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return '注册表写入失败'
}

function sortedNamespaces(namespaces: GlobalNamespaceInfo[]): GlobalNamespaceInfo[] {
  return [...namespaces].sort((left, right) => right.bytes - left.bytes)
}

function settingsPanelColorAt(ratio: number): string {
  const t = Math.min(1, Math.max(0, ratio))
  const channel = (top: number, bottom: number) => Math.round(top + (bottom - top) * t)
  const r = channel(0xec, 0xd8)
  const g = channel(0xec, 0xd8)
  const b = channel(0xec, 0xd8)
  return `rgb(${r}, ${g}, ${b})`
}

type DrillState = {
  selectedKey: string | undefined
  jsonPath: JsonPath
  editorOpen: boolean
}

const EMPTY_DRILL: DrillState = {
  selectedKey: undefined,
  jsonPath: [],
  editorOpen: false,
}

function parentPageId(drill: DrillState, entry: RegistryEntry | undefined): string {
  if (drill.editorOpen) {
    const root = entry ? parsedJsonRoot(entry) : undefined
    const node = root !== undefined ? getAtPath(root, drill.jsonPath) : undefined
    if (drill.jsonPath.length === 0) {
      if (entry && jsonOpenMode(entry.value, entryValueType(entry)) === 'browse') {
        return browsePageId(0)
      }
      return PAGE_KEYS
    }
    if (isJsonContainer(node)) {
      return browsePageId(drill.jsonPath.length)
    }
    return browsePageId(drill.jsonPath.length - 1)
  }
  if (!drill.selectedKey || drill.jsonPath.length === 0) {
    return PAGE_KEYS
  }
  return browsePageId(drill.jsonPath.length - 1)
}

function poppedDrill(drill: DrillState, entry: RegistryEntry | undefined): DrillState {
  if (drill.editorOpen) {
    const root = entry ? parsedJsonRoot(entry) : undefined
    const node = root !== undefined ? getAtPath(root, drill.jsonPath) : undefined
    if (drill.jsonPath.length === 0) {
      if (entry && jsonOpenMode(entry.value, entryValueType(entry)) === 'browse') {
        return { ...drill, editorOpen: false }
      }
      return EMPTY_DRILL
    }
    if (isJsonContainer(node)) {
      return { ...drill, editorOpen: false }
    }
    return { ...drill, jsonPath: drill.jsonPath.slice(0, -1), editorOpen: false }
  }
  if (!drill.selectedKey) {
    return drill
  }
  if (drill.jsonPath.length === 0) {
    return EMPTY_DRILL
  }
  return { ...drill, jsonPath: drill.jsonPath.slice(0, -1) }
}

function currentNarrowPage(selectedAppId: string | undefined, drill: DrillState): string {
  if (!selectedAppId) {
    return PAGE_ROOT
  }
  if (!drill.selectedKey) {
    return PAGE_KEYS
  }
  if (drill.editorOpen) {
    return PAGE_EDIT
  }
  return browsePageId(drill.jsonPath.length)
}

type EditorKind = JsonNodeKind | 'raw'

type ResolvedEditor = {
  title: string
  initial: string
  kind: EditorKind
  node: unknown
}

function resolveEditor(
  entry: RegistryEntry,
  path: JsonPath,
): ResolvedEditor | 'invalid-path' {
  const type = entryValueType(entry)
  if (type !== 'json') {
    if (path.length > 0) {
      return 'invalid-path'
    }
    return {
      title: entry.key,
      initial: entry.value,
      kind: 'raw',
      node: entry.value,
    }
  }

  const parsed = parseJsonValue(entry.value)
  if (!parsed.ok) {
    if (path.length > 0) {
      return 'invalid-path'
    }
    return {
      title: entry.key,
      initial: entry.value,
      kind: 'object',
      node: entry.value,
    }
  }

  const node = getAtPath(parsed.value, path)
  if (path.length > 0 && node === undefined) {
    return 'invalid-path'
  }
  return {
    title: pathTitle(entry.key, path, parsed.value),
    initial: formatNodeForEditor(node),
    kind: jsonNodeKind(node),
    node,
  }
}

function editorDraftError(kind: EditorKind, draft: string): string | undefined {
  if (kind === 'raw' || kind === 'string') {
    return undefined
  }
  const parsed = parseEditorDraft(kind, draft)
  return parsed.ok ? undefined : parsed.error
}

type WideFrame =
  | { kind: 'keys'; id: string; appId: string }
  | { kind: 'browse'; id: string; appId: string; key: string; path: JsonPath }
  | { kind: 'edit'; id: string; appId: string; key: string; path: JsonPath }

function buildWideFrames(
  appId: string | undefined,
  drill: DrillState,
  entry: RegistryEntry | undefined,
): WideFrame[] {
  if (!appId) {
    return []
  }
  const frames: WideFrame[] = [{ kind: 'keys', id: `keys:${appId}`, appId }]
  if (!drill.selectedKey || !entry) {
    return frames
  }
  const containerKey = jsonOpenMode(entry.value, entryValueType(entry)) === 'browse'
  if (!containerKey) {
    if (drill.editorOpen) {
      frames.push({
        id: `edit:${entry.key}`,
        kind: 'edit',
        appId,
        key: entry.key,
        path: [],
      })
    }
    return frames
  }

  const root = parsedJsonRoot(entry)
  frames.push({
    id: `browse:${entry.key}`,
    kind: 'browse',
    appId,
    key: entry.key,
    path: [],
  })
  for (let index = 0; index < drill.jsonPath.length; index += 1) {
    const prefix = drill.jsonPath.slice(0, index + 1)
    const node = root !== undefined ? getAtPath(root, prefix) : undefined
    if (isJsonContainer(node)) {
      frames.push({
        id: `browse:${entry.key}:${prefix.join('\0')}`,
        kind: 'browse',
        appId,
        key: entry.key,
        path: prefix,
      })
    }
  }
  if (drill.editorOpen) {
    frames.push({
      id: `edit:${entry.key}:${drill.jsonPath.join('\0')}`,
      kind: 'edit',
      appId,
      key: entry.key,
      path: drill.jsonPath,
    })
  }
  return frames
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
  onOpen: () => void
  onDelete: () => void
}

function RegistryEntryRow({ entry, deleting, onOpen, onDelete }: RegistryEntryRowProps) {
  return (
    <div class="registry__entry-row">
      <button
        type="button"
        class="settings__row settings__row--button registry__entry-open"
        onClick={onOpen}
      >
        <span class="settings__row-name">
          <span class="registry__row-meta">
            <span class="registry__row-key-line">
              <span class="settings__row-key">{entry.key}</span>
              <span class="settings__row-badge">{valueTypeBadgeLabel(entry)}</span>
            </span>
            <span class="settings__row-key-detail">
              {summarizeEntryValue(entry)} · 更新于 {formatTimestamp(entry.updatedAt)}
            </span>
          </span>
        </span>
        <span class="settings__disclosure" aria-hidden="true">
          <ForwardIcon size={13} />
        </span>
      </button>
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
  onOpenKey: (key: string) => void
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
  onOpenKey,
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
            <div class="settings__list registry__key-list">
              <div class="settings__list-head registry__list-head">
                <span>键</span>
                <span>大小</span>
                <span>操作</span>
              </div>
              <div class="settings__list-body settings__list-body--keys">
                {entries.map((entry) => (
                  <RegistryEntryRow
                    key={entry.key}
                    entry={entry}
                    deleting={deletingKey === entry.key}
                    onOpen={() => onOpenKey(entry.key)}
                    onDelete={() => onDeleteKey(entry.key)}
                  />
                ))}
              </div>
            </div>
          )}
          <p class="settings__section-footnote">
            JSON 对象与数组可逐级展开；文本与叶子值点进去编辑。删除仍只作用于整个注册表键。
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

type RegistryBrowsePaneProps = {
  title: string
  backLabel: string
  footnote: string
  nodes: JsonChild[]
  onBack: () => void
  onOpenChild: (key: string) => void
  onEditJson: () => void
}

function RegistryBrowsePane({
  title,
  backLabel,
  footnote,
  nodes,
  onBack,
  onOpenChild,
  onEditJson,
}: RegistryBrowsePaneProps) {
  return (
    <>
      <div class="settings__nav settings__nav--titled">
        <div class="settings__nav-bar">
          <IosNavBackButton label={backLabel} onClick={onBack} />
          <h1 class="settings__nav-heading">{title}</h1>
          <div class="settings__nav-trailing">
            <button type="button" class="settings__btn settings__btn--default" onClick={onEditJson}>
              编辑 JSON
            </button>
          </div>
        </div>
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <p class="settings__section-footnote">{footnote}</p>
          {nodes.length === 0 ? (
            <div class="settings__box settings__empty">此节点暂无子项</div>
          ) : (
            <div class="settings__list registry__node-list">
              <div class="settings__list-head registry__list-head">
                <span>键</span>
                <span>值</span>
              </div>
              <div class="settings__list-body">
                {nodes.map((child) => (
                  <div class="registry__entry-row registry__entry-row--node" key={child.key}>
                    <button
                      type="button"
                      class="settings__row settings__row--button registry__entry-open"
                      onClick={() => onOpenChild(child.key)}
                    >
                      <span class="settings__row-name">
                        <span class="registry__row-meta">
                          <span class="registry__row-key-line">
                            <span class="settings__row-key">{child.label}</span>
                            <span class="settings__row-badge">{jsonKindLabel(child.kind)}</span>
                          </span>
                        </span>
                      </span>
                      <span class="settings__disclosure" aria-hidden="true">
                        <ForwardIcon size={13} />
                      </span>
                    </button>
                    <span class="settings__row-size">{child.summary}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  )
}

type RegistryValuePaneProps = {
  title: string
  backLabel: string
  footnote: string
  initial: string
  kind: EditorKind
  saving: boolean
  onBack: () => void
  onSave: (draft: string) => void | Promise<void>
  onDirtyChange: (dirty: boolean) => void
}

function RegistryValuePane({
  title,
  backLabel,
  footnote,
  initial,
  kind,
  saving,
  onBack,
  onSave,
  onDirtyChange,
}: RegistryValuePaneProps) {
  const [draft, setDraft] = useState(initial)
  const parseError = editorDraftError(kind, draft)
  const dirty = draft !== initial
  const canSave = dirty && !saving && parseError === undefined

  useEffect(() => {
    setDraft(initial)
  }, [initial])

  useEffect(() => {
    onDirtyChange(draft !== initial)
    return () => onDirtyChange(false)
  }, [draft, initial, onDirtyChange])

  return (
    <>
      <div class="settings__nav settings__nav--titled">
        <div class="settings__nav-bar">
          <IosNavBackButton label={backLabel} onClick={onBack} />
          <h1 class="settings__nav-heading">{title}</h1>
          <div class="settings__nav-trailing">
            <button
              type="button"
              class="settings__btn settings__btn--default"
              disabled={!canSave}
              onClick={() => void onSave(draft)}
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
      <div class="settings__content settings__content--compact registry__value-content">
        <p class="settings__section-footnote">{footnote}</p>
        {parseError ? <p class="registry__value-error">{parseError}</p> : undefined}
        <textarea
          class="registry__value-textarea"
          value={draft}
          cols={1}
          spellcheck={false}
          disabled={saving}
          onInput={(event) => setDraft((event.currentTarget as HTMLTextAreaElement).value)}
        />
      </div>
    </>
  )
}

export function RegistryApp() {
  const modal = useWindowModal()
  const { hostRef, narrowLayout, layoutReady } = useAppNarrowLayout()
  const prevNarrowLayoutRef = useRef<boolean | undefined>(undefined)
  const splitRef = useRef<HTMLDivElement>(null)
  const listPaneRef = useRef<HTMLDivElement>(null)
  const detailPanelRef = useRef<HTMLDivElement>(null)
  const selectedRowRef = useRef<HTMLButtonElement>(null)
  const editorDirtyRef = useRef(false)
  const [caretPos, setCaretPos] = useState<
    { x: number; y: number; fill: string } | undefined
  >(undefined)

  const [namespaces, setNamespaces] = useState<GlobalNamespaceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedAppId, setSelectedAppId] = useState<string | undefined>(undefined)
  const [detailAppId, setDetailAppId] = useState<string | undefined>(undefined)
  const [drill, setDrill] = useState<DrillState>(EMPTY_DRILL)
  const [entries, setEntries] = useState<RegistryEntry[]>([])
  const [entriesLoading, setEntriesLoading] = useState(false)
  const [deletingKey, setDeletingKey] = useState<string | undefined>(undefined)
  const [clearing, setClearing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [heldFrames, setHeldFrames] = useState<WideFrame[]>([])
  const [wideIndex, setWideIndex] = useState(0)
  const entriesCacheRef = useRef(new Map<string, RegistryEntry[]>())
  const hasDisplayedDetailRef = useRef(false)
  const heldFramesRef = useRef<WideFrame[]>([])
  const wideAppRef = useRef<string | undefined>(undefined)
  const prevLiveLenRef = useRef(0)

  const {
    page: screen,
    stack: navStack,
    transition: navTransition,
    queuedTransition: navQueuedTransition,
    commitQueuedTransition: commitNavQueuedTransition,
    navigate: navigateTo,
    handleMotionEnd: handleStackMotionEnd,
    setPage: setPageSilent,
  } = useKeychainNavStack<string>(PAGE_ROOT)

  const applyDisplayedEntries = useCallback((appId: string, next: RegistryEntry[]) => {
    entriesCacheRef.current.set(appId, next)
    hasDisplayedDetailRef.current = true
    setDetailAppId(appId)
    setEntries(next)
    setEntriesLoading(false)
  }, [])

  const reloadNamespaces = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true)
    }
    try {
      setNamespaces(await createGlobalRegistry().listNamespaces())
    } finally {
      if (!options?.silent) {
        setLoading(false)
      }
    }
  }, [])

  const handleDirtyChange = useCallback((dirty: boolean) => {
    editorDirtyRef.current = dirty
  }, [])

  const confirmDiscard = useCallback(async (): Promise<boolean> => {
    if (!editorDirtyRef.current) {
      return true
    }
    return modal.confirm({
      title: '放弃未保存的更改？',
      message: '此键的编辑尚未保存，离开后将丢失。',
      confirmLabel: '放弃',
      confirmTone: 'danger',
    })
  }, [modal])

  const resetDrill = useCallback((next: DrillState = EMPTY_DRILL) => {
    editorDirtyRef.current = false
    setDrill(next)
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
    resetDrill()
    if (narrowLayout) {
      setSelectedAppId(undefined)
      setPageSilent(PAGE_ROOT)
      return
    }
    setSelectedAppId(sortedNamespaces(namespaces)[0]?.appId)
  }, [loading, namespaces, selectedAppId, narrowLayout, resetDrill, setPageSilent])

  const selectedEntry = drill.selectedKey
    ? entries.find((entry) => entry.key === drill.selectedKey)
    : undefined

  useEffect(() => {
    if (!drill.selectedKey) {
      return
    }
    if (!selectedEntry) {
      resetDrill()
      if (narrowLayout && screen !== PAGE_ROOT && screen !== PAGE_KEYS) {
        setPageSilent(PAGE_KEYS)
      }
      return
    }

    if (drill.jsonPath.length === 0 && !drill.editorOpen) {
      if (jsonOpenMode(selectedEntry.value, entryValueType(selectedEntry)) === 'edit') {
        resetDrill({ selectedKey: drill.selectedKey, jsonPath: [], editorOpen: true })
        if (narrowLayout) {
          setPageSilent(PAGE_EDIT)
        }
      }
      return
    }

    const root = parsedJsonRoot(selectedEntry)
    if (root === undefined) {
      if (drill.jsonPath.length > 0) {
        resetDrill({ selectedKey: drill.selectedKey, jsonPath: [], editorOpen: true })
        if (narrowLayout) {
          setPageSilent(PAGE_EDIT)
        }
      }
      return
    }

    if (drill.jsonPath.length > 0 && getAtPath(root, drill.jsonPath) === undefined) {
      const valid = longestValidPrefix(root, drill.jsonPath)
      const node = getAtPath(root, valid)
      if (isJsonContainer(node) || valid.length === 0) {
        resetDrill({
          selectedKey: drill.selectedKey,
          jsonPath: valid,
          editorOpen: false,
        })
        if (narrowLayout) {
          setPageSilent(browsePageId(valid.length))
        }
        return
      }
      const parent = valid.slice(0, -1)
      resetDrill({
        selectedKey: drill.selectedKey,
        jsonPath: parent,
        editorOpen: false,
      })
      if (narrowLayout) {
        setPageSilent(browsePageId(parent.length))
      }
    }
  }, [drill, narrowLayout, resetDrill, screen, selectedEntry, setPageSilent])

  useLayoutEffect(() => {
    if (!layoutReady) {
      return
    }

    const previous = prevNarrowLayoutRef.current
    if (previous === undefined) {
      prevNarrowLayoutRef.current = narrowLayout
      return
    }
    if (previous === narrowLayout) {
      return
    }

    prevNarrowLayoutRef.current = narrowLayout

    if (narrowLayout) {
      setPageSilent(currentNarrowPage(selectedAppId, drill))
      return
    }

    setPageSilent(PAGE_ROOT)
  }, [drill, layoutReady, narrowLayout, selectedAppId, setPageSilent])

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
  }, [syncCaretPos, selectedAppId, namespaces, loading, narrowLayout, drill])

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
  }, [syncCaretPos, selectedAppId, namespaces, narrowLayout, drill])

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
      if (drill.selectedKey === key) {
        resetDrill()
        if (narrowLayout) {
          setPageSilent(PAGE_KEYS)
        }
      }
      await reloadNamespaces({ silent: true })
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
      resetDrill()
      if (narrowLayout && screen !== PAGE_ROOT && screen !== PAGE_KEYS) {
        setPageSilent(PAGE_KEYS)
      }
      await reloadNamespaces({ silent: true })
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

  const retreatInvalidPath = (entry: RegistryEntry) => {
    const root = parsedJsonRoot(entry)
    if (root === undefined) {
      resetDrill({ selectedKey: entry.key, jsonPath: [], editorOpen: true })
      if (narrowLayout) {
        setPageSilent(PAGE_EDIT)
      }
      return
    }
    const valid = longestValidPrefix(root, drill.jsonPath)
    const node = getAtPath(root, valid)
    if (isJsonContainer(node) || valid.length === 0) {
      resetDrill({ selectedKey: entry.key, jsonPath: valid, editorOpen: false })
      if (narrowLayout) {
        setPageSilent(browsePageId(valid.length))
      }
      return
    }
    const parent = valid.slice(0, -1)
    resetDrill({ selectedKey: entry.key, jsonPath: parent, editorOpen: false })
    if (narrowLayout) {
      setPageSilent(browsePageId(parent.length))
    }
  }

  const handleSaveEntry = async (
    entry: RegistryEntry,
    path: JsonPath,
    kind: EditorKind,
    draft: string,
  ) => {
    if (!selectedAppId || saving) {
      return
    }
    setSaving(true)
    try {
      const registry = createGlobalRegistry()
      if (kind === 'raw' && entryValueType(entry) !== 'json') {
        await registry.setText(selectedAppId, entry.key, draft)
      } else {
        const decoded = parseEditorDraft(kind === 'raw' ? 'object' : kind, draft)
        if (!decoded.ok) {
          throw new Error(decoded.error)
        }
        if (path.length === 0) {
          await registry.setJson(selectedAppId, entry.key, decoded.value)
        } else {
          const parsed = parseJsonValue(entry.value)
          if (!parsed.ok) {
            throw new Error('当前键已不是有效 JSON')
          }
          const next = setAtPath(parsed.value, path, decoded.value)
          if (next === undefined) {
            await modal.alert({
              title: '保存失败',
              message: '该路径已不存在，可能被其他更改移动或删除。',
            })
            retreatInvalidPath(entry)
            return
          }
          await registry.setJson(selectedAppId, entry.key, next)
        }
      }
      const next = await registry.listNamespaceEntries(selectedAppId)
      applyDisplayedEntries(selectedAppId, next)
      await reloadNamespaces({ silent: true })
    } catch (error) {
      await modal.alert({
        title: '保存失败',
        message: writeErrorMessage(error),
      })
    } finally {
      setSaving(false)
    }
  }

  const applyPop = (entry: RegistryEntry | undefined) => {
    resetDrill(poppedDrill(drill, entry))
  }

  const goBackFromDrill = async () => {
    if (drill.editorOpen && !(await confirmDiscard())) {
      return
    }
    const entry = selectedEntry
    if (narrowLayout) {
      navigateTo(parentPageId(drill, entry), 'pop', () => applyPop(entry))
      return
    }
    applyPop(entry)
  }

  const openEntry = (key: string) => {
    const entry = entries.find((item) => item.key === key)
    if (!entry) {
      return
    }
    if (jsonOpenMode(entry.value, entryValueType(entry)) === 'browse') {
      setDrill({ selectedKey: key, jsonPath: [], editorOpen: false })
      if (narrowLayout) {
        navigateTo(browsePageId(0), 'push')
      }
      return
    }
    setDrill({ selectedKey: key, jsonPath: [], editorOpen: true })
    if (narrowLayout) {
      navigateTo(PAGE_EDIT, 'push')
    }
  }

  const openChild = (entry: RegistryEntry, path: JsonPath, childKey: string) => {
    const root = parsedJsonRoot(entry)
    if (root === undefined) {
      return
    }
    const nextPath = [...path, childKey]
    const node = getAtPath(root, nextPath)
    if (isJsonContainer(node)) {
      setDrill({ selectedKey: entry.key, jsonPath: nextPath, editorOpen: false })
      if (narrowLayout) {
        navigateTo(browsePageId(nextPath.length), 'push')
      }
      return
    }
    setDrill({ selectedKey: entry.key, jsonPath: nextPath, editorOpen: true })
    if (narrowLayout) {
      navigateTo(PAGE_EDIT, 'push')
    }
  }

  const openEditJson = (entry: RegistryEntry, path: JsonPath) => {
    setDrill({ selectedKey: entry.key, jsonPath: path, editorOpen: true })
    if (narrowLayout) {
      navigateTo(PAGE_EDIT, 'push')
    }
  }

  const selectNamespace = useCallback(
    (appId: string) => {
      const switchTo = async () => {
        if (appId !== selectedAppId) {
          if (drill.editorOpen && !(await confirmDiscard())) {
            return
          }
          resetDrill()
        }
        setSelectedAppId(appId)
        const cached = entriesCacheRef.current.get(appId)
        if (cached) {
          applyDisplayedEntries(appId, cached)
        }
        if (narrowLayout && appId !== selectedAppId) {
          navigateTo(PAGE_KEYS, 'push')
        } else if (narrowLayout && !selectedAppId) {
          navigateTo(PAGE_KEYS, 'push')
        }
      }
      void switchTo()
    },
    [
      applyDisplayedEntries,
      confirmDiscard,
      drill.editorOpen,
      narrowLayout,
      navigateTo,
      resetDrill,
      selectedAppId,
    ],
  )

  const closeDetail = useCallback(() => {
    navigateTo(PAGE_ROOT, 'pop', () => {
      setSelectedAppId(undefined)
      resetDrill()
    })
  }, [navigateTo, resetDrill])

  const menuBar = useMemo<MenuDefinition[]>(() => {
    return [
      {
        label: '注册表',
        items: [
          {
            type: 'action',
            label: '刷新',
            shortcut: '⌘R',
            onClick: () => void reloadNamespaces(),
          },
        ],
      },
    ]
  }, [reloadNamespaces])

  useAppMenuBar(APP_ID, menuBar)

  const selectedNamespace = namespaces.find((item) => item.appId === selectedAppId)
  const displayedAppId = detailAppId ?? selectedAppId
  const displayedNamespace = namespaces.find((item) => item.appId === displayedAppId)
  const displayedEntries = detailAppId === selectedAppId || !narrowLayout ? entries : []
  const displayedLoading =
    Boolean(selectedAppId) &&
    (narrowLayout ? detailAppId !== selectedAppId : !detailAppId && entriesLoading)

  const liveFrames = useMemo(
    () => buildWideFrames(displayedAppId, drill, selectedEntry),
    [displayedAppId, drill, selectedEntry],
  )

  useLayoutEffect(() => {
    heldFramesRef.current = heldFrames
  }, [heldFrames])

  useLayoutEffect(() => {
    if (narrowLayout) {
      return
    }
    const previous = heldFramesRef.current
    const appChanged = wideAppRef.current !== selectedAppId
    wideAppRef.current = selectedAppId
    const prevLen = prevLiveLenRef.current
    const nextLen = liveFrames.length

    if (appChanged || Math.abs(nextLen - prevLen) > 1 || previous.length === 0) {
      prevLiveLenRef.current = nextLen
      setHeldFrames(liveFrames)
      setWideIndex(Math.max(0, nextLen - 1))
      return
    }

    if (nextLen >= prevLen) {
      setHeldFrames(liveFrames)
      return
    }

    setWideIndex(Math.max(0, nextLen - 1))
    const timer = window.setTimeout(() => {
      prevLiveLenRef.current = nextLen
      setHeldFrames(liveFrames)
    }, WIDE_STACK_MS)
    return () => window.clearTimeout(timer)
  }, [liveFrames, narrowLayout, selectedAppId])

  useEffect(() => {
    if (narrowLayout) {
      return
    }
    if (heldFrames.length > prevLiveLenRef.current) {
      prevLiveLenRef.current = heldFrames.length
      setWideIndex(heldFrames.length - 1)
    }
  }, [heldFrames, narrowLayout])

  const findEntry = (appId: string, key: string): RegistryEntry | undefined => {
    if (appId === displayedAppId) {
      return displayedEntries.find((item) => item.key === key) ?? selectedEntry
    }
    return entriesCacheRef.current.get(appId)?.find((item) => item.key === key)
  }

  const browseBackLabel = (entry: RegistryEntry, path: JsonPath): string => {
    if (path.length === 0) {
      return appLabel(entry.appId)
    }
    const root = parsedJsonRoot(entry)
    if (root === undefined) {
      return entry.key
    }
    return pathTitle(entry.key, path.slice(0, -1), root)
  }

  const editorBackLabel = (entry: RegistryEntry, path: JsonPath, kind: EditorKind): string => {
    if (kind === 'raw' && path.length === 0) {
      return appLabel(entry.appId)
    }
    const root = parsedJsonRoot(entry)
    if (root === undefined) {
      return appLabel(entry.appId)
    }
    const node = getAtPath(root, path)
    if (isJsonContainer(node) || path.length === 0) {
      return pathTitle(entry.key, path, root)
    }
    return pathTitle(entry.key, path.slice(0, -1), root)
  }

  const renderDetailPane = (appId: string, showBack: boolean) => (
    <RegistryDetailPane
      selectedAppId={appId}
      namespace={appId === selectedAppId ? selectedNamespace : displayedNamespace}
      entries={displayedEntries}
      entriesLoading={displayedLoading}
      deletingKey={deletingKey}
      clearing={clearing}
      showBack={showBack}
      onBack={showBack ? closeDetail : undefined}
      onOpenKey={openEntry}
      onDeleteKey={(key) => void handleDeleteKey(key)}
      onConfirmClear={() => void handleConfirmClear()}
    />
  )

  const renderBrowsePane = (entry: RegistryEntry, path: JsonPath) => {
    const root = parsedJsonRoot(entry)
    const node = root !== undefined ? getAtPath(root, path) : undefined
    const nodes = isJsonContainer(node) ? listJsonChildren(node) : []
    const title = root !== undefined ? pathTitle(entry.key, path, root) : entry.key
    const kind = jsonNodeKind(node)
    return (
      <RegistryBrowsePane
        title={title}
        backLabel={browseBackLabel(entry, path)}
        footnote={`${jsonKindLabel(kind)} · ${nodes.length} 项`}
        nodes={nodes}
        onBack={() => void goBackFromDrill()}
        onOpenChild={(childKey) => openChild(entry, path, childKey)}
        onEditJson={() => openEditJson(entry, path)}
      />
    )
  }

  const renderEditorPane = (entry: RegistryEntry, path: JsonPath) => {
    const resolved = resolveEditor(entry, path)
    if (resolved === 'invalid-path') {
      return (
        <>
          <div class="settings__nav settings__nav--titled">
            <div class="settings__nav-bar">
              <IosNavBackButton label="返回" onClick={() => void goBackFromDrill()} />
              <h1 class="settings__nav-heading">{entry.key}</h1>
              <span class="settings__nav-trailing" aria-hidden="true" />
            </div>
          </div>
          <div class="settings__content settings__content--compact">
            <div class="settings__box settings__empty">该路径已不存在</div>
          </div>
        </>
      )
    }
    const kindLabel =
      resolved.kind === 'raw' ? valueTypeBadgeLabel(entry) : jsonKindLabel(resolved.kind)
    const bytes =
      resolved.kind === 'raw' ? utf8Length(entry.value) : nodeByteLength(resolved.node)
    return (
      <RegistryValuePane
        key={`${entry.appId}:${entry.key}:${path.join('\0')}`}
        title={resolved.title}
        backLabel={editorBackLabel(entry, path, resolved.kind)}
        footnote={`${kindLabel} · ${formatStorageSize(bytes)} · 更新于 ${formatTimestamp(entry.updatedAt)}`}
        initial={resolved.initial}
        kind={resolved.kind}
        saving={saving}
        onBack={() => void goBackFromDrill()}
        onSave={(draft) => handleSaveEntry(entry, path, resolved.kind, draft)}
        onDirtyChange={handleDirtyChange}
      />
    )
  }

  const renderBrowseAtDepth = (depth: number) => {
    if (!selectedAppId || !selectedEntry) {
      return null
    }
    return renderBrowsePane(selectedEntry, drill.jsonPath.slice(0, depth))
  }

  const renderPage = (target: string) => {
    if (target === PAGE_EDIT) {
      if (!selectedEntry) {
        return null
      }
      return renderEditorPane(selectedEntry, drill.jsonPath)
    }

    const browseDepth = parseBrowseDepth(target)
    if (browseDepth !== undefined) {
      return renderBrowseAtDepth(browseDepth)
    }

    if (target === PAGE_KEYS) {
      if (!selectedAppId) {
        return null
      }
      return renderDetailPane(selectedAppId, true)
    }

    return (
      <RegistryRootPane
        namespaces={namespaces}
        loading={loading}
        onSelect={selectNamespace}
        footnote="点击命名空间可查看字段级键条目；JSON 可逐级展开，叶子可编辑。"
      />
    )
  }

  const renderWideFrame = (frame: WideFrame) => {
    if (frame.kind === 'keys') {
      return renderDetailPane(frame.appId, false)
    }
    const entry = findEntry(frame.appId, frame.key)
    if (!entry) {
      return (
        <div class="settings__content settings__content--compact">
          <div class="settings__box settings__empty">该键已不存在</div>
        </div>
      )
    }
    if (frame.kind === 'browse') {
      return renderBrowsePane(entry, frame.path)
    }
    return renderEditorPane(entry, frame.path)
  }

  const renderWideDetail = () => {
    if (!displayedAppId) {
      return (
        <div class="settings">
          <RegistryDetailEmpty />
        </div>
      )
    }

    const frames = heldFrames.length > 0 ? heldFrames : liveFrames
    const active = Math.min(wideIndex, Math.max(0, frames.length - 1))
    return (
      <div class="registry__wide-stack">
        {frames.map((frame, index) => (
          <div
            key={frame.id}
            class={
              index === active
                ? 'settings registry__wide-stack__page is-active'
                : 'settings registry__wide-stack__page'
            }
            style={{
              transform:
                index === active
                  ? 'translateX(0)'
                  : index < active
                    ? 'translateX(-30%)'
                    : 'translateX(100%)',
              zIndex: index,
            }}
          >
            {renderWideFrame(frame)}
          </div>
        ))}
      </div>
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
              footnote="点击应用可在右侧查看注册表键；JSON 可逐级展开。"
            />
          </div>
          <div ref={detailPanelRef} class="registry__detail-pane">
            {selectedAppId && displayedAppId ? (
              renderWideDetail()
            ) : (
              <div class="settings">
                <RegistryDetailEmpty />
              </div>
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
