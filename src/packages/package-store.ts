import { gunzipSync } from 'fflate'
import {
  filesCreateText,
  filesMkdir,
  filesReadText,
  filesRemove,
  filesStat,
  filesSymlink,
  filesWriteText,
} from '../apps/files/files-api.ts'
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

export async function isPackageInStore(
  config: PackageServiceConfig,
  name: string,
  version: string,
): Promise<boolean> {
  const dir = storePackageDir(config, name, version)
  const pkg = await filesStat(`${dir}/package.json`)
  return pkg?.kind === 'file'
}

/**
 * 将 npm tarball（gzip + tar，内容通常在 package/ 前缀下）解压到 CAS 目录。
 */
export async function extractTarballToStore(params: {
  config: PackageServiceConfig
  name: string
  version: string
  tarball: Uint8Array
  signal?: AbortSignal
}): Promise<string> {
  const { config, name, version, tarball, signal } = params
  const dest = storePackageDir(config, name, version)
  if (await isPackageInStore(config, name, version)) {
    return dest
  }

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
  await ensureDir(dest)

  let fileCount = 0
  for (const [rawPath, data] of Object.entries(entries)) {
    signal?.throwIfAborted()
    let rel = rawPath.replace(/^package\//, '')
    if (!rel || rel.endsWith('/')) continue
    // 安全：拒绝跳出
    if (rel.includes('..') || rel.startsWith('/')) continue
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
    if (fileCount > config.maxProjectFiles) {
      throw new Error('解压文件数超过配额')
    }
  }

  const marker = await filesStat(`${dest}/package.json`)
  if (!marker) {
    throw new Error(`tarball 解压后缺少 package.json: ${name}@${version}`)
  }
  return dest
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

  const existing = await filesStat(linkPath)
  if (existing) {
    await filesRemove(linkPath)
  }

  // 相对链接：从 link 父目录到 store
  const linkParent = linkPath.slice(0, linkPath.lastIndexOf('/'))
  const target = relativePath(linkParent, storePath)
  await filesSymlink(target, linkPath)
}

function relativePath(fromDir: string, toPath: string): string {
  const fromParts = fromDir.split('/').filter(Boolean)
  const toParts = toPath.split('/').filter(Boolean)
  let i = 0
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) {
    i += 1
  }
  const ups = fromParts.length - i
  const downs = toParts.slice(i)
  const rel = [...Array(ups).fill('..'), ...downs].join('/')
  return rel || '.'
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
  await ensureDir(config.storeRoot)
}
