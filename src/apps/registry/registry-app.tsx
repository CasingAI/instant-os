import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { Page } from '../../ui/page.tsx'
import { PageHeader } from '../../ui/page-header.tsx'
import {
  AdaptiveSplitNav,
  useAdaptiveSplitNav,
  type AdaptiveFrameSpec,
} from '../../ui/adaptive-split-nav.tsx'
import { SettingsNavRow } from '../../ui/settings-nav-row.tsx'
import { ForwardIcon } from '../../icons/app-icons.tsx'
import {
  createGlobalRegistry,
  subscribeAppRegistryChanged,
  type GlobalNamespaceInfo,
} from '../../os/app-registry.ts'
import { entryValueType, type RegistryEntry } from '../../os/app-registry-db.ts'
import { APP_REGISTRY } from '../../os/app-registry.tsx'
import { getDataCapacityBytes } from '../../os/device-data-storage.ts'
import { loadInstalledAppsFromCache } from '../../os/generated-apps-store.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useWindowModal } from '../../window/window-modal-context.tsx'
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
import '../settings/settings.css'
import './registry.css'

const APP_ID = 'registry'
const DATE_TIME_LOCALE = 'zh-CN'
const PAGE_ROOT = 'root'
const PAGE_KEYS = 'keys'
const PAGE_EDIT = 'edit'

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
    const generated = loadInstalledAppsFromCache().find((app) => app.id === appId)
    if (generated?.name) {
      return generated.name
    }
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
  return entryValueType(entry) === 'json' ? 'JSON' : '文本'
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

function drillPathStillValid(entry: RegistryEntry | undefined, drill: DrillState): boolean {
  if (!drill.selectedKey) {
    return true
  }
  if (!entry) {
    return false
  }
  if (drill.jsonPath.length === 0) {
    return true
  }
  const root = parsedJsonRoot(entry)
  if (root === undefined) {
    return false
  }
  return getAtPath(root, drill.jsonPath) !== undefined
}

type PathCrumb = {
  id: string
  label: string
}

function buildPathCrumbs(
  appId: string | undefined,
  drill: DrillState,
  entry: RegistryEntry | undefined,
): PathCrumb[] {
  if (!appId || !drill.selectedKey) {
    return []
  }
  const crumbs: PathCrumb[] = [
    { id: 'app', label: appLabel(appId) },
    { id: 'key', label: drill.selectedKey },
  ]
  const root = entry ? parsedJsonRoot(entry) : undefined
  for (let index = 0; index < drill.jsonPath.length; index += 1) {
    const prefix = drill.jsonPath.slice(0, index + 1)
    const label =
      entry && root !== undefined
        ? pathTitle(entry.key, prefix, root)
        : String(drill.jsonPath[index])
    crumbs.push({ id: `p:${prefix.join('\0')}`, label })
  }
  return crumbs
}

function RegistryPathBar({
  crumbs,
  onSelect,
}: {
  crumbs: PathCrumb[]
  onSelect: (index: number) => void
}) {
  if (crumbs.length === 0) {
    return null
  }
  return (
    <nav class="registry__path-bar" aria-label="当前位置路径">
      <div class="registry__path-bar-row">
        {crumbs.map((crumb, index) => (
          <span key={crumb.id} class="registry__path-bar-item">
            {index > 0 ? (
              <span class="registry__path-bar-chevron" aria-hidden="true">
                ›
              </span>
            ) : undefined}
            {index === crumbs.length - 1 ? (
              <span class="registry__path-bar-segment registry__path-bar-segment--current">
                {crumb.label}
              </span>
            ) : (
              <button
                type="button"
                class="registry__path-bar-segment"
                onClick={() => onSelect(index)}
              >
                {crumb.label}
              </button>
            )}
          </span>
        ))}
      </div>
    </nav>
  )
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
  onSelect: (appId: string) => void
}

function NamespaceList({ namespaces, selectedAppId, onSelect }: NamespaceListProps) {
  return (
    <div class="settings__list">
      {sortedNamespaces(namespaces).map((namespace) => (
        <SettingsNavRow
          key={namespace.appId}
          selected={namespace.appId === selectedAppId}
          label={
            <span class="registry__row-meta">
              <span>{appLabel(namespace.appId)}</span>
              <span class="settings__row-key-detail">
                {namespace.appId.startsWith('gen:')
                  ? `${namespace.appId} · ${namespace.keyCount} 键 · 更新于 ${formatTimestamp(namespace.updatedAt)}`
                  : `${namespace.keyCount} 键 · 更新于 ${formatTimestamp(namespace.updatedAt)}`}
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
  footnote: string
  onSelect: (appId: string) => void
}

function RegistryRootPane({
  namespaces,
  loading,
  selectedAppId,
  footnote,
  onSelect,
}: RegistryRootPaneProps) {
  return (
    <Page header={<PageHeader title="注册表管理" />}>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <p class="settings__section-subtitle">
            应用注册表（IndexedDB）按应用命名空间存储数据，当前{' '}
            {formatStorageSize(namespaces.reduce((sum, namespace) => sum + namespace.bytes, 0))} /{' '}
            {formatStorageSize(getDataCapacityBytes())}
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
              onSelect={onSelect}
            />
          )}
          <p class="settings__section-footnote">{footnote}</p>
        </section>
      </div>
    </Page>
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
  headerClass?: string
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
  headerClass,
  onBack,
  onOpenKey,
  onDeleteKey,
  onConfirmClear,
}: RegistryDetailPaneProps) {
  return (
    <Page
      header={
        <PageHeader
          class={headerClass}
          title={appLabel(selectedAppId)}
          backLabel={showBack ? '注册表管理' : undefined}
          onBack={showBack ? onBack : undefined}
          actions={
            entries.length > 0 ? (
              <button
                type="button"
                class="settings__btn settings__btn--danger"
                disabled={clearing}
                onClick={onConfirmClear}
              >
                {clearing ? '清空中…' : '清空'}
              </button>
            ) : undefined
          }
        />
      }
    >
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <p class="settings__section-footnote">
            {namespace?.keyCount ?? entries.length} 键 ·{' '}
            {formatStorageSize(namespace?.bytes ?? 0)}
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
    </Page>
  )
}

function RegistryDetailEmpty() {
  return (
    <Page header={<PageHeader title="注册表管理" />}>
      <div class="settings__content settings__content--compact">
        <div class="settings__box settings__empty">选择左侧应用以查看注册表键</div>
      </div>
    </Page>
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
    <Page
      header={
        <PageHeader
          title={title}
          backLabel={backLabel}
          onBack={onBack}
          actions={
            <button type="button" class="settings__btn settings__btn--default" onClick={onEditJson}>
              编辑 JSON
            </button>
          }
        />
      }
    >
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
    </Page>
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
  const initialRef = useRef(initial)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const parseError = editorDraftError(kind, draft)
  const dirty = draft !== initial
  const canSave = dirty && !saving && parseError === undefined

  useEffect(() => {
    if (draftRef.current === initialRef.current) {
      setDraft(initial)
    }
    initialRef.current = initial
  }, [initial])

  useEffect(() => {
    onDirtyChange(draft !== initial)
    return () => onDirtyChange(false)
  }, [draft, initial, onDirtyChange])

  return (
    <Page
      header={
        <PageHeader
          title={title}
          backLabel={backLabel}
          onBack={onBack}
          actions={
            <button
              type="button"
              class="settings__btn settings__btn--default"
              disabled={!canSave}
              onClick={() => void onSave(draft)}
            >
              {saving ? '保存中…' : '保存'}
            </button>
          }
        />
      }
    >
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
    </Page>
  )
}

export function RegistryApp() {
  const modal = useWindowModal()
  const editorDirtyRef = useRef(false)
  const selectedAppIdRef = useRef<string | undefined>(undefined)
  const drillRef = useRef<DrillState>(EMPTY_DRILL)
  const skipRegistryChangeAlertRef = useRef(false)

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
  const entriesCacheRef = useRef(new Map<string, RegistryEntry[]>())
  const hasDisplayedDetailRef = useRef(false)

  // 单一真源是 selectedAppId + drill：窄屏子页（root/keys/b:N/edit）与
  // 分栏右栏帧栈都从它派生，分栏切回子页栈的落点也由它推导。
  const nav = useAdaptiveSplitNav({
    split: true,
    narrowPageForState: () => currentNarrowPage(selectedAppId, drill),
    listPage: PAGE_ROOT,
  })
  const { narrowLayout, layoutReady, page: screen, setPageSilent } = nav

  const applyDisplayedEntries = useCallback((appId: string, next: RegistryEntry[]) => {
    entriesCacheRef.current.set(appId, next)
    hasDisplayedDetailRef.current = true
    setDetailAppId(appId)
    setEntries(next)
    setEntriesLoading(false)
  }, [])

  selectedAppIdRef.current = selectedAppId
  drillRef.current = drill

  const noteLocalRegistryMutation = useCallback(() => {
    skipRegistryChangeAlertRef.current = true
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
    return subscribeAppRegistryChanged((appId) => {
      const skipAlert = skipRegistryChangeAlertRef.current
      skipRegistryChangeAlertRef.current = false
      const previous = drillRef.current
      void (async () => {
        try {
          await reloadNamespaces({ silent: true })
          if (appId !== selectedAppIdRef.current) {
            entriesCacheRef.current.delete(appId)
            return
          }
          const next = await createGlobalRegistry().listNamespaceEntries(appId)
          applyDisplayedEntries(appId, next)
          if (skipAlert || !previous.selectedKey || !previous.editorOpen) {
            return
          }
          const entry = next.find((item) => item.key === previous.selectedKey)
          if (drillPathStillValid(entry, previous)) {
            return
          }
          await modal.alert({
            title: '节点已失效',
            message: '该节点已被更新或删除',
          })
        } catch {
          // 静默重载失败时保留当前页，用户可手动刷新
        }
      })()
    })
  }, [applyDisplayedEntries, modal, reloadNamespaces])

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

  const handleDeleteKey = async (key: string) => {
    if (!selectedAppId || deletingKey !== undefined) {
      return
    }
    noteLocalRegistryMutation()
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
      skipRegistryChangeAlertRef.current = false
      setDeletingKey(undefined)
    }
  }

  const handleClearNamespace = async () => {
    if (!selectedAppId || clearing) {
      return
    }
    setClearing(true)
    noteLocalRegistryMutation()
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
      skipRegistryChangeAlertRef.current = false
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
    noteLocalRegistryMutation()
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
      skipRegistryChangeAlertRef.current = false
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
    // 窄屏 pop 落定后提交 drill，分栏即时提交（旧帧保帧滑出）
    nav.navigate(parentPageId(drill, entry), 'pop', () => applyPop(entry))
  }

  const openEntry = (key: string) => {
    const entry = entries.find((item) => item.key === key)
    if (!entry) {
      return
    }
    if (jsonOpenMode(entry.value, entryValueType(entry)) === 'browse') {
      setDrill({ selectedKey: key, jsonPath: [], editorOpen: false })
      if (narrowLayout) {
        nav.navigate(browsePageId(0), 'push')
      }
      return
    }
    setDrill({ selectedKey: key, jsonPath: [], editorOpen: true })
    if (narrowLayout) {
      nav.navigate(PAGE_EDIT, 'push')
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
        nav.navigate(browsePageId(nextPath.length), 'push')
      }
      return
    }
    setDrill({ selectedKey: entry.key, jsonPath: nextPath, editorOpen: true })
    if (narrowLayout) {
      nav.navigate(PAGE_EDIT, 'push')
    }
  }

  const openEditJson = (entry: RegistryEntry, path: JsonPath) => {
    setDrill({ selectedKey: entry.key, jsonPath: path, editorOpen: true })
    if (narrowLayout) {
      nav.navigate(PAGE_EDIT, 'push')
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
          nav.navigate(PAGE_KEYS, 'push')
        } else if (narrowLayout && !selectedAppId) {
          nav.navigate(PAGE_KEYS, 'push')
        }
      }
      void switchTo()
    },
    [
      applyDisplayedEntries,
      confirmDiscard,
      drill.editorOpen,
      narrowLayout,
      nav,
      resetDrill,
      selectedAppId,
    ],
  )

  const closeDetail = useCallback(() => {
    nav.navigate(PAGE_ROOT, 'pop', () => {
      setSelectedAppId(undefined)
      resetDrill()
    })
  }, [nav, resetDrill])

  const jumpToPathCrumb = async (index: number) => {
    if (!selectedAppId || !drill.selectedKey) {
      return
    }
    if (index === 0) {
      if (drill.editorOpen && !(await confirmDiscard())) {
        return
      }
      resetDrill()
      if (narrowLayout) {
        setPageSilent(PAGE_KEYS)
      }
      return
    }
    const nextPath = index === 1 ? [] : drill.jsonPath.slice(0, index - 1)
    const alreadyThere =
      !drill.editorOpen &&
      drill.jsonPath.length === nextPath.length &&
      nextPath.every((segment, offset) => segment === drill.jsonPath[offset])
    if (alreadyThere) {
      return
    }
    if (drill.editorOpen && !(await confirmDiscard())) {
      return
    }
    resetDrill({
      selectedKey: drill.selectedKey,
      jsonPath: nextPath,
      editorOpen: false,
    })
    if (narrowLayout) {
      setPageSilent(browsePageId(nextPath.length))
    }
  }

  const menuBar = useMemo<MenuDefinition[]>(() => {
    return [
      {
        label: '注册表',
        items: [
          {
            type: 'action',
            label: '刷新',
            shortcut: '⌘R',
            onClick: () => {
              void (async () => {
                await reloadNamespaces()
                const appId = selectedAppIdRef.current
                if (!appId) {
                  return
                }
                const next = await createGlobalRegistry().listNamespaceEntries(appId)
                applyDisplayedEntries(appId, next)
              })()
            },
          },
        ],
      },
    ]
  }, [applyDisplayedEntries, reloadNamespaces])

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

  // ── 形变期返回键对齐（nav-kit-demo 同款）：keys 页/keys 帧的返回键只在窄
  // 形态有、分栏静置没有。A 型（窄→宽）先挂着随滑轨淡出；C 型（宽→窄）
  // 落定交棒后才出现，给一次透明度 0→1 的短淡入代替硬蹦。
  const [backFadeEpoch, setBackFadeEpoch] = useState(0)
  const backFadeTimerRef = useRef(0)
  const prevMorphingRef = useRef(false)
  useLayoutEffect(() => {
    const was = prevMorphingRef.current
    prevMorphingRef.current = nav.morphing
    if (was === nav.morphing) return
    if (nav.morphing || !narrowLayout) return
    // 落定页是 keys 页（唯一返回键有形态差的页）才淡入
    if (!selectedAppId || drill.selectedKey) return
    window.clearTimeout(backFadeTimerRef.current)
    setBackFadeEpoch((epoch) => epoch + 1)
    backFadeTimerRef.current = window.setTimeout(() => setBackFadeEpoch(0), 320)
  }, [nav.morphing, narrowLayout, selectedAppId, drill.selectedKey])
  useEffect(() => () => window.clearTimeout(backFadeTimerRef.current), [])

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

  const renderDetailPane = (appId: string, showBack: boolean, headerClass?: string) => (
    <RegistryDetailPane
      selectedAppId={appId}
      namespace={appId === selectedAppId ? selectedNamespace : displayedNamespace}
      entries={displayedEntries}
      entriesLoading={displayedLoading}
      deletingKey={deletingKey}
      clearing={clearing}
      showBack={showBack}
      headerClass={headerClass}
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
        <Page
          header={
            <PageHeader title={entry.key} backLabel="返回" onBack={() => void goBackFromDrill()} />
          }
        >
          <div class="settings__content settings__content--compact">
            <div class="settings__box settings__empty">该路径已不存在</div>
          </div>
        </Page>
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

  const renderNarrowPage = (target: string) => {
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
      return renderDetailPane(
        selectedAppId,
        true,
        backFadeEpoch > 0 && target === screen
          ? `registry__back-fade-in-${backFadeEpoch % 2}`
          : undefined,
      )
    }

    return (
      <RegistryRootPane
        namespaces={namespaces}
        loading={loading}
        selectedAppId={narrowLayout ? undefined : selectedAppId}
        onSelect={selectNamespace}
        footnote={
          narrowLayout
            ? '点击命名空间可查看字段级键条目；JSON 可逐级展开，叶子可编辑。'
            : '点击应用可在右侧查看注册表键；JSON 可逐级展开。'
        }
      />
    )
  }

  // 分栏帧栈：keys 帧静置不带返回（左栏即它的上级），A 型形变（窄→宽）
  // 先挂着返回随滑轨淡出；browse/edit 帧两种形态都带返回。
  const keepKeysBack =
    nav.morphing && nav.morphKind === 'A' && selectedAppId !== undefined && !drill.selectedKey

  const renderWideFrame = (frame: WideFrame) => {
    if (frame.kind === 'keys') {
      return renderDetailPane(
        frame.appId,
        false,
        keepKeysBack ? 'registry__back-fade-out' : undefined,
      )
    }
    const entry = findEntry(frame.appId, frame.key)
    if (!entry) {
      return (
        <Page>
          <div class="settings__content settings__content--compact">
            <div class="settings__box settings__empty">该键已不存在</div>
          </div>
        </Page>
      )
    }
    if (frame.kind === 'browse') {
      return renderBrowsePane(entry, frame.path)
    }
    return renderEditorPane(entry, frame.path)
  }

  const renderWideFrames = (): AdaptiveFrameSpec[] =>
    liveFrames.map((frame) => ({ id: frame.id, content: renderWideFrame(frame) }))

  const pathCrumbs = buildPathCrumbs(selectedAppId, drill, selectedEntry)
  const pathBar =
    pathCrumbs.length > 0 ? (
      <RegistryPathBar crumbs={pathCrumbs} onSelect={(index) => void jumpToPathCrumb(index)} />
    ) : undefined

  return (
    <AdaptiveSplitNav
      controller={nav}
      class={narrowLayout ? 'registry registry--narrow' : 'registry registry--wide'}
      renderNarrowPage={renderNarrowPage}
      renderWideFrames={renderWideFrames}
      renderDetailEmpty={() => <RegistryDetailEmpty />}
      framesResetKey={displayedAppId}
      footer={pathBar}
      /* 对齐原手写分栏 minmax(220px, 34%) */
      listMinWidth={220}
      listRatio={0.34}
    />
  )
}
