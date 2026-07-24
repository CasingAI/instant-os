import { gunzipSync } from 'fflate'
import {
  filesCreateText,
  filesLstat,
  filesList,
  filesMkdir,
  filesReadText,
  filesRemove,
  filesStat,
  filesSymlink,
  filesWriteText,
} from '../apps/files/files-api.ts'
import { runWithFilesVfsChangeBatch } from '../apps/files/files-vfs.ts'
import {
  DEFAULT_PACKAGE_STORE_ROOT,
  PACKAGE_STORE_COMPLETE_MARKER,
} from './package-store-paths.ts'
import { ensureNpmStoreNamespace } from './package-store-vfs.ts'
import { untarBytes } from './package-untar.ts'
import type { PackageServiceConfig } from './package-types.ts'

export function storePackageDir(
  config: PackageServiceConfig,
  name: string,
  version: string,
): string {
  const safeName = name.startsWith('@')
    ? name.replace('/', '__')
    : name
  return `${config.storeRoot}/v1/${safeName}/${version}`
}

export function storeTarballPath(
  config: PackageServiceConfig,
  name: string,
  version: string,
): string {
  return `${storePackageDir(config, name, version)}.tgz`
}

function storeCompleteMarkerPath(storePath: string): string {
  return `${storePath}/${PACKAGE_STORE_COMPLETE_MARKER}`
}

async function ensureDir(path: string): Promise<void> {
  const existing = await filesStat(path)
  if (existing?.kind === 'folder') return
  if (existing) {
    throw new Error(`路径已存在且非目录: ${path}`)
  }
  // 逐级创建（跳过已存在的卷根）
  const parts = path.split('/').filter(Boolean)
  let cursor = ''
  for (const part of parts) {
    cursor += `/${part}`
    const st = await filesStat(cursor)
    if (st?.kind === 'folder') continue
    if (st) throw new Error(`无法创建目录，路径被占用: ${cursor}`)
    // 卷根不可 mkdir，应已存在
    const segments = cursor.split('/').filter(Boolean)
    if (segments.length <= 1) {
      throw new Error(`卷根不存在或不可创建: ${cursor}`)
    }
    await filesMkdir(cursor)
  }
}

async function removeStoreDirBestEffort(path: string): Promise<void> {
  try {
    const existing = await filesLstat(path)
    if (existing) await filesRemove(path)
  } catch {
    // ignore cleanup errors
  }
}

export async function isPackageInStore(
  config: PackageServiceConfig,
  name: string,
  version: string,
): Promise<boolean> {
  const dir = storePackageDir(config, name, version)
  const marker = await filesStat(storeCompleteMarkerPath(dir))
  return marker?.kind === 'file'
}

/** 列出 CAS 中某包已完整提交的版本目录名（需有 .instant-ok） */
export async function listStorePackageVersions(
  config: PackageServiceConfig,
  name: string,
): Promise<string[]> {
  const safeName = name.startsWith('@') ? name.replace('/', '__') : name
  const dir = `${config.storeRoot}/v1/${safeName}`
  const st = await filesStat(dir)
  if (st?.kind !== 'folder') return []
  const entries = await filesList(dir)
  const versions: string[] = []
  for (const entry of entries) {
    if (entry.kind !== 'folder') continue
    const marker = await filesStat(storeCompleteMarkerPath(`${dir}/${entry.name}`))
    if (marker?.kind === 'file') versions.push(entry.name)
  }
  return versions
}

export type ExtractTarballProgress = {
  done: number
  total: number
  bytesWritten: number
  currentPath?: string
}

/**
 * npm tarball 通常只有一层根目录（多为 `package/`；部分 @types 用包名或带版本的目录名）。
 * 若所有文件共享同一顶层段，则剥掉它；否则原样保留。
 */
export function stripTarballRootPrefix(rawPath: string, root: string | undefined): string {
  if (!root) return rawPath
  if (rawPath === root) return ''
  const prefix = `${root}/`
  return rawPath.startsWith(prefix) ? rawPath.slice(prefix.length) : rawPath
}

export function detectTarballRootDir(paths: Iterable<string>): string | undefined {
  let root: string | undefined
  for (const path of paths) {
    if (!path || path.endsWith('/')) continue
    const slash = path.indexOf('/')
    // 有文件落在归档根部 → 不能安全剥一层
    if (slash <= 0) return undefined
    const seg = path.slice(0, slash)
    if (root === undefined) root = seg
    else if (root !== seg) return undefined
  }
  return root
}

/**
 * 规范化 tarball 内相对路径：去掉空段与 `.`，遇 `..` 或绝对路径则拒绝。
 * 例如 `./dist/cjs/index.js` → `dist/cjs/index.js`
 */
export function normalizeTarballRelPath(rel: string): string | undefined {
  if (!rel || rel.startsWith('/')) return undefined
  const parts: string[] = []
  for (const seg of rel.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') return undefined
    parts.push(seg)
  }
  if (parts.length === 0) return undefined
  return parts.join('/')
}

/**
 * 将 npm tarball（gzip + tar）解压到 CAS 目录。
 * 仅在全部写完并确认 package.json 后写入 `.instant-ok`；半成品不视为缓存命中。
 */
export async function extractTarballToStore(params: {
  config: PackageServiceConfig
  name: string
  version: string
  tarball: Uint8Array
  signal?: AbortSignal
  onProgress?: (progress: ExtractTarballProgress) => void
}): Promise<string> {
  const { config, name, version, tarball, signal, onProgress } = params
  const dest = storePackageDir(config, name, version)
  if (await isPackageInStore(config, name, version)) {
    return dest
  }

  // 无完成标记的目录视为半成品，清掉再解
  await removeStoreDirBestEffort(dest)

  try {
    signal?.throwIfAborted?.()
    if (signal?.aborted) {
      throw new Error('aborted')
    }
    let tarBytes: Uint8Array
    try {
      tarBytes = gunzipSync(tarball)
    } catch {
      tarBytes = tarball
    }

    const entries = untarBytes(tarBytes)
    const rootDir = detectTarballRootDir(Object.keys(entries))
    const writeMap = new Map<string, Uint8Array>()
    for (const [rawPath, data] of Object.entries(entries)) {
      const stripped = stripTarballRootPrefix(rawPath, rootDir)
      const rel = normalizeTarballRelPath(stripped)
      if (!rel) continue
      // 同路径多条目（如 `./dist/...` 与 `dist/...`）后者覆盖前者
      writeMap.set(rel, data)
    }
    const writeEntries = [...writeMap.entries()].map(([rel, data]) => ({ rel, data }))
    const total = writeEntries.length
    await ensureDir(dest)

    let fileCount = 0
    let bytesWritten = 0
    // 解压期合并 VFS 通知：否则每写一个文件就重置 UI debounce，链接要等整次安装结束才看得见
    await runWithFilesVfsChangeBatch(async () => {
      for (const { rel, data } of writeEntries) {
        signal?.throwIfAborted()
        const outPath = `${dest}/${rel}`
        const parent = outPath.slice(0, outPath.lastIndexOf('/'))
        await ensureDir(parent)
        const text = new TextDecoder('utf-8', { fatal: false }).decode(data)
        // 含 \0 的当二进制：用 latin1 往返不完美；简化为 utf-8 文本写入
        // 对 .node 等：仍写入以便安装器检测拒绝
        try {
          await filesCreateText(outPath, text)
        } catch {
          await filesWriteText(outPath, text)
        }
        fileCount += 1
        bytesWritten += data.byteLength
        onProgress?.({
          done: fileCount,
          total,
          bytesWritten,
          currentPath: rel,
        })
        if (fileCount > config.maxProjectFiles) {
          throw new Error('解压文件数超过配额')
        }
      }
    })

    const pkgJson = await filesStat(`${dest}/package.json`)
    if (!pkgJson) {
      throw new Error(`tarball 解压后缺少 package.json: ${name}@${version}`)
    }

    // 全部成功后再写完成标记；此前中断不会被 isPackageInStore 命中
    try {
      await filesCreateText(storeCompleteMarkerPath(dest), '')
    } catch {
      await filesWriteText(storeCompleteMarkerPath(dest), '')
    }
    return dest
  } catch (error) {
    await removeStoreDirBestEffort(dest)
    throw error
  }
}

export async function linkPackageIntoProject(params: {
  projectRoot: string
  name: string
  storePath: string
}): Promise<void> {
  const { projectRoot, name, storePath } = params
  const nm = `${projectRoot}/node_modules`
  await ensureDir(nm)

  let linkPath: string
  if (name.startsWith('@')) {
    const [scope, pkg] = name.split('/')
    if (!scope || !pkg) throw new Error(`无效的作用域包名: ${name}`)
    await ensureDir(`${nm}/${scope}`)
    linkPath = `${nm}/${scope}/${pkg}`
  } else {
    linkPath = `${nm}/${name}`
  }

  // 必须用 lstat：stat 会跟随已有链接，误判成 store 目录
  const existing = await filesLstat(linkPath)
  if (existing) {
    await filesRemove(linkPath)
  }

  // 绝对目标：跨 /user ↔ /dev 等卷时相对路径易碎，且便于核对链接是否落在项目旁
  try {
    await filesSymlink(storePath, linkPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('不支持创建符号链接')) {
      throw new Error(
        `无法在 ${projectRoot}/node_modules 创建链接（当前卷不支持 symlink）。请将项目放在 /user 或 /dev 下再安装。`,
      )
    }
    throw error
  }
}

export async function readStorePackageJson(
  storePath: string,
): Promise<Record<string, unknown>> {
  const text = await filesReadText(`${storePath}/package.json`)
  return JSON.parse(text) as Record<string, unknown>
}

export async function estimateStoreBytes(config: PackageServiceConfig): Promise<number> {
  // 粗略：读 store 根若不存在则为 0；完整枚举留给管理 App
  const st = await filesStat(config.storeRoot)
  if (!st) return 0
  return st.byteSize
}

export async function ensureStoreRoot(config: PackageServiceConfig): Promise<void> {
  if (config.storeRoot === DEFAULT_PACKAGE_STORE_ROOT) {
    await ensureNpmStoreNamespace()
    return
  }
  await ensureDir(config.storeRoot)
}
