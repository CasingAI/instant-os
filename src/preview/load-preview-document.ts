import { readFileBlob, readTextFile, resolveFilesAbsolutePath } from '../apps/files/files-vfs.ts'
import type { FilesNode } from '../apps/files/files-types.ts'
import {
  guessImageMime,
  resolvePreviewKind,
  type PreviewKind,
} from './preview-kind.ts'

export type LoadedPreviewDocument = {
  path: string
  name: string
  kind: PreviewKind
  node: FilesNode
  /** Markdown 正文；非 markdown 时为 undefined */
  text?: string
  /** 图片等二进制；调用方负责 revoke object URL */
  blob?: Blob
}

/** 按路径加载可预览文档（markdown 读文本，image 读 blob） */
export async function loadPreviewDocument(documentRef: string): Promise<LoadedPreviewDocument> {
  const kind = resolvePreviewKind(documentRef)

  if (kind === 'image') {
    const result = await readFileBlob(documentRef)
    const path = await resolveFilesAbsolutePath(result.node)
    const mime = result.blob.type || guessImageMime(result.node.name)
    const blob =
      result.blob.type === mime
        ? result.blob
        : new Blob([result.blob], { type: mime })
    return {
      path,
      name: result.node.name,
      kind,
      node: result.node,
      blob,
    }
  }

  const result = await readTextFile(documentRef)
  const path = await resolveFilesAbsolutePath(result.node)
  const resolvedKind = resolvePreviewKind(result.node.name)
  return {
    path,
    name: result.node.name,
    kind: resolvedKind,
    node: result.node,
    text: resolvedKind === 'markdown' ? result.text : undefined,
  }
}
