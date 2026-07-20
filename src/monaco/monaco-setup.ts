import './monaco-nls.ts'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import * as monaco from 'monaco-editor'
import { installMonacoDialogService } from './monaco-dialog-service.ts'
import { registerMonacoThemes } from './monaco-themes.ts'
import { ensureMonacoTypescriptDefaults } from './monaco-typescript.ts'

let configured = false

export function ensureMonacoEnvironment(): void {
  if (configured) {
    return
  }

  configured = true

  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === 'json') {
        return new jsonWorker()
      }
      if (label === 'css' || label === 'scss' || label === 'less') {
        return new cssWorker()
      }
      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return new htmlWorker()
      }
      if (label === 'typescript' || label === 'javascript') {
        return new tsWorker()
      }
      return new editorWorker()
    },
  }

  // 必须在首个 editor.create / StandaloneServices.get 之前替换，否则会固化成 window.confirm
  installMonacoDialogService()

  registerMonacoThemes()
  ensureMonacoTypescriptDefaults()
}

export { monaco }
