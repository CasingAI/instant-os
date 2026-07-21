import { useMemo } from 'preact/hooks'
import {
  buildUnifiedDiffLines,
  diffLineNumberWidth,
  parseUnifiedPatch,
  type GithubDiffLine,
} from './github-diff.ts'

export type GithubDesktopDiffViewProps = {
  /** Changes：两侧全文；与 patch 二选一 */
  original?: string
  modified?: string
  /** History：unified patch 文本 */
  patch?: string
  className?: string
}

function linePrefix(kind: GithubDiffLine['kind']): string {
  if (kind === 'added') return '+'
  if (kind === 'deleted') return '-'
  if (kind === 'context') return '\u00a0'
  return ''
}

function renderLineText(line: GithubDiffLine) {
  const { text, innerRange } = line
  if (!innerRange || innerRange.length <= 0) {
    return text.length === 0 ? '\u00a0' : text
  }
  const before = text.slice(0, innerRange.start)
  const mid = text.slice(innerRange.start, innerRange.start + innerRange.length)
  const after = text.slice(innerRange.start + innerRange.length)
  const innerClass =
    line.kind === 'added'
      ? 'github-desktop__diff-inner github-desktop__diff-inner--add'
      : 'github-desktop__diff-inner github-desktop__diff-inner--del'
  return (
    <>
      {before}
      <span class={innerClass}>{mid.length === 0 ? '\u00a0' : mid}</span>
      {after}
    </>
  )
}

function DiffRow({
  line,
  gutterWidth,
}: {
  line: GithubDiffLine
  gutterWidth: number
}) {
  if (line.kind === 'hunk') {
    return (
      <div class="github-desktop__diff-row github-desktop__diff-row--hunk" role="row">
        <div
          class="github-desktop__diff-hunk-gutter"
          style={{ width: gutterWidth * 2 }}
        />
        <div class="github-desktop__diff-content">
          <span class="github-desktop__diff-prefix">{'\u00a0'}</span>
          <span class="github-desktop__diff-text">{line.text}</span>
        </div>
      </div>
    )
  }

  const rowMod =
    line.kind === 'added'
      ? 'github-desktop__diff-row--added'
      : line.kind === 'deleted'
        ? 'github-desktop__diff-row--deleted'
        : 'github-desktop__diff-row--context'

  const oldNum = line.oldLineNumber !== undefined ? String(line.oldLineNumber) : ''
  const newNum = line.newLineNumber !== undefined ? String(line.newLineNumber) : ''

  return (
    <div class={`github-desktop__diff-row ${rowMod}`} role="row">
      <div class="github-desktop__diff-gutter" style={{ width: gutterWidth * 2 }}>
        <span class="github-desktop__diff-linenum" style={{ width: gutterWidth }}>
          {oldNum}
        </span>
        <span class="github-desktop__diff-linenum" style={{ width: gutterWidth }}>
          {newNum}
        </span>
      </div>
      <div class="github-desktop__diff-content">
        <span class="github-desktop__diff-prefix">{linePrefix(line.kind)}</span>
        <span class="github-desktop__diff-text">{renderLineText(line)}</span>
      </div>
    </div>
  )
}

/**
 * 自定义 Unified Diff 视图（对齐 GitHub Desktop，不用 Monaco）。
 * 传入 original/modified 或 patch。
 */
export function GithubDesktopDiffView({
  original = '',
  modified = '',
  patch,
  className,
}: GithubDesktopDiffViewProps) {
  const lines = useMemo(() => {
    if (patch !== undefined) {
      return parseUnifiedPatch(patch)
    }
    return buildUnifiedDiffLines(original, modified)
  }, [original, modified, patch])

  const gutterWidth = useMemo(() => diffLineNumberWidth(lines), [lines])

  if (lines.length === 0) {
    return (
      <div class={className ?? 'github-desktop__diff-view'}>
        <div class="github-desktop__diff-empty-inline">没有可显示的差异</div>
      </div>
    )
  }

  return (
    <div class={`github-desktop__diff-view ${className ?? ''}`.trim()} role="table">
      <div class="github-desktop__diff-rows">
        {lines.map((line, index) => (
          <DiffRow key={index} line={line} gutterWidth={gutterWidth} />
        ))}
      </div>
    </div>
  )
}
