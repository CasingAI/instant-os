import type * as Monaco from 'monaco-editor'
import { monaco } from '../../monaco/monaco-setup.ts'
import {
  VscodeCompletionManager,
  type VscodeCompletionContext,
  type VscodeCompletionUiStatus,
} from './vscode-completion-manager.ts'

export type VscodeCompletionInlineOptions = {
  editor: Monaco.editor.IStandaloneCodeEditor
  enabled: boolean
  debounceMs?: number
  getModelKey?: () => string | undefined
  /** 额外上下文（只读等）；默认从 editor model 推断 */
  getContextExtras?: () => Partial<Pick<VscodeCompletionContext, 'readOnly'>>
}

export type VscodeCompletionInlineHandle = {
  setEnabled: (enabled: boolean) => void
  setDebounceMs: (ms: number) => void
  dispose: () => void
}

const BEFORE_LINE_LIMIT = 80
const AFTER_LINE_LIMIT = 40

function extractCursorContext(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
): { beforeCursor: string; afterCursor: string } {
  const lineCount = model.getLineCount()
  const startLine = Math.max(1, position.lineNumber - BEFORE_LINE_LIMIT)
  const endLine = Math.min(lineCount, position.lineNumber + AFTER_LINE_LIMIT)

  const beforeRange = new monaco.Range(startLine, 1, position.lineNumber, position.column)
  const afterRange = new monaco.Range(
    position.lineNumber,
    position.column,
    endLine,
    model.getLineMaxColumn(endLine),
  )

  return {
    beforeCursor: model.getValueInRange(beforeRange),
    afterCursor: model.getValueInRange(afterRange),
  }
}

function createLoadingDotWidget(
  editor: Monaco.editor.IStandaloneCodeEditor,
): {
  setStatus: (status: VscodeCompletionUiStatus) => void
  dispose: () => void
} {
  let attached = false
  let position: Monaco.Position | null = editor.getPosition()
  let status: VscodeCompletionUiStatus = 'idle'

  const domNode = document.createElement('div')
  domNode.className = 'vscode__completion-dot'
  domNode.setAttribute('aria-hidden', 'true')

  const widget: Monaco.editor.IContentWidget = {
    getId: () => 'vscode.completion.loadingDot',
    getDomNode: () => domNode,
    getPosition: () => {
      if (!position) return null
      return {
        position: {
          lineNumber: position.lineNumber,
          column: position.column,
        },
        preference: [monaco.editor.ContentWidgetPositionPreference.EXACT],
      }
    },
  }

  const syncDom = () => {
    domNode.classList.toggle('vscode__completion-dot--error', status === 'error')
  }

  const show = () => {
    position = editor.getPosition()
    syncDom()
    if (!attached) {
      editor.addContentWidget(widget)
      attached = true
    } else {
      editor.layoutContentWidget(widget)
    }
  }

  const hide = () => {
    if (!attached) return
    editor.removeContentWidget(widget)
    attached = false
  }

  const cursorDisposable = editor.onDidChangeCursorPosition((event) => {
    position = event.position
    if (attached) {
      editor.layoutContentWidget(widget)
    }
  })

  return {
    setStatus: (next) => {
      status = next
      if (next === 'idle') {
        hide()
        return
      }
      show()
    },
    dispose: () => {
      cursorDisposable.dispose()
      hide()
    },
  }
}

export function registerVscodeCompletionInline(
  options: VscodeCompletionInlineOptions,
): VscodeCompletionInlineHandle {
  const { editor } = options
  let enabled = options.enabled
  let providerDisposable: Monaco.IDisposable | undefined

  const loadingWidget = createLoadingDotWidget(editor)
  const manager = new VscodeCompletionManager({
    debounceMs: options.debounceMs ?? 400,
    onStatusChange: (status) => {
      loadingWidget.setStatus(status)
    },
  })

  const registerProvider = () => {
    if (providerDisposable) return
    providerDisposable = monaco.languages.registerInlineCompletionsProvider('*', {
      displayName: 'Virtual Studio Code AI',
      debounceDelayMs: 0,
      async provideInlineCompletions(model, position, _context, token) {
        if (!enabled) {
          return { items: [] }
        }
        if (model.isDisposed()) {
          return { items: [] }
        }
        // 多编辑器实例时各注册一份 provider；仅响应本 editor 当前 model
        if (editor.getModel() !== model) {
          return { items: [] }
        }

        const extras = options.getContextExtras?.() ?? {}
        if (extras.readOnly) {
          return { items: [] }
        }

        const { beforeCursor, afterCursor } = extractCursorContext(model, position)
        if (!/\S/.test(beforeCursor)) {
          return { items: [] }
        }

        const cancelListener = token.onCancellationRequested(() => {
          manager.cancel()
        })

        try {
          const result = await manager.requestCompletion({
            beforeCursor,
            afterCursor,
            language: model.getLanguageId(),
            filePath: model.uri.path || model.uri.toString(),
            readOnly: extras.readOnly,
            modelKey: options.getModelKey?.(),
          })

          if (token.isCancellationRequested || !result.text) {
            return { items: [] }
          }

          const insertText = result.text
          if (!insertText) {
            return { items: [] }
          }

          // 仅替换光标处空 range；insertText 已在 service 层去掉与光标前的重叠
          const range = new monaco.Range(
            position.lineNumber,
            position.column,
            position.lineNumber,
            position.column,
          )

          return {
            items: [
              {
                insertText,
                range,
              },
            ],
            enableForwardStability: true,
          }
        } catch {
          return { items: [] }
        } finally {
          cancelListener.dispose()
        }
      },
      disposeInlineCompletions() {
        // no-op：请求生命周期由 manager + CancellationToken 管理
      },
    })
  }

  if (enabled) {
    registerProvider()
  }

  return {
    setEnabled: (next) => {
      if (enabled === next) return
      enabled = next
      if (next) {
        registerProvider()
      } else {
        manager.cancel()
        loadingWidget.setStatus('idle')
        providerDisposable?.dispose()
        providerDisposable = undefined
      }
    },
    setDebounceMs: (ms) => {
      manager.setDebounceMs(ms)
    },
    dispose: () => {
      enabled = false
      manager.dispose()
      loadingWidget.dispose()
      providerDisposable?.dispose()
      providerDisposable = undefined
    },
  }
}
