import { useEffect, useMemo, useState } from 'preact/hooks'
import { filesReadText } from '../files/files-api.ts'
import {
  buildUnifiedDiffLines,
  diffLineNumberWidth,
  type GithubDiffLine,
} from '../github-desktop/github-diff.ts'
import { isProbablyTextBytes } from '../github-desktop/github-working-tree.ts'
import type { TerminalChangeKind, TerminalChangeSet } from '../../terminal/terminal-changeset.ts'
import {
  loadTerminalChangeSession,
  readBeforeBlobBytes,
} from '../../terminal/terminal-changeset-store.ts'
import type { VscodeAiLastChangeSource } from './vscode-ai-run-command.ts'
import type { VscodeAiTerminalChangeReview } from './vscode-ai-chat-storage.ts'

type ReviewFile = VscodeAiTerminalChangeReview['files'][number]

const KIND_LABEL: Record<TerminalChangeKind, string> = {
  added: '新增',
  modified: '修改',
  deleted: '删除',
  renamed: '重命名',
}

export function buildVscodeAiTerminalChangeReview(
  changeSet: TerminalChangeSet,
  source: VscodeAiLastChangeSource,
): VscodeAiTerminalChangeReview {
  return {
    sessionId: changeSet.sessionId,
    source,
    sealedAt: changeSet.sealedAt ?? changeSet.createdAt,
    status: 'pending',
    files: changeSet.changes.map((entry) => ({
      path: entry.path,
      kind: entry.kind,
      fromPath: entry.fromPath,
      beforeBlobId: entry.beforeBlobId,
      isDirectory: entry.meta?.isDirectory === true,
      byteSize: entry.meta?.byteSize,
    })),
  }
}

export type VscodeAiFileDiffSides = {
  original: string
  modified: string
  notice?: string
}

export async function loadVscodeAiFileDiffSides(file: {
  path: string
  kind: TerminalChangeKind
  beforeBlobId?: string
  isDirectory?: boolean
}): Promise<VscodeAiFileDiffSides> {
  if (file.isDirectory) {
    return {
      original: '',
      modified: '',
      notice: '目录变更，无法显示文本 diff',
    }
  }

  let beforeBytes: Uint8Array | undefined
  if (file.beforeBlobId) {
    beforeBytes = await readBeforeBlobBytes(file.beforeBlobId)
  }

  if (beforeBytes && !isProbablyTextBytes(beforeBytes)) {
    return { original: '', modified: '', notice: '二进制文件，无法显示文本 diff' }
  }

  const original =
    file.kind === 'added'
      ? ''
      : beforeBytes
        ? new TextDecoder().decode(beforeBytes)
        : ''

  if (file.kind === 'deleted') {
    return { original, modified: '' }
  }

  try {
    const modified = await filesReadText(file.path)
    const encoded = new TextEncoder().encode(modified)
    if (!isProbablyTextBytes(encoded)) {
      return { original, modified: '', notice: '当前文件为二进制，无法显示文本 diff' }
    }
    return { original, modified }
  } catch {
    return {
      original,
      modified: '',
      notice: file.kind === 'added' ? '无法读取新增文件内容' : '无法读取修改后的文件内容',
    }
  }
}

function linePrefix(kind: GithubDiffLine['kind']): string {
  if (kind === 'added') return '+'
  if (kind === 'deleted') return '-'
  if (kind === 'context') return '\u00a0'
  return ''
}

export function VscodeAiUnifiedDiffView({
  original,
  modified,
}: {
  original: string
  modified: string
}) {
  const lines = useMemo(
    () => buildUnifiedDiffLines(original, modified),
    [original, modified],
  )
  const gutterWidth = useMemo(() => diffLineNumberWidth(lines), [lines])

  if (lines.length === 0) {
    return <div class="vscode-ai__diff-empty">没有可显示的差异</div>
  }

  return (
    <div class="vscode-ai__diff-view" role="table">
      <div class="vscode-ai__diff-rows">
        {lines.map((line, index) => {
          if (line.kind === 'hunk') {
            return (
              <div key={index} class="vscode-ai__diff-row vscode-ai__diff-row--hunk">
                <div class="vscode-ai__diff-hunk" style={{ paddingLeft: gutterWidth * 2 }}>
                  {line.text}
                </div>
              </div>
            )
          }
          const rowMod =
            line.kind === 'added'
              ? 'vscode-ai__diff-row--added'
              : line.kind === 'deleted'
                ? 'vscode-ai__diff-row--deleted'
                : 'vscode-ai__diff-row--context'
          const oldNum = line.oldLineNumber !== undefined ? String(line.oldLineNumber) : ''
          const newNum = line.newLineNumber !== undefined ? String(line.newLineNumber) : ''
          return (
            <div key={index} class={`vscode-ai__diff-row ${rowMod}`}>
              <div class="vscode-ai__diff-gutter" style={{ width: gutterWidth * 2 }}>
                <span class="vscode-ai__diff-linenum" style={{ width: gutterWidth }}>
                  {oldNum}
                </span>
                <span class="vscode-ai__diff-linenum" style={{ width: gutterWidth }}>
                  {newNum}
                </span>
              </div>
              <div class="vscode-ai__diff-content">
                <span class="vscode-ai__diff-prefix">{linePrefix(line.kind)}</span>
                <span class="vscode-ai__diff-text">
                  {line.text.length === 0 ? '\u00a0' : line.text}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

async function loadReviewFilesFromSessions(
  sessionIds: readonly string[],
): Promise<ReviewFile[]> {
  const byPath = new Map<string, ReviewFile>()
  for (const sessionId of sessionIds) {
    const changeSet = await loadTerminalChangeSession(sessionId)
    if (!changeSet) continue
    for (const entry of changeSet.changes) {
      byPath.set(entry.path, {
        path: entry.path,
        kind: entry.kind,
        fromPath: entry.fromPath,
        beforeBlobId: entry.beforeBlobId,
        isDirectory: entry.meta?.isDirectory === true,
        byteSize: entry.meta?.byteSize,
      })
    }
  }
  return [...byPath.values()]
}

function ReviewFileDiff({
  file,
}: {
  file: ReviewFile
}) {
  const [sides, setSides] = useState<VscodeAiFileDiffSides | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setSides(undefined)
    setError(undefined)
    void loadVscodeAiFileDiffSides(file)
      .then((next) => {
        if (!cancelled) setSides(next)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      })
    return () => {
      cancelled = true
    }
  }, [file])

  if (error) {
    return <div class="vscode-ai__diff-notice">{error}</div>
  }
  if (!sides) {
    return <div class="vscode-ai__diff-empty">加载 diff…</div>
  }
  if (sides.notice) {
    return <div class="vscode-ai__diff-notice">{sides.notice}</div>
  }
  return <VscodeAiUnifiedDiffView original={sides.original} modified={sides.modified} />
}

/** 底部审查条「查看更改」：按 session 汇总待审文件并展示 diff */
export function VscodeAiPendingChangesPanel({
  sessionIds,
  onOpenPath,
}: {
  sessionIds: readonly string[]
  onOpenPath?: (path: string) => void
}) {
  const [files, setFiles] = useState<ReviewFile[]>([])
  const [error, setError] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [activePath, setActivePath] = useState<string | undefined>(undefined)

  const sessionKey = sessionIds.join('\0')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(undefined)
    const ids = sessionKey ? sessionKey.split('\0') : []
    void loadReviewFilesFromSessions(ids)
      .then((next) => {
        if (cancelled) return
        setFiles(next)
        setActivePath((current) =>
          current && next.some((file) => file.path === current)
            ? current
            : next[0]?.path,
        )
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionKey])

  const activeFile = files.find((file) => file.path === activePath) ?? files[0]

  if (loading) {
    return <div class="vscode-ai__review-changes vscode-ai__diff-empty">加载改动…</div>
  }
  if (error) {
    return <div class="vscode-ai__review-changes vscode-ai__diff-notice">{error}</div>
  }
  if (files.length === 0) {
    return <div class="vscode-ai__review-changes vscode-ai__diff-empty">没有可显示的改动</div>
  }

  return (
    <div class="vscode-ai__review-changes">
      <div class="vscode-ai__change-review-files" role="tablist" aria-label="变更文件">
        {files.map((file) => {
          const active = file.path === activeFile?.path
          return (
            <button
              key={file.path}
              type="button"
              role="tab"
              class={`vscode-ai__change-review-file${active ? ' vscode-ai__change-review-file--active' : ''}`}
              aria-selected={active}
              onClick={() => setActivePath(file.path)}
              onDblClick={() => onOpenPath?.(file.path)}
              title={onOpenPath ? '双击在编辑器中打开' : undefined}
            >
              <span class="vscode-ai__change-review-kind">{KIND_LABEL[file.kind]}</span>
              <span class="vscode-ai__change-review-path">
                {file.kind === 'renamed' && file.fromPath
                  ? `${file.fromPath} → ${file.path}`
                  : file.path}
              </span>
            </button>
          )
        })}
      </div>
      {activeFile ? <ReviewFileDiff file={activeFile} /> : undefined}
    </div>
  )
}

export function TerminalChangeReviewCard({
  review,
  onKeep,
  onRevert,
  busy,
}: {
  review: VscodeAiTerminalChangeReview
  onKeep: () => void
  onRevert: () => void
  busy?: boolean
}) {
  const [activePath, setActivePath] = useState(review.files[0]?.path)
  const activeFile =
    review.files.find((file) => file.path === activePath) ?? review.files[0]

  if (review.status === 'kept') {
    return (
      <div class="vscode-ai__edit-card vscode-ai__change-review">
        <div class="vscode-ai__edit-card-title">已保留本轮改动</div>
        <div class="vscode-ai__edit-card-path">
          {review.files.length} 个文件 · session={review.sessionId}
        </div>
      </div>
    )
  }
  if (review.status === 'reverted') {
    return (
      <div class="vscode-ai__edit-card vscode-ai__change-review">
        <div class="vscode-ai__edit-card-title">已撤销本轮改动</div>
        <div class="vscode-ai__edit-card-path">
          {review.files.length} 个文件 · session={review.sessionId}
        </div>
      </div>
    )
  }

  return (
    <div class="vscode-ai__edit-card vscode-ai__change-review">
      <div class="vscode-ai__edit-card-title">
        审查本轮改动（{review.source === 'npm' ? 'npm/npx' : '终端'} · {review.files.length}）
      </div>
      <div class="vscode-ai__change-review-files" role="tablist" aria-label="变更文件">
        {review.files.map((file) => {
          const active = file.path === activeFile?.path
          return (
            <button
              key={file.path}
              type="button"
              role="tab"
              class={`vscode-ai__change-review-file${active ? ' vscode-ai__change-review-file--active' : ''}`}
              aria-selected={active}
              onClick={() => setActivePath(file.path)}
            >
              <span class="vscode-ai__change-review-kind">{KIND_LABEL[file.kind]}</span>
              <span class="vscode-ai__change-review-path">
                {file.kind === 'renamed' && file.fromPath
                  ? `${file.fromPath} → ${file.path}`
                  : file.path}
              </span>
            </button>
          )
        })}
      </div>
      {activeFile ? <ReviewFileDiff file={activeFile} /> : undefined}
      <div class="vscode-ai__edit-card-actions">
        <button
          type="button"
          class="help-app__sample vscode-ai__change-review-keep"
          disabled={busy}
          onClick={onKeep}
        >
          保留
        </button>
        <button
          type="button"
          class="help-app__sample vscode-ai__change-review-revert"
          disabled={busy}
          onClick={onRevert}
        >
          撤销
        </button>
      </div>
    </div>
  )
}
