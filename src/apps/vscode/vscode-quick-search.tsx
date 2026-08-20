import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  matchVscodeOpenFiles,
  searchVscodeWorkspaceFilesDetailed,
  type VscodeWorkspaceSearchHit,
  type VscodeWorkspaceSearchOpenFile,
} from './vscode-workspace-search.ts'

const DEBOUNCE_MS = 200

export type VscodeQuickSearchProps = {
  open: boolean
  workspaceFolder: string | undefined
  openFiles: readonly VscodeWorkspaceSearchOpenFile[]
  onSelect: (hit: VscodeWorkspaceSearchHit) => void
  onClose: () => void
}

export function VscodeQuickSearch({
  open,
  workspaceFolder,
  openFiles,
  onSelect,
  onClose,
}: VscodeQuickSearchProps) {
  const [query, setQuery] = useState('')
  const [workspaceHits, setWorkspaceHits] = useState<VscodeWorkspaceSearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const openHits = useMemo(() => {
    if (!query.trim()) return []
    return matchVscodeOpenFiles(query, [...openFiles]).hits
  }, [openFiles, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setWorkspaceHits([])
    setHighlight(0)
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (!open) return
    const trimmed = query.trim()
    if (!trimmed || !workspaceFolder) {
      setWorkspaceHits([])
      setLoading(false)
      return
    }
    const abort = new AbortController()
    setLoading(true)
    const skipPaths = new Set(openFiles.map((file) => file.path))
    const timer = window.setTimeout(() => {
      void searchVscodeWorkspaceFilesDetailed({
        query: trimmed,
        skipPaths,
        workspaceFolder,
        signal: abort.signal,
      })
        .then((result) => {
          if (abort.signal.aborted) return
          setWorkspaceHits(result.hits)
          setLoading(false)
        })
        .catch(() => {
          if (abort.signal.aborted) return
          setLoading(false)
        })
    }, DEBOUNCE_MS)
    return () => {
      abort.abort()
      window.clearTimeout(timer)
    }
  }, [open, openFiles, query, workspaceFolder])

  const hits = useMemo(() => {
    const openPaths = new Set(openFiles.map((file) => file.path))
    const workspaceOnly = workspaceHits.filter((hit) => !openPaths.has(hit.path))
    return [...openHits, ...workspaceOnly].slice(0, 80)
  }, [openFiles, openHits, workspaceHits])

  useEffect(() => {
    setHighlight((current) => {
      if (hits.length === 0) return 0
      return Math.min(current, hits.length - 1)
    })
  }, [hits.length])

  if (!open) return undefined

  return (
    <div
      class="vscode__quick-search"
      role="dialog"
      aria-modal="true"
      aria-label="快速搜索"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
          return
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setHighlight((value) => Math.min(value + 1, Math.max(0, hits.length - 1)))
          return
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setHighlight((value) => Math.max(0, value - 1))
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          const hit = hits[highlight]
          if (hit) {
            onSelect(hit)
            onClose()
          }
        }
      }}
    >
      <button type="button" class="vscode__quick-search-backdrop" aria-label="关闭" onClick={onClose} />
      <div class="vscode__quick-search-panel">
        <input
          ref={inputRef}
          class="vscode__quick-search-input"
          type="search"
          placeholder="快速搜索文件内容…"
          value={query}
          onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
        />
        <div class="vscode__quick-search-list">
          {hits.map((hit, index) => (
            <button
              key={`${hit.path}:${hit.line}:${hit.column}:${index}`}
              type="button"
              class={`vscode__quick-search-item${index === highlight ? ' vscode__quick-search-item--active' : ''}`}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => {
                onSelect(hit)
                onClose()
              }}
            >
              <span class="vscode__quick-search-item-name">
                {hit.name}:{hit.line}
              </span>
              <span class="vscode__quick-search-item-preview">{hit.preview}</span>
            </button>
          ))}
          {query.trim() && loading ? <div class="vscode__tree-hint">搜索中…</div> : undefined}
          {query.trim() && !loading && hits.length === 0 ? (
            <div class="vscode__tree-hint">无匹配</div>
          ) : undefined}
        </div>
      </div>
    </div>
  )
}
