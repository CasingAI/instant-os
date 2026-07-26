export type ScanNodeKind = 'file' | 'folder'

export type ScanNode = {
  path: string
  name: string
  kind: ScanNodeKind
  byteSize: number
  updatedAt?: number
  mimeType?: string
  children?: ScanNode[]
}

export type ScanProgress = {
  root: ScanNode
  fileCount: number
  folderCount: number
  done: boolean
  error?: string
}

export type ScanOptions = {
  signal?: AbortSignal
  onProgress?: (progress: ScanProgress) => void
}

export const DEFAULT_DETAIL_LEVEL = 2
export const MIN_DETAIL_LEVEL = 1
export const MAX_DETAIL_LEVEL = 5
