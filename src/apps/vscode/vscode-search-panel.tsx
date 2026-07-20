import type { ComponentChildren } from 'preact'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useIconContextMenu } from '../../os/icon-context-menu-context.tsx'
import {
  pushSearchHistory,
  type VscodeSearchPrefs,
} from './vscode-prefs.ts'
import {
  matchVscodeOpenFiles,
  searchVscodeWorkspaceFilesDetailed,
  type VscodeWorkspaceSearchHit,
  type VscodeWorkspaceSearchOpenFile,
} from './vscode-workspace-search.ts'
import {
  applyReplaceToTarget,
  previewReplaceLine,
} from './vscode-workspace-search-replace.ts'
import { relativeToWorkspace } from './vscode-workspace-search-ignore.ts'

const SEARCH_DEBOUNCE_MS = 250

export type VscodeSearchPanelOpenPayload = {
  query: string
  isCaseSensitive: boolean
  matchWholeWord: boolean
  isRegex: boolean
  filesToInclude: string
  filesToExclude: string
  useExcludeSettingsAndIgnoreFiles: boolean
  hits: VscodeWorkspaceSearchHit[]
}

export type VscodeSearchPanelProps = {
  workspaceFolder: string | undefined
  openFiles: readonly VscodeWorkspaceSearchOpenFile[]
  dirtyPaths: ReadonlySet<string>
  searchPrefs: VscodeSearchPrefs
  onPatchSearchPrefs: (patch: Partial<VscodeSearchPrefs>) => void
  /** 递增时聚焦查询框 */
  focusNonce?: number
  /** 递增时展开替换并聚焦 */
  expandReplaceNonce?: number
  /** 递增时把 seedInclude 写入 include */
  seedInclude?: string
  seedIncludeNonce?: number
  onOpenHit: (hit: VscodeWorkspaceSearchHit) => void
  onUpdateOpenFileText: (path: string, text: string) => void
  onOpenSearchEditor: (payload: VscodeSearchPanelOpenPayload) => void
}

type FileGroup = {
  path: string
  name: string
  hits: VscodeWorkspaceSearchHit[]
}

function hitKey(hit: VscodeWorkspaceSearchHit): string {
  return `${hit.path}:${hit.line}:${hit.column}:${hit.matchLength}`
}

function highlightPreview(preview: string, matchedText: string): ComponentChildren {
  if (!matchedText) return preview
  const idx = preview.indexOf(matchedText)
  if (idx < 0) return preview
  return (
    <>
      {preview.slice(0, idx)}
      <mark class="vscode__search-mark">{matchedText}</mark>
      {preview.slice(idx + matchedText.length)}
    </>
  )
}

export function VscodeSearchPanel({
  workspaceFolder,
  openFiles,
  dirtyPaths,
  searchPrefs,
  onPatchSearchPrefs,
  focusNonce = 0,
  expandReplaceNonce = 0,
  seedInclude,
  seedIncludeNonce = 0,
  onOpenHit,
  onUpdateOpenFileText,
  onOpenSearchEditor,
}: VscodeSearchPanelProps) {
  const { showIconContextMenu } = useIconContextMenu()
  const queryRef = useRef<HTMLInputElement>(null)
  const replaceRef = useRef<HTMLInputElement>(null)

  const [query, setQuery] = useState('')
  const [replaceValue, setReplaceValue] = useState('')
  const [filesToInclude, setFilesToInclude] = useState('')
  const [filesToExclude, setFilesToExclude] = useState('')
  const [workspaceHits, setWorkspaceHits] = useState<VscodeWorkspaceSearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [patternError, setPatternError] = useState<string | undefined>(undefined)
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set())
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(() => new Set())
  const [replacing, setReplacing] = useState(false)
  const historyIndexRef = useRef(-1)

  const openFilesRef = useRef(openFiles)
  openFilesRef.current = openFiles

  useEffect(() => {
    if (!focusNonce) return
    const frame = window.requestAnimationFrame(() => {
      queryRef.current?.focus()
      queryRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focusNonce])

  useEffect(() => {
    if (!expandReplaceNonce) return
    onPatchSearchPrefs({ showReplace: true })
    const frame = window.requestAnimationFrame(() => {
      replaceRef.current?.focus()
      replaceRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [expandReplaceNonce, onPatchSearchPrefs])

  useEffect(() => {
    if (!seedIncludeNonce || seedInclude === undefined) return
    setFilesToInclude(seedInclude)
    onPatchSearchPrefs({ showDetails: true })
  }, [onPatchSearchPrefs, seedInclude, seedIncludeNonce])

  const matchOptions = useMemo(
    () => ({
      isCaseSensitive: searchPrefs.isCaseSensitive,
      matchWholeWord: searchPrefs.matchWholeWord,
      isRegex: searchPrefs.isRegex,
      filesToInclude,
      filesToExclude,
      useExcludeSettingsAndIgnoreFiles: searchPrefs.useExcludeSettingsAndIgnoreFiles,
      onlyPaths: searchPrefs.onlyChangedFiles ? dirtyPaths : undefined,
      workspaceFolder,
    }),
    [
      dirtyPaths,
      filesToExclude,
      filesToInclude,
      searchPrefs.isCaseSensitive,
      searchPrefs.isRegex,
      searchPrefs.matchWholeWord,
      searchPrefs.onlyChangedFiles,
      searchPrefs.useExcludeSettingsAndIgnoreFiles,
      workspaceFolder,
    ],
  )

  const openHitsResult = useMemo(() => {
    if (!query.trim()) return { hits: [] as VscodeWorkspaceSearchHit[], patternError: undefined }
    if (searchPrefs.onlyChangedFiles && dirtyPaths.size === 0) {
      return { hits: [], patternError: undefined }
    }
    return matchVscodeOpenFiles(query, [...openFiles], matchOptions)
  }, [dirtyPaths.size, matchOptions, openFiles, query, searchPrefs.onlyChangedFiles])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setWorkspaceHits([])
      setLoading(false)
      setPatternError(undefined)
      return
    }
    if (openHitsResult.patternError) {
      setPatternError(openHitsResult.patternError)
      setWorkspaceHits([])
      setLoading(false)
      return
    }
    if (searchPrefs.onlyOpenEditors) {
      setWorkspaceHits([])
      setLoading(false)
      setPatternError(undefined)
      return
    }
    if (searchPrefs.onlyChangedFiles && dirtyPaths.size === 0) {
      setWorkspaceHits([])
      setLoading(false)
      setPatternError(undefined)
      return
    }

    const abort = new AbortController()
    setWorkspaceHits([])
    setLoading(true)
    setPatternError(undefined)
    const skipPaths = new Set(openFilesRef.current.map((file) => file.path))
    const timer = window.setTimeout(() => {
      void searchVscodeWorkspaceFilesDetailed({
        query: trimmed,
        skipPaths,
        workspaceFolder,
        signal: abort.signal,
        isCaseSensitive: searchPrefs.isCaseSensitive,
        matchWholeWord: searchPrefs.matchWholeWord,
        isRegex: searchPrefs.isRegex,
        filesToInclude,
        filesToExclude,
        useExcludeSettingsAndIgnoreFiles: searchPrefs.useExcludeSettingsAndIgnoreFiles,
        onlyOpenEditors: searchPrefs.onlyOpenEditors,
        onlyPaths: searchPrefs.onlyChangedFiles ? [...dirtyPaths] : undefined,
        onProgress: (hits) => {
          if (abort.signal.aborted) return
          setWorkspaceHits(hits)
        },
      })
        .then((result) => {
          if (abort.signal.aborted) return
          setWorkspaceHits(result.hits)
          setPatternError(result.patternError)
          setLoading(false)
        })
        .catch(() => {
          if (abort.signal.aborted) return
          setLoading(false)
        })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      abort.abort()
      window.clearTimeout(timer)
    }
  }, [
    dirtyPaths,
    filesToExclude,
    filesToInclude,
    openHitsResult.patternError,
    query,
    searchPrefs.isCaseSensitive,
    searchPrefs.isRegex,
    searchPrefs.matchWholeWord,
    searchPrefs.onlyChangedFiles,
    searchPrefs.onlyOpenEditors,
    searchPrefs.useExcludeSettingsAndIgnoreFiles,
    workspaceFolder,
  ])

  const allHits = useMemo(() => {
    if (!query.trim()) return []
    const openPaths = new Set(openFiles.map((file) => file.path))
    const workspaceOnly = workspaceHits.filter((hit) => !openPaths.has(hit.path))
    return [...openHitsResult.hits, ...workspaceOnly].filter(
      (hit) => !dismissedKeys.has(hitKey(hit)),
    )
  }, [dismissedKeys, openFiles, openHitsResult.hits, query, workspaceHits])

  const groups = useMemo((): FileGroup[] => {
    const map = new Map<string, FileGroup>()
    for (const hit of allHits) {
      let group = map.get(hit.path)
      if (!group) {
        group = { path: hit.path, name: hit.name, hits: [] }
        map.set(hit.path, group)
      }
      group.hits.push(hit)
    }
    return [...map.values()]
  }, [allHits])

  const fileCount = groups.length
  const resultCount = allHits.length

  const rememberQuery = useCallback(() => {
    const trimmed = query.trim()
    if (!trimmed) return
    onPatchSearchPrefs({
      searchHistory: pushSearchHistory(searchPrefs.searchHistory, trimmed),
    })
  }, [onPatchSearchPrefs, query, searchPrefs.searchHistory])

  const rememberReplace = useCallback(() => {
    const trimmed = replaceValue.trim()
    if (!trimmed) return
    onPatchSearchPrefs({
      replaceHistory: pushSearchHistory(searchPrefs.replaceHistory, trimmed),
    })
  }, [onPatchSearchPrefs, replaceValue, searchPrefs.replaceHistory])

  const toggleCollapsed = useCallback((path: string) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const appendExclude = useCallback((folderOrFileRel: string) => {
    const pattern = folderOrFileRel
    setFilesToExclude((current) => {
      const parts = current
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
      if (parts.includes(pattern)) return current
      return [...parts, pattern].join(', ')
    })
    onPatchSearchPrefs({ showDetails: true })
  }, [onPatchSearchPrefs])

  const setIncludeOnly = useCallback((pattern: string) => {
    setFilesToInclude(pattern)
    onPatchSearchPrefs({ showDetails: true })
  }, [onPatchSearchPrefs])

  const openGroupMenu = useCallback(
    (event: MouseEvent, group: FileGroup) => {
      event.preventDefault()
      event.stopPropagation()
      const rel = workspaceFolder
        ? relativeToWorkspace(workspaceFolder, group.path)
        : group.path
      const folderRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : rel
      showIconContextMenu(event, [
        {
          type: 'action',
          label: '限制搜索到此文件夹',
          disabled: !workspaceFolder,
          onClick: () => setIncludeOnly(folderRel || rel),
        },
        {
          type: 'action',
          label: '从此文件夹排除',
          disabled: !workspaceFolder,
          onClick: () => appendExclude(folderRel || rel),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: '关闭结果',
          onClick: () => {
            setDismissedKeys((prev) => {
              const next = new Set(prev)
              for (const hit of group.hits) next.add(hitKey(hit))
              return next
            })
          },
        },
      ])
    },
    [appendExclude, setIncludeOnly, showIconContextMenu, workspaceFolder],
  )

  const openTextForPath = useCallback(
    (path: string): string | undefined => {
      return openFilesRef.current.find((file) => file.path === path)?.text
    },
    [],
  )

  const replaceOne = useCallback(
    async (hit: VscodeWorkspaceSearchHit) => {
      if (!query.trim() || replacing) return
      setReplacing(true)
      rememberQuery()
      rememberReplace()
      try {
        const openText = openTextForPath(hit.path)
        const result = await applyReplaceToTarget(
          { path: hit.path, openText },
          query,
          replaceValue,
          {
            isCaseSensitive: searchPrefs.isCaseSensitive,
            matchWholeWord: searchPrefs.matchWholeWord,
            isRegex: searchPrefs.isRegex,
            preserveCase: searchPrefs.preserveCase,
          },
          { line: hit.line, column: hit.column, matchLength: hit.matchLength },
        )
        if (!result) return
        if (result.fromOpenTab) onUpdateOpenFileText(hit.path, result.text)
        setDismissedKeys((prev) => new Set(prev).add(hitKey(hit)))
      } finally {
        setReplacing(false)
      }
    },
    [
      onUpdateOpenFileText,
      openTextForPath,
      query,
      rememberQuery,
      rememberReplace,
      replaceValue,
      replacing,
      searchPrefs.isCaseSensitive,
      searchPrefs.isRegex,
      searchPrefs.matchWholeWord,
      searchPrefs.preserveCase,
    ],
  )

  const openHitMenu = useCallback(
    (event: MouseEvent, hit: VscodeWorkspaceSearchHit) => {
      event.preventDefault()
      event.stopPropagation()
      showIconContextMenu(event, [
        {
          type: 'action',
          label: '关闭结果',
          onClick: () => {
            setDismissedKeys((prev) => new Set(prev).add(hitKey(hit)))
          },
        },
        {
          type: 'action',
          label: '替换',
          onClick: () => void replaceOne(hit),
        },
      ])
    },
    [replaceOne, showIconContextMenu],
  )

  const replaceInFile = useCallback(
    async (group: FileGroup) => {
      if (!query.trim() || replacing) return
      setReplacing(true)
      rememberQuery()
      rememberReplace()
      try {
        const openText = openTextForPath(group.path)
        const result = await applyReplaceToTarget(
          { path: group.path, openText },
          query,
          replaceValue,
          {
            isCaseSensitive: searchPrefs.isCaseSensitive,
            matchWholeWord: searchPrefs.matchWholeWord,
            isRegex: searchPrefs.isRegex,
            preserveCase: searchPrefs.preserveCase,
          },
        )
        if (!result) return
        if (result.fromOpenTab) onUpdateOpenFileText(group.path, result.text)
        setDismissedKeys((prev) => {
          const next = new Set(prev)
          for (const hit of group.hits) next.add(hitKey(hit))
          return next
        })
      } finally {
        setReplacing(false)
      }
    },
    [
      onUpdateOpenFileText,
      openTextForPath,
      query,
      rememberQuery,
      rememberReplace,
      replaceValue,
      replacing,
      searchPrefs.isCaseSensitive,
      searchPrefs.isRegex,
      searchPrefs.matchWholeWord,
      searchPrefs.preserveCase,
    ],
  )

  const replaceAll = useCallback(async () => {
    if (!query.trim() || replacing || groups.length === 0) return
    setReplacing(true)
    rememberQuery()
    rememberReplace()
    try {
      for (const group of groups) {
        const openText = openTextForPath(group.path)
        const result = await applyReplaceToTarget(
          { path: group.path, openText },
          query,
          replaceValue,
          {
            isCaseSensitive: searchPrefs.isCaseSensitive,
            matchWholeWord: searchPrefs.matchWholeWord,
            isRegex: searchPrefs.isRegex,
            preserveCase: searchPrefs.preserveCase,
          },
        )
        if (result?.fromOpenTab) onUpdateOpenFileText(group.path, result.text)
      }
      setDismissedKeys(new Set(allHits.map(hitKey)))
    } finally {
      setReplacing(false)
    }
  }, [
    allHits,
    groups,
    onUpdateOpenFileText,
    openTextForPath,
    query,
    rememberQuery,
    rememberReplace,
    replaceValue,
    replacing,
    searchPrefs.isCaseSensitive,
    searchPrefs.isRegex,
    searchPrefs.matchWholeWord,
    searchPrefs.preserveCase,
  ])

  const onQueryKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const history = searchPrefs.searchHistory
        if (history.length === 0) return
        event.preventDefault()
        const current = historyIndexRef.current
        const next =
          event.key === 'ArrowUp'
            ? current < 0
              ? 0
              : Math.min(current + 1, history.length - 1)
            : current <= 0
              ? -1
              : current - 1
        historyIndexRef.current = next
        if (next >= 0) setQuery(history[next] ?? '')
        return
      }
      if (event.key === 'Enter') {
        rememberQuery()
      }
    },
    [rememberQuery, searchPrefs.searchHistory],
  )

  const changedFilesDisabled = dirtyPaths.size === 0

  return (
    <div class="vscode__search">
      <div class="vscode__sidebar-header">搜索</div>

      <div class="vscode__search-query-row">
        <button
          type="button"
          class={`vscode__search-toggle-replace${searchPrefs.showReplace ? ' vscode__search-toggle-replace--open' : ''}`}
          title="切换替换"
          aria-expanded={searchPrefs.showReplace}
          onClick={() => onPatchSearchPrefs({ showReplace: !searchPrefs.showReplace })}
        >
          ▸
        </button>
        <div class="vscode__search-input-wrap">
          <input
            ref={queryRef}
            class="vscode__search-input"
            type="search"
            placeholder="搜索"
            value={query}
            onInput={(event) => {
              historyIndexRef.current = -1
              setQuery((event.target as HTMLInputElement).value)
            }}
            onKeyDown={onQueryKeyDown}
            onBlur={rememberQuery}
          />
        </div>
      </div>

      {searchPrefs.showReplace ? (
        <div class="vscode__search-replace-row">
          <div class="vscode__search-input-wrap">
            <input
              ref={replaceRef}
              class="vscode__search-input"
              type="text"
              placeholder="替换"
              value={replaceValue}
              onInput={(event) => setReplaceValue((event.target as HTMLInputElement).value)}
              onBlur={rememberReplace}
            />
            <div class="vscode__search-toggles">
              <button
                type="button"
                class={`vscode__search-toggle${searchPrefs.preserveCase ? ' vscode__search-toggle--on' : ''}`}
                title="保留大小写"
                aria-pressed={searchPrefs.preserveCase}
                onClick={() => onPatchSearchPrefs({ preserveCase: !searchPrefs.preserveCase })}
              >
                AB
              </button>
              <button
                type="button"
                class="vscode__search-action-btn"
                title="全部替换"
                disabled={replacing || resultCount === 0}
                onClick={() => void replaceAll()}
              >
                全部
              </button>
            </div>
          </div>
        </div>
      ) : undefined}

      <button
        type="button"
        class="vscode__search-advanced-toggle"
        aria-expanded={searchPrefs.showDetails}
        onClick={() => onPatchSearchPrefs({ showDetails: !searchPrefs.showDetails })}
      >
        {searchPrefs.showDetails ? '▾' : '▸'} 高级选项
      </button>

      {searchPrefs.showDetails ? (
        <div class="vscode__search-advanced">
          <div class="vscode__search-advanced-label">匹配</div>
          <div class="vscode__search-toggles" role="group" aria-label="匹配选项">
            <button
              type="button"
              class={`vscode__search-toggle${searchPrefs.isCaseSensitive ? ' vscode__search-toggle--on' : ''}`}
              title="区分大小写"
              aria-pressed={searchPrefs.isCaseSensitive}
              onClick={() =>
                onPatchSearchPrefs({ isCaseSensitive: !searchPrefs.isCaseSensitive })
              }
            >
              Aa
            </button>
            <button
              type="button"
              class={`vscode__search-toggle${searchPrefs.matchWholeWord ? ' vscode__search-toggle--on' : ''}`}
              title="全字匹配"
              aria-pressed={searchPrefs.matchWholeWord}
              onClick={() =>
                onPatchSearchPrefs({ matchWholeWord: !searchPrefs.matchWholeWord })
              }
            >
              ab
            </button>
            <button
              type="button"
              class={`vscode__search-toggle${searchPrefs.isRegex ? ' vscode__search-toggle--on' : ''}`}
              title="使用正则表达式"
              aria-pressed={searchPrefs.isRegex}
              onClick={() => onPatchSearchPrefs({ isRegex: !searchPrefs.isRegex })}
            >
              .*
            </button>
          </div>

          <label class="vscode__search-detail-field">
            <span>要包含的文件</span>
            <input
              class="vscode__search-input vscode__search-input--detail"
              type="text"
              placeholder="例如 *.ts, src"
              value={filesToInclude}
              onInput={(event) => setFilesToInclude((event.target as HTMLInputElement).value)}
            />
          </label>
          <label class="vscode__search-detail-field">
            <span>要排除的文件</span>
            <div class="vscode__search-input-wrap">
              <input
                class="vscode__search-input vscode__search-input--detail"
                type="text"
                placeholder="例如 dist, *.min.js"
                value={filesToExclude}
                onInput={(event) => setFilesToExclude((event.target as HTMLInputElement).value)}
              />
              <button
                type="button"
                class={`vscode__search-toggle${searchPrefs.useExcludeSettingsAndIgnoreFiles ? ' vscode__search-toggle--on' : ''}`}
                title="使用排除设置与忽略文件"
                aria-pressed={searchPrefs.useExcludeSettingsAndIgnoreFiles}
                onClick={() =>
                  onPatchSearchPrefs({
                    useExcludeSettingsAndIgnoreFiles:
                      !searchPrefs.useExcludeSettingsAndIgnoreFiles,
                  })
                }
              >
                ⚙
              </button>
            </div>
          </label>
          <label class="vscode__search-check">
            <input
              type="checkbox"
              checked={searchPrefs.onlyOpenEditors}
              onChange={(event) =>
                onPatchSearchPrefs({
                  onlyOpenEditors: (event.target as HTMLInputElement).checked,
                })
              }
            />
            仅搜索打开的编辑器
          </label>
          <label class={`vscode__search-check${changedFilesDisabled ? ' vscode__search-check--disabled' : ''}`}>
            <input
              type="checkbox"
              checked={searchPrefs.onlyChangedFiles}
              disabled={changedFilesDisabled}
              onChange={(event) =>
                onPatchSearchPrefs({
                  onlyChangedFiles: (event.target as HTMLInputElement).checked,
                })
              }
            />
            仅搜索已更改的文件
          </label>
        </div>
      ) : undefined}

      {patternError ? <div class="vscode__search-error">{patternError}</div> : undefined}

      <div class="vscode__search-summary">
        <span>
          {query.trim()
            ? loading
              ? `搜索中…（已找到 ${resultCount} 个结果）`
              : `${resultCount} 个结果，${fileCount} 个文件`
            : '输入以搜索工作区'}
        </span>
        {allHits.length > 0 ? (
          <button
            type="button"
            class="vscode__search-summary-link"
            onClick={() => {
              rememberQuery()
              onOpenSearchEditor({
                query,
                isCaseSensitive: searchPrefs.isCaseSensitive,
                matchWholeWord: searchPrefs.matchWholeWord,
                isRegex: searchPrefs.isRegex,
                filesToInclude,
                filesToExclude,
                useExcludeSettingsAndIgnoreFiles: searchPrefs.useExcludeSettingsAndIgnoreFiles,
                hits: allHits,
              })
            }}
          >
            在编辑器中打开
          </button>
        ) : undefined}
      </div>

      <div class="vscode__search-results">
        {groups.map((group) => {
          const collapsed = collapsedPaths.has(group.path)
          return (
            <div key={group.path} class="vscode__search-file">
              <div class="vscode__search-file-row">
                <button
                  type="button"
                  class="vscode__search-file-head"
                  onClick={() => toggleCollapsed(group.path)}
                  onContextMenu={(event) => openGroupMenu(event, group)}
                >
                  <span class="vscode__search-twistie">{collapsed ? '▸' : '▾'}</span>
                  <span class="vscode__search-file-name">{group.name}</span>
                  <span class="vscode__search-file-count">{group.hits.length}</span>
                </button>
                {searchPrefs.showReplace ? (
                  <button
                    type="button"
                    class="vscode__search-file-replace"
                    title="替换此文件中的全部"
                    disabled={replacing}
                    onClick={() => void replaceInFile(group)}
                  >
                    替换
                  </button>
                ) : undefined}
              </div>
              {!collapsed
                ? group.hits.map((hit) => {
                    const after =
                      searchPrefs.showReplace && replaceValue !== undefined
                        ? previewReplaceLine(
                            hit.preview,
                            hit.matchedText,
                            query,
                            replaceValue,
                            {
                              isCaseSensitive: searchPrefs.isCaseSensitive,
                              matchWholeWord: searchPrefs.matchWholeWord,
                              isRegex: searchPrefs.isRegex,
                              preserveCase: searchPrefs.preserveCase,
                            },
                          )
                        : undefined
                    return (
                      <div key={hitKey(hit)} class="vscode__search-hit-row">
                        <button
                          type="button"
                          class="vscode__search-hit"
                          onClick={() => onOpenHit(hit)}
                          onContextMenu={(event) => openHitMenu(event, hit)}
                        >
                          <span class="vscode__search-hit-line">{hit.line}</span>
                          <span class="vscode__search-hit-preview">
                            {highlightPreview(hit.preview, hit.matchedText)}
                          </span>
                          {after !== undefined && after !== hit.preview ? (
                            <span class="vscode__search-hit-after">{after}</span>
                          ) : undefined}
                        </button>
                        {searchPrefs.showReplace ? (
                          <button
                            type="button"
                            class="vscode__search-hit-replace"
                            title="替换"
                            disabled={replacing}
                            onClick={() => void replaceOne(hit)}
                          >
                            ↵
                          </button>
                        ) : undefined}
                      </div>
                    )
                  })
                : undefined}
            </div>
          )
        })}
        {query.trim() && !loading && !patternError && allHits.length === 0 ? (
          <div class="vscode__tree-hint">无匹配</div>
        ) : undefined}
      </div>
    </div>
  )
}
