import type * as Monaco from 'monaco-editor'
import { fileNameFromPath, parentDirFromPath } from './monaco-language.ts'
import { ensureMonacoEnvironment, monaco } from './monaco-setup.ts'

function vfsPathFromUri(uri: Monaco.Uri): string | undefined {
  const path = uri.path
  if (!path.startsWith('/')) return undefined
  if (path.includes('\\')) return undefined
  return path
}

export type MonacoProblemSeverity = 'error' | 'warning' | 'info' | 'hint'

export type MonacoProblem = {
  id: string
  path: string | undefined
  resourceLabel: string
  message: string
  severity: MonacoProblemSeverity
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
  source: string | undefined
  code: string | undefined
}

export type MonacoProblemSummary = {
  errors: number
  warnings: number
  infos: number
  hints: number
}

function severityFromMarker(severity: Monaco.MarkerSeverity): MonacoProblemSeverity {
  if (severity === monaco.MarkerSeverity.Error) return 'error'
  if (severity === monaco.MarkerSeverity.Warning) return 'warning'
  if (severity === monaco.MarkerSeverity.Info) return 'info'
  return 'hint'
}

function markerCodeLabel(code: string | { value: string } | undefined): string | undefined {
  if (code === undefined) return undefined
  if (typeof code === 'string') return code || undefined
  return code.value || undefined
}

function resourceLabelForUri(uri: Monaco.Uri, path: string | undefined): string {
  if (path) {
    const name = fileNameFromPath(path)
    return name || path
  }
  const fromPath = fileNameFromPath(uri.path)
  if (fromPath) return fromPath
  return uri.toString()
}

function problemFromMarker(marker: Monaco.editor.IMarker, index: number): MonacoProblem {
  const path = vfsPathFromUri(marker.resource)
  const severity = severityFromMarker(marker.severity)
  const code = markerCodeLabel(marker.code)
  return {
    id: [
      marker.resource.toString(),
      marker.startLineNumber,
      marker.startColumn,
      marker.endLineNumber,
      marker.endColumn,
      severity,
      marker.message,
      code ?? '',
      String(index),
    ].join('\0'),
    path,
    resourceLabel: resourceLabelForUri(marker.resource, path),
    message: marker.message,
    severity,
    startLineNumber: marker.startLineNumber,
    startColumn: marker.startColumn,
    endLineNumber: marker.endLineNumber,
    endColumn: marker.endColumn,
    source: marker.source || undefined,
    code,
  }
}

const SEVERITY_RANK: Record<MonacoProblemSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3,
}

export function listMonacoProblems(): MonacoProblem[] {
  ensureMonacoEnvironment()
  const markers = monaco.editor.getModelMarkers({})
  const problems = markers.map(problemFromMarker)
  problems.sort((a, b) => {
    const rank = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (rank !== 0) return rank
    const pathCmp = (a.path ?? a.resourceLabel).localeCompare(b.path ?? b.resourceLabel, 'en')
    if (pathCmp !== 0) return pathCmp
    if (a.startLineNumber !== b.startLineNumber) return a.startLineNumber - b.startLineNumber
    return a.startColumn - b.startColumn
  })
  return problems
}

export function summarizeMonacoProblems(problems: MonacoProblem[]): MonacoProblemSummary {
  let errors = 0
  let warnings = 0
  let infos = 0
  let hints = 0
  for (const problem of problems) {
    if (problem.severity === 'error') errors += 1
    else if (problem.severity === 'warning') warnings += 1
    else if (problem.severity === 'info') infos += 1
    else hints += 1
  }
  return { errors, warnings, infos, hints }
}

export type MonacoProblemTreeDecoration = {
  errors: number
  warnings: number
}

/** 按文件路径汇总错误/警告，并向上累加到各层父目录（供资源管理器着色） */
export function buildMonacoProblemTreeDecorations(
  problems: MonacoProblem[],
): Map<string, MonacoProblemTreeDecoration> {
  const map = new Map<string, MonacoProblemTreeDecoration>()

  const bump = (path: string, severity: MonacoProblemSeverity) => {
    if (severity !== 'error' && severity !== 'warning') return
    const current = map.get(path) ?? { errors: 0, warnings: 0 }
    if (severity === 'error') current.errors += 1
    else current.warnings += 1
    map.set(path, current)
  }

  for (const problem of problems) {
    if (!problem.path) continue
    let path = problem.path
    for (;;) {
      bump(path, problem.severity)
      if (path === '/') break
      const parent = parentDirFromPath(path)
      if (parent === path) break
      path = parent
    }
  }

  return map
}

export function subscribeMonacoProblems(listener: (problems: MonacoProblem[]) => void): () => void {
  ensureMonacoEnvironment()
  listener(listMonacoProblems())
  const disposable = monaco.editor.onDidChangeMarkers(() => {
    listener(listMonacoProblems())
  })
  return () => disposable.dispose()
}
