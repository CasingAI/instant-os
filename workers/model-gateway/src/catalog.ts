/**
 * 允许通过网关拉取的对象。pathname 与 Instant OS 本地 `/assets/...` 对齐，
 * r2Key 是桶内对象键；uncompressedBytes 是解压后体积（校验 / X-Linked-Size）。
 */
export type ModelObject = {
  r2Key: string
  uncompressedBytes: number
}

const OBJECTS: Readonly<Record<string, ModelObject>> = {
  '/assets/demucs/models/htdemucs_6s.onnx': {
    r2Key: 'demucs/models/htdemucs_6s.onnx',
    uncompressedBytes: 284_797_240,
  },
  '/assets/mdx/models/UVR-MDX-NET-Inst_full_292.onnx': {
    r2Key: 'mdx/models/UVR-MDX-NET-Inst_full_292.onnx',
    uncompressedBytes: 66_759_214,
  },
  '/assets/sense-voice/models/model.int8.onnx': {
    r2Key: 'sense-voice/models/model.int8.onnx',
    uncompressedBytes: 237_115_547,
  },
  '/assets/sense-voice/tokens.txt': {
    r2Key: 'sense-voice/tokens.txt',
    uncompressedBytes: 315_894,
  },
  '/assets/sense-voice/meta.json': {
    r2Key: 'sense-voice/meta.json',
    uncompressedBytes: 11_673,
  },
  '/assets/zipformer-ctc/models/model.int8.onnx': {
    r2Key: 'zipformer-ctc/models/model.int8.onnx',
    uncompressedBytes: 367_074_356,
  },
  '/assets/zipformer-ctc/tokens.txt': {
    r2Key: 'zipformer-ctc/tokens.txt',
    uncompressedBytes: 13_366,
  },
  '/assets/zipformer-ctc-en/models/model.int8.onnx': {
    r2Key: 'zipformer-ctc-en/models/model.int8.onnx',
    uncompressedBytes: 70_239_299,
  },
  '/assets/zipformer-ctc-en/models/tokens.txt': {
    r2Key: 'zipformer-ctc-en/models/tokens.txt',
    uncompressedBytes: 5_048,
  },
}

export function lookupModelObject(pathname: string): ModelObject | undefined {
  if (!pathname.startsWith('/assets/')) return undefined
  if (pathname.includes('..') || pathname.includes('//')) return undefined
  return OBJECTS[pathname]
}
