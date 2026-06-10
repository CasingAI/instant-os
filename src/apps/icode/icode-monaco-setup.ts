import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import * as monaco from 'monaco-editor'

let configured = false

export function ensureMonacoEnvironment(): void {
  if (configured) {
    return
  }

  configured = true

  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return new htmlWorker()
      }
      if (label === 'json') {
        return new jsonWorker()
      }
      return new editorWorker()
    },
  }
}

export { monaco }
