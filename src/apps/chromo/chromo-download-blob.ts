const BLOB_CHUNK_BYTES = 256 * 1024

type BlobMetaResult = {
  ok?: boolean
  size?: number
  type?: string
  base64?: string
  error?: string
}

function parseEvalResult(value: unknown): BlobMetaResult {
  if (!value || typeof value !== 'object') {
    throw new Error('无法读取页内 blob')
  }
  return value as BlobMetaResult
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function buildBlobChunkEval(url: string, offset: number, length: number): string {
  return `(function () {
    var url = ${JSON.stringify(url)};
    var offset = ${offset};
    var length = ${length};
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.blob();
    }).then(function (blob) {
      if (length <= 0) {
        return { ok: true, size: blob.size, type: blob.type || '' };
      }
      var slice = blob.slice(offset, offset + length);
      return slice.arrayBuffer().then(function (buf) {
        var bytes = new Uint8Array(buf);
        var bin = '';
        var step = 0x8000;
        for (var i = 0; i < bytes.length; i += step) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + step, bytes.length)));
        }
        return { ok: true, size: blob.size, type: blob.type || '', base64: btoa(bin) };
      });
    }).catch(function (err) {
      return { ok: false, error: err && err.message ? String(err.message) : String(err) };
    });
  })()`
}

export type ChromoBlobReadMeta = {
  size: number
  type?: string
}

export async function* readBlobUrlChunksViaEval(
  evalInPage: (code: string) => Promise<unknown>,
  blobUrl: string,
): AsyncGenerator<Uint8Array, ChromoBlobReadMeta> {
  const metaValue = parseEvalResult(await evalInPage(buildBlobChunkEval(blobUrl, 0, 0)))
  if (!metaValue.ok) {
    throw new Error(metaValue.error || '无法读取页内 blob')
  }
  const size = typeof metaValue.size === 'number' && Number.isFinite(metaValue.size) ? metaValue.size : 0
  const type = typeof metaValue.type === 'string' && metaValue.type.trim() ? metaValue.type.trim() : undefined
  let offset = 0
  while (offset < size) {
    const length = Math.min(BLOB_CHUNK_BYTES, size - offset)
    const chunkValue = parseEvalResult(await evalInPage(buildBlobChunkEval(blobUrl, offset, length)))
    if (!chunkValue.ok || typeof chunkValue.base64 !== 'string') {
      throw new Error(chunkValue.error || '无法读取页内 blob 分块')
    }
    const bytes = base64ToBytes(chunkValue.base64)
    if (bytes.byteLength === 0) {
      break
    }
    yield bytes
    offset += bytes.byteLength
  }
  return { size, type }
}
