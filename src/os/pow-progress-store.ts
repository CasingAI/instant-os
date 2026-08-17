/**
 * PoW 进度全局发布器：供菜单栏「云服务」卡片订阅 Challenge 计算进度。
 * 各求解路径（串行 / 并行 worker）通过 reportPowProgress 上报已尝试次数，
 * UI 端通过 subscribePowProgress 拿到最新的 active/tried/total 状态。
 */

export type PowProgressState = {
  /** 是否正在计算 Challenge */
  active: boolean
  /** 已尝试的 nonce 数 */
  tried: number
  /** 本次求解的 nonce 空间上限（MAX_NONCE） */
  total: number
  /** tried / total 的百分比（0-100） */
  percent: number
}

export const POW_PROGRESS_EVENT = 'instant-os:pow-progress'

const IDLE_PROGRESS: PowProgressState = { active: false, tried: 0, total: 100, percent: 0 }

function computePercent(tried: number, total: number): number {
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, (tried / total) * 100))
}

let current: PowProgressState = { ...IDLE_PROGRESS }

function publish(state: PowProgressState): void {
  current = state
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') {
    return
  }
  window.dispatchEvent(new CustomEvent<PowProgressState>(POW_PROGRESS_EVENT, { detail: state }))
}

/** 求解开始时调用，重置并标记 active。 */
export function beginPowProgress(total: number): void {
  publish({ active: true, tried: 0, total, percent: 0 })
}

/** 求解过程中上报已尝试的 nonce 数。 */
export function reportPowProgress(tried: number, total: number): void {
  if (!current.active) {
    return
  }
  const clamped = Math.max(0, Math.min(total, Math.round(tried)))
  publish({ active: true, tried: clamped, total, percent: computePercent(clamped, total) })
}

/** 求解结束（成功 / 失败 / 取消）时调用，恢复空闲态。 */
export function endPowProgress(): void {
  publish({ ...IDLE_PROGRESS })
}

export function getPowProgress(): PowProgressState {
  return current
}

export function subscribePowProgress(listener: (state: PowProgressState) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }
  const handle = (event: Event) => {
    listener((event as CustomEvent<PowProgressState>).detail)
  }
  window.addEventListener(POW_PROGRESS_EVENT, handle)
  return () => window.removeEventListener(POW_PROGRESS_EVENT, handle)
}
