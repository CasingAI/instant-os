import { useEffect, useState } from 'preact/hooks'
import type { ComponentType } from 'preact'

type TextPreviewProps = {
  text: string
  fileName?: string
  active?: boolean
}

type PreviewComponent = ComponentType<TextPreviewProps>

export type ChromoNetworkTextPreviewProps = TextPreviewProps

/**
 * Lazy-load TextDocumentPreview (and Monaco) only when a text network preview is shown.
 */
export function ChromoNetworkTextPreview({
  text,
  fileName,
  active = true,
}: ChromoNetworkTextPreviewProps) {
  const [Preview, setPreview] = useState<PreviewComponent | null>(null)
  const [error, setError] = useState('')
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError('')
    setPreview(null)
    void import('../../preview/text-document-preview.tsx')
      .then((mod) => {
        if (!cancelled) {
          setPreview(() => mod.TextDocumentPreview)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      })
    return () => {
      cancelled = true
    }
  }, [retryKey])

  if (error) {
    return (
      <div class="chromo-network__drawer-empty">
        <p>加载编辑器失败：{error}</p>
        <button
          type="button"
          class="chromo-network__preview-retry"
          onClick={() => setRetryKey((n) => n + 1)}
        >
          重试
        </button>
      </div>
    )
  }

  if (!Preview) {
    return <div class="chromo-network__drawer-empty">加载编辑器…</div>
  }

  return <Preview text={text} fileName={fileName} active={active} />
}
