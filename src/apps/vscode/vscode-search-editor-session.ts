import type { VscodeWorkspaceSearchHit } from './vscode-workspace-search-core.ts'

export type VscodeSearchEditorSession = {
  id: string
  query: string
  isCaseSensitive: boolean
  matchWholeWord: boolean
  isRegex: boolean
  filesToInclude: string
  filesToExclude: string
  useExcludeSettingsAndIgnoreFiles: boolean
  hits: VscodeWorkspaceSearchHit[]
  contextLines: number
}

let searchEditorSeq = 0

export function createSearchEditorSessionId(): string {
  searchEditorSeq += 1
  return `vscode-search-editor-${searchEditorSeq}`
}

export function buildSearchEditorSession(
  partial: Omit<VscodeSearchEditorSession, 'id'> & { id?: string },
): VscodeSearchEditorSession {
  return {
    id: partial.id ?? createSearchEditorSessionId(),
    query: partial.query,
    isCaseSensitive: partial.isCaseSensitive,
    matchWholeWord: partial.matchWholeWord,
    isRegex: partial.isRegex,
    filesToInclude: partial.filesToInclude,
    filesToExclude: partial.filesToExclude,
    useExcludeSettingsAndIgnoreFiles: partial.useExcludeSettingsAndIgnoreFiles,
    hits: partial.hits,
    contextLines: partial.contextLines,
  }
}
