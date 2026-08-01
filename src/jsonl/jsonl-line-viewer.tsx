import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  disposeMonacoModelForPath,
  MonacoEditor,
  type MonacoEditorTheme,
} from '../monaco/monaco-editor.tsx'
import { FixedRowVirtualList } from '../ui/fixed-row-virtual-list.tsx'
import { indexJsonlLines, parseJsonlLine, type JsonlLineEntry } from './parse-jsonl-lines.ts'
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

/** 活动行值缓存窗口（±N 条），避免来回导航反复 JSON.parse */
const VALUE_CACHE_WINDOW = 8

/**
 * JSONL 行查看器：左侧虚拟化行号导航列表 + 右侧只读 Monaco 编辑器（当前行）。
 * 超大文件友好：全量只建轻量索引，值按需解析并窗口缓存，列表虚拟化、Monaco 单实例。
 */
export function JsonlLineViewer({ text, modelPath, prefs, active = true }: JsonlLineViewerProps) {
  const entries = useMemo(() => indexJsonlLines(text), [text])
  const [activeIndex, setActiveIndex] = useState(0)
  const [jumpText, setJumpText] = useState('')

  const safeIndex =
    entries.length === 0 ? -1 : Math.min(Math.max(0, activeIndex), entries.length - 1)

  // text 变化（编辑后切回预览）时索引重建，旧值缓存一并作废
  const entriesRef = useRef(entries)
  const valueCacheRef = useRef(new Map<number, unknown>())
  if (entriesRef.current !== entries) {
    entriesRef.current = entries
    valueCacheRef.current.clear()
  }

  const goTo = (index: number) => {
    if (entries.length === 0) return
    setActiveIndex(Math.min(Math.max(0, index), entries.length - 1))
  }

  const errorIndices = useMemo(() => {
    const indices: number[] = []
    for (let i = 0; i < entries.length; i += 1) {
      if (!entries[i].ok) indices.push(i)
    }
    return indices
  }, [entries])

  const entry: JsonlLineEntry | undefined = safeIndex >= 0 ? entries[safeIndex] : undefined

  let displayText = ''
  if (entry) {
    if (entry.ok) {
      const cached = valueCacheRef.current.get(safeIndex)
      let value = cached
      if (value === undefined) {
        try {
          value = parseJsonlLine(entry.raw)
        } catch {
          value = undefined
        }
        valueCacheRef.current.set(safeIndex, value)
      }
      for (const key of [...valueCacheRef.current.keys()]) {
        if (Math.abs(key - safeIndex) > VALUE_CACHE_WINDOW) {
          valueCacheRef.current.delete(key)
        }
      }
      displayText = value === undefined ? entry.raw : JSON.stringify(value, null, 2)
    } else {
      displayText = entry.raw
    }
  }

  // 释放独占的预览 model（组件卸载时 MonacoEditor 已先 dispose editor）
  useEffect(() => {
    return () => {
      disposeMonacoModelForPath(modelPath)
    }
  }, [modelPath])

  if (entries.length === 0) {
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
    goTo(current ?? errorIndices[0])
  }

  const onKeyDownCapture = (event: KeyboardEvent) => {
    const prev = event.key === 'PageUp' || (event.key === 'ArrowUp' && event.altKey)
    const next = event.key === 'PageDown' || (event.key === 'ArrowDown' && event.altKey)
    if (!prev && !next) return
    event.preventDefault()
    event.stopPropagation()
    goTo(safeIndex + (next ? 1 : -1))
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
      <div class="jsonl-line-viewer__body">
        <FixedRowVirtualList
          className="jsonl-line-viewer__nav"
          items={entries}
          itemKey={(item) => String(item.line)}
          rowHeight={22}
          scrollToIndex={safeIndex}
          renderItem={(item, index) => (
            <button
              type="button"
              class={`jsonl-line-viewer__nav-row${index === safeIndex ? ' jsonl-line-viewer__nav-row--active' : ''}${item.ok ? '' : ' jsonl-line-viewer__nav-row--error'}`}
              title={`第 ${item.line} 行${item.ok ? '' : `（错误：${item.message}）`}`}
              onClick={() => goTo(index)}
            >
              <span class="jsonl-line-viewer__nav-line">{item.line}</span>
              {item.ok ? undefined : (
                <span class="jsonl-line-viewer__nav-dot" aria-hidden="true" />
              )}
            </button>
          )}
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
