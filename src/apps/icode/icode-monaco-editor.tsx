import { useEffect, useRef } from 'preact/hooks'
import type * as Monaco from 'monaco-editor'
import { ensureMonacoEnvironment, monaco } from './icode-monaco-setup.ts'
import 'monaco-editor/min/vs/editor/editor.main.css'

type IcodeMonacoEditorProps = {
  value: string
  onChange: (value: string) => void
  active?: boolean
  language?: 'html' | 'json'
}

export function IcodeMonacoEditor({
  value,
  onChange,
  active = true,
  language = 'html',
}: IcodeMonacoEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | undefined>(undefined)
  const onChangeRef = useRef(onChange)

  onChangeRef.current = onChange

  useEffect(() => {
    ensureMonacoEnvironment()

    const container = containerRef.current
    if (!container) {
      return
    }

    const editor = monaco.editor.create(container, {
      value,
      language,
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 12,
      lineHeight: 18,
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      padding: { top: 8, bottom: 8 },
      tabSize: 2,
      renderWhitespace: 'selection',
    })

    editor.onDidChangeModelContent(() => {
      onChangeRef.current(editor.getValue())
    })

    editorRef.current = editor

    return () => {
      editor.dispose()
      editorRef.current = undefined
    }
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) {
      return
    }

    const model = editor.getModel()
    if (!model || model.getValue() === value) {
      return
    }

    const scrollTop = editor.getScrollTop()
    const position = editor.getPosition()
    editor.setValue(value)
    editor.setScrollTop(scrollTop)
    if (position) {
      editor.setPosition(position)
    }
  }, [value])

  useEffect(() => {
    if (!active) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      editorRef.current?.layout()
    })

    return () => window.cancelAnimationFrame(frame)
  }, [active, value])

  return <div class="icode__monaco" ref={containerRef} />
}
