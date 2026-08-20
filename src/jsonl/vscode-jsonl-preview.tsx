import { useEffect, useState } from 'preact/hooks'
import { JsonlLineViewer, type JsonlViewerPrefs } from './jsonl-line-viewer.tsx'

type VscodeJsonlPreviewProps = {
  text: string
  /** 唯一合成 modelPath（调用方保证不与他人共享，卸载时释放） */
  modelPath: string
  prefs: JsonlViewerPrefs
  active?: boolean
  /** 对 text 尾随防抖后再重建索引；侧边预览用 300，内联用 0 */
  debounceMs?: number
}

/** VS Code 内联 / 侧边 JSONL 预览：根 class 供 vscode.css 做间距与暗色主题微调 */
export function VscodeJsonlPreview({
  text,
  modelPath,
  prefs,
  active = true,
  debounceMs = 0,
}: VscodeJsonlPreviewProps) {
  const [stableText, setStableText] = useState(text)

  useEffect(() => {
    if (debounceMs <= 0) {
      setStableText(text)
      return
    }
    const timer = window.setTimeout(() => setStableText(text), debounceMs)
    return () => window.clearTimeout(timer)
  }, [text, debounceMs])

  return (
    <div class="vscode__jsonl-preview">
      <JsonlLineViewer text={stableText} modelPath={modelPath} prefs={prefs} active={active} />
    </div>
  )
}
