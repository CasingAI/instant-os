/**
 * 解析当前曲目同目录侧车 `.stems.zip`：探测是否存在、读取 blob。
 */

import { STEMS_ARCHIVE_EXTENSION } from '../stems/stems-persistence.ts'
import type { FilesNode } from '../files/files-types.ts'
import { getNodeOrThrow, listDirectory, readFileBlob } from '../files/files-vfs.ts'

/** 音频文件名 → 同名分轨侧车文件名（`song.mp3` → `song.stems.zip`）。 */
export function stemsSidecarNameForAudio(audioFileName: string): string {
  const dot = audioFileName.lastIndexOf('.')
  const base = dot > 0 ? audioFileName.slice(0, dot) : audioFileName
  return base + STEMS_ARCHIVE_EXTENSION
}

function isStemsSidecarName(name: string, audioFileName: string): boolean {
  return name.toLowerCase() === stemsSidecarNameForAudio(audioFileName).toLowerCase()
}

/** 在同目录兄弟节点中查找分轨侧车；不存在返回 undefined。 */
export async function findStemsSidecarNode(audioNode: FilesNode): Promise<FilesNode | undefined> {
  const siblings = await listDirectory(audioNode.locationId, audioNode.parentId)
  return siblings.find(
    (sibling) =>
      sibling.kind === 'file' && isStemsSidecarName(sibling.name, audioNode.name),
  )
}

/**
 * 按曲目 vfsRef（节点 id）探测是否有分轨侧车。
 * 节点不存在或读取失败视为无分轨。
 */
export async function probeStemsSidecar(vfsRef: string | undefined): Promise<boolean> {
  if (!vfsRef) return false
  try {
    const audioNode = await getNodeOrThrow(vfsRef)
    if (audioNode.kind !== 'file') return false
    const sidecar = await findStemsSidecarNode(audioNode)
    return sidecar !== undefined
  } catch {
    return false
  }
}

/**
 * 读取分轨侧车 blob；无侧车返回 undefined。
 */
export async function readStemsSidecarBlob(
  vfsRef: string | undefined,
): Promise<{ blob: Blob; archiveName: string } | undefined> {
  if (!vfsRef) return undefined
  const audioNode = await getNodeOrThrow(vfsRef)
  if (audioNode.kind !== 'file') return undefined
  const sidecar = await findStemsSidecarNode(audioNode)
  if (!sidecar) return undefined
  const { blob } = await readFileBlob(sidecar.id)
  return { blob, archiveName: sidecar.name }
}
