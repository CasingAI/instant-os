export type ArchiveJobPhase = 'read' | 'encode' | 'decode' | 'write'

/** 编码/解码阶段没有细粒度吞吐，返回 undefined 表示应用不确定进度条。 */
export function archiveJobProgressFraction(params: {
  phase: ArchiveJobPhase
  bytesDone: number
  bytesTotal: number
}): number | undefined {
  if (params.phase === 'encode' || params.phase === 'decode') return undefined
  if (params.bytesTotal <= 0) return params.bytesDone > 0 ? 1 : 0
  return Math.min(1, Math.max(0, params.bytesDone / params.bytesTotal))
}
