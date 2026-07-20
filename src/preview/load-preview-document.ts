import { catalogEntryById } from '../assets/3d/asset-catalog.ts'
import { parseModels3dCatalogId } from '../apps/files/files-location-models3d.ts'
import { isFilesAbsolutePath } from '../apps/files/files-path.ts'
import type { FilesNode } from '../apps/files/files-types.ts'
import {
  getNodeOrThrow,
  readFileBlob,
  readTextFile,
  resolveFileNodeByAbsolutePath,
  resolveFilesAbsolutePath,
} from '../apps/files/files-vfs.ts'
import {
  guessImageMime,
  guessModel3dMime,
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
  /** 图片 / 非 catalog 模型二进制；调用方负责 revoke object URL */
  blob?: Blob
  /** catalog 内置模型的静态站点 URL */
  modelUrl?: string
}

async function resolvePreviewFileNode(ref: string): Promise<FilesNode> {
  if (isFilesAbsolutePath(ref)) {
    const node = await resolveFileNodeByAbsolutePath(ref)
    if (!node) throw new Error('文件不存在')
    return node
  }
  return getNodeOrThrow(ref)
}

/** 按路径或节点 id 加载可预览文档 */
export async function loadPreviewDocument(documentRef: string): Promise<LoadedPreviewDocument> {
  const node = await resolvePreviewFileNode(documentRef)
  const path = await resolveFilesAbsolutePath(node)
  const kind = resolvePreviewKind(node.name)

  if (kind === 'model3d') {
    const catalogId = parseModels3dCatalogId(node.id)
    if (catalogId) {
      const entry = catalogEntryById(catalogId)
      if (!entry?.url) {
        throw new Error('找不到模型资源')
      }
      return {
        path,
        name: node.name,
        kind,
        node,
        modelUrl: entry.url,
      }
    }

    const result = await readFileBlob(node.id)
    const mime = result.blob.type || guessModel3dMime(result.node.name)
    const blob =
      result.blob.type === mime ? result.blob : new Blob([result.blob], { type: mime })
    return {
      path,
      name: result.node.name,
      kind,
      node: result.node,
      blob,
    }
  }

  if (kind === 'image') {
    const result = await readFileBlob(node.id)
    const mime = result.blob.type || guessImageMime(result.node.name)
    const blob =
      result.blob.type === mime ? result.blob : new Blob([result.blob], { type: mime })
    return {
      path,
      name: result.node.name,
      kind,
      node: result.node,
      blob,
    }
  }

  if (kind === 'markdown') {
    const result = await readTextFile(node.id)
    return {
      path,
      name: result.node.name,
      kind,
      node: result.node,
      text: result.text,
    }
  }

  return {
    path,
    name: node.name,
    kind,
    node,
  }
}
