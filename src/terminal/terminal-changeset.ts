/** 一轮受控 eval 的文件系统变更清单（文本 diff 是消费者的事）。 */

export type TerminalChangeKind = 'added' | 'modified' | 'deleted' | 'renamed'

export type TerminalChangeEntry = {
  path: string
  kind: TerminalChangeKind
  /** renamed 时的原路径 */
  fromPath?: string
  /** 改前内容对象 id（added 无；文件夹删除可无） */
  beforeBlobId?: string
  meta?: {
    byteSize?: number
    isDirectory?: boolean
  }
}

export type TerminalChangeSet = {
  sessionId: string
  createdAt: number
  sealedAt?: number
  changes: TerminalChangeEntry[]
}

export function formatTerminalChangeSummary(changeSet: TerminalChangeSet): string {
  const count = changeSet.changes.length
  if (count === 0) {
    return '变更 0 项'
  }
  const preview = changeSet.changes
    .slice(0, 5)
    .map((entry) => {
      const tag =
        entry.kind === 'added'
          ? '+'
          : entry.kind === 'deleted'
            ? '-'
            : entry.kind === 'renamed'
              ? '→'
              : '~'
      return `${tag}${entry.path}`
    })
    .join(' · ')
  const more = count > 5 ? ` · …另有 ${count - 5} 项` : ''
  return `变更 ${count} 项：${preview}${more}`
}
