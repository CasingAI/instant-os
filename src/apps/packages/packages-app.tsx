import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { getAppDefinition } from '../../os/app-registry.tsx'
import {
  DEVICE_STORAGE_KEYS,
  writeLocalStorageItem,
} from '../../os/device-storage.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import {
  cancelPackageTask,
  estimatePackageStoreBytes,
  formatInstallLivePlain,
  formatProgressLine,
  getCachedStorePackageDetail,
  getInstalledPackageDetail,
  getPackageServiceConfig,
  installPackages,
  listCachedStorePackages,
  listInstalled,
  outdatedPackages,
  resolvePackageProjectRoot,
  subscribePackageEvents,
  uninstallPackages,
  type CachedStorePackage,
  type CachedStorePackageDetail,
  type InstalledPackageDetail,
  type PackageTaskProgress,
  type PackageTaskStatus,
} from '../../packages/package-public.ts'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { SegmentedControl } from '../../ui/segmented-control.tsx'
import { SettingsNavRow } from '../../ui/settings-nav-row.tsx'
import { useSystemOpenDialog } from '../../window/system-open-dialog.tsx'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import { PackagesInstallSheet } from './packages-install-sheet.tsx'
import { ExpandablePackageList } from './expandable-package-list.tsx'
import '../../ui/ios-nav-back.css'
import '../settings/settings.css'
import './packages-app.css'

const APP_ID = 'packages' as const
const PROJECT_ROOT_KEY = DEVICE_STORAGE_KEYS.packagesAppProjectRoot

type PackagesTab = 'project' | 'cache'
type InstalledPkg = { name: string; version: string }
type OutdatedMap = Record<string, { current: string; latest: string }>
type CacheDetailEntry = { name: string; version?: string }
type InstallSheetWork = {
  /** 每次开单递增，供 effect 识别新任务 */
  gen: number
  mode: 'install' | 'uninstall' | 'check'
  packageNames: string[]
  preferLock?: boolean
  projectRoot: string
  /** 完成后是否清空 outdated 标记 */
  clearOutdated?: boolean
}

function backLabelForStack(stack: readonly string[], rootLabel: string): string {
  if (stack.length <= 1) return rootLabel
  const prev = stack[stack.length - 2]!
  return prev.length > 18 ? `${prev.slice(0, 17)}…` : prev
}

function pruneInstalledDetailStack(
  stack: readonly string[],
  installedNames: ReadonlySet<string>,
): string[] {
  const next: string[] = []
  for (const name of stack) {
    if (!installedNames.has(name)) break
    next.push(name)
  }
  return next
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function loadSavedProjectRoot(): string | undefined {
  try {
    const raw = localStorage.getItem(PROJECT_ROOT_KEY)?.trim()
    return raw || undefined
  } catch {
    return undefined
  }
}

function saveProjectRoot(root: string | undefined): void {
  if (!root) {
    try {
      localStorage.removeItem(PROJECT_ROOT_KEY)
    } catch {
      // ignore
    }
    return
  }
  writeLocalStorageItem(PROJECT_ROOT_KEY, root)
}

export function PackagesApp() {
  const { windows, closeWindowsForApp, minimizeWindow } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const definition = getAppDefinition(APP_ID)
  const { showSystemOpenDialog, dialog: openDialog } = useSystemOpenDialog()
  const modal = useWindowModal()

  const [tab, setTab] = useState<PackagesTab>('project')
  const [projectRoot, setProjectRoot] = useState<string | undefined>(() => loadSavedProjectRoot())
  const [installed, setInstalled] = useState<InstalledPkg[]>([])
  const [outdated, setOutdated] = useState<OutdatedMap>({})
  const [detailStack, setDetailStack] = useState<string[]>([])
  const [detail, setDetail] = useState<InstalledPackageDetail | undefined>()
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | undefined>()
  const [depsError, setDepsError] = useState<string | undefined>()
  const [depsLoading, setDepsLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const [installSheetOpen, setInstallSheetOpen] = useState(false)
  const [installHeadline, setInstallHeadline] = useState('正在安装')
  const [installStatus, setInstallStatus] = useState<PackageTaskStatus | 'idle'>('idle')
  const [installProgress, setInstallProgress] = useState<PackageTaskProgress | undefined>()
  const [installLines, setInstallLines] = useState<string[]>([])
  const [installError, setInstallError] = useState<string | undefined>()
  const [installTaskId, setInstallTaskId] = useState<string | undefined>()
  /** 非空时由 effect 在 sheet 已经挂上之后再跑安装，避免同 tick 里 setState+重活导致弹层不画 */
  const [installWork, setInstallWork] = useState<InstallSheetWork | undefined>()
  const installGenRef = useRef(0)

  const [cached, setCached] = useState<CachedStorePackage[]>([])
  const [storeBytes, setStoreBytes] = useState(0)
  const [cacheLoading, setCacheLoading] = useState(false)
  const [cacheError, setCacheError] = useState<string | undefined>()
  const [cacheDetailStack, setCacheDetailStack] = useState<CacheDetailEntry[]>([])
  const [cacheDetail, setCacheDetail] = useState<CachedStorePackageDetail | undefined>()
  const [cacheDetailLoading, setCacheDetailLoading] = useState(false)
  const [cacheDetailError, setCacheDetailError] = useState<string | undefined>()

  const detailName = detailStack[detailStack.length - 1]
  const cacheDetailEntry = cacheDetailStack[cacheDetailStack.length - 1]
  const cacheDetailName = cacheDetailEntry?.name
  const cacheDetailVersion = cacheDetailEntry?.version
  const installedNameSet = useMemo(
    () => new Set(installed.map((pkg) => pkg.name)),
    [installed],
  )
  const cachedNameSet = useMemo(() => new Set(cached.map((pkg) => pkg.name)), [cached])

  const config = getPackageServiceConfig()

  const refreshDeps = useCallback(async (root: string) => {
    setDepsLoading(true)
    setDepsError(undefined)
    try {
      const list = await listInstalled(root)
      setInstalled(list)
      const names = new Set(list.map((pkg) => pkg.name))
      setDetailStack((prev) => pruneInstalledDetailStack(prev, names))
    } catch (error) {
      setInstalled([])
      setDepsError(error instanceof Error ? error.message : String(error))
    } finally {
      setDepsLoading(false)
    }
  }, [])

  const loadDetail = useCallback(async (root: string, name: string) => {
    setDetailLoading(true)
    setDetailError(undefined)
    try {
      const next = await getInstalledPackageDetail(root, name)
      setDetail(next)
    } catch (error) {
      setDetail(undefined)
      setDetailError(error instanceof Error ? error.message : String(error))
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const refreshCache = useCallback(async () => {
    setCacheLoading(true)
    setCacheError(undefined)
    try {
      const [list, bytes] = await Promise.all([
        listCachedStorePackages(),
        estimatePackageStoreBytes(),
      ])
      setCached(list)
      setStoreBytes(bytes)
      const names = new Set(list.map((pkg) => pkg.name))
      setCacheDetailStack((prev) => {
        const next: CacheDetailEntry[] = []
        for (const entry of prev) {
          if (!names.has(entry.name)) break
          next.push(entry)
        }
        return next
      })
    } catch (error) {
      setCached([])
      setCacheError(error instanceof Error ? error.message : String(error))
    } finally {
      setCacheLoading(false)
    }
  }, [])

  const loadCacheDetail = useCallback(async (name: string, version?: string) => {
    setCacheDetailLoading(true)
    setCacheDetailError(undefined)
    try {
      const next = await getCachedStorePackageDetail(name, version)
      setCacheDetail(next)
      setCacheDetailStack((prev) => {
        if (prev.length === 0) return prev
        const tip = prev[prev.length - 1]!
        if (tip.name !== name || tip.version === next.version) return prev
        return [...prev.slice(0, -1), { name, version: next.version }]
      })
    } catch (error) {
      setCacheDetail(undefined)
      setCacheDetailError(error instanceof Error ? error.message : String(error))
    } finally {
      setCacheDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!projectRoot) {
      setInstalled([])
      setOutdated({})
      setDetailStack([])
      setDetail(undefined)
      return
    }
    void refreshDeps(projectRoot)
  }, [projectRoot, refreshDeps])

  useEffect(() => {
    if (!projectRoot || !detailName) {
      setDetail(undefined)
      setDetailError(undefined)
      return
    }
    void loadDetail(projectRoot, detailName)
  }, [projectRoot, detailName, loadDetail])

  useEffect(() => {
    if (!cacheDetailName) {
      setCacheDetail(undefined)
      setCacheDetailError(undefined)
      return
    }
    void loadCacheDetail(cacheDetailName, cacheDetailVersion)
  }, [cacheDetailName, cacheDetailVersion, loadCacheDetail])

  useEffect(() => {
    if (tab === 'cache') {
      void refreshCache()
    }
  }, [tab, refreshCache])

  useEffect(() => {
    void refreshCache()
  }, [refreshCache])

  /** 只按本 App 会话占用禁用；不要被历史/僵尸任务的 running 状态永久卡住 */
  const actionsDisabled = !projectRoot || busy || installSheetOpen

  const openProject = useCallback(async () => {
    const path = await showSystemOpenDialog({
      title: '选择项目文件夹',
      selectionMode: 'folder',
      presentation: 'modal',
    })
    if (!path) return
    const root = await resolvePackageProjectRoot(path)
    setProjectRoot(root)
    saveProjectRoot(root)
    setOutdated({})
    setTab('project')
  }, [showSystemOpenDialog])

  const clearProject = useCallback(() => {
    setProjectRoot(undefined)
    saveProjectRoot(undefined)
    setOutdated({})
    setDetailStack([])
  }, [])

  const openPackageDetail = useCallback((name: string) => {
    setDetailStack([name])
  }, [])

  const pushPackageDetail = useCallback((name: string) => {
    setDetailStack((prev) => {
      if (prev[prev.length - 1] === name) return prev
      return [...prev, name]
    })
  }, [])

  const popPackageDetail = useCallback(() => {
    setDetailStack((prev) => prev.slice(0, -1))
    setDetail(undefined)
    setDetailError(undefined)
  }, [])

  const detailNameRef = useRef(detailName)
  const popPackageDetailRef = useRef(popPackageDetail)
  const loadDetailRef = useRef(loadDetail)
  detailNameRef.current = detailName
  popPackageDetailRef.current = popPackageDetail
  loadDetailRef.current = loadDetail

  const openCacheDetail = useCallback((name: string, version?: string) => {
    setCacheDetailStack([{ name, version }])
  }, [])

  const pushCacheDetail = useCallback((name: string, version?: string) => {
    setCacheDetailStack((prev) => {
      const tip = prev[prev.length - 1]
      if (tip?.name === name && tip.version === version) return prev
      return [...prev, { name, version }]
    })
  }, [])

  const popCacheDetail = useCallback(() => {
    setCacheDetailStack((prev) => prev.slice(0, -1))
    setCacheDetail(undefined)
    setCacheDetailError(undefined)
  }, [])

  const selectCacheDetailVersion = useCallback((version: string) => {
    setCacheDetailStack((prev) => {
      if (prev.length === 0) return prev
      const tip = prev[prev.length - 1]!
      if (tip.version === version) return prev
      return [...prev.slice(0, -1), { name: tip.name, version }]
    })
  }, [])

  const closeInstallSheet = useCallback(() => {
    setInstallWork(undefined)
    setBusy(false)
    setInstallSheetOpen(false)
    setInstallStatus('idle')
    setInstallProgress(undefined)
    setInstallLines([])
    setInstallError(undefined)
    setInstallTaskId(undefined)
  }, [])

  const startTaskWithSheet = useCallback(
    (options: {
      headline: string
      packages?: string[]
      preferLock?: boolean
      mode?: 'install' | 'uninstall' | 'check'
      clearOutdated?: boolean
    }) => {
      if (!projectRoot) {
        void modal.alert({ title: '包管理', message: '请先打开项目。' })
        return
      }
      if (installSheetOpen || installWork) return

      const mode = options.mode ?? 'install'
      const packageNames = options.packages ?? []
      const gen = ++installGenRef.current

      setBusy(true)
      setDepsError(undefined)
      setDetailError(undefined)
      setInstallHeadline(options.headline)
      setInstallStatus('running')
      setInstallProgress(undefined)
      setInstallLines(['Preparing…'])
      setInstallError(undefined)
      setInstallTaskId(undefined)
      setInstallSheetOpen(true)
      setInstallWork({
        gen,
        mode,
        packageNames,
        preferLock: options.preferLock,
        projectRoot,
        clearOutdated: options.clearOutdated,
      })
    },
    [projectRoot, modal, installSheetOpen, installWork],
  )

  // sheet 先开；下一帧 effect 再跑任务，保证用户先看到弹层
  useEffect(() => {
    if (!installWork) return
    const work = installWork
    let cancelled = false

    const unsub = subscribePackageEvents((event) => {
      if (cancelled || installGenRef.current !== work.gen) return
      if (event.type === 'progress' && event.progress) {
        setInstallProgress(event.progress)
        setInstallLines((prev) => {
          const live = formatInstallLivePlain(event.progress!)
          const withoutLive = prev.filter(
            (line) => !line.startsWith('Progress:') && !line.startsWith('Packages:'),
          )
          return [...withoutLive, ...live.split('\n').filter(Boolean)]
        })
      }
      if (event.type === 'log') {
        setInstallLines((prev) => [...prev, `[${event.line.level}] ${event.line.message}`])
      }
      if (event.type === 'task') {
        setInstallTaskId(event.task.id)
        setInstallStatus(event.task.status)
        if (event.task.error) setInstallError(event.task.error)
      }
    })

    void (async () => {
      try {
        if (work.mode === 'check') {
          setInstallLines(['Checking registry for updates…'])
          setInstallProgress({
            phase: 'resolve',
            percent: 0,
            detail: 'Starting…',
            counters: { resolved: 0, reused: 0, downloaded: 0, added: 0 },
          })
          const rows = await outdatedPackages(work.projectRoot, {
            onProgress: (info) => {
              if (cancelled || installGenRef.current !== work.gen) return
              const pct = info.total > 0 ? (info.checked / info.total) * 100 : 0
              setInstallProgress({
                phase: 'resolve',
                percent: pct,
                detail: `${info.checked}/${info.total} ${info.name}`,
                counters: {
                  resolved: info.checked,
                  reused: 0,
                  downloaded: 0,
                  added: info.outdated ? 1 : 0,
                },
              })
              const line = info.outdated
                ? `${info.name}: ${info.current} → ${info.latest}`
                : info.latest
                  ? `${info.name}: ${info.current} (up to date)`
                  : `${info.name}: skip (lookup failed)`
              setInstallLines((prev) => {
                const withoutPrep = prev.filter(
                  (l) => l !== 'Preparing…' && l !== 'Checking registry for updates…',
                )
                return [...withoutPrep, line]
              })
            },
          })
          if (cancelled || installGenRef.current !== work.gen) return
          const map: OutdatedMap = {}
          for (const row of rows) {
            map[row.name] = row
          }
          setOutdated(map)
          setInstallProgress({
            phase: 'resolve',
            percent: 100,
            detail: rows.length === 0 ? 'All up to date' : `${rows.length} outdated`,
            counters: {
              resolved: rows.length,
              reused: 0,
              downloaded: 0,
              added: rows.length,
            },
          })
          setInstallStatus('succeeded')
          setInstallLines((prev) => [
            ...prev,
            rows.length === 0
              ? 'All packages are up to date.'
              : `Found ${rows.length} outdated package${rows.length === 1 ? '' : 's'}.`,
            'Complete.',
          ])
          return
        }

        const task =
          work.mode === 'uninstall'
            ? await uninstallPackages({
                projectRoot: work.projectRoot,
                packages: work.packageNames,
              })
            : await installPackages({
                projectRoot: work.projectRoot,
                packages: work.packageNames.length > 0 ? work.packageNames : undefined,
                preferLock: work.preferLock,
              })
        if (cancelled || installGenRef.current !== work.gen) return
        setInstallTaskId(task.id)
        setInstallStatus(task.status)
        if (task.error) setInstallError(task.error)
        if (task.installReport) {
          const summary = task.installReport.alreadyUpToDate
            ? 'Already up to date'
            : formatProgressLine(task.installReport.counters, { done: true })
          setInstallLines((prev) => [...prev, summary, 'Complete.'])
        } else if (task.status === 'succeeded') {
          setInstallLines((prev) => [...prev, 'Complete.'])
        }
        if (work.clearOutdated) setOutdated({})
        await refreshDeps(work.projectRoot)
        void refreshCache()
        if (cancelled || installGenRef.current !== work.gen) return
        const currentDetail = detailNameRef.current
        if (work.mode === 'uninstall' && currentDetail && work.packageNames.includes(currentDetail)) {
          popPackageDetailRef.current()
        } else if (
          work.mode === 'install' &&
          currentDetail &&
          work.packageNames.some(
            (spec) => spec === currentDetail || spec.startsWith(`${currentDetail}@`),
          )
        ) {
          await loadDetailRef.current(work.projectRoot, currentDetail)
        }
      } catch (error) {
        if (cancelled || installGenRef.current !== work.gen) return
        const message = error instanceof Error ? error.message : String(error)
        setInstallStatus('failed')
        setInstallError(message)
        setInstallLines((prev) => [...prev, `Error: ${message}`])
        if (work.mode === 'uninstall') setDetailError(message)
        if (work.mode === 'check') setDepsError(message)
      } finally {
        if (!cancelled && installGenRef.current === work.gen) {
          setBusy(false)
          setInstallWork(undefined)
        }
      }
    })()

    return () => {
      cancelled = true
      unsub()
    }
  }, [installWork])

  const runInstallDeps = useCallback(() => {
    startTaskWithSheet({
      headline: '正在安装依赖',
      preferLock: true,
    })
  }, [startTaskWithSheet])

  const runAddPackages = useCallback(async () => {
    if (!projectRoot || busy || installSheetOpen) return
    const raw = await modal.prompt({
      title: '添加包',
      label: '包名',
      placeholder: '例如 lodash 或 left-pad@1.3.0',
      confirmLabel: '安装',
      cancelLabel: '取消',
      requireValue: true,
      validate: (value) => {
        const names = value
          .trim()
          .split(/\s+/)
          .filter(Boolean)
        if (names.length === 0) return '请输入至少一个包名'
        return undefined
      },
    })
    if (!raw) return
    const packages = raw
      .trim()
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
    startTaskWithSheet({
      headline: packages.length === 1 ? `正在安装 ${packages[0]}` : '正在安装软件包',
      packages,
    })
  }, [projectRoot, busy, installSheetOpen, modal, startTaskWithSheet])

  const runUninstallDetail = useCallback(() => {
    if (!projectRoot || !detailName) return
    startTaskWithSheet({
      headline: `正在卸载 ${detailName}`,
      packages: [detailName],
      mode: 'uninstall',
    })
  }, [projectRoot, detailName, startTaskWithSheet])

  const runUpdate = useCallback(
    (names: string[]) => {
      if (!projectRoot || names.length === 0) return
      startTaskWithSheet({
        headline: names.length === 1 ? `正在更新 ${names[0]}` : '正在更新软件包',
        packages: names.map((name) => `${name}@latest`),
        preferLock: false,
        clearOutdated: true,
      })
    },
    [projectRoot, startTaskWithSheet],
  )

  const checkOutdated = useCallback(() => {
    if (!projectRoot || installed.length === 0) return
    startTaskWithSheet({
      headline: '正在检查更新',
      mode: 'check',
    })
  }, [projectRoot, installed, startTaskWithSheet])

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === APP_ID)
    return [
      {
        label: definition?.name ?? '包管理',
        items: [
          ...aboutAppMenuPrefix(`关于${definition?.name ?? '包管理'}`, () =>
            showBuiltinAbout(APP_ID),
          ),
          {
            type: 'action',
            label: '打开项目…',
            onClick: () => void openProject(),
          },
          {
            type: 'action',
            label: '关闭项目',
            disabled: !projectRoot,
            onClick: clearProject,
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '刷新',
            onClick: () => {
              if (projectRoot) void refreshDeps(projectRoot)
              void refreshCache()
            },
          },
          {
            type: 'action',
            label: '最小化',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: `退出${definition?.name ?? '包管理'}`,
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp(APP_ID),
          },
        ],
      },
    ]
  }, [
    clearProject,
    closeWindowsForApp,
    definition?.name,
    minimizeWindow,
    openProject,
    projectRoot,
    refreshCache,
    refreshDeps,
    showBuiltinAbout,
    windows,
  ])

  useAppMenuBar(APP_ID, menuBar)

  const cacheVersionCount = cached.reduce((sum, pkg) => sum + pkg.versions.length, 0)
  const detailOutdated = detailName ? outdated[detailName] : undefined

  const installSheet = (
    <PackagesInstallSheet
      open={installSheetOpen}
      headline={installHeadline}
      status={installStatus}
      progress={installProgress}
      lines={installLines}
      error={installError}
      onCancel={() => {
        if (installTaskId) {
          cancelPackageTask(installTaskId)
          return
        }
        // 检查更新没有 PackageTask，直接作废当前 gen
        installGenRef.current += 1
        setInstallWork(undefined)
        setBusy(false)
        setInstallStatus('cancelled')
        setInstallLines((prev) => [...prev, 'Cancelled.'])
      }}
      onDone={closeInstallSheet}
    />
  )

  if (detailName) {
    return (
      <div class="settings packages-app">
        {openDialog}
        {installSheet}
        <header class="settings__nav packages-app__header">
          <IosNavBackButton
            label={backLabelForStack(detailStack, '项目')}
            onClick={popPackageDetail}
          />
        </header>
        <div class="settings__content settings__content--compact">
          <section class="settings__section">
              <h2 class="settings__section-title">{detailName}</h2>
              {detailLoading && (
                <p class="settings__section-subtitle">加载详情…</p>
              )}
              {detailError && (
                <p class="settings__section-footnote settings__form-status--error">{detailError}</p>
              )}
              {detail && (
                <>
                  {detail.description && (
                    <p class="settings__section-subtitle">{detail.description}</p>
                  )}
                  <div class="settings__list">
                    <div class="settings__row settings__row--static">
                      <span class="settings__row-name">版本</span>
                      <span class="settings__row-size">{detail.version}</span>
                    </div>
                    {detailOutdated && (
                      <div class="settings__row settings__row--static">
                        <span class="settings__row-name">最新</span>
                        <span class="settings__row-size">
                          {detailOutdated.current} → {detailOutdated.latest}
                        </span>
                      </div>
                    )}
                    {detail.license && (
                      <div class="settings__row settings__row--static">
                        <span class="settings__row-name">许可证</span>
                        <span class="settings__row-size">{detail.license}</span>
                      </div>
                    )}
                    {detail.homepage && (
                      <div class="settings__row settings__row--static">
                        <span class="settings__row-name">主页</span>
                        <span class="settings__row-size packages-app__path">{detail.homepage}</span>
                      </div>
                    )}
                    {detail.main && (
                      <div class="settings__row settings__row--static">
                        <span class="settings__row-name">main</span>
                        <span class="settings__row-size packages-app__path">{detail.main}</span>
                      </div>
                    )}
                    {detail.module && (
                      <div class="settings__row settings__row--static">
                        <span class="settings__row-name">module</span>
                        <span class="settings__row-size packages-app__path">{detail.module}</span>
                      </div>
                    )}
                    {detail.binLabels.length > 0 && (
                      <div class="settings__row settings__row--static">
                        <span class="settings__row-name">bin</span>
                        <span class="settings__row-size">{detail.binLabels.join(', ')}</span>
                      </div>
                    )}
                    <div class="settings__row settings__row--static">
                      <span class="settings__row-name">缓存</span>
                      <span class="settings__row-size">
                        {detail.inStore ? '已在全局 store' : '未完整缓存'}
                      </span>
                    </div>
                    <div class="settings__row settings__row--static">
                      <span class="settings__row-name">链接</span>
                      <span class="settings__row-size packages-app__path">{detail.linkPath}</span>
                    </div>
                    <div class="settings__row settings__row--static">
                      <span class="settings__row-name">Store</span>
                      <span class="settings__row-size packages-app__path">{detail.storePath}</span>
                    </div>
                    {detail.resolved && (
                      <div class="settings__row settings__row--static">
                        <span class="settings__row-name">resolved</span>
                        <span class="settings__row-size packages-app__path">{detail.resolved}</span>
                      </div>
                    )}
                    {detail.integrity && (
                      <div class="settings__row settings__row--static">
                        <span class="settings__row-name">integrity</span>
                        <span class="settings__row-size packages-app__path">{detail.integrity}</span>
                      </div>
                    )}
                  </div>

                  {detail.lockDependencies.length > 0 && (
                    <>
                      <h2 class="settings__section-title packages-app__detail-deps-title">
                        依赖（{detail.lockDependencies.length}）
                      </h2>
                      <div class="settings__list">
                        <div class="settings__list-head packages-app__list-head--nav">
                          <span>包名</span>
                          <span>范围</span>
                        </div>
                        <div class="settings__list-body settings__list-body--apps">
                          {detail.lockDependencies.map((dep) =>
                            installedNameSet.has(dep.name) ? (
                              <SettingsNavRow
                                key={dep.name}
                                label={dep.name}
                                value={dep.range}
                                onClick={() => pushPackageDetail(dep.name)}
                              />
                            ) : (
                              <div key={dep.name} class="settings__row settings__row--static">
                                <span class="settings__row-name">{dep.name}</span>
                                <span class="settings__row-size">{dep.range}</span>
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  <div class="settings__actions settings__actions--inline">
                    <button
                      type="button"
                      class="settings__btn settings__btn--default"
                      disabled={actionsDisabled}
                      onClick={() => void runUpdate([detail.name])}
                    >
                      更新到 latest
                    </button>
                    <button
                      type="button"
                      class="settings__btn settings__btn--danger"
                      disabled={actionsDisabled}
                      onClick={() => void runUninstallDetail()}
                    >
                      卸载
                    </button>
                  </div>
                </>
              )}
          </section>
        </div>
      </div>
    )
  }

  if (cacheDetailName) {
    return (
      <div class="settings packages-app">
        {openDialog}
        {installSheet}
        <header class="settings__nav packages-app__header">
          <IosNavBackButton
            label={backLabelForStack(
              cacheDetailStack.map((entry) => entry.name),
              '全局缓存',
            )}
            onClick={popCacheDetail}
          />
        </header>
        <div class="settings__content settings__content--compact">
          <section class="settings__section">
              <h2 class="settings__section-title">{cacheDetailName}</h2>
              {cacheDetailLoading && (
                <p class="settings__section-subtitle">加载详情…</p>
              )}
              {cacheDetailError && (
                <p class="settings__section-footnote settings__form-status--error">
                  {cacheDetailError}
                </p>
              )}
              {cacheDetail && (
                <>
                  {cacheDetail.description && (
                    <p class="settings__section-subtitle">{cacheDetail.description}</p>
                  )}
                  <div class="settings__list">
                    <div class="settings__row settings__row--static">
                      <span class="settings__row-name">版本</span>
                      <span class="settings__row-size">{cacheDetail.version}</span>
                    </div>
                    {cacheDetail.license && (
                      <div class="settings__row settings__row--static">
                        <span class="settings__row-name">许可证</span>
                        <span class="settings__row-size">{cacheDetail.license}</span>
                      </div>
                    )}
                    {cacheDetail.homepage && (
                      <div class="settings__row settings__row--static">
                        <span class="settings__row-name">主页</span>
                        <span class="settings__row-size packages-app__path">
                          {cacheDetail.homepage}
                        </span>
                      </div>
                    )}
                    {cacheDetail.main && (
                      <div class="settings__row settings__row--static">
                        <span class="settings__row-name">main</span>
                        <span class="settings__row-size packages-app__path">{cacheDetail.main}</span>
                      </div>
                    )}
                    {cacheDetail.module && (
                      <div class="settings__row settings__row--static">
                        <span class="settings__row-name">module</span>
                        <span class="settings__row-size packages-app__path">{cacheDetail.module}</span>
                      </div>
                    )}
                    {cacheDetail.binLabels.length > 0 && (
                      <div class="settings__row settings__row--static">
                        <span class="settings__row-name">bin</span>
                        <span class="settings__row-size">{cacheDetail.binLabels.join(', ')}</span>
                      </div>
                    )}
                    <div class="settings__row settings__row--static">
                      <span class="settings__row-name">位置</span>
                      <span class="settings__row-size">全局 CAS store</span>
                    </div>
                    <div class="settings__row settings__row--static">
                      <span class="settings__row-name">Store</span>
                      <span class="settings__row-size packages-app__path">{cacheDetail.storePath}</span>
                    </div>
                  </div>

                  {cacheDetail.versions.length > 1 && (
                    <>
                      <h2 class="settings__section-title packages-app__detail-deps-title">
                        已缓存版本（{cacheDetail.versions.length}）
                      </h2>
                      <div class="settings__list">
                        <div class="settings__list-body settings__list-body--apps">
                          {[...cacheDetail.versions].reverse().map((version) => (
                            <button
                              key={version}
                              type="button"
                              class={
                                version === cacheDetail.version
                                  ? 'settings__row settings__row--button packages-app__row--selected'
                                  : 'settings__row settings__row--button'
                              }
                              onClick={() => selectCacheDetailVersion(version)}
                            >
                              <span class="settings__row-name">{version}</span>
                              <span class="settings__row-size">
                                {version === cacheDetail.version ? '当前' : '查看'}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {cacheDetail.dependencies.length > 0 && (
                    <>
                      <h2 class="settings__section-title packages-app__detail-deps-title">
                        依赖（{cacheDetail.dependencies.length}）
                      </h2>
                      <div class="settings__list">
                        <div class="settings__list-head packages-app__list-head--nav">
                          <span>包名</span>
                          <span>范围</span>
                        </div>
                        <div class="settings__list-body settings__list-body--apps">
                          {cacheDetail.dependencies.map((dep) =>
                            cachedNameSet.has(dep.name) ? (
                              <SettingsNavRow
                                key={dep.name}
                                label={dep.name}
                                value={dep.range}
                                onClick={() => pushCacheDetail(dep.name)}
                              />
                            ) : (
                              <div key={dep.name} class="settings__row settings__row--static">
                                <span class="settings__row-name">{dep.name}</span>
                                <span class="settings__row-size">{dep.range}</span>
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  <p class="settings__section-footnote">
                    此包已缓存在全局 store。打开项目后安装同名版本时可直接复用，无需重新下载。
                  </p>
                </>
              )}
          </section>
        </div>
      </div>
    )
  }

  return (
    <div class="settings packages-app">
      {openDialog}
      {installSheet}
      <header class="settings__nav packages-app__header">
        <SegmentedControl
          value={tab}
          ariaLabel="包管理"
          className="packages-app__tabs"
          items={[
            { id: 'project', label: '项目' },
            {
              id: 'cache',
              label: '全局缓存',
              badge: cacheVersionCount > 0 ? cacheVersionCount : undefined,
            },
          ]}
          onChange={setTab}
        />
      </header>

      <div class="settings__content settings__content--compact">
        {tab === 'project' && (
          <>
            <section class="settings__section">
              <h2 class="settings__section-title">项目</h2>
              <p class="settings__section-subtitle">
                registry {config.registryUrl}
              </p>
              <div class="settings__list">
                <div class="settings__row settings__row--static">
                  <span class="settings__row-name">路径</span>
                  <span class="settings__row-size packages-app__path">
                    {projectRoot ?? '未打开'}
                  </span>
                </div>
              </div>
              <div class="settings__actions settings__actions--inline">
                <button
                  type="button"
                  class="settings__btn settings__btn--default"
                  onClick={() => void openProject()}
                >
                  打开项目…
                </button>
                <button
                  type="button"
                  class="settings__btn settings__btn--plain"
                  disabled={!projectRoot}
                  onClick={clearProject}
                >
                  关闭
                </button>
              </div>
            </section>

            <section class="settings__section">
              <h2 class="settings__section-title">
                已安装依赖{depsLoading ? '…' : projectRoot ? `（${installed.length}）` : ''}
              </h2>
              {!projectRoot ? (
                <p class="settings__section-footnote">打开含 package.json 的项目后，可在此管理依赖。</p>
              ) : (
                <>
                  <ExpandablePackageList
                    key={`installed:${projectRoot ?? ''}`}
                    resetKey={`installed:${projectRoot ?? ''}:${installed.length}`}
                    items={installed}
                    getKey={(pkg) => pkg.name}
                    showAllLabel={`显示全部依赖（${installed.length}）`}
                    head={
                      <div class="settings__list-head packages-app__list-head--nav">
                        <span>包名</span>
                        <span>版本</span>
                      </div>
                    }
                    empty={
                      <div class="settings__row settings__row--static">
                        <span class="settings__row-name">尚无已安装依赖</span>
                      </div>
                    }
                    renderItem={(pkg) => {
                      const stale = outdated[pkg.name]
                      return (
                        <SettingsNavRow
                          label={pkg.name}
                          value={stale ? `${stale.current} → ${stale.latest}` : pkg.version}
                          onClick={() => openPackageDetail(pkg.name)}
                        />
                      )
                    }}
                  />

                  <div class="settings__actions settings__actions--inline">
                    <button
                      type="button"
                      class="settings__btn settings__btn--default"
                      disabled={actionsDisabled}
                      onClick={() => void runInstallDeps()}
                    >
                      安装依赖
                    </button>
                    <button
                      type="button"
                      class="settings__btn"
                      disabled={actionsDisabled}
                      onClick={() => void runAddPackages()}
                    >
                      添加包…
                    </button>
                    <button
                      type="button"
                      class="settings__btn settings__btn--plain"
                      disabled={actionsDisabled || installed.length === 0}
                      onClick={() => void runUpdate(installed.map((p) => p.name))}
                    >
                      全部更新
                    </button>
                    <button
                      type="button"
                      class="settings__btn settings__btn--plain"
                      disabled={actionsDisabled || installed.length === 0}
                      onClick={() => void checkOutdated()}
                    >
                      检查更新
                    </button>
                  </div>
                </>
              )}
              {depsError && (
                <p class="settings__section-footnote settings__form-status--error">{depsError}</p>
              )}
            </section>
          </>
        )}

        {tab === 'cache' && (
          <section class="settings__section">
              <div class="packages-app__section-head">
                <div class="packages-app__section-head-text">
                  <h2 class="settings__section-title">全局缓存</h2>
                  <p class="settings__section-subtitle">
                    store {config.storeRoot}
                    {cacheLoading ? '' : ` · ${formatBytes(storeBytes)} · ${cached.length} 个包`}
                  </p>
                </div>
                <button
                  type="button"
                  class="settings__btn settings__btn--plain"
                  disabled={cacheLoading}
                  onClick={() => void refreshCache()}
                >
                  刷新
                </button>
              </div>
              <ExpandablePackageList
                key="cache-packages"
                resetKey={`cache:${cached.length}`}
                items={cached}
                getKey={(pkg) => pkg.name}
                showAllLabel={`显示全部缓存包（${cached.length}）`}
                head={
                  <div class="settings__list-head packages-app__list-head--nav">
                    <span>包名</span>
                    <span>已缓存版本</span>
                  </div>
                }
                empty={
                  cacheLoading ? (
                    <div class="settings__row settings__row--static">
                      <span class="settings__row-name">加载中…</span>
                    </div>
                  ) : (
                    <div class="settings__row settings__row--static">
                      <span class="settings__row-name">缓存为空</span>
                      <span class="settings__row-size">安装过的包会出现在这里</span>
                    </div>
                  )
                }
                renderItem={(pkg) => (
                  <SettingsNavRow
                    label={pkg.name}
                    value={
                      pkg.versions.length === 1
                        ? pkg.versions[0]!
                        : `${pkg.versions[pkg.versions.length - 1]} 等 ${pkg.versions.length} 个`
                    }
                    onClick={() => openCacheDetail(pkg.name)}
                  />
                )}
              />
              {cacheError && (
                <p class="settings__section-footnote settings__form-status--error">{cacheError}</p>
              )}
              <p class="settings__section-footnote">
                内容寻址缓存（CAS）。项目 `node_modules` 通过符号链接复用此处版本；完整提交的包带有
                .instant-ok 标记。
              </p>
          </section>
        )}
      </div>
    </div>
  )
}
