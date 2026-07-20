import { useMemo } from 'preact/hooks'
import type { VscodeSearchEditorSession } from './vscode-search-editor-session.ts'
import type { VscodeWorkspaceSearchHit } from './vscode-workspace-search-core.ts'

export type VscodeSearchEditorProps = {
  session: VscodeSearchEditorSession
  onOpenHit: (hit: VscodeWorkspaceSearchHit) => void
  onContextLinesChange: (lines: number) => void
}

function hitKey(hit: VscodeWorkspaceSearchHit): string {
  return `${hit.path}:${hit.line}:${hit.column}`
}

export function VscodeSearchEditor({
  session,
  onOpenHit,
  onContextLinesChange,
}: VscodeSearchEditorProps) {
  const groups = useMemo(() => {
    const map = new Map<string, VscodeWorkspaceSearchHit[]>()
    for (const hit of session.hits) {
      const list = map.get(hit.path) ?? []
      list.push(hit)
      map.set(hit.path, list)
    }
    return [...map.entries()].map(([path, hits]) => ({
      path,
      name: hits[0]?.name ?? path,
      hits,
    }))
  }, [session.hits])

  const fileCount = groups.length
  const resultCount = session.hits.length

  return (
    <div class="vscode__search-editor">
      <div class="vscode__search-editor-toolbar">
        <div class="vscode__search-editor-query">
          <span class="vscode__search-editor-label">查询</span>
          <code>{session.query || '（空）'}</code>
          {session.isCaseSensitive ? <span class="vscode__search-editor-flag">Aa</span> : undefined}
          {session.matchWholeWord ? <span class="vscode__search-editor-flag">ab</span> : undefined}
          {session.isRegex ? <span class="vscode__search-editor-flag">.*</span> : undefined}
        </div>
        <label class="vscode__search-editor-context">
          上下文行
          <input
            type="number"
            min={0}
            max={10}
            value={session.contextLines}
            onInput={(event) =>
              onContextLinesChange(
                Math.max(0, Math.min(10, Number((event.target as HTMLInputElement).value) || 0)),
              )
            }
          />
        </label>
        <span class="vscode__search-editor-summary">
          {resultCount} 个结果，{fileCount} 个文件
        </span>
      </div>

      <div class="vscode__search-editor-body">
        {groups.map((group) => (
          <section key={group.path} class="vscode__search-editor-file">
            <h3 class="vscode__search-editor-file-title">{group.path}</h3>
            {group.hits.map((hit) => {
              const context = hit.context
              if (context && context.length > 0) {
                return (
                  <div key={hitKey(hit)} class="vscode__search-editor-block">
                    {context.map((line) => (
                      <button
                        key={`${hitKey(hit)}:${line.line}`}
                        type="button"
                        class={`vscode__search-editor-line${line.isMatch ? ' vscode__search-editor-line--match' : ''}`}
                        onClick={() =>
                          onOpenHit({
                            ...hit,
                            line: line.line,
                            column: line.isMatch ? hit.column : 1,
                          })
                        }
                      >
                        <span class="vscode__search-editor-lineno">{line.line}</span>
                        <span class="vscode__search-editor-text">{line.text || ' '}</span>
                      </button>
                    ))}
                  </div>
                )
              }
              return (
                <button
                  key={hitKey(hit)}
                  type="button"
                  class="vscode__search-editor-line vscode__search-editor-line--match"
                  onClick={() => onOpenHit(hit)}
                >
                  <span class="vscode__search-editor-lineno">{hit.line}</span>
                  <span class="vscode__search-editor-text">{hit.preview}</span>
                </button>
              )
            })}
          </section>
        ))}
        {resultCount === 0 ? <div class="vscode__tree-hint">无匹配</div> : undefined}
      </div>
    </div>
  )
}
