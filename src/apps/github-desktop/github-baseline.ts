import { hashBytes, type GithubFileIndexEntry } from './github-sync-meta.ts'
import {
  githubObjectStat,
  readGithubObjectBytes,
  removeGithubObjectBlob,
  writeGithubObjectBlob,
} from './github-objects-vfs.ts'

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

export async function baselineBlobExists(hash: string): Promise<boolean> {
  return (await githubObjectStat(hash)) !== undefined
}

export async function writeBaselineBlobIfMissing(
  hash: string,
  bytes: Uint8Array,
): Promise<void> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  await writeGithubObjectBlob(hash, copy.buffer, false)
}

/** 写入 blob；若已存在则覆盖（用于修复「有文件但内容不对」的脏基线） */
export async function writeBaselineBlob(hash: string, bytes: Uint8Array): Promise<void> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  await writeGithubObjectBlob(hash, copy.buffer, true)
}

export async function removeBaselineBlob(hash: string): Promise<void> {
  await removeGithubObjectBlob(hash)
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
  revisionIds?: ReadonlyMap<string, string | undefined>,
): Promise<Record<string, GithubFileIndexEntry>> {
  const index: Record<string, GithubFileIndexEntry> = {}
  for (const [path, bytes] of files) {
    const hash = await hashBytes(bytes)
    const entry: GithubFileIndexEntry = { hash, byteSize: bytes.byteLength }
    const revisionId = revisionIds?.get(path)
    if (revisionId !== undefined) {
      entry.revisionId = revisionId
    }
    index[path] = entry
    await writeBaselineBlobIfMissing(hash, bytes)
  }
  return index
}

export async function readBaselineBytes(hash: string): Promise<Uint8Array | undefined> {
  return readGithubObjectBytes(hash)
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

/** 仅检查 blob 是否存在（不做内容哈希校验，供丢弃/切换等热路径） */
export async function baselineBlobsAbsentForIndex(
  fileIndex: Record<string, GithubFileIndexEntry>,
): Promise<boolean> {
  for (const entry of Object.values(fileIndex)) {
    if (!(await baselineBlobExists(entry.hash))) return true
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
