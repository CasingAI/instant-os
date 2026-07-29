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

export type WorkerHeapReport = {
  id: WorkerHeapServiceId
  label: string
  usedBytes: number | undefined
  totalBytes: number | undefined
  limitBytes: number | undefined
  memorySupported: boolean
  at: number
}

const reports = new Map<WorkerHeapServiceId, WorkerHeapReport>()

function dispatchChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(WORKER_HEAP_REPORTS_CHANGED_EVENT))
}

export function upsertWorkerHeapReport(
  report: Omit<WorkerHeapReport, 'at' | 'label'> & {
    label?: string
    at?: number
  },
): void {
  reports.set(report.id, {
    id: report.id,
    label: report.label ?? WORKER_HEAP_SERVICE_LABELS[report.id],
    usedBytes: report.usedBytes,
    totalBytes: report.totalBytes,
    limitBytes: report.limitBytes,
    memorySupported: report.memorySupported,
    at: report.at ?? Date.now(),
  })
  dispatchChanged()
}

export function removeWorkerHeapReport(id: WorkerHeapServiceId): void {
  if (!reports.delete(id)) return
  dispatchChanged()
}

export function listWorkerHeapReports(): WorkerHeapReport[] {
  return [...reports.values()].sort((left, right) => {
    const leftUsed = left.usedBytes ?? -1
    const rightUsed = right.usedBytes ?? -1
    if (rightUsed !== leftUsed) return rightUsed - leftUsed
    return left.label.localeCompare(right.label, 'zh-CN')
  })
}

export function sumWorkerHeapUsedBytes(reportsList = listWorkerHeapReports()): number {
  return reportsList.reduce((sum, report) => sum + (report.usedBytes ?? 0), 0)
}

export function sumWorkerHeapTotalBytes(reportsList = listWorkerHeapReports()): number {
  return reportsList.reduce((sum, report) => sum + (report.totalBytes ?? 0), 0)
}

export function sumWorkerHeapLimitBytes(reportsList = listWorkerHeapReports()): number {
  return reportsList.reduce((sum, report) => sum + (report.limitBytes ?? 0), 0)
}
