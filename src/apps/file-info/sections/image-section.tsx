/**
 * file-info 图片信息分节：作为第一个内置插件示范 file-info-registry 协议。
 * 渲染缩略图 + 宽高 + 格式 + 文件大小；超大图片跳过正文读取避免卡顿。
 */
import { useEffect, useState } from 'preact/hooks'
import { formatFilesByteSize } from '../../../apps/files/files-path.ts'
import {
  registerFileInfoSection,
  type FileInfoSectionProps,
} from '../../../os/file-info-registry.ts'

/** 超过此大小不再读取正文做缩略图，避免拖慢信息面板 */
const IMAGE_PREVIEW_MAX_BYTES = 8 * 1024 * 1024

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp'] as const

type ImageInfo = {
  width: number
  height: number
  objectUrl: string
}

function loadImageInfo(blob: Blob): Promise<ImageInfo> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight, objectUrl })
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('图片解码失败'))
    }
    img.src = objectUrl
  })
}

function ImageInfoSection({ node, readBlob }: FileInfoSectionProps) {
  const [info, setInfo] = useState<ImageInfo | undefined>(undefined)
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'too-large'>('loading')

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | undefined

    if (node.byteSize > IMAGE_PREVIEW_MAX_BYTES) {
      setState('too-large')
      return
    }

    readBlob()
      .then((blob) => loadImageInfo(blob))
      .then((loaded) => {
        if (cancelled) {
          URL.revokeObjectURL(loaded.objectUrl)
          return
        }
        objectUrl = loaded.objectUrl
        setInfo(loaded)
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [node.byteSize, node.id, readBlob])

  if (state === 'too-large') {
    return (
      <p class="file-info-app__section-hint">
        文件过大（{formatFilesByteSize(node.byteSize)}），不生成预览。
      </p>
    )
  }
  if (state === 'loading') {
    return <p class="file-info-app__section-hint">正在读取图片信息…</p>
  }
  if (state === 'error' || !info) {
    return <p class="file-info-app__section-hint">无法读取图片信息。</p>
  }

  return (
    <div class="file-info-app__image">
      <div class="file-info-app__image-thumb">
        <img
          src={info.objectUrl}
          alt={node.name}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
          }}
        />
      </div>
      <dl class="file-info-app__image-meta">
        <div class="file-info-app__info-row">
          <dt>尺寸</dt>
          <dd>
            {info.width} × {info.height}
          </dd>
        </div>
        <div class="file-info-app__info-row">
          <dt>格式</dt>
          <dd>{node.mimeType ?? '图片'}</dd>
        </div>
        <div class="file-info-app__info-row">
          <dt>大小</dt>
          <dd>{formatFilesByteSize(node.byteSize)}</dd>
        </div>
      </dl>
    </div>
  )
}

registerFileInfoSection({
  id: 'image',
  title: '图片',
  extensions: IMAGE_EXTENSIONS,
  rank: 10,
  component: ImageInfoSection,
})
