import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { DocumentTabBar } from '../../ui/document-tab-bar.tsx'
import { FilesNodeIcon } from '../files/files-node-icon.tsx'
import { getNode } from '../files/files-storage.ts'
import {
  filesLocationPathRoot,
  formatFilesByteSize,
  formatFilesTimestamp,
} from '../files/files-path.ts'
import { readFileBlob } from '../files/files-vfs.ts'
import {
  listFileInfoSections,
  type FileInfoSectionContribution,
} from '../../os/file-info-registry.ts'
// 副作用导入：注册图片信息分节
import './sections/image-section.tsx'
import {
  filesVolumeRootAttributes,
  formatFilesNodePermissionLabel,
  isMountNodeId,
  type FilesLocationId,
  type FilesNode,
} from '../files/files-types.ts'
import {
  enrichFilesNodeMeta,
  getFilesLocationLabel,
  listSubtreeFiles,
  resolveNodeByAbsolutePath,
} from '../files/files-vfs.ts'
import { decodeInfoDocumentId, type InfoDocumentKind } from './info-document-id.ts'
import './file-info.css'

const APP_ID = 'file-info' as const
const DEFAULT_TITLE = '文件信息'

type InfoTab = {
  id: string
  documentId: string
  kind: InfoDocumentKind
  title: string
  /** 与 documentId 中路径一一对应；解析失败（已被删除）为 undefined */
  nodes: (FilesNode | undefined)[]
  /** volume 卷根：虚拟节点的 locationId（无真实节点可解析） */
  volumeLocationId?: FilesLocationId
}

type FileInfoAppProps = {
  windowId?: string
}

let tabCounter = 0

function nextTabId(): string {
  tabCounter += 1
  return `file-info-tab-${tabCounter}`
}

export function FileInfoApp({ windowId }: FileInfoAppProps) {
  const {
    windows,
    activeWindowId,
    setWindowTitle,
    setWindowDocumentId,
    closeWindow,
    closeWindowsForApp,
    minimizeWindow,
    bypassWindowCloseGuard,
  } = useOs()
  const { showBuiltinAbout } = useAboutApp()

  const appWindow = windowId
    ? windows.find((window) => window.id === windowId && !window.closing)
    : undefined
  const pendingDocumentId = appWindow?.documentId
  const isActiveWindow = windowId !== undefined && activeWindowId === windowId

  const [tabs, setTabs] = useState<InfoTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const bootstrappedRef = useRef(false)
  const loadingDocumentIdRef = useRef<string | undefined>(undefined)
  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)
  const mountedRef = useRef(true)

  tabsRef.current = tabs
  activeTabIdRef.current = activeTabId

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!windowId || !ready) return
    if (!activeTab) {
      setWindowTitle(windowId, DEFAULT_TITLE)
      setWindowDocumentId(windowId, undefined)
      return
    }
    setWindowTitle(windowId, activeTab.title)
    setWindowDocumentId(windowId, activeTab.documentId)
  }, [
    activeTab?.documentId,
    activeTab?.id,
    activeTab?.title,
    ready,
    setWindowDocumentId,
    setWindowTitle,
    windowId,
  ])

  const resolveTabBase = useCallback(
    async (documentId: string): Promise<Omit<InfoTab, 'id'>> => {
      const decoded = decodeInfoDocumentId(documentId)
      if (decoded.kind === 'volume') {
        const locationId = decoded.locationId as FilesLocationId
        const virtualNode: FilesNode = {
          id: '',
          locationId,
          parentId: undefined,
          name: getFilesLocationLabel(locationId),
          kind: 'folder',
          mimeType: undefined,
          byteSize: 0,
          createdAt: 0,
          updatedAt: 0,
          attributes: filesVolumeRootAttributes(locationId),
        }
        return {
          documentId,
          kind: 'volume',
          title: virtualNode.name,
          nodes: [virtualNode],
          volumeLocationId: locationId,
        }
      }
      if (decoded.kind === 'multi') {
        const nodes = await Promise.all(
          decoded.paths.map((path) => resolveNodeByAbsolutePath(path, { follow: false })),
        )
        return {
          documentId,
          kind: 'multi',
          title: `${decoded.paths.length} 个项目`,
          nodes,
        }
      }
      const node = await resolveNodeByAbsolutePath(decoded.path, { follow: false })
      return {
        documentId,
        kind: 'node',
        title: node ? node.name : '项目不存在',
        nodes: [node],
      }
    },
    [],
  )

  const openDocument = useCallback(
    async (documentId: string): Promise<boolean> => {
      if (!windowId) return false

      const existing = tabsRef.current.find((tab) => tab.documentId === documentId)
      if (existing) {
        setActiveTabId(existing.id)
        setReady(true)
        return true
      }

      if (loadingDocumentIdRef.current === documentId) {
        return true
      }

      loadingDocumentIdRef.current = documentId
      setLoading(true)
      try {
        const base = await resolveTabBase(documentId)
        if (!mountedRef.current) return false
        const already = tabsRef.current.find((tab) => tab.documentId === documentId)
        if (already) {
          setActiveTabId(already.id)
          setReady(true)
          return true
        }
        const tab: InfoTab = { id: nextTabId(), ...base }
        setTabs((prev) => [...prev, tab])
        setActiveTabId(tab.id)
        setReady(true)
        return true
      } finally {
        if (loadingDocumentIdRef.current === documentId) {
          loadingDocumentIdRef.current = undefined
        }
        setLoading(false)
      }
    },
    [resolveTabBase, windowId],
  )

  useEffect(() => {
    if (!windowId || bootstrappedRef.current) return
    bootstrappedRef.current = true

    if (pendingDocumentId) {
      void openDocument(pendingDocumentId)
    } else {
      setReady(true)
    }
  }, [openDocument, pendingDocumentId, windowId])

  useEffect(() => {
    if (!windowId || !ready || !pendingDocumentId) return
    if (loadingDocumentIdRef.current === pendingDocumentId) return

    const existing = tabsRef.current.find((tab) => tab.documentId === pendingDocumentId)
    if (existing) {
      if (existing.id !== activeTabIdRef.current) {
        setActiveTabId(existing.id)
      }
      return
    }

    void openDocument(pendingDocumentId)
  }, [openDocument, pendingDocumentId, ready, windowId])

  const focusTab = useCallback((tabId: string) => {
    setActiveTabId(tabId)
  }, [])

  const removeTab = useCallback(
    (tabId: string) => {
      if (!windowId) return
      const current = tabsRef.current
      const index = current.findIndex((tab) => tab.id === tabId)
      if (index < 0) return
      const nextTabs = current.filter((tab) => tab.id !== tabId)
      if (nextTabs.length === 0) {
        setTabs([])
        setActiveTabId(undefined)
        bypassWindowCloseGuard(windowId)
        closeWindow(windowId)
        return
      }
      setTabs(nextTabs)
      if (activeTabIdRef.current === tabId) {
        const neighbor = nextTabs[Math.min(index, nextTabs.length - 1)]
        setActiveTabId(neighbor?.id)
      }
    },
    [bypassWindowCloseGuard, closeWindow, windowId],
  )

  const closeTab = useCallback(
    (tabId: string) => {
      removeTab(tabId)
    },
    [removeTab],
  )

  const tabItems = useMemo(
    () =>
      tabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        pathTitle: tab.documentId,
      })),
    [tabs],
  )

  const menuBar = useMemo((): MenuDefinition[] => {
    return [
      {
        label: '文件信息',
        items: [
          ...aboutAppMenuPrefix('关于文件信息', () => showBuiltinAbout(APP_ID)),
          {
            type: 'action',
            label: '隐藏文件信息',
            shortcut: '⌘H',
            onClick: () => windowId && minimizeWindow(windowId),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出文件信息',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp(APP_ID),
          },
        ],
      },
      {
        label: '文件',
        items: [
          {
            type: 'action',
            label: '关闭标签页',
            shortcut: '⌘W',
            disabled: !activeTab || loading,
            onClick: () => activeTab && closeTab(activeTab.id),
          },
        ],
      },
    ]
  }, [activeTab, closeTab, closeWindowsForApp, loading, minimizeWindow, showBuiltinAbout, windowId])

  useAppMenuBar(APP_ID, menuBar, isActiveWindow)

  return (
    <div class="file-info-app">
      {tabItems.length > 0 ? (
        <DocumentTabBar
          class="file-info-app__tabs"
          tabs={tabItems}
          activeTabId={activeTab?.id}
          closeDisabled={loading}
          onActivate={focusTab}
          onClose={closeTab}
        />
      ) : undefined}

      <div class="file-info-app__body">
        {loading && !activeTab ? (
          <div class="file-info-app__loading">正在加载…</div>
        ) : !activeTab ? (
          <div class="file-info-app__empty">
            <p class="file-info-app__empty-title">文件信息</p>
            <p class="file-info-app__empty-hint">
              在「文件」中右键项目选择「显示信息」，或打开文件夹的「显示文件夹信息」，在此查看属性。
            </p>
          </div>
        ) : activeTab.kind === 'multi' ? (
          <MultiInfoPanel tab={activeTab} />
        ) : (
          <SingleInfoPanel tab={activeTab} />
        )}
      </div>
    </div>
  )
}

type FolderStats = {
  fileCount: number
  folderCount: number
  totalBytes: number
}

function SingleInfoPanel({ tab }: { tab: InfoTab }) {
  const node = tab.nodes[0]
  if (!node) {
    return (
      <div class="file-info-app__missing">
        <p class="file-info-app__missing-title">项目不存在</p>
        <p class="file-info-app__missing-hint">该项目可能已被移动或删除。</p>
      </div>
    )
  }
  return <SingleInfoContent tab={tab} node={node} />
}

function SingleInfoContent({ tab, node }: { tab: InfoTab; node: FilesNode }) {
  const [folderStats, setFolderStats] = useState<FolderStats | undefined>(undefined)
  const [folderStatsState, setFolderStatsState] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  )
  const [mountNode, setMountNode] = useState<FilesNode | undefined>(undefined)
  const [trashParentName, setTrashParentName] = useState<string | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    if (node.kind !== 'file' || !isMountNodeId(node.id)) {
      setMountNode(undefined)
      return
    }
    enrichFilesNodeMeta(node.id).then((enriched) => {
      if (!cancelled && enriched) setMountNode(enriched)
    })
    return () => {
      cancelled = true
    }
  }, [node.id, node.kind])

  useEffect(() => {
    let cancelled = false
    if (node.kind !== 'folder') {
      setFolderStatsState('idle')
      setFolderStats(undefined)
      return
    }
    setFolderStatsState('loading')
    setFolderStats(undefined)
    const rootPath =
      tab.kind === 'volume' && tab.volumeLocationId
        ? filesLocationPathRoot(tab.volumeLocationId)
        : tab.documentId
    listSubtreeFiles(rootPath)
      .then((entries) => {
        if (cancelled) return
        const folderNames = new Set<string>()
        let fileCount = 0
        let totalBytes = 0
        for (const entry of entries) {
          fileCount += 1
          totalBytes += entry.byteSize
          const slash = entry.path.lastIndexOf('/')
          if (slash > 0) {
            let dir = entry.path.slice(0, slash)
            while (dir) {
              folderNames.add(dir)
              const nextSlash = dir.lastIndexOf('/')
              if (nextSlash < 0) break
              dir = dir.slice(0, nextSlash)
            }
          }
        }
        setFolderStats({ fileCount, folderCount: folderNames.size, totalBytes })
        setFolderStatsState('ready')
      })
      .catch(() => {
        if (!cancelled) setFolderStatsState('error')
      })
    return () => {
      cancelled = true
    }
  }, [node.id, node.kind, tab.documentId, tab.kind, tab.volumeLocationId])

  useEffect(() => {
    let cancelled = false
    const origin = node.trashOrigin
    if (!origin || origin.parentId === undefined) {
      setTrashParentName(undefined)
      return
    }
    getNode(origin.parentId)
      .then((parent) => {
        if (cancelled) return
        if (parent && parent.kind === 'folder' && parent.locationId === origin.locationId) {
          setTrashParentName(parent.name)
        } else {
          setTrashParentName(undefined)
        }
      })
      .catch(() => {
        if (!cancelled) setTrashParentName(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [node.id, node.trashOrigin])

  const displayNode = mountNode ?? node

  const path =
    tab.kind === 'volume' && tab.volumeLocationId
      ? filesLocationPathRoot(tab.volumeLocationId)
      : tab.documentId

  const parentPath =
    tab.kind === 'volume' && tab.volumeLocationId
      ? filesLocationPathRoot(tab.volumeLocationId)
      : (() => {
          const lastSlash = tab.documentId.lastIndexOf('/')
          return lastSlash > 0 ? tab.documentId.slice(0, lastSlash) : tab.documentId
        })()

  const kindLabel = node.kind === 'folder' ? '文件夹' : node.kind === 'symlink' ? '符号链接' : '文件'

  const sizeLabel = (() => {
    if (node.kind === 'folder') {
      if (folderStatsState === 'loading') return '计算中…'
      if (folderStatsState === 'error' || !folderStats) return '—'
      return `${folderStats.folderCount} 个文件夹、${folderStats.fileCount} 个文件，共 ${formatFilesByteSize(folderStats.totalBytes)}`
    }
    if (node.kind === 'file') return formatFilesByteSize(displayNode.byteSize)
    return '—'
  })()

  return (
    <div class="file-info-app__single">
      <div class="file-info-app__hero">
        <FilesNodeIcon node={node} />
        <h2 class="file-info-app__hero-name">{node.name}</h2>
      </div>

      <details class="file-info-app__section" open>
        <summary class="file-info-app__section-summary">通用</summary>
        <dl class="file-info-app__info">
          <div class="file-info-app__info-row">
            <dt>种类</dt>
            <dd>{kindLabel}</dd>
          </div>
          <div class="file-info-app__info-row">
            <dt>大小</dt>
            <dd>{sizeLabel}</dd>
          </div>
          <div class="file-info-app__info-row file-info-app__info-row--path">
            <dt>位置</dt>
            <dd>
              <code class="file-info-app__info-path">{parentPath}</code>
            </dd>
          </div>
          <div class="file-info-app__info-row">
            <dt>创建</dt>
            <dd>{formatFilesTimestamp(displayNode.createdAt)}</dd>
          </div>
          <div class="file-info-app__info-row">
            <dt>修改</dt>
            <dd>{formatFilesTimestamp(displayNode.updatedAt)}</dd>
          </div>
        </dl>
      </details>

      <details class="file-info-app__section">
        <summary class="file-info-app__section-summary">更多信息</summary>
        <dl class="file-info-app__info">
          <div class="file-info-app__info-row file-info-app__info-row--path">
            <dt>路径</dt>
            <dd>
              <code class="file-info-app__info-path">{path}</code>
            </dd>
          </div>
          {node.mimeType ? (
            <div class="file-info-app__info-row">
              <dt>类型</dt>
              <dd>{node.mimeType}</dd>
            </div>
          ) : undefined}
          {node.kind === 'symlink' && node.target ? (
            <div class="file-info-app__info-row file-info-app__info-row--path">
              <dt>链接目标</dt>
              <dd>
                <code class="file-info-app__info-path">{node.target}</code>
              </dd>
            </div>
          ) : undefined}
          {node.trashOrigin ? (
            <div class="file-info-app__info-row">
              <dt>原位置</dt>
              <dd>
                {getFilesLocationLabel(node.trashOrigin.locationId)}
                {trashParentName ? ` / ${trashParentName}` : ''}
                {node.trashOrigin.name ? ` / ${node.trashOrigin.name}` : ''}
              </dd>
            </div>
          ) : undefined}
          {node.kind === 'file' && node.contentRevisionId ? (
            <div class="file-info-app__info-row">
              <dt>内容版本</dt>
              <dd>
                <code class="file-info-app__info-rev" title={node.contentRevisionId}>
                  {node.contentRevisionId.slice(0, 8)}
                </code>
              </dd>
            </div>
          ) : undefined}
          <div class="file-info-app__info-row">
            <dt>权限</dt>
            <dd>{formatFilesNodePermissionLabel(node)}</dd>
          </div>
        </dl>
      </details>

      {listFileInfoSections(node).map((contribution) => (
        <InfoSectionCard
          key={`${contribution.id}-${node.id}`}
          contribution={contribution}
          node={node}
          path={path}
        />
      ))}
    </div>
  )
}

function InfoSectionCard({
  contribution,
  node,
  path,
}: {
  contribution: FileInfoSectionContribution
  node: FilesNode
  path: string
}) {
  const SectionComponent = contribution.component
  return (
    <details class="file-info-app__section">
      <summary class="file-info-app__section-summary">{contribution.title}</summary>
      <SectionComponent
        node={node}
        path={path}
        readBlob={() => readFileBlob(node.id).then((result) => result.blob)}
      />
    </details>
  )
}

function MultiInfoPanel({ tab }: { tab: InfoTab }) {
  const present = tab.nodes.filter((node): node is FilesNode => node !== undefined)
  const totalBytes = present
    .filter((node) => node.kind === 'file')
    .reduce((sum, node) => sum + node.byteSize, 0)
  const locations = new Set(present.map((node) => node.locationId))
  const locationLabel =
    present.length === 0
      ? '—'
      : locations.size === 1
        ? getFilesLocationLabel(present[0].locationId)
        : '多个位置'

  return (
    <div class="file-info-app__multi">
      <dl class="file-info-app__info">
        <div class="file-info-app__info-row">
          <dt>名称</dt>
          <dd>{tab.title}</dd>
        </div>
        <div class="file-info-app__info-row">
          <dt>位置</dt>
          <dd>{locationLabel}</dd>
        </div>
        <div class="file-info-app__info-row">
          <dt>大小</dt>
          <dd>{formatFilesByteSize(totalBytes)}</dd>
        </div>
      </dl>
      <ul class="file-info-app__multi-list">
        {tab.nodes.map((node, index) => (
          <li key={index} class="file-info-app__multi-item">
            {node ? (
              <>
                <span class="file-info-app__multi-name">{node.name}</span>
                <span class="file-info-app__multi-meta">
                  {node.kind === 'folder' ? '文件夹' : '文件'} ·{' '}
                  {node.kind === 'file' ? formatFilesByteSize(node.byteSize) : '—'}
                </span>
              </>
            ) : (
              <span class="file-info-app__multi-name file-info-app__multi-name--missing">
                项目不存在
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
