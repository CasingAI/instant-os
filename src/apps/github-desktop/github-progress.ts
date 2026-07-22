export type GithubProgressDetail = {
  /** 当前阶段的完成比例 0–1 */
  fraction?: number
  downloadedBytes?: number
  totalBytes?: number
}

export type GithubProgress = (message: string, detail?: GithubProgressDetail) => void
