/**
 * 聊天气泡内的附件图片预览：按 VFS 路径异步加载 blob → object URL。
 */
import { useEffect, useRef, useState } from 'preact/hooks'
import { createPortal } from 'preact/compat'
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
  const [expanded, setExpanded] = useState(false)
  const [overlayHost, setOverlayHost] = useState<HTMLElement | null>(null)
  const openButtonRef = useRef<HTMLButtonElement>(null)

  const closeOverlay = () => {
    setExpanded(false)
    setOverlayHost(null)
  }

  useEffect(() => {
    let revoked: string | undefined
    let cancelled = false
    setFailed(false)
    setUrl(undefined)

    const ready = attachment.previewUrl?.trim()
    if (ready && !ready.includes('vscode-ai-image-omitted')) {
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

  useEffect(() => {
    if (!expanded) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeOverlay()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [expanded])

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
  const overlay =
    expanded && url && overlayHost
      ? createPortal(
          <div
            class="vscode-ai__msg-image-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={attachment.name}
            onClick={closeOverlay}
          >
            <img
              class="vscode-ai__msg-image-overlay-img"
              src={url}
              alt={attachment.name}
              onClick={(event) => event.stopPropagation()}
            />
          </div>,
          overlayHost,
        )
      : undefined

  return (
    <>
      <button
        ref={openButtonRef}
        type="button"
        class={`vscode-ai__msg-image-link${
          layout === 'inline' ? ' vscode-ai__msg-image-link--inline' : ''
        }`}
        title={attachment.path}
        aria-label={`放大查看：${attachment.name}`}
        onClick={() => {
          const root =
            openButtonRef.current?.closest('.vscode') ??
            document.querySelector('.vscode')
          if (!(root instanceof HTMLElement)) return
          setOverlayHost(root)
          setExpanded(true)
        }}
      >
        <img
          class={`vscode-ai__msg-image${
            layout === 'inline' ? ' vscode-ai__msg-image--inline' : ''
          }`}
          src={url}
          alt={attachment.name}
        />
      </button>
      {overlay}
    </>
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
