import {
  filesCreateBinary,
  filesMkdir,
  filesReadBlob,
  filesRemove,
  filesStat,
  filesWriteBinary,
} from '../files/files-api.ts'
import { joinFilesAbsolutePath } from '../files/files-path.ts'
import { hashBytes, type GithubFileIndexEntry } from './github-sync-meta.ts'

const OBJECTS_ROOT = '/repo/github/.objects'

function objectPathForHash(hash: string): string {
  return joinFilesAbsolutePath(OBJECTS_ROOT, hash.slice(0, 2), hash)
}

function isProbablyTextBytes(bytes: Uint8Array): boolean {
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

async function ensureDir(path: string): Promise<void> {
  const existing = await filesStat(path)
  if (existing) {
    if (existing.kind !== 'folder') {
      throw new Error(`路径冲突：${path} 不是文件夹`)
    }
    return
  }
  await filesMkdir(path)
}

async function ensureObjectParents(hash: string): Promise<string> {
  await ensureDir('/repo/github')
  await ensureDir(OBJECTS_ROOT)
  const shard = joinFilesAbsolutePath(OBJECTS_ROOT, hash.slice(0, 2))
  await ensureDir(shard)
  return objectPathForHash(hash)
}

export async function baselineBlobExists(hash: string): Promise<boolean> {
  const stat = await filesStat(objectPathForHash(hash))
  return stat?.kind === 'file'
}

export async function writeBaselineBlobIfMissing(
  hash: string,
  bytes: Uint8Array,
): Promise<void> {
  if (await baselineBlobExists(hash)) return
  await writeBaselineBlob(hash, bytes)
}

/** 写入 blob；若已存在则覆盖（用于修复「有文件但内容不对」的脏基线） */
export async function writeBaselineBlob(hash: string, bytes: Uint8Array): Promise<void> {
  const path = await ensureObjectParents(hash)
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  if (await baselineBlobExists(hash)) {
    await filesWriteBinary(path, copy.buffer)
    return
  }
  await filesCreateBinary(path, copy.buffer)
}

export async function removeBaselineBlob(hash: string): Promise<void> {
  try {
    await filesRemove(objectPathForHash(hash))
  } catch {
    // 不存在则忽略
  }
}

/** 磁盘上有文件，且正文 hash 与 key 一致（防止 Contents JSON 等脏数据占坑） */
export async function baselineBlobIsValid(hash: string): Promise<boolean> {
  const bytes = await readBaselineBytes(hash)
  if (bytes === undefined) return false
  return (await hashBytes(bytes)) === hash
}

/** 将工作区文件写入本地 blob，并返回 fileIndex（与 buildFileIndex 一致） */
export async function persistBaselineFromFiles(
  files: Map<string, Uint8Array>,
): Promise<Record<string, GithubFileIndexEntry>> {
  const index: Record<string, GithubFileIndexEntry> = {}
  for (const [path, bytes] of files) {
    const hash = await hashBytes(bytes)
    index[path] = { hash, byteSize: bytes.byteLength }
    await writeBaselineBlobIfMissing(hash, bytes)
  }
  return index
}

export async function readBaselineBytes(hash: string): Promise<Uint8Array | undefined> {
  const path = objectPathForHash(hash)
  try {
    const blob = await filesReadBlob(path)
    return new Uint8Array(await blob.arrayBuffer())
  } catch {
    return undefined
  }
}

export async function readBaselineText(hash: string): Promise<string | undefined> {
  const bytes = await readBaselineBytes(hash)
  if (bytes === undefined) return undefined
  if (!isProbablyTextBytes(bytes)) return undefined
  return new TextDecoder().decode(bytes)
}

export async function readBaselineTextForPath(
  fileIndex: Record<string, GithubFileIndexEntry>,
  path: string,
): Promise<string | undefined> {
  const entry = fileIndex[path]
  if (!entry) return undefined
  return readBaselineText(entry.hash)
}

export async function baselineMissingForIndex(
  fileIndex: Record<string, GithubFileIndexEntry>,
): Promise<boolean> {
  for (const entry of Object.values(fileIndex)) {
    if (!(await baselineBlobIsValid(entry.hash))) return true
  }
  return false
}

/** 用 fileIndex + 本地 blob 组装文件映射；任一 blob 缺失则返回 undefined */
export async function loadFilesFromFileIndex(
  fileIndex: Record<string, GithubFileIndexEntry>,
): Promise<Map<string, Uint8Array> | undefined> {
  const files = new Map<string, Uint8Array>()
  for (const [path, entry] of Object.entries(fileIndex)) {
    const bytes = await readBaselineBytes(entry.hash)
    if (bytes === undefined) return undefined
    files.set(path, bytes)
  }
  return files
}
