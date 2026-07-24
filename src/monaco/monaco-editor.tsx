import { useEffect, useRef } from 'preact/hooks'
import type * as Monaco from 'monaco-editor'
import { monacoLanguageFromFileName, fileNameFromPath } from './monaco-language.ts'
import { ensureMonacoEnvironment, monaco } from './monaco-setup.ts'
import type { MonacoEditorTheme } from './monaco-themes.ts'
import 'monaco-editor/min/vs/editor/editor.main.css'

export type { MonacoEditorTheme }

export type MonacoRevealPosition = {
  line: number
  column: number
}

export type MonacoEditorProps = {
  value: string
  onChange: (value: string) => void
  language?: string
  /** VFS 绝对路径；有值时用 Uri.file 复用/创建 model，供 TS 模块解析 */
  modelPath?: string
  theme?: MonacoEditorTheme
  active?: boolean
  readOnly?: boolean
  fontSize?: number
  minimap?: boolean
  wordWrap?: 'on' | 'off' | 'wordWrapColumn' | 'bounded'
  className?: string
  onCursorChange?: (line: number, column: number) => void
  onSelectionChange?: (selectionText: string | undefined) => void
  /**
   * Go to Definition 等打开其它资源时回调。
   * 返回 true 表示已处理（应打开/切换标签）；false 则交回默认行为。
   */
  onOpenPath?: (path: string, position?: MonacoRevealPosition) => boolean | Promise<boolean>
  /** 打开资源后定位光标（例如转到定义） */
  revealPosition?: MonacoRevealPosition
  onRevealPositionApplied?: () => void
}

function getOrCreatePathModel(
  path: string,
  value: string,
  language: string,
): Monaco.editor.ITextModel {
  const uri = monaco.Uri.file(path)
  const existing = monaco.editor.getModel(uri)
  if (existing) {
    if (existing.getValue() !== value) {
      existing.setValue(value)
    }
    if (existing.getLanguageId() !== language) {
      monaco.editor.setModelLanguage(existing, language)
    }
    return existing
  }
  return monaco.editor.createModel(value, language, uri)
}

/** 确保指定路径存在 Monaco model（已存在则不覆盖内容，避免冲掉打开中的编辑） */
export function ensureMonacoPathModel(
  path: string,
  value: string,
  language: string,
  options?: { overwrite?: boolean },
): void {
  ensureMonacoEnvironment()
  const uri = monaco.Uri.file(path)
  const existing = monaco.editor.getModel(uri)
  if (existing) {
    if (options?.overwrite && existing.getValue() !== value) {
      existing.setValue(value)
    }
    if (existing.getLanguageId() !== language) {
      monaco.editor.setModelLanguage(existing, language)
    }
    return
  }
  monaco.editor.createModel(value, language, uri)
}

/** 关闭标签页时释放对应 path 的 Monaco model（若仍被编辑器占用则跳过） */
export function disposeMonacoModelForPath(path: string): void {
  const model = monaco.editor.getModel(monaco.Uri.file(path))
  if (!model) return
  const attached = monaco.editor.getEditors().some((editor) => editor.getModel() === model)
  if (attached) return
  model.dispose()
}

/** Monaco Uri.file → VFS 绝对路径 */
export function vfsPathFromMonacoUri(uri: Monaco.Uri): string | undefined {
  const path = uri.path
  if (!path.startsWith('/')) return undefined
  // 排除明显的非 VFS 路径
  if (path.includes('\\')) return undefined
  return path
}

function positionFromSelectionOrPosition(
  selectionOrPosition: Monaco.IRange | Monaco.IPosition | undefined,
): MonacoRevealPosition | undefined {
  if (!selectionOrPosition) return undefined
  if ('startLineNumber' in selectionOrPosition) {
    return {
      line: selectionOrPosition.startLineNumber,
      column: selectionOrPosition.startColumn,
    }
  }
  return {
    line: selectionOrPosition.lineNumber,
    column: selectionOrPosition.column,
  }
}

function applyRevealPosition(
  editor: Monaco.editor.IStandaloneCodeEditor,
  position: MonacoRevealPosition,
): void {
  const pos = {
    lineNumber: position.line,
    column: position.column,
  }
  editor.setPosition(pos)
  editor.revealPositionInCenter(pos)
  editor.focus()
}

export function MonacoEditor({
  value,
  onChange,
  language = 'plaintext',
  modelPath,
  theme = 'dark-plus',
  active = true,
  readOnly = false,
  fontSize = 13,
  minimap = true,
  wordWrap = 'on',
  className,
  onCursorChange,
  onSelectionChange,
  onOpenPath,
  revealPosition,
  onRevealPositionApplied,
}: MonacoEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | undefined>(undefined)
  const onChangeRef = useRef(onChange)
  const onCursorChangeRef = useRef(onCursorChange)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const onOpenPathRef = useRef(onOpenPath)
  const onRevealPositionAppliedRef = useRef(onRevealPositionApplied)
  const modelPathRef = useRef(modelPath)
  const suppressChangeRef = useRef(false)
  /** opener 已切到目标 model，等待父组件同步 modelPath，期间勿用旧 path 抢回 */
  const pendingOpenPathRef = useRef<string | undefined>(undefined)

  onChangeRef.current = onChange
  onCursorChangeRef.current = onCursorChange
  onSelectionChangeRef.current = onSelectionChange
  onOpenPathRef.current = onOpenPath
  onRevealPositionAppliedRef.current = onRevealPositionApplied
  modelPathRef.current = modelPath

  useEffect(() => {
    ensureMonacoEnvironment()

    const container = containerRef.current
    if (!container) {
      return
    }

    const pathModel = modelPath ? getOrCreatePathModel(modelPath, value, language) : undefined

    const editor = monaco.editor.create(container, {
      ...(pathModel
        ? { model: pathModel }
        : {
            value,
            language,
          }),
      theme,
      automaticLayout: true,
      // 让 hover / suggest 等溢出层使用 fixed，避免被编辑器祖先 overflow:hidden 裁切
      fixedOverflowWidgets: true,
      minimap: { enabled: minimap },
      fontSize,
      lineHeight: Math.round(fontSize * 1.45),
      scrollBeyondLastLine: false,
      wordWrap,
      padding: { top: 8, bottom: 8 },
      tabSize: 2,
      renderWhitespace: 'selection',
      // 依赖包等文件常含 LS/PS，默认 prompt 会打扰；用户暂无此设置项
      unusualLineTerminators: 'off',
      readOnly,
      'editor.inlineSuggest.enabled': true,
      // Cmd/Ctrl+点击转到定义
      links: true,
      gotoLocation: {
        multiple: 'goto',
        multipleDefinitions: 'goto',
      },
    })

    editor.onDidChangeModelContent(() => {
      if (suppressChangeRef.current) return
      const model = editor.getModel()
      if (!model) return
      const currentPath = vfsPathFromMonacoUri(model.uri)
      const expected = modelPathRef.current
      // 转到定义已切 model、父层尚未跟上时，不要把内容写回旧标签
      if (expected && currentPath && currentPath !== expected) return
      if (pendingOpenPathRef.current && currentPath === pendingOpenPathRef.current) return
      onChangeRef.current(editor.getValue())
    })

    editor.onDidChangeCursorPosition((event) => {
      onCursorChangeRef.current?.(event.position.lineNumber, event.position.column)
    })

    editor.onDidChangeCursorSelection((event) => {
      const model = editor.getModel()
      if (!model) {
        onSelectionChangeRef.current?.(undefined)
        return
      }
      const selection = event.selection
      if (selection.isEmpty()) {
        onSelectionChangeRef.current?.(undefined)
        return
      }
      const text = model.getValueInRange(selection)
      onSelectionChangeRef.current?.(text || undefined)
    })

    const opener = monaco.editor.registerEditorOpener({
      async openCodeEditor(_source, resource, selectionOrPosition) {
        const path = vfsPathFromMonacoUri(resource)
        if (!path) return false

        const previousModel = editor.getModel()
        let model = monaco.editor.getModel(resource)
        if (!model) {
          const languageId = monacoLanguageFromFileName(fileNameFromPath(path))
          model = monaco.editor.createModel('', languageId, resource)
        }

        pendingOpenPathRef.current = path
        suppressChangeRef.current = true
        editor.setModel(model)
        const position = positionFromSelectionOrPosition(selectionOrPosition)
        if (position) {
          applyRevealPosition(editor, position)
        }
        suppressChangeRef.current = false

        const handled = await onOpenPathRef.current?.(path, position)
        if (handled === false) {
          pendingOpenPathRef.current = undefined
          if (previousModel && !previousModel.isDisposed()) {
            suppressChangeRef.current = true
            editor.setModel(previousModel)
            suppressChangeRef.current = false
          }
          // 若刚才新建了空 model 且打开失败，释放它
          if (model.getValue() === '' && monaco.editor.getEditors().every((item) => item.getModel() !== model)) {
            model.dispose()
          }
          return false
        }
        return true
      },
    })

    const position = editor.getPosition()
    if (position) {
      onCursorChangeRef.current?.(position.lineNumber, position.column)
    }

    editorRef.current = editor

    return () => {
      opener.dispose()
      // Monaco WordHighlighter 在 dispose 时会取消未完成的 Delayer，产生无害的 Canceled rejection；
      // 先卸下 model，减少贡献点在销毁路径上的异步高亮任务。
      try {
        suppressChangeRef.current = true
        editor.setModel(null)
        suppressChangeRef.current = false
      } catch (_e) {
        // ignore
      }
      editor.dispose()
      editorRef.current = undefined
    }
    // 仅挂载时创建；后续通过 effect 同步 props
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    if (modelPath) {
      // 父层已跟上 opener 打开的路径
      if (pendingOpenPathRef.current === modelPath) {
        pendingOpenPathRef.current = undefined
      }

      // opener 正在导航到其它文件时，不要用旧 modelPath 抢回
      if (pendingOpenPathRef.current && pendingOpenPathRef.current !== modelPath) {
        return
      }

      const nextModel = getOrCreatePathModel(modelPath, value, language)
      if (editor.getModel() !== nextModel) {
        suppressChangeRef.current = true
        editor.setModel(nextModel)
        suppressChangeRef.current = false
        const position = editor.getPosition()
        if (position) {
          onCursorChangeRef.current?.(position.lineNumber, position.column)
        }
      }
      return
    }

    const model = editor.getModel()
    if (model && model.getLanguageId() !== language) {
      monaco.editor.setModelLanguage(model, language)
    }
  }, [modelPath, language, value])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (pendingOpenPathRef.current) return

    const model = editor.getModel()
    if (!model || model.getValue() === value) return

    const currentPath = vfsPathFromMonacoUri(model.uri)
    if (modelPath && currentPath && currentPath !== modelPath) return

    const scrollTop = editor.getScrollTop()
    const position = editor.getPosition()
    suppressChangeRef.current = true
    model.setValue(value)
    suppressChangeRef.current = false
    editor.setScrollTop(scrollTop)
    if (position) {
      editor.setPosition(position)
    }
  }, [value, modelPath])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !revealPosition) return
    if (pendingOpenPathRef.current) return

    applyRevealPosition(editor, revealPosition)
    onRevealPositionAppliedRef.current?.()
  }, [revealPosition, modelPath])

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
  }, [active])

  return <div class={className ?? 'monaco-editor-host'} ref={containerRef} />
}
