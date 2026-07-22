export type GithubProgressDetail = {
  /** 当前阶段的完成比例 0–1 */
  fraction?: number
  downloadedBytes?: number
  totalBytes?: number
}

export type GithubProgress = (message: string, detail?: GithubProgressDetail) => void

/** 限制进度回调频率，避免大量小步骤时 UI 刷新过于密集 */
export function shouldReportGithubProgress(
  lastReportedAtMs: number,
  nowMs: number,
  intervalMs = 1000,
): boolean {
  return nowMs - lastReportedAtMs >= intervalMs
}
