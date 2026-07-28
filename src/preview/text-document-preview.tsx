import { useEffect } from 'preact/hooks'
import {
  disposeMonacoModelForPath,
  MonacoEditor,
} from '../monaco/monaco-editor.tsx'
import { monacoLanguageFromFileName } from '../monaco/monaco-language.ts'
import './text-document-preview.css'

export type TextDocumentPreviewProps = {
  text: string
  /** 用于语言推断；也可传显式 language */
  fileName?: string
  /** Monaco modelPath；有值时 unmount 会尝试释放 model */
  filePath?: string
  language?: string
  active?: boolean
  class?: string
}

export function TextDocumentPreview({
  text,
  fileName,
  filePath,
  language,
  active = true,
  class: className,
}: TextDocumentPreviewProps) {
  const resolvedLanguage =
    language ?? (fileName ? monacoLanguageFromFileName(fileName) : 'plaintext')

  useEffect(() => {
    if (!filePath) return
    return () => {
      disposeMonacoModelForPath(filePath)
    }
  }, [filePath])

  const rootClass = ['text-document-preview', className].filter(Boolean).join(' ')

  return (
    <div class={rootClass}>
      <MonacoEditor
        className="text-document-preview__monaco"
        value={text}
        onChange={() => {}}
        language={resolvedLanguage}
        modelPath={filePath}
        readOnly
        active={active}
        theme="light-plus"
        minimap={false}
        wordWrap="on"
        fontSize={13}
      />
    </div>
  )
}
