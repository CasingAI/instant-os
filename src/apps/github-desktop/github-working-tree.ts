import { unzipSync } from 'fflate'
import { osNowMs } from '../../os/os-clock.ts'
import { assertAdditionalBytesAvailable } from '../files/files-storage.ts'
import {
  filesCreateBinary,
  filesCreateText,
  filesList,
  filesMkdir,
  filesReadBlob,
  filesReadText,
  filesRemove,
  filesStat,
  filesWriteBinary,
  filesWriteText,
  type FilesApiEntry,
} from '../files/files-api.ts'
import { joinFilesAbsolutePath } from '../files/files-path.ts'
import { resolveNodeByAbsolutePath } from '../files/files-vfs.ts'
import {
  githubDownloadZipball,
  githubGetBranchTip,
  githubGetRepo,
} from './github-api.ts'
import { githubRepoRootPath } from './github-repo-paths.ts'
import { persistBaselineFromFiles } from './github-baseline.ts'
import {
  saveGithubRepoMeta,
  type GithubRepoSyncMeta,
} from './github-sync-meta.ts'

const TEXT_DECODER = new TextDecoder('utf-8')

export type GithubProgress = (message: string) => void

function normalizeZipPath(path: string): string {
  return path.replace(/^\/+/, '').replace(/\\/g, '/')
}

function stripZipRoot(files: Record<string, Uint8Array>): Map<string, Uint8Array> {
  const map = new Map<string, Uint8Array>()
  const keys = Object.keys(files).filter((key) => !key.endsWith('/'))
  if (keys.length === 0) return map

  let commonRoot: string | undefined
  for (const key of keys) {
    const normalized = normalizeZipPath(key)
    const slash = normalized.indexOf('/')
    if (slash <= 0) {
      commonRoot = undefined
      break
    }
    const root = normalized.slice(0, slash)
    if (commonRoot === undefined) commonRoot = root
    else if (commonRoot !== root) {
      commonRoot = undefined
      break
    }
  }

  for (const key of keys) {
    const normalized = normalizeZipPath(key)
    const relative =
      commonRoot && normalized.startsWith(`${commonRoot}/`)
        ? normalized.slice(commonRoot.length + 1)
        : normalized
    if (!relative || relative.endsWith('/')) continue
    const bytes = files[key]
    if (!bytes) continue
    map.set(relative, bytes)
  }
  return map
}

export function isProbablyTextBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength === 0) return true
  const sample = bytes.subarray(0, Math.min(bytes.byteLength, 8192))
  let suspicious = 0
  for (let i = 0; i < sample.length; i += 1) {
    const code = sample[i]!
    if (code === 0) return false
    if (code < 7 || (code > 14 && code < 32 && code !== 27)) {
      suspicious += 1
    }
  }
  return suspicious / sample.length < 0.05
}

async function ensureParentDirs(absoluteFilePath: string): Promise<void> {
  const parts = absoluteFilePath.split('/').filter(Boolean)
  if (parts.length <= 1) return
  let current = ''
  for (let i = 0; i < parts.length - 1; i += 1) {
    current += `/${parts[i]}`
    const existing = await filesStat(current)
    if (existing) {
      if (existing.kind !== 'folder') {
        throw new Error(`路径冲突：${current} 不是文件夹`)
      }
      continue
    }
    await filesMkdir(current)
  }
}

export async function writeWorkingTreeFile(
  absolutePath: string,
  bytes: Uint8Array,
): Promise<void> {
  await ensureParentDirs(absolutePath)
  const existing = await filesStat(absolutePath)
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const buffer = copy.buffer
  if (isProbablyTextBytes(bytes)) {
    const text = TEXT_DECODER.decode(bytes)
    if (existing) {
      if (existing.kind !== 'file') throw new Error(`路径冲突：${absolutePath}`)
      await filesWriteText(absolutePath, text)
    } else {
      await filesCreateText(absolutePath, text)
    }
    return
  }
  if (existing) {
    if (existing.kind !== 'file') throw new Error(`路径冲突：${absolutePath}`)
    await filesWriteBinary(absolutePath, buffer)
  } else {
    await filesCreateBinary(absolutePath, buffer)
  }
}

export async function removeWorkingTreePath(absolutePath: string): Promise<void> {
  const existing = await filesStat(absolutePath)
  if (!existing) return
  await filesRemove(absolutePath)
}

export async function clearDirectoryContents(dirPath: string): Promise<void> {
  const existing = await filesStat(dirPath)
  if (!existing) return
  if (existing.kind !== 'folder') {
    await filesRemove(dirPath)
    return
  }
  const children = await filesList(dirPath)
  for (const child of children) {
    await filesRemove(child.path)
  }
}

export async function ensureRepoRootFolder(owner: string, repo: string): Promise<string> {
  const githubRoot = '/repo/github'
  if (!(await filesStat(githubRoot))) {
    await filesMkdir(githubRoot)
  }
  const ownerPath = joinFilesAbsolutePath(githubRoot, owner)
  if (!(await filesStat(ownerPath))) {
    await filesMkdir(ownerPath)
  }
  const repoPath = githubRepoRootPath(owner, repo)
  if (!(await filesStat(repoPath))) {
    await filesMkdir(repoPath)
  }
  return repoPath
}

async function listFilesRecursive(dirPath: string): Promise<FilesApiEntry[]> {
  const result: FilesApiEntry[] = []
  const stack = [dirPath]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    const children = await filesList(current)
    for (const child of children) {
      if (child.kind === 'folder') {
        stack.push(child.path)
      } else {
        result.push(child)
      }
    }
  }
  return result
}

export async function readWorkingTreeBytes(absolutePath: string): Promise<Uint8Array> {
  try {
    const blob = await filesReadBlob(absolutePath)
    return new Uint8Array(await blob.arrayBuffer())
  } catch {
    const text = await filesReadText(absolutePath)
    return new TextEncoder().encode(text)
  }
}

export async function collectWorkingTreeFiles(
  owner: string,
  repo: string,
): Promise<Map<string, Uint8Array>> {
  const root = githubRepoRootPath(owner, repo)
  const rootStat = await filesStat(root)
  if (!rootStat) return new Map()

  const entries = await listFilesRecursive(root)
  const map = new Map<string, Uint8Array>()
  const prefix = `${root}/`
  for (const entry of entries) {
    if (!entry.path.startsWith(prefix)) continue
    const relative = entry.path.slice(prefix.length)
    if (!relative) continue
    map.set(relative, await readWorkingTreeBytes(entry.path))
  }
  return map
}

export async function materializeFilesToRepo(
  owner: string,
  repo: string,
  files: Map<string, Uint8Array>,
  onProgress?: GithubProgress,
): Promise<void> {
  const repoPath = await ensureRepoRootFolder(owner, repo)
  onProgress?.('清理本地工作树…')
  await clearDirectoryContents(repoPath)

  let totalBytes = 0
  for (const bytes of files.values()) {
    totalBytes += bytes.byteLength
  }
  await assertAdditionalBytesAvailable(totalBytes + files.size * 64)

  let written = 0
  for (const [relativePath, bytes] of files) {
    const absolute = joinFilesAbsolutePath(repoPath, ...relativePath.split('/'))
    await writeWorkingTreeFile(absolute, bytes)
    written += 1
    if (written % 40 === 0) {
      onProgress?.(`写入文件 ${written}/${files.size}…`)
    }
  }
  onProgress?.(`已写入 ${files.size} 个文件`)
}

export async function unzipGithubZipball(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const unzipped = unzipSync(new Uint8Array(buffer))
  return stripZipRoot(unzipped)
}

export async function cloneGithubRepository(params: {
  owner: string
  repo: string
  branch?: string
  onProgress?: GithubProgress
}): Promise<GithubRepoSyncMeta> {
  const onProgress = params.onProgress
  onProgress?.('读取仓库信息…')
  const remote = await githubGetRepo(params.owner, params.repo)
  const branch = params.branch?.trim() || remote.defaultBranch

  onProgress?.(`下载 ${branch} 分支压缩包…`)
  const zip = await githubDownloadZipball(params.owner, params.repo, branch)
  onProgress?.('解析压缩包…')
  const files = await unzipGithubZipball(zip)

  onProgress?.('获取提交 SHA…')
  const headSha = await githubGetBranchTip(params.owner, params.repo, branch)

  await materializeFilesToRepo(params.owner, params.repo, files, onProgress)

  onProgress?.('建立同步快照…')
  const working = await collectWorkingTreeFiles(params.owner, params.repo)
  const fileIndex = await persistBaselineFromFiles(working)
  const meta: GithubRepoSyncMeta = {
    version: 2,
    owner: remote.owner,
    repo: remote.name,
    currentBranch: branch,
    defaultBranch: remote.defaultBranch,
    branches: {
      [branch]: { tipSha: headSha, fileIndex },
    },
    updatedAt: osNowMs(),
  }
  await saveGithubRepoMeta(meta)
  return meta
}

export async function deleteLocalGithubRepository(owner: string, repo: string): Promise<void> {
  const repoPath = githubRepoRootPath(owner, repo)
  const node = await resolveNodeByAbsolutePath(repoPath)
  if (node) {
    await filesRemove(repoPath)
  }
  const ownerPath = joinFilesAbsolutePath('/repo/github', owner)
  const ownerChildren = await filesList(ownerPath).catch(() => [])
  if (ownerChildren.length === 0) {
    await filesRemove(ownerPath).catch(() => undefined)
  }
}
