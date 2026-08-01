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
const monacoWorkers = new Set<Worker>()

function trackWorker(worker: Worker): Worker {
  monacoWorkers.add(worker)
  return worker
}

export function ensureMonacoEnvironment(): void {
  if (configured) {
    return
  }

  configured = true

  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === 'json') {
        return trackWorker(new jsonWorker())
      }
      if (label === 'css' || label === 'scss' || label === 'less') {
        return trackWorker(new cssWorker())
      }
      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return trackWorker(new htmlWorker())
      }
      if (label === 'typescript' || label === 'javascript') {
        return trackWorker(new tsWorker())
      }
      return trackWorker(new editorWorker())
    },
  }

  // 必须在首个 editor.create / StandaloneServices.get 之前替换，否则会固化成 window.confirm
  installMonacoDialogService()

  registerMonacoThemes()
  ensureMonacoTypescriptDefaults()
}

/**
 * 终止由 getWorker 创建的全部 Monaco 语言 Worker。
 * 仅在无 VS Code / iCode 等共享 Monaco 的窗口存活时调用；下次编辑会再懒创建。
 */
export function disposeMonacoWorkers(): void {
  for (const worker of monacoWorkers) {
    try {
      worker.terminate()
    } catch {
      // 已终止或不可达时忽略
    }
  }
  monacoWorkers.clear()
}

export { monaco }
