/**
 * 聊天气泡内的附件图片预览：按 VFS 路径异步加载 blob → object URL。
 */
import { useEffect, useState } from 'preact/hooks'
import { filesReadBlob } from '../files/files-api.ts'
import type { VscodeAiImageAttachment } from './vscode-ai-attachments.ts'

type VscodeAiAttachmentImagesProps = {
  attachments: readonly VscodeAiImageAttachment[]
  /** 气泡内大图（子 Agent 详情） vs chip 旁缩略 */
  layout?: 'stack' | 'inline'
}

function VscodeAiAttachmentImageItem({
  attachment,
  layout,
}: {
  attachment: VscodeAiImageAttachment
  layout: 'stack' | 'inline'
}) {
  const [url, setUrl] = useState<string | undefined>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let revoked: string | undefined
    let cancelled = false
    setFailed(false)
    setUrl(undefined)

    const ready = attachment.previewUrl?.trim()
    if (ready) {
      setUrl(ready)
      return () => {
        cancelled = true
      }
    }

    void (async () => {
      try {
        const blob = await filesReadBlob(attachment.path)
        if (cancelled) return
        const objectUrl = URL.createObjectURL(blob)
        revoked = objectUrl
        setUrl(objectUrl)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [attachment.path, attachment.previewUrl])

  if (failed) {
    return (
      <div class="vscode-ai__msg-image vscode-ai__msg-image--failed" title={attachment.path}>
        {attachment.name}
      </div>
    )
  }
  if (!url) {
    return (
      <div
        class={`vscode-ai__msg-image vscode-ai__msg-image--loading${
          layout === 'inline' ? ' vscode-ai__msg-image--inline' : ''
        }`}
        aria-hidden="true"
      />
    )
  }
  return (
    <a
      class={`vscode-ai__msg-image-link${
        layout === 'inline' ? ' vscode-ai__msg-image-link--inline' : ''
      }`}
      href={url}
      target="_blank"
      rel="noreferrer"
      title={attachment.path}
    >
      <img
        class={`vscode-ai__msg-image${
          layout === 'inline' ? ' vscode-ai__msg-image--inline' : ''
        }`}
        src={url}
        alt={attachment.name}
      />
    </a>
  )
}

export function VscodeAiAttachmentImages({
  attachments,
  layout = 'stack',
}: VscodeAiAttachmentImagesProps) {
  if (attachments.length === 0) return null
  return (
    <div
      class={`vscode-ai__msg-images${
        layout === 'inline' ? ' vscode-ai__msg-images--inline' : ''
      }`}
    >
      {attachments.map((item) => (
        <VscodeAiAttachmentImageItem key={item.id} attachment={item} layout={layout} />
      ))}
    </div>
  )
}
