import type { GeneratedAppId } from './types.ts'

export type GeneratedAppHeapReport = {
  windowId: string
  appId: GeneratedAppId
  usedBytes: number
  totalBytes: number
  limitBytes: number
  at: number
}

const reports = new Map<string, GeneratedAppHeapReport>()

export function upsertGeneratedAppHeapReport(
  report: Omit<GeneratedAppHeapReport, 'at'> & { at?: number },
): void {
  reports.set(report.windowId, {
    windowId: report.windowId,
    appId: report.appId,
    usedBytes: report.usedBytes,
    totalBytes: report.totalBytes,
    limitBytes: report.limitBytes,
    at: report.at ?? Date.now(),
  })
}

export function removeGeneratedAppHeapReport(windowId: string): void {
  reports.delete(windowId)
}

export function listGeneratedAppHeapReports(): GeneratedAppHeapReport[] {
  return [...reports.values()].sort((a, b) => b.usedBytes - a.usedBytes)
}
