import {
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
  readStorePackageJson,
  storePackageDir,
  ensureStoreRoot,
} from './package-store.ts'
import { satisfiesSemver } from './package-semver.ts'
import type {
  InstantPackageLock,
  PackageLockEntry,
  PackageLogLevel,
  PackageServiceConfig,
  PackageTask,
  RegistryPackageVersion,
} from './package-types.ts'
import { DEFAULT_PACKAGE_SERVICE_CONFIG } from './package-types.ts'

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

async function writeProjectPackageJson(
  projectRoot: string,
  pkg: Record<string, unknown>,
): Promise<void> {
  await filesWriteText(`${projectRoot}/package.json`, `${JSON.stringify(pkg, null, 2)}\n`)
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
  await filesWriteText(
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

async function resolveTree(
  roots: { name: string; range: string }[],
  task: PackageTask,
  options: { preferLock: boolean; lock: InstantPackageLock },
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
        for (const [dep, range] of Object.entries(fromLock.meta.dependencies ?? {})) {
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

async function materializeNode(node: ResolvedNode, task: PackageTask): Promise<string> {
  const storePath = storePackageDir(config, node.name, node.version)
  if (await isPackageInStore(config, node.name, node.version)) {
    log(task, 'info', `缓存命中 ${node.name}@${node.version}`)
    return storePath
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
  log(task, 'info', `下载 ${node.name}@${node.version}`)
  const tarball = await downloadTarball(
    tarballUrl,
    config,
    task.abortController.signal,
  )
  log(task, 'info', `解压 ${node.name}@${node.version}（${tarball.byteLength} bytes）`)
  return extractTarballToStore({
    config,
    name: node.name,
    version: node.version,
    tarball,
    signal: task.abortController.signal,
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

  try {
    const projectRoot = await resolvePackageProjectRoot(params.projectRoot)
    if (projectRoot !== params.projectRoot) {
      log(task, 'info', `项目根：${projectRoot}（由 ${params.projectRoot} 向上定位 package.json）`)
      task.projectRoot = projectRoot
      publishTask(task)
    }

    const pkgJson = await readProjectPackageJson(projectRoot)
    const deps = {
      ...((pkgJson.dependencies as Record<string, string> | undefined) ?? {}),
      ...((pkgJson.devDependencies as Record<string, string> | undefined) ?? {}),
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
      task.status = 'succeeded'
      publishTask(task)
      return serializeTaskForEvent(task)
    }

    const lock = await readLock(projectRoot)
    const preferLock = params.preferLock ?? !hasCliPackages
    if (preferLock) {
      log(task, 'info', '安装策略：锁优先（满足 package.json 范围则跳过 registry 解析）')
    }
    const tree = await resolveTree(roots, task, { preferLock, lock })

    for (const node of tree) {
      task.abortController.signal.throwIfAborted()
      const storePath = await materializeNode(node, task)
      // 安装后扫一眼是否含 .node
      const pkg = await readStorePackageJson(storePath)
      if (pkg.gypfile === true) {
        throw new Error(`拒绝原生包 ${node.name}@${node.version}`)
      }
      await linkPackageIntoProject({
        projectRoot,
        name: node.name,
        storePath,
      })
      await linkBins(projectRoot, node.name, storePath)
      lock.packages[node.name] = {
        name: node.name,
        version: node.version,
        resolved: node.meta.dist.tarball,
        integrity: node.meta.dist.integrity,
        dependencies: node.meta.dependencies,
      }
      if (params.packages && params.packages.length > 0) {
        const depsMap = (pkgJson.dependencies as Record<string, string> | undefined) ?? {}
        depsMap[node.name] = `^${node.version}`
        pkgJson.dependencies = depsMap
      }
      log(task, 'info', `已链接 ${projectRoot}/node_modules/${node.name} → ${storePath}`)
      // 让出事件循环，使 Files / Code 能在下一个包开始前刷新并绘制链接
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
    }

    await writeLock(projectRoot, lock)
    await writeProjectPackageJson(projectRoot, pkgJson)
    task.status = 'succeeded'
    log(task, 'info', `安装完成（node_modules → ${projectRoot}/node_modules）`)
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
