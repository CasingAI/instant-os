import { encodeArchiveInWorker } from '../../archive/archive-worker-client.ts'
import { filesDecodeArchive, filesReadBlob, filesWriteBinary } from '../files/files-api.ts'
import type { ArchiveCodecFormat } from '../../archive/archive-codec.ts'

/**
 * 归档内修改：读回字节 → 全量解码 → transform 改写条目 → 重新编码 → 覆盖写回。
 * 支持 zip / tar / tar.gz；单文件 gzip 无条目结构，不支持。
 * 已知取舍：重新编码会丢失归档注释、额外字段、加密等原始特性。
 */

export type ArchiveRewriteResult = {
  entryCount: number
}

export async function applyArchiveRewrite(params: {
  archivePath: string
  format: ArchiveCodecFormat
  transform: (
    entries: Map<string, Uint8Array>,
  ) => Map<string, Uint8Array> | Promise<Map<string, Uint8Array>>
  signal?: AbortSignal
}): Promise<ArchiveRewriteResult> {
  const { archivePath, format, transform, signal } = params
  if (format === 'gzip-file') {
    throw new Error('单文件 gzip 不支持修改内容')
  }
  const blob = await filesReadBlob(archivePath)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const entries = await filesDecodeArchive({
    bytes,
    format,
    stripRoot: false,
    signal,
  })
  const next = await transform(entries)
  const outBytes = await encodeArchiveInWorker({
    entries: [...next.entries()].map(([path, data]) => ({
      path,
      bytes: toExactBytes(data),
    })),
    format: format === 'zip' ? 'zip' : format === 'tar' ? 'tar' : 'gzip-tar',
    signal,
  })
  await filesWriteBinary(archivePath, toExactBytes(outBytes))
  return { entryCount: next.size }
}

function toExactBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer as ArrayBuffer
}
