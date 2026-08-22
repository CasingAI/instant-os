export type DownloadTaskState = 'pending' | 'running' | 'paused' | 'completed' | 'failed'

export type DownloadTask = {
  id: string
  targetPath: string
  state: DownloadTaskState
  manifest: DownloadManifest
  createdAt: number
  updatedAt: number
  error?: string
}

export type DownloadManifest =
  | { kind: 'single'; url: string; totalSize?: number; hash?: HashInfo }
  | { kind: 'metalink'; name: string; totalSize: number; pieces: PieceInfo[] }

export type PieceInfo = {
  index: number
  offset: number
  size: number
  urls: string[]
  hash?: HashInfo
}

export type HashInfo = { algorithm: 'sha-256' | 'sha-1' | 'md5'; value: string }

export type ByteRange = { start: number; end: number }

export type DownloadProgress = {
  totalBytes: number
  downloadedBytes: number
  completedRanges: ByteRange[]
  bytesPerSecond: number
}

export type DownloadEngineOptions = {
  concurrency?: number
  retryCount?: number
  signal?: AbortSignal
  onProgress?: (progress: DownloadProgress) => void
}

export type DownloadEnginePiece = {
  index: number
  offset: number
  size: number
  urls: string[]
  hash?: HashInfo
}
