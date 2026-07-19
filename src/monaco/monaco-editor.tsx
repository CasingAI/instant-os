import { useEffect, useRef } from 'preact/hooks'
import type * as Monaco from 'monaco-editor'
import { ensureMonacoEnvironment, monaco } from './monaco-setup.ts'
import 'monaco-editor/min/vs/editor/editor.main.css'

export type MonacoEditorTheme = 'vs' | 'vs-dark' | 'hc-black'

export type MonacoEditorProps = {
  value: string
  onChange: (value: string) => void
  language?: string
  theme?: MonacoEditorTheme
  active?: boolean
  readOnly?: boolean
  fontSize?: number
  minimap?: boolean
  wordWrap?: 'on' | 'off' | 'wordWrapColumn' | 'bounded'
  className?: string
  onCursorChange?: (line: number, column: number) => void
}

export function MonacoEditor({
  value,
  onChange,
  language = 'plaintext',
  theme = 'vs-dark',
  active = true,
  readOnly = false,
  fontSize = 13,
  minimap = true,
  wordWrap = 'on',
  className,
  onCursorChange,
}: MonacoEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | undefined>(undefined)
  const onChangeRef = useRef(onChange)
  const onCursorChangeRef = useRef(onCursorChange)

  onChangeRef.current = onChange
  onCursorChangeRef.current = onCursorChange

  useEffect(() => {
    ensureMonacoEnvironment()

    const container = containerRef.current
    if (!container) {
      return
    }

    const editor = monaco.editor.create(container, {
      value,
      language,
      theme,
      automaticLayout: true,
      minimap: { enabled: minimap },
      fontSize,
      lineHeight: Math.round(fontSize * 1.45),
      scrollBeyondLastLine: false,
      wordWrap,
      padding: { top: 8, bottom: 8 },
      tabSize: 2,
      renderWhitespace: 'selection',
      readOnly,
    })

    editor.onDidChangeModelContent(() => {
      onChangeRef.current(editor.getValue())
    })

    editor.onDidChangeCursorPosition((event) => {
      onCursorChangeRef.current?.(event.position.lineNumber, event.position.column)
    })

    const position = editor.getPosition()
    if (position) {
      onCursorChangeRef.current?.(position.lineNumber, position.column)
    }

    editorRef.current = editor

    return () => {
      editor.dispose()
      editorRef.current = undefined
    }
    // 仅挂载时创建；后续通过 effect 同步 props
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const model = editor.getModel()
    if (!model || model.getValue() === value) return

    const scrollTop = editor.getScrollTop()
    const position = editor.getPosition()
    editor.setValue(value)
    editor.setScrollTop(scrollTop)
    if (position) {
      editor.setPosition(position)
    }
  }, [value])

  useEffect(() => {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!editor || !model) return
    if (model.getLanguageId() === language) return
    monaco.editor.setModelLanguage(model, language)
  }, [language])

  useEffect(() => {
    monaco.editor.setTheme(theme)
  }, [theme])

  useEffect(() => {
    editorRef.current?.updateOptions({
      readOnly,
      fontSize,
      lineHeight: Math.round(fontSize * 1.45),
      minimap: { enabled: minimap },
      wordWrap,
    })
  }, [fontSize, minimap, readOnly, wordWrap])

  useEffect(() => {
    if (!active) return

    const frame = window.requestAnimationFrame(() => {
      editorRef.current?.layout()
    })

    return () => window.cancelAnimationFrame(frame)
  }, [active, value])

  return <div class={className ?? 'monaco-editor-host'} ref={containerRef} />
}
