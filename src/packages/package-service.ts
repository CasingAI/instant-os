import {
  filesCreateText,
  filesReadText,
  filesStat,
  filesWriteText,
} from '../apps/files/files-api.ts'
import { emitPackageEvent, serializeTaskForEvent } from './package-events.ts'
import {
  downloadTarball,
  resolveRegistryVersion,
} from './package-registry.ts'
import {
  extractTarballToStore,
  isPackageInStore,
  linkPackageIntoProject,
  listStorePackageVersions,
  readStorePackageJson,
  storePackageDir,
  ensureStoreRoot,
} from './package-store.ts'
import { emptyCounters } from './package-install-report.ts'
import { runLifecycleScripts } from './package-run.ts'
import { maxSatisfying, satisfiesSemver } from './package-semver.ts'
import type {
  InstantPackageLock,
  PackageInstallCounters,
  PackageInstallDepChange,
  PackageInstallReport,
  PackageLockEntry,
  PackageLogLevel,
  PackageServiceConfig,
  PackageTask,
  PackageTaskProgress,
  RegistryPackageVersion,
} from './package-types.ts'
import { DEFAULT_PACKAGE_SERVICE_CONFIG } from './package-types.ts'

const ROOT_PREINSTALL = ['preinstall'] as const
const ROOT_POST_INSTALL = ['install', 'postinstall', 'prepare'] as const
const DEP_LIFECYCLE = ['preinstall', 'install', 'postinstall'] as const

let config: PackageServiceConfig = {
  ...DEFAULT_PACKAGE_SERVICE_CONFIG,
  allowedHosts: [...DEFAULT_PACKAGE_SERVICE_CONFIG.allowedHosts],
}
const tasks = new Map<string, PackageTask>()
const taskOrder: string[] = []

export function getPackageServiceConfig(): PackageServiceConfig {
  return config
}

export function setPackageServiceConfig(patch: Partial<PackageServiceConfig>): void {
  config = {
    ...config,
    ...patch,
    allowedHosts: patch.allowedHosts
      ? [...patch.allowedHosts]
      : [...config.allowedHosts],
  }
}

/** 放行 tarball / 镜像 CDN 主机（在已信任当前 registry 的前提下） */
export function allowPackageHost(hostname: string): void {
  const host = hostname.trim().toLowerCase()
  if (!host || config.allowedHosts.includes(host)) return
  config = { ...config, allowedHosts: [...config.allowedHosts, host] }
}

function ensureTarballHostAllowed(tarballUrl: string): void {
  try {
    const host = new URL(tarballUrl).hostname
    allowPackageHost(host)
  } catch {
    // downloadTarball 会再报无效 URL
  }
}

function newTaskId(): string {
  return `pkg:${crypto.randomUUID()}`
}

function publishTask(task: PackageTask): void {
  emitPackageEvent({ type: 'task', task: serializeTaskForEvent(task) })
}

function setProgress(task: PackageTask, progress: PackageTaskProgress | undefined): void {
  task.progress = progress
  task.updatedAt = Date.now()
  emitPackageEvent({ type: 'progress', taskId: task.id, progress })
  publishTask(task)
}

function clearProgress(task: PackageTask): void {
  if (task.progress === undefined) return
  setProgress(task, undefined)
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 节流进度上报；force、完成（percent===100）或首次时立即发出 */
function createThrottledProgressReporter(
  task: PackageTask,
  minIntervalMs = 100,
): {
  report: (progress: PackageTaskProgress, force?: boolean) => void
  clear: () => void
} {
  let lastAt = 0
  return {
    report(progress, force = false) {
      const now = Date.now()
      const done = progress.percent === 100
      if (!force && !done && lastAt > 0 && now - lastAt < minIntervalMs) {
        return
      }
      lastAt = now
      setProgress(task, progress)
    },
    clear() {
      clearProgress(task)
    },
  }
}

function log(task: PackageTask, level: PackageLogLevel, message: string): void {
  const line = { at: Date.now(), level, message }
  task.logs.push(line)
  task.updatedAt = Date.now()
  emitPackageEvent({ type: 'log', taskId: task.id, line })
  publishTask(task)
}

export function listPackageTasks(): Omit<PackageTask, 'abortController'>[] {
  return taskOrder
    .map((id) => tasks.get(id))
    .filter((t): t is PackageTask => t !== undefined)
    .map(serializeTaskForEvent)
}

export function getPackageTask(id: string): Omit<PackageTask, 'abortController'> | undefined {
  const task = tasks.get(id)
  return task ? serializeTaskForEvent(task) : undefined
}

export function cancelPackageTask(id: string): boolean {
  const task = tasks.get(id)
  if (!task) return false
  if (task.status === 'succeeded' || task.status === 'failed' || task.status === 'cancelled') {
    return false
  }
  task.abortController.abort()
  task.status = 'cancelled'
  task.updatedAt = Date.now()
  log(task, 'warn', '任务已取消')
  return true
}

/**
 * 从 cwd 向上查找最近的 package.json 所在目录（对齐桌面 npm）。
 * 找不到则回退为 cwd，安装时会在该处创建/写入 package.json 与 node_modules。
 */
export async function resolvePackageProjectRoot(cwd: string): Promise<string> {
  let cursor = cwd.trim().replace(/\/+$/, '') || '/'
  const seen = new Set<string>()
  while (!seen.has(cursor)) {
    seen.add(cursor)
    const st = await filesStat(`${cursor}/package.json`)
    if (st?.kind === 'file') return cursor
    if (cursor === '/') break
    const idx = cursor.lastIndexOf('/')
    cursor = idx <= 0 ? '/' : cursor.slice(0, idx)
  }
  return cwd.trim().replace(/\/+$/, '') || '/'
}

async function readProjectPackageJson(
  projectRoot: string,
): Promise<Record<string, unknown>> {
  const path = `${projectRoot}/package.json`
  const st = await filesStat(path)
  if (!st) {
    return { name: 'project', version: '0.0.0', dependencies: {} }
  }
  return JSON.parse(await filesReadText(path)) as Record<string, unknown>
}

/** 路径不存在则创建，存在则覆写（filesWriteText 仅支持已有文件） */
async function upsertTextFile(path: string, text: string): Promise<void> {
  const st = await filesStat(path)
  if (st?.kind === 'file') {
    await filesWriteText(path, text)
    return
  }
  if (st) {
    throw new Error(`路径已存在且非文件: ${path}`)
  }
  await filesCreateText(path, text)
}

async function writeProjectPackageJson(
  projectRoot: string,
  pkg: Record<string, unknown>,
): Promise<void> {
  await upsertTextFile(`${projectRoot}/package.json`, `${JSON.stringify(pkg, null, 2)}\n`)
}

async function readLock(projectRoot: string): Promise<InstantPackageLock> {
  const path = `${projectRoot}/instant-lock.json`
  const st = await filesStat(path)
  if (!st) {
    return { lockfileVersion: 1, packages: {} }
  }
  return JSON.parse(await filesReadText(path)) as InstantPackageLock
}

async function writeLock(projectRoot: string, lock: InstantPackageLock): Promise<void> {
  await upsertTextFile(
    `${projectRoot}/instant-lock.json`,
    `${JSON.stringify(lock, null, 2)}\n`,
  )
}

function parseSpec(spec: string): { name: string; range: string } {
  if (spec.startsWith('@')) {
    const at = spec.indexOf('@', 1)
    if (at === -1) return { name: spec, range: 'latest' }
    return { name: spec.slice(0, at), range: spec.slice(at + 1) || 'latest' }
  }
  const at = spec.indexOf('@')
  if (at === -1) return { name: spec, range: 'latest' }
  return { name: spec.slice(0, at), range: spec.slice(at + 1) || 'latest' }
}

function assertNotNative(name: string, version: string, meta: RegistryPackageVersion): void {
  if (meta.hasNative) {
    throw new Error(
      `拒绝原生包 ${name}@${version}（含 gypfile/binary/node-gyp 类 install 脚本）`,
    )
  }
}

type ResolveQueueItem = {
  name: string
  range: string
  /** peer 降级安装：解析失败只告警，不中断整棵树 */
  soft?: boolean
}

type ResolvedNode = {
  name: string
  version: string
  meta: RegistryPackageVersion
  fromLock?: boolean
}

function metaFromLockEntry(entry: PackageLockEntry): RegistryPackageVersion {
  return {
    version: entry.version,
    dist: {
      tarball: entry.resolved ?? '',
      integrity: entry.integrity,
    },
    dependencies: entry.dependencies,
    hasNative: false,
  }
}

function tryNodeFromLock(
  name: string,
  range: string,
  lock: InstantPackageLock,
): ResolvedNode | undefined {
  const entry = lock.packages[name]
  if (!entry) return undefined
  if (!satisfiesSemver(entry.version, range)) return undefined
  return {
    name,
    version: entry.version,
    meta: metaFromLockEntry(entry),
    fromLock: true,
  }
}

/** 锁未命中时：若 CAS 已有满足范围的版本，用本地 package.json 继续解析，免打 registry */
async function tryNodeFromStore(
  name: string,
  range: string,
): Promise<ResolvedNode | undefined> {
  const versions = await listStorePackageVersions(config, name)
  if (versions.length === 0) return undefined
  const version = maxSatisfying(versions, range)
  if (!version) return undefined
  if (!(await isPackageInStore(config, name, version))) return undefined
  const storePath = storePackageDir(config, name, version)
  const pkg = await readStorePackageJson(storePath)
  return {
    name,
    version,
    meta: {
      version,
      dist: { tarball: '' },
      dependencies: (pkg.dependencies as Record<string, string> | undefined) ?? undefined,
      hasNative: pkg.gypfile === true,
    },
  }
}

function publishInstallProgress(
  task: PackageTask,
  counters: PackageInstallCounters,
  patch: Partial<PackageTaskProgress> & Pick<PackageTaskProgress, 'phase' | 'detail'>,
): void {
  setProgress(task, {
    counters: { ...counters },
    packagesPlus: patch.packagesPlus ?? task.progress?.packagesPlus,
    packagesMinus: patch.packagesMinus ?? task.progress?.packagesMinus,
    fetchHint: patch.fetchHint,
    done: patch.done,
    percent: patch.percent,
    phase: patch.phase,
    detail: patch.detail,
  })
}

async function resolveTree(
  roots: { name: string; range: string }[],
  task: PackageTask,
  options: {
    preferLock: boolean
    lock: InstantPackageLock
    counters: PackageInstallCounters
  },
): Promise<ResolvedNode[]> {
  const resolved = new Map<string, ResolvedNode>()
  const queue: ResolveQueueItem[] = roots.map((r) => ({ ...r }))

  while (queue.length > 0) {
    task.abortController.signal.throwIfAborted()
    const next = queue.shift()!
    const key = next.name
    if (resolved.has(key)) continue

    if (options.preferLock) {
      const fromLock = tryNodeFromLock(next.name, next.range, options.lock)
      if (fromLock) {
        log(task, 'info', `锁命中 ${fromLock.name}@${fromLock.version}（满足 ${next.range}）`)
        assertNotNative(fromLock.name, fromLock.version, fromLock.meta)
        resolved.set(key, fromLock)
        options.counters.resolved = resolved.size
        publishInstallProgress(task, options.counters, {
          phase: 'resolve',
          detail: `resolved ${fromLock.name}@${fromLock.version}`,
        })
        for (const [dep, range] of Object.entries(fromLock.meta.dependencies ?? {})) {
          if (!resolved.has(dep)) {
            queue.push({ name: dep, range })
          }
        }
        continue
      }

      const fromStore = await tryNodeFromStore(next.name, next.range)
      if (fromStore) {
        log(
          task,
          'info',
          `本地 store 命中 ${fromStore.name}@${fromStore.version}（满足 ${next.range}，跳过 registry）`,
        )
        assertNotNative(fromStore.name, fromStore.version, fromStore.meta)
        resolved.set(key, fromStore)
        options.counters.resolved = resolved.size
        publishInstallProgress(task, options.counters, {
          phase: 'resolve',
          detail: `resolved ${fromStore.name}@${fromStore.version}`,
        })
        for (const [dep, range] of Object.entries(fromStore.meta.dependencies ?? {})) {
          if (!resolved.has(dep)) {
            queue.push({ name: dep, range })
          }
        }
        continue
      }
    }

    log(task, 'info', `解析 ${next.name}@${next.range}`)
    let meta: RegistryPackageVersion
    try {
      meta = await resolveRegistryVersion(
        next.name,
        next.range,
        config,
        task.abortController.signal,
      )
    } catch (error) {
      if (next.soft) {
        const reason = error instanceof Error ? error.message : String(error)
        log(task, 'warn', `跳过 peer ${next.name}@${next.range}（${reason}）`)
        continue
      }
      throw error
    }
    if (meta.dist.tarball) ensureTarballHostAllowed(meta.dist.tarball)
    assertNotNative(next.name, meta.version, meta)
    resolved.set(key, { name: next.name, version: meta.version, meta })
    options.counters.resolved = resolved.size
    publishInstallProgress(task, options.counters, {
      phase: 'resolve',
      detail: `resolved ${next.name}@${meta.version}`,
    })
    for (const [dep, range] of Object.entries(meta.dependencies ?? {})) {
      if (!resolved.has(dep)) {
        queue.push({ name: dep, range })
      }
    }
    const peerMeta = meta.peerDependenciesMeta ?? {}
    for (const [dep, range] of Object.entries(meta.peerDependencies ?? {})) {
      if (resolved.has(dep)) continue
      if (peerMeta[dep]?.optional === true) {
        log(task, 'info', `跳过 optional peer ${dep}@${range}`)
        continue
      }
      log(task, 'warn', `peer 依赖降级尝试: ${dep}@${range}`)
      queue.push({ name: dep, range, soft: true })
    }
  }

  return [...resolved.values()]
}

async function materializeNode(
  node: ResolvedNode,
  task: PackageTask,
  counters: PackageInstallCounters,
  packagesPlus: number,
): Promise<{ storePath: string; downloaded: boolean }> {
  const storePath = storePackageDir(config, node.name, node.version)
  if (await isPackageInStore(config, node.name, node.version)) {
    log(task, 'info', `缓存命中 ${node.name}@${node.version}`)
    return { storePath, downloaded: false }
  }

  let tarballUrl = node.meta.dist.tarball
  if (!tarballUrl) {
    log(task, 'info', `锁无 resolved，向 registry 补全 ${node.name}@${node.version}`)
    const meta = await resolveRegistryVersion(
      node.name,
      node.version,
      config,
      task.abortController.signal,
    )
    tarballUrl = meta.dist.tarball
    node.meta = meta
  }

  ensureTarballHostAllowed(tarballUrl)
  const label = `${node.name}@${node.version}`
  const reporter = createThrottledProgressReporter(task)
  log(task, 'info', `下载 ${label}`)
  try {
    const tarball = await downloadTarball(
      tarballUrl,
      config,
      task.abortController.signal,
      ({ received, total }) => {
        const sizePart =
          total && total > 0
            ? `${formatByteSize(received)} / ${formatByteSize(total)}`
            : formatByteSize(received)
        reporter.report({
          phase: 'download',
          percent:
            total && total > 0
              ? Math.min(100, Math.round((received / total) * 100))
              : undefined,
          detail: `下载 ${label}  ${sizePart}`,
          counters: { ...counters },
          packagesPlus,
          fetchHint: `Downloading ${label}: ${sizePart}`,
        })
      },
    )
    reporter.report(
      {
        phase: 'download',
        percent: 100,
        detail: `下载 ${label}  ${formatByteSize(tarball.byteLength)}`,
        counters: { ...counters },
        packagesPlus,
        fetchHint: `Downloading ${label}: ${formatByteSize(tarball.byteLength)}`,
      },
      true,
    )

    log(task, 'info', `解压 ${label}（${formatByteSize(tarball.byteLength)}）`)
    const dest = await extractTarballToStore({
      config,
      name: node.name,
      version: node.version,
      tarball,
      signal: task.abortController.signal,
      onProgress: ({ done, total, bytesWritten, currentPath }) => {
        const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 100
        const pathHint = currentPath ? `  ${currentPath}` : ''
        const filesPart = `${done}/${total}`
        reporter.report({
          phase: 'extract',
          percent,
          detail: `解压 ${label}  ${filesPart} (${percent}%)  ${formatByteSize(bytesWritten)}${pathHint}`,
          counters: { ...counters },
          packagesPlus,
          fetchHint: `Extracting ${label}: ${filesPart} (${percent}%)`,
        })
      },
    })
    reporter.report(
      {
        phase: 'extract',
        percent: 100,
        detail: `解压 ${label}  完成`,
        counters: { ...counters },
        packagesPlus,
      },
      true,
    )
    return { storePath: dest, downloaded: true }
  } finally {
    publishInstallProgress(task, counters, {
      phase: 'link',
      detail: `fetched ${label}`,
      packagesPlus,
    })
  }
}

/** 依赖先于依赖者；有环则退回原序并打 warn。 */
function topoSortResolvedNodes(
  nodes: ResolvedNode[],
  onCycle?: () => void,
): ResolvedNode[] {
  const byName = new Map(nodes.map((n) => [n.name, n]))
  const inDegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()

  for (const n of nodes) {
    inDegree.set(n.name, 0)
  }
  for (const n of nodes) {
    for (const dep of Object.keys(n.meta.dependencies ?? {})) {
      if (!byName.has(dep)) continue
      const list = dependents.get(dep) ?? []
      list.push(n.name)
      dependents.set(dep, list)
      inDegree.set(n.name, (inDegree.get(n.name) ?? 0) + 1)
    }
  }

  const queue = nodes.filter((n) => (inDegree.get(n.name) ?? 0) === 0).map((n) => n.name)
  const order: string[] = []
  while (queue.length > 0) {
    const name = queue.shift()!
    order.push(name)
    for (const next of dependents.get(name) ?? []) {
      const deg = (inDegree.get(next) ?? 1) - 1
      inDegree.set(next, deg)
      if (deg === 0) queue.push(next)
    }
  }

  if (order.length !== nodes.length) {
    onCycle?.()
    return nodes
  }
  return order.map((name) => byName.get(name)!)
}

function projectNodeModulesPackagePath(projectRoot: string, name: string): string {
  return `${projectRoot}/node_modules/${name}`
}

async function runInstallLifecycles(params: {
  task: PackageTask
  projectRoot: string
  tree: ResolvedNode[]
  phase: 'root-preinstall' | 'deps-and-root-post'
}): Promise<void> {
  const { task, projectRoot, tree, phase } = params
  const onConsole = (_level: string, text: string) => {
    log(task, 'info', text)
  }
  const onSkip = (scriptName: string, command: string, reason: string) => {
    log(task, 'warn', `跳过 ${scriptName}（${reason}）: ${command}`)
  }
  const onRun = (scriptName: string, command: string) => {
    log(task, 'info', `lifecycle ${scriptName}: ${command}`)
  }
  const env = { INIT_CWD: projectRoot }

  if (phase === 'root-preinstall') {
    await runLifecycleScripts({
      projectRoot,
      packageRoot: projectRoot,
      scriptNames: ROOT_PREINSTALL,
      env,
      signal: task.abortController.signal,
      onConsole,
      onSkip,
      onRun,
    })
    return
  }

  const ordered = topoSortResolvedNodes(tree, () => {
    log(task, 'warn', '依赖图疑似有环，lifecycle 退回解析序')
  })
  for (const node of ordered) {
    task.abortController.signal.throwIfAborted()
    const packageRoot = projectNodeModulesPackagePath(projectRoot, node.name)
    log(task, 'info', `lifecycle ${node.name}@${node.version}`)
    await runLifecycleScripts({
      projectRoot,
      packageRoot,
      scriptNames: DEP_LIFECYCLE,
      env,
      signal: task.abortController.signal,
      onConsole,
      onSkip,
      onRun,
    })
  }

  await runLifecycleScripts({
    projectRoot,
    packageRoot: projectRoot,
    scriptNames: ROOT_POST_INSTALL,
    env,
    signal: task.abortController.signal,
    onConsole,
    onSkip,
    onRun,
  })
}

async function linkBins(
  projectRoot: string,
  name: string,
  storePath: string,
): Promise<void> {
  const pkg = await readStorePackageJson(storePath)
  const bin = pkg.bin
  if (!bin) return
  const binDir = `${projectRoot}/node_modules/.bin`
  const { filesMkdir, filesStat, filesLstat, filesSymlink, filesRemove } = await import(
    '../apps/files/files-api.ts'
  )
  const st = await filesStat(binDir)
  if (!st) {
    // ensureDir via mkdir chain
    const nm = await filesStat(`${projectRoot}/node_modules`)
    if (!nm) await filesMkdir(`${projectRoot}/node_modules`)
    await filesMkdir(binDir)
  }
  const entries: Record<string, string> =
    typeof bin === 'string'
      ? { [name.includes('/') ? name.split('/').pop()! : name]: bin }
      : ((bin ?? {}) as Record<string, string>)
  for (const [binName, rel] of Object.entries(entries)) {
    // 禁止 npm 占位包 `tsc` 覆盖 `typescript` 已链接的编译器入口
    if (binName === 'tsc' && name === 'tsc') {
      const typescriptLinked = await filesStat(
        `${projectRoot}/node_modules/typescript/bin/tsc`,
      )
      if (typescriptLinked && typescriptLinked.kind !== 'folder') {
        continue
      }
    }
    const targetFile = `${storePath}/${rel.replace(/^\.\//, '')}`
    const linkPath = `${binDir}/${binName}`
    const existing = await filesLstat(linkPath)
    if (existing) await filesRemove(linkPath)
    await filesSymlink(targetFile, linkPath)
  }
}

export async function installPackages(params: {
  projectRoot: string
  packages?: string[]
  signal?: AbortSignal
  /** 默认：无 CLI 包名时锁优先；有显式包名 / update 时走 registry */
  preferLock?: boolean
  /**
   * 覆盖全局 `config.ignoreScripts`。
   * 未传则用设置/默认（默认忽略 scripts）。
   */
  ignoreScripts?: boolean
}): Promise<Omit<PackageTask, 'abortController'>> {
  await ensureStoreRoot(config)
  const task: PackageTask = {
    id: newTaskId(),
    kind: 'install',
    projectRoot: params.projectRoot,
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    packages: params.packages ?? [],
    logs: [],
    abortController: new AbortController(),
  }
  if (params.signal) {
    params.signal.addEventListener('abort', () => task.abortController.abort())
  }
  tasks.set(task.id, task)
  taskOrder.push(task.id)
  task.status = 'running'
  publishTask(task)

  let projectRootForLock = params.projectRoot
  let lockForPersist: InstantPackageLock | undefined
  const ignoreScripts = params.ignoreScripts ?? config.ignoreScripts
  const counters = emptyCounters()
  const startedAt = Date.now()

  try {
    const projectRoot = await resolvePackageProjectRoot(params.projectRoot)
    projectRootForLock = projectRoot
    if (projectRoot !== params.projectRoot) {
      log(task, 'info', `项目根：${projectRoot}（由 ${params.projectRoot} 向上定位 package.json）`)
      task.projectRoot = projectRoot
      publishTask(task)
    }

    if (ignoreScripts) {
      log(
        task,
        'info',
        '忽略 lifecycle 脚本（ignoreScripts；设置 → NPM 开启「运行 install 脚本」，或加 --scripts）',
      )
    }

    const pkgJson = await readProjectPackageJson(projectRoot)
    const deps = {
      ...((pkgJson.dependencies as Record<string, string> | undefined) ?? {}),
      ...((pkgJson.devDependencies as Record<string, string> | undefined) ?? {}),
    }
    const directDepNames = new Set(Object.keys(deps))
    const prodDepNames = new Set(
      Object.keys((pkgJson.dependencies as Record<string, string> | undefined) ?? {}),
    )
    const devDepNames = new Set(
      Object.keys((pkgJson.devDependencies as Record<string, string> | undefined) ?? {}),
    )

    if (!ignoreScripts) {
      log(task, 'info', '将执行 lifecycle 脚本（经 QuickJS）')
      await runInstallLifecycles({
        task,
        projectRoot,
        tree: [],
        phase: 'root-preinstall',
      })
    }

    const roots: { name: string; range: string }[] = []
    const hasCliPackages = Boolean(params.packages && params.packages.length > 0)
    if (hasCliPackages) {
      for (const spec of params.packages!) {
        roots.push(parseSpec(spec))
      }
    } else {
      for (const [name, range] of Object.entries(deps)) {
        roots.push({ name, range })
      }
    }

    if (roots.length === 0) {
      log(task, 'warn', '没有要安装的依赖')
      if (!ignoreScripts) {
        await runInstallLifecycles({
          task,
          projectRoot,
          tree: [],
          phase: 'deps-and-root-post',
        })
      }
      task.status = 'succeeded'
      task.installReport = {
        counters: emptyCounters(),
        addedCount: 0,
        removedCount: 0,
        alreadyUpToDate: true,
        durationMs: Date.now() - startedAt,
        depChanges: [],
      }
      clearProgress(task)
      publishTask(task)
      return serializeTaskForEvent(task)
    }

    const lock = await readLock(projectRoot)
    lockForPersist = lock
    const preferLock = params.preferLock ?? !hasCliPackages
    const previousLockVersions = new Map(
      Object.entries(lock.packages).map(([name, entry]) => [name, entry.version]),
    )
    if (preferLock) {
      log(task, 'info', '安装策略：锁优先（满足 package.json 范围则跳过 registry 解析；其次复用本地 store）')
    }

    publishInstallProgress(task, counters, {
      phase: 'resolve',
      detail: 'Resolving dependencies',
      packagesPlus: 0,
    })
    const tree = await resolveTree(roots, task, { preferLock, lock, counters })
    counters.resolved = tree.length

    const { filesStat } = await import('../apps/files/files-api.ts')
    let packagesPlus = 0
    for (const node of tree) {
      const prev = previousLockVersions.get(node.name)
      const linkPath = projectNodeModulesPackagePath(projectRoot, node.name)
      const linkExists = Boolean(await filesStat(linkPath))
      if (prev !== node.version || !linkExists) {
        packagesPlus += 1
      }
    }

    publishInstallProgress(task, counters, {
      phase: 'link',
      detail: `Packages +${packagesPlus}`,
      packagesPlus,
    })

    const depChanges: PackageInstallDepChange[] = []
    let linkedNew = 0

    for (const node of tree) {
      task.abortController.signal.throwIfAborted()
      const { storePath, downloaded } = await materializeNode(
        node,
        task,
        counters,
        packagesPlus,
      )
      if (downloaded) {
        counters.downloaded += 1
      } else {
        counters.reused += 1
      }

      const pkg = await readStorePackageJson(storePath)
      if (pkg.gypfile === true) {
        throw new Error(`拒绝原生包 ${node.name}@${node.version}`)
      }

      const linkPath = projectNodeModulesPackagePath(projectRoot, node.name)
      const prevVersion = previousLockVersions.get(node.name)
      const linkExisted = Boolean(await filesStat(linkPath))
      const isNewOrChanged = prevVersion !== node.version || !linkExisted

      await linkPackageIntoProject({
        projectRoot,
        name: node.name,
        storePath,
      })
      await linkBins(projectRoot, node.name, storePath)

      if (isNewOrChanged) {
        linkedNew += 1
        counters.added += 1
        let section: PackageInstallDepChange['section'] = 'transitive'
        if (hasCliPackages && params.packages?.some((s) => parseSpec(s).name === node.name)) {
          section = 'dependencies'
        } else if (prodDepNames.has(node.name)) {
          section = 'dependencies'
        } else if (devDepNames.has(node.name)) {
          section = 'devDependencies'
        } else if (directDepNames.has(node.name)) {
          section = 'dependencies'
        }
        if (section !== 'transitive') {
          depChanges.push({ name: node.name, version: node.version, section })
        }
      }

      lock.packages[node.name] = {
        name: node.name,
        version: node.version,
        resolved: node.meta.dist.tarball || undefined,
        integrity: node.meta.dist.integrity,
        dependencies: node.meta.dependencies,
      }
      if (params.packages && params.packages.length > 0) {
        const depsMap = (pkgJson.dependencies as Record<string, string> | undefined) ?? {}
        depsMap[node.name] = `^${node.version}`
        pkgJson.dependencies = depsMap
        if (!depChanges.some((d) => d.name === node.name)) {
          depChanges.push({ name: node.name, version: node.version, section: 'dependencies' })
        } else {
          const existing = depChanges.find((d) => d.name === node.name)
          if (existing) existing.section = 'dependencies'
        }
      }
      log(task, 'info', `已链接 ${projectRoot}/node_modules/${node.name} → ${storePath}`)
      publishInstallProgress(task, counters, {
        phase: 'link',
        detail: `linked ${node.name}@${node.version}`,
        packagesPlus,
      })
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
    }

    if (!ignoreScripts) {
      publishInstallProgress(task, counters, {
        phase: 'lifecycle',
        detail: 'Running lifecycle scripts',
        packagesPlus,
      })
      await runInstallLifecycles({
        task,
        projectRoot,
        tree,
        phase: 'deps-and-root-post',
      })
    }

    await writeLock(projectRoot, lock)
    await writeProjectPackageJson(projectRoot, pkgJson)

    const alreadyUpToDate =
      !hasCliPackages && packagesPlus === 0 && counters.downloaded === 0 && linkedNew === 0

    const report: PackageInstallReport = {
      counters: { ...counters },
      addedCount: alreadyUpToDate ? 0 : packagesPlus,
      removedCount: 0,
      alreadyUpToDate,
      durationMs: Date.now() - startedAt,
      depChanges,
      contextLine:
        alreadyUpToDate && preferLock && previousLockVersions.size > 0
          ? 'Lockfile is up to date, resolution step is skipped'
          : undefined,
    }

    task.status = 'succeeded'
    task.installReport = report
    clearProgress(task)
    log(task, 'info', `安装完成（node_modules → ${projectRoot}/node_modules）`)
    publishTask(task)
    return serializeTaskForEvent(task)
  } catch (error) {
    if (task.abortController.signal.aborted) {
      task.status = 'cancelled'
      task.error = 'cancelled'
    } else {
      task.status = 'failed'
      task.error = error instanceof Error ? error.message : String(error)
      log(task, 'error', task.error)
    }
    task.installReport = {
      counters: { ...counters },
      addedCount: counters.added,
      removedCount: 0,
      alreadyUpToDate: false,
      durationMs: Date.now() - startedAt,
      depChanges: [],
    }
    if (lockForPersist && Object.keys(lockForPersist.packages).length > 0) {
      try {
        await writeLock(projectRootForLock, lockForPersist)
        log(task, 'info', `已写入部分锁（${Object.keys(lockForPersist.packages).length} 个包）`)
      } catch {
        // ignore persist errors
      }
    }
    clearProgress(task)
    publishTask(task)
    return serializeTaskForEvent(task)
  }
}

export async function uninstallPackages(params: {
  projectRoot: string
  packages: string[]
}): Promise<Omit<PackageTask, 'abortController'>> {
  const { filesRemove, filesStat } = await import('../apps/files/files-api.ts')
  const task: PackageTask = {
    id: newTaskId(),
    kind: 'uninstall',
    projectRoot: params.projectRoot,
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    packages: params.packages,
    logs: [],
    abortController: new AbortController(),
  }
  tasks.set(task.id, task)
  taskOrder.push(task.id)
  publishTask(task)

  try {
    const pkgJson = await readProjectPackageJson(params.projectRoot)
    const lock = await readLock(params.projectRoot)
    for (const name of params.packages) {
      const linkPath = name.startsWith('@')
        ? `${params.projectRoot}/node_modules/${name}`
        : `${params.projectRoot}/node_modules/${name}`
      const st = await filesStat(linkPath)
      if (st) await filesRemove(linkPath)
      delete lock.packages[name]
      const deps = pkgJson.dependencies as Record<string, string> | undefined
      if (deps) delete deps[name]
      log(task, 'info', `已移除 ${name}`)
    }
    await writeLock(params.projectRoot, lock)
    await writeProjectPackageJson(params.projectRoot, pkgJson)
    task.status = 'succeeded'
    publishTask(task)
    return serializeTaskForEvent(task)
  } catch (error) {
    task.status = 'failed'
    task.error = error instanceof Error ? error.message : String(error)
    log(task, 'error', task.error)
    publishTask(task)
    return serializeTaskForEvent(task)
  }
}

export async function listInstalled(projectRoot: string): Promise<
  { name: string; version: string }[]
> {
  const lock = await readLock(projectRoot)
  return Object.values(lock.packages).map((p) => ({ name: p.name, version: p.version }))
}

export async function outdatedPackages(projectRoot: string): Promise<
  { name: string; current: string; latest: string }[]
> {
  const lock = await readLock(projectRoot)
  const out: { name: string; current: string; latest: string }[] = []
  for (const entry of Object.values(lock.packages)) {
    try {
      const latest = await resolveRegistryVersion(entry.name, 'latest', config)
      if (latest.version !== entry.version) {
        out.push({ name: entry.name, current: entry.version, latest: latest.version })
      }
    } catch {
      // skip
    }
  }
  return out
}
