export const WORKER_HEAP_REPORTS_CHANGED_EVENT = 'instant-os:worker-heap-reports-changed'

export const WORKER_HEAP_SERVICE_IDS = [
  'tokenizer',
  'vscode-workspace-search',
  'vscode-typescript-resolve',
] as const

export type WorkerHeapServiceId = (typeof WORKER_HEAP_SERVICE_IDS)[number]

export const WORKER_HEAP_SERVICE_LABELS: Record<WorkerHeapServiceId, string> = {
  tokenizer: 'Tokenizer',
  'vscode-workspace-search': 'Workspace Search',
  'vscode-typescript-resolve': 'TypeScript Resolve',
}

/** 服务运行状态（由 service-supervisor 维护） */
export type WorkerServiceStatus = 'running' | 'restarting' | 'failed'

export const WORKER_SERVICE_STATUS_LABELS: Record<WorkerServiceStatus, string> = {
  running: '运行中',
  restarting: '重启中',
  failed: '已失败',
}

export type WorkerHeapReport = {
  id: WorkerHeapServiceId
  label: string
  at: number
  status: WorkerServiceStatus
  /** 页面加载以来累计重启次数（含手动重启） */
  restartCount: number
}

const reports = new Map<WorkerHeapServiceId, WorkerHeapReport>()

function dispatchChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(WORKER_HEAP_REPORTS_CHANGED_EVENT))
}

export function upsertWorkerHeapReport(
  report: Pick<WorkerHeapReport, 'id'> & Partial<Omit<WorkerHeapReport, 'id'>>,
): void {
  const existing = reports.get(report.id)
  reports.set(report.id, {
    id: report.id,
    label: report.label ?? existing?.label ?? WORKER_HEAP_SERVICE_LABELS[report.id],
    at: report.at ?? Date.now(),
    status: report.status ?? existing?.status ?? 'running',
    restartCount: report.restartCount ?? existing?.restartCount ?? 0,
  })
  dispatchChanged()
}

export function listWorkerHeapReports(): WorkerHeapReport[] {
  return [...reports.values()].sort((left, right) =>
    left.label.localeCompare(right.label, 'zh-CN'),
  )
}
