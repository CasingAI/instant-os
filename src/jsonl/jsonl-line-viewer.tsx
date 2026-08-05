import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import {
  disposeMonacoModelForPath,
  MonacoEditor,
  type MonacoEditorTheme,
} from '../monaco/monaco-editor.tsx'
import { FixedRowVirtualList } from '../ui/fixed-row-virtual-list.tsx'
import {
  entryRaw,
  parseJsonlLine,
  stringFieldFromValue,
  type JsonlLineEntry,
} from './parse-jsonl-lines.ts'
import {
  JSONL_NAV_PREVIEW_MAX,
  JSONL_PARSE_CACHE_WINDOW,
  JSONL_PRETTY_MAX_BYTES,
} from './jsonl-perf.ts'
import { useJsonlIndex } from './use-jsonl-index.ts'
import './jsonl-line-viewer.css'

export type JsonlViewerPrefs = {
  theme: MonacoEditorTheme
  fontSize: number
  minimap: boolean
  wordWrap: boolean
}

type JsonlLineViewerProps = {
  text: string
  /** 唯一合成 modelPath（调用方保证不与他人共享） */
  modelPath: string
  prefs: JsonlViewerPrefs
  active?: boolean
}

const NAV_WIDTH_STORAGE_KEY = 'vscode.jsonl.navWidth'
const NAV_WIDTH_DEFAULT = 200
const NAV_WIDTH_MIN = 80
const NAV_WIDTH_MAX = 360

function clampNavWidth(width: number, bodyWidth?: number): number {
  const half = bodyWidth !== undefined ? Math.floor(bodyWidth * 0.5) : NAV_WIDTH_MAX
  const max = Math.max(NAV_WIDTH_MIN, Math.min(NAV_WIDTH_MAX, half))
  return Math.min(max, Math.max(NAV_WIDTH_MIN, Math.round(width)))
}

function loadNavWidth(): number {
  try {
    const raw = localStorage.getItem(NAV_WIDTH_STORAGE_KEY)
    if (!raw) return NAV_WIDTH_DEFAULT
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed)) return NAV_WIDTH_DEFAULT
    return clampNavWidth(parsed)
  } catch {
    return NAV_WIDTH_DEFAULT
  }
}

function saveNavWidth(width: number): void {
  try {
    localStorage.setItem(NAV_WIDTH_STORAGE_KEY, String(width))
  } catch {
    // quota / private mode
  }
}

function formatDisplayValue(value: unknown, raw: string): string {
  if (value === undefined) {
    if (raw.length > JSONL_PRETTY_MAX_BYTES) {
      return `${raw.slice(0, JSONL_PRETTY_MAX_BYTES)}…\n\n/* 行过大，已截断 */`
    }
    return raw
  }
  if (raw.length > JSONL_PRETTY_MAX_BYTES) {
    try {
      return JSON.stringify(value)
    } catch {
      return `${raw.slice(0, JSONL_PRETTY_MAX_BYTES)}…\n\n/* 行过大，未展开 */`
    }
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return raw
  }
}

/**
 * JSONL 行查看器：左侧虚拟化序号+字段预览导航 + 右侧只读 Monaco（当前行）。
 * 超大文件友好：行偏移索引（Worker/主线程）+ 共享解析缓存 + 列表虚拟化 + Monaco 单实例。
 */
export function JsonlLineViewer({ text, modelPath, prefs, active = true }: JsonlLineViewerProps) {
  const {
    entries,
    availableKeys,
    errorIndices,
    defaultPreviewKey,
    indexing,
    progressLines,
  } = useJsonlIndex(text)

  const [activeIndex, setActiveIndex] = useState(0)
  const [jumpText, setJumpText] = useState('')
  const [navWidth, setNavWidth] = useState(loadNavWidth)
  const [previewKey, setPreviewKey] = useState<string | undefined>(undefined)
  const [keyMenuOpen, setKeyMenuOpen] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const keyMenuRef = useRef<HTMLDivElement>(null)

  const safeIndex =
    entries.length === 0 ? -1 : Math.min(Math.max(0, activeIndex), entries.length - 1)

  /** 行号 → 解析对象；导航预览与主视图共用 */
  const parseCacheRef = useRef(new Map<number, unknown>())
  /** `${index}\0${previewKey}` → 截断预览；按 key 分桶，切换字段不清空其它桶 */
  const previewCacheRef = useRef(new Map<string, string>())
  const indexedEntriesRef = useRef(entries)

  // 索引结果替换时同步清缓存，避免 useMemo 读到旧 text 的解析结果
  if (indexedEntriesRef.current !== entries) {
    indexedEntriesRef.current = entries
    parseCacheRef.current.clear()
    previewCacheRef.current.clear()
  }

  useEffect(() => {
    setKeyMenuOpen(false)
    setPreviewKey(defaultPreviewKey)
  }, [entries, defaultPreviewKey])

  const goTo = (index: number) => {
    if (entries.length === 0) return
    setActiveIndex(Math.min(Math.max(0, index), entries.length - 1))
  }

  const pruneParseCache = (around: number) => {
    for (const key of [...parseCacheRef.current.keys()]) {
      if (Math.abs(key - around) > JSONL_PARSE_CACHE_WINDOW) {
        parseCacheRef.current.delete(key)
      }
    }
  }

  const getParsed = (index: number, item: JsonlLineEntry): unknown => {
    if (!item.ok) return undefined
    if (parseCacheRef.current.has(index)) {
      return parseCacheRef.current.get(index)
    }
    let value: unknown
    try {
      value = parseJsonlLine(entryRaw(text, item))
    } catch {
      value = undefined
    }
    parseCacheRef.current.set(index, value)
    pruneParseCache(index)
    return value
  }

  const entry: JsonlLineEntry | undefined = safeIndex >= 0 ? entries[safeIndex] : undefined

  let displayText = ''
  if (entry) {
    const raw = entryRaw(text, entry)
    if (!entry.ok) {
      displayText = raw
    } else {
      displayText = formatDisplayValue(getParsed(safeIndex, entry), raw)
    }
  }

  const previewForRow = (item: JsonlLineEntry, index: number): string => {
    if (!item.ok || !previewKey) return ''
    const cacheKey = `${index}\0${previewKey}`
    if (previewCacheRef.current.has(cacheKey)) {
      return previewCacheRef.current.get(cacheKey) ?? ''
    }
    const parsed = getParsed(index, item)
    const value =
      stringFieldFromValue(parsed, previewKey, { maxLength: JSONL_NAV_PREVIEW_MAX }) ?? ''
    previewCacheRef.current.set(cacheKey, value)
    if (previewCacheRef.current.size > 400) {
      for (const key of [...previewCacheRef.current.keys()]) {
        const row = Number.parseInt(key, 10)
        if (!Number.isFinite(row) || Math.abs(row - safeIndex) > JSONL_PARSE_CACHE_WINDOW) {
          previewCacheRef.current.delete(key)
        }
      }
    }
    return value
  }

  useEffect(() => {
    return () => {
      disposeMonacoModelForPath(modelPath)
    }
  }, [modelPath])

  useEffect(() => {
    if (!keyMenuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const root = keyMenuRef.current
      if (!root) return
      if (event.target instanceof Node && root.contains(event.target)) return
      setKeyMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setKeyMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [keyMenuOpen])

  const onNavSashPointerDown = useCallback((event: PointerEvent) => {
    const sash = event.currentTarget as HTMLElement
    const body = bodyRef.current
    if (!body) return
    event.preventDefault()
    sash.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startWidth = navWidth
    const bodyWidth = body.getBoundingClientRect().width

    const onMove = (moveEvent: PointerEvent) => {
      const next = clampNavWidth(startWidth + (moveEvent.clientX - startX), bodyWidth)
      setNavWidth(next)
    }
    const onUp = (upEvent: PointerEvent) => {
      sash.releasePointerCapture(upEvent.pointerId)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setNavWidth((current) => {
        saveNavWidth(current)
        return current
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [navWidth])

  if (indexing && entries.length === 0) {
    return (
      <div class="jsonl-line-viewer jsonl-line-viewer--empty" role="status">
        索引中…{progressLines > 0 ? `（已处理 ${progressLines} 条）` : ''}
      </div>
    )
  }

  if (!indexing && entries.length === 0) {
    return <div class="jsonl-line-viewer jsonl-line-viewer--empty">空文件</div>
  }

  const commitJump = () => {
    const value = Number.parseInt(jumpText, 10)
    if (!Number.isFinite(value)) return
    const clamped = Math.min(Math.max(1, value), entries.length)
    goTo(clamped - 1)
    setJumpText(String(clamped))
  }

  const goNextError = () => {
    if (errorIndices.length === 0) return
    const current = errorIndices.find((index) => index > safeIndex)
    goTo(current ?? errorIndices[0]!)
  }

  const onKeyDownCapture = (event: KeyboardEvent) => {
    const prev = event.key === 'PageUp' || (event.key === 'ArrowUp' && event.altKey)
    const next = event.key === 'PageDown' || (event.key === 'ArrowDown' && event.altKey)
    if (!prev && !next) return
    event.preventDefault()
    event.stopPropagation()
    goTo(safeIndex + (next ? 1 : -1))
  }

  const selectPreviewKey = (key: string) => {
    setPreviewKey(key)
    setKeyMenuOpen(false)
  }

  return (
    <div class="jsonl-line-viewer" onKeyDownCapture={onKeyDownCapture}>
      <div class="jsonl-line-viewer__toolbar" role="toolbar" aria-label="JSONL 行导航">
        <button
          type="button"
          class="jsonl-line-viewer__btn"
          aria-label="上一行"
          title="上一行（PgUp / ⌥↑）"
          disabled={safeIndex <= 0}
          onClick={() => goTo(safeIndex - 1)}
        >
          ◀
        </button>
        <span class="jsonl-line-viewer__counter">
          第 {safeIndex + 1} / {entries.length} 条
          {indexing ? ' · 索引中…' : ''}
        </span>
        <button
          type="button"
          class="jsonl-line-viewer__btn"
          aria-label="下一行"
          title="下一行（PgDn / ⌥↓）"
          disabled={safeIndex >= entries.length - 1}
          onClick={() => goTo(safeIndex + 1)}
        >
          ▶
        </button>
        <input
          type="number"
          class="jsonl-line-viewer__jump"
          min={1}
          max={entries.length}
          value={jumpText}
          placeholder="跳转"
          aria-label="跳到第几条"
          onInput={(event) => setJumpText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitJump()
          }}
          onBlur={commitJump}
        />
        <span class="jsonl-line-viewer__error-count" role="status">
          {errorIndices.length > 0 ? `⚠ ${errorIndices.length} 行错误` : ''}
        </span>
        <button
          type="button"
          class="jsonl-line-viewer__btn jsonl-line-viewer__btn--next-error"
          aria-label="下一处错误"
          disabled={errorIndices.length === 0}
          onClick={goNextError}
        >
          下一处错误
        </button>
      </div>
      <div class="jsonl-line-viewer__body" ref={bodyRef}>
        <div class="jsonl-line-viewer__nav-pane" style={{ width: `${navWidth}px` }}>
          <div class="jsonl-line-viewer__nav-header">
            <span class="jsonl-line-viewer__nav-index" aria-hidden="true">
              #
            </span>
            <div class="jsonl-line-viewer__nav-key-wrap" ref={keyMenuRef}>
              {availableKeys.length > 0 && previewKey ? (
                <button
                  type="button"
                  class="jsonl-line-viewer__nav-key-btn"
                  aria-haspopup="listbox"
                  aria-expanded={keyMenuOpen}
                  title="切换预览字段"
                  onClick={() => setKeyMenuOpen((open) => !open)}
                >
                  <span class="jsonl-line-viewer__nav-key-label">{previewKey}</span>
                  <span class="jsonl-line-viewer__nav-key-caret" aria-hidden="true">
                    ▾
                  </span>
                </button>
              ) : (
                <span class="jsonl-line-viewer__nav-key-static">预览</span>
              )}
              {keyMenuOpen && availableKeys.length > 0 ? (
                <ul class="jsonl-line-viewer__nav-key-menu" role="listbox" aria-label="预览字段">
                  {availableKeys.map((key) => (
                    <li key={key} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={key === previewKey}
                        class={`jsonl-line-viewer__nav-key-option${key === previewKey ? ' jsonl-line-viewer__nav-key-option--active' : ''}`}
                        onClick={() => selectPreviewKey(key)}
                      >
                        {key}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : undefined}
            </div>
          </div>
          <FixedRowVirtualList
            className="jsonl-line-viewer__nav"
            items={entries}
            itemKey={(item) => String(item.line)}
            rowHeight={22}
            scrollToIndex={safeIndex}
            renderItem={(item, index) => {
              const preview = previewForRow(item, index)
              const titleParts = [`第 ${item.line} 行`]
              if (!item.ok && item.message) titleParts.push(`错误：${item.message}`)
              return (
                <button
                  type="button"
                  class={`jsonl-line-viewer__nav-row${index === safeIndex ? ' jsonl-line-viewer__nav-row--active' : ''}${item.ok ? '' : ' jsonl-line-viewer__nav-row--error'}`}
                  title={titleParts.join(' · ')}
                  onClick={() => goTo(index)}
                >
                  <span class="jsonl-line-viewer__nav-index">{index + 1}</span>
                  <span class="jsonl-line-viewer__nav-preview">{preview}</span>
                  {item.ok ? undefined : (
                    <span class="jsonl-line-viewer__nav-dot" aria-hidden="true" />
                  )}
                </button>
              )
            }}
          />
        </div>
        <div
          class="jsonl-line-viewer__sash"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整行号栏宽度"
          aria-valuenow={navWidth}
          aria-valuemin={NAV_WIDTH_MIN}
          aria-valuemax={NAV_WIDTH_MAX}
          onPointerDown={onNavSashPointerDown}
        />
        <div class="jsonl-line-viewer__main">
          {entry && !entry.ok ? (
            <div class="jsonl-line-viewer__error-banner" role="status">
              第 {entry.line} 行解析失败：{entry.message}
            </div>
          ) : undefined}
          <MonacoEditor
            className="jsonl-line-viewer__monaco"
            value={displayText}
            onChange={() => undefined}
            language="jsonl"
            modelPath={modelPath}
            readOnly
            theme={prefs.theme}
            fontSize={prefs.fontSize}
            minimap={prefs.minimap}
            wordWrap={prefs.wordWrap ? 'on' : 'off'}
            active={active}
          />
        </div>
      </div>
    </div>
  )
}
