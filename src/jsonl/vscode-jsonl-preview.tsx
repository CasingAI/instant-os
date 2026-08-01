import { JsonlLineViewer, type JsonlViewerPrefs } from './jsonl-line-viewer.tsx'

type VscodeJsonlPreviewProps = {
  text: string
  /** 唯一合成 modelPath（调用方保证不与他人共享，卸载时释放） */
  modelPath: string
  prefs: JsonlViewerPrefs
  active?: boolean
}

/** VS Code 内联 / 侧边 JSONL 预览：根 class 供 vscode.css 做间距与暗色主题微调 */
export function VscodeJsonlPreview({
  text,
  modelPath,
  prefs,
  active = true,
}: VscodeJsonlPreviewProps) {
  return (
    <div class="vscode__jsonl-preview">
      <JsonlLineViewer text={text} modelPath={modelPath} prefs={prefs} active={active} />
    </div>
  )
}
