/**
 * 镜像正文安静块写入通道。
 * 用于虚拟机实时写入、FAT 卷回刷等高频场景：只按偏移写 OPFS 正文，
 * 运行期间不更新内容版本、不广播、不改目录账本；关闭时一次性更新修改时间。
 * 若正文仍在 IndexedDB（未溢到 OPFS），返回 undefined，调用方走常规 files API。
 */

import { osNowMs } from '../../os/os-clock.ts'
import { beginIdbTransaction } from '../../os/idb-transaction.ts'
import {
  resolveFileNodeByAbsolutePath,
  resolveFilesAbsolutePath,
  invalidateFilesVfsPathCaches,
} from './files-vfs.ts'
import {
  FILES_NODES_STORE,
  getFileBlobStorageInfo,
  openFilesDb,
  type FilesNodeRecord,
} from './files-storage.ts'
import { openOpfsBlobWriter } from './files-opfs-blobs.ts'
import { newContentRevisionId } from './files-types.ts'

export type QuietBlobWriter = {
  /** 按偏移写入正文；不触发版本/广播/事务 */
  writeAt(offset: number, data: Uint8Array): Promise<void>
  /** 把已写入数据刷入持久层 */
  flush(): Promise<void>
  /** 关闭写入会话并一次性更新节点修改时间 */
  close(): Promise<void>
  /** 中止会话 */
  abort(): Promise<void>
}

export async function openQuietBlobWriter(
  path: string,
): Promise<QuietBlobWriter | undefined> {
  const node = await resolveFileNodeByAbsolutePath(path)
  if (!node) return undefined
  const info = await getFileBlobStorageInfo(node.id)
  if (!info || info.bodyStore !== 'OPFS') return undefined

  const writer = await openOpfsBlobWriter(info.blobId)
  let closed = false

  async function closeWriter(): Promise<void> {
    if (closed) return
    closed = true
    await writer.close()
  }

  return {
    async writeAt(offset, data) {
      if (closed) throw new Error('安静写入已结束')
      await writer.writeAt(offset, data)
    },
    async flush() {
      if (closed) return
      await writer.flush()
    },
    async close() {
      await closeWriter()
      await bumpNodeUpdatedAt(node.id)
      const path = await resolveFilesAbsolutePath(node)
      if (path) {
        // 只清路径缓存；不派改事件，避免 UI 在运行期刷新
        invalidateFilesVfsPathCaches()
      }
    },
    async abort() {
      if (closed) return
      closed = true
      await writer.abort()
    },
  }
}

async function bumpNodeUpdatedAt(nodeId: string): Promise<void> {
  const db = await openFilesDb()
  const tx = beginIdbTransaction(db, [FILES_NODES_STORE], 'readwrite')
  const nodeStore = tx.objectStore(FILES_NODES_STORE)
  const record = (await new Promise((resolve, reject) => {
    const req = nodeStore.get(nodeId)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 读取失败'))
  })) as FilesNodeRecord | undefined
  if (record && record.kind === 'file') {
    const updated: FilesNodeRecord = {
      ...record,
      updatedAt: osNowMs(),
      contentRevisionId: newContentRevisionId(),
    }
    nodeStore.put(updated)
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务失败'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务已中止'))
  })
}
