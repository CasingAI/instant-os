import { listAllModelVisionExportRecords } from './model-vision-storage.ts'

export type ModelVisionExportPayload = {
  version: 1
  exportedAt: string
  count: number
  successCount: number
  results: Awaited<ReturnType<typeof listAllModelVisionExportRecords>>
}

export async function buildModelVisionExportPayload(): Promise<ModelVisionExportPayload> {
  const results = await listAllModelVisionExportRecords()
  const successCount = results.filter((record) => !record.error).length
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    count: results.length,
    successCount,
    results,
  }
}

function formatExportFilename(at: Date): string {
  const stamp = [
    at.getFullYear(),
    String(at.getMonth() + 1).padStart(2, '0'),
    String(at.getDate()).padStart(2, '0'),
    '-',
    String(at.getHours()).padStart(2, '0'),
    String(at.getMinutes()).padStart(2, '0'),
  ].join('')
  return `model-vision-results-${stamp}.json`
}

/** 下载全部识图文字结果（不含预览图）。 */
export async function downloadModelVisionResultsJson(): Promise<number> {
  const payload = await buildModelVisionExportPayload()
  if (payload.count === 0) {
    throw new Error('还没有可导出的识别结果')
  }
  const json = `${JSON.stringify(payload, undefined, 2)}\n`
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = formatExportFilename(new Date())
  anchor.click()
  URL.revokeObjectURL(url)
  return payload.count
}
