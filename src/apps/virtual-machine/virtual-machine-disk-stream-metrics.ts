export type VmDiskStreamIoDirection = 'read' | 'write'

export type VmDiskStreamIoSnapshot = {
  windowMs: number
  readOpsPerSec: number
  writeOpsPerSec: number
  opsPerSec: number
  readBytesPerSec: number
  writeBytesPerSec: number
  avgReadDurationMs: number | undefined
  avgWriteDurationMs: number | undefined
}

type VmDiskStreamIoSample = {
  streamId: string
  at: number
  direction: VmDiskStreamIoDirection
  bytes: number
  durationMs: number
}

const SAMPLE_RETENTION_MS = 60_000
export const VM_DISK_STREAM_IO_WINDOW_MS = 3_000

const samples: VmDiskStreamIoSample[] = []

const DISK_STREAM_SLOTS = [
  'hdaStream',
  'hdbStream',
  'cdromStream',
  'fdaStream',
  'fdbStream',
] as const

function pruneSamples(now: number): void {
  const cutoff = now - SAMPLE_RETENTION_MS
  while (samples.length > 0 && samples[0]!.at < cutoff) {
    samples.shift()
  }
}

export function emptyVmDiskStreamIoSnapshot(
  windowMs: number = VM_DISK_STREAM_IO_WINDOW_MS,
): VmDiskStreamIoSnapshot {
  return {
    windowMs,
    readOpsPerSec: 0,
    writeOpsPerSec: 0,
    opsPerSec: 0,
    readBytesPerSec: 0,
    writeBytesPerSec: 0,
    avgReadDurationMs: undefined,
    avgWriteDurationMs: undefined,
  }
}

/** 记录一次成功的镜像范围读或回写。失败请求不要调用。 */
export function recordVmDiskStreamIo(params: {
  streamId: string
  direction: VmDiskStreamIoDirection
  bytes: number
  durationMs: number
  at?: number
}): void {
  const streamId = params.streamId.trim()
  if (!streamId) {
    return
  }
  const at = params.at ?? Date.now()
  samples.push({
    streamId,
    at,
    direction: params.direction,
    bytes: Math.max(0, params.bytes),
    durationMs: Math.max(0, params.durationMs),
  })
  pruneSamples(at)
}

export function releaseVmDiskStreamMetrics(streamId: string | undefined): void {
  if (!streamId) {
    return
  }
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    if (samples[i]!.streamId === streamId) {
      samples.splice(i, 1)
    }
  }
}

export function listVmDiskStreamIds(
  message:
    | {
        hdaStream?: { id: string }
        hdbStream?: { id: string }
        cdromStream?: { id: string }
        fdaStream?: { id: string }
        fdbStream?: { id: string }
        stateStream?: { id: string }
      }
    | undefined,
): string[] {
  if (!message) {
    return []
  }
  const ids: string[] = []
  for (const slot of DISK_STREAM_SLOTS) {
    const id = message[slot]?.id
    if (id) {
      ids.push(id)
    }
  }
  return ids
}

export function getVmDiskStreamIoSnapshot(
  streamIds: readonly string[],
  now: number = Date.now(),
  windowMs: number = VM_DISK_STREAM_IO_WINDOW_MS,
): VmDiskStreamIoSnapshot {
  pruneSamples(now)
  if (streamIds.length === 0) {
    return emptyVmDiskStreamIoSnapshot(windowMs)
  }
  const wanted = new Set(streamIds)
  const cutoff = now - windowMs
  let readBytes = 0
  let writeBytes = 0
  let readOps = 0
  let writeOps = 0
  let readDurationSum = 0
  let writeDurationSum = 0
  for (const sample of samples) {
    if (sample.at < cutoff) {
      continue
    }
    if (!wanted.has(sample.streamId)) {
      continue
    }
    if (sample.direction === 'read') {
      readBytes += sample.bytes
      readOps += 1
      readDurationSum += sample.durationMs
    } else {
      writeBytes += sample.bytes
      writeOps += 1
      writeDurationSum += sample.durationMs
    }
  }
  const seconds = Math.max(windowMs / 1000, 0.001)
  return {
    windowMs,
    readOpsPerSec: readOps / seconds,
    writeOpsPerSec: writeOps / seconds,
    opsPerSec: (readOps + writeOps) / seconds,
    readBytesPerSec: readBytes / seconds,
    writeBytesPerSec: writeBytes / seconds,
    avgReadDurationMs: readOps > 0 ? readDurationSum / readOps : undefined,
    avgWriteDurationMs: writeOps > 0 ? writeDurationSum / writeOps : undefined,
  }
}
