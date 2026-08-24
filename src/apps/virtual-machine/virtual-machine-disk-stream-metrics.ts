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
  readLatencyStale: boolean
  writeLatencyStale: boolean
}

type VmDiskStreamIoSample = {
  streamId: string
  at: number
  direction: VmDiskStreamIoDirection
  bytes: number
  durationMs: number
}

type VmDiskStreamLastOp = {
  at: number
  durationMs: number
}

const SAMPLE_RETENTION_MS = 60_000
export const VM_DISK_STREAM_IO_WINDOW_MS = 3_000

const samples: VmDiskStreamIoSample[] = []
const lastReadOpByStream = new Map<string, VmDiskStreamLastOp>()
const lastWriteOpByStream = new Map<string, VmDiskStreamLastOp>()
const lastReadWindowAvgByStreams = new Map<string, number>()
const lastWriteWindowAvgByStreams = new Map<string, number>()

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
    readLatencyStale: false,
    writeLatencyStale: false,
  }
}

function streamsKey(streamIds: readonly string[]): string {
  return [...streamIds].join('\0')
}

function pickLastOp(
  map: Map<string, VmDiskStreamLastOp>,
  wanted: Set<string>,
): VmDiskStreamLastOp | undefined {
  let best: VmDiskStreamLastOp | undefined
  for (const id of wanted) {
    const op = map.get(id)
    if (!op) {
      continue
    }
    if (!best || op.at > best.at) {
      best = op
    }
  }
  return best
}

function holdoverDuration(
  windowAvg: number | undefined,
  lastOp: VmDiskStreamLastOp | undefined,
): number | undefined {
  return windowAvg ?? lastOp?.durationMs
}

function dropStreamHoldover(streamId: string): void {
  lastReadOpByStream.delete(streamId)
  lastWriteOpByStream.delete(streamId)
  for (const key of [...lastReadWindowAvgByStreams.keys()]) {
    if (key === streamId || key.split('\0').includes(streamId)) {
      lastReadWindowAvgByStreams.delete(key)
    }
  }
  for (const key of [...lastWriteWindowAvgByStreams.keys()]) {
    if (key === streamId || key.split('\0').includes(streamId)) {
      lastWriteWindowAvgByStreams.delete(key)
    }
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
  const durationMs = Math.max(0, params.durationMs)
  samples.push({
    streamId,
    at,
    direction: params.direction,
    bytes: Math.max(0, params.bytes),
    durationMs,
  })
  const lastOp = { at, durationMs }
  if (params.direction === 'read') {
    lastReadOpByStream.set(streamId, lastOp)
  } else {
    lastWriteOpByStream.set(streamId, lastOp)
  }
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
  dropStreamHoldover(streamId)
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
  const key = streamsKey(streamIds)
  let avgReadDurationMs: number | undefined
  let avgWriteDurationMs: number | undefined
  let readLatencyStale = false
  let writeLatencyStale = false
  if (readOps > 0) {
    avgReadDurationMs = readDurationSum / readOps
    lastReadWindowAvgByStreams.set(key, avgReadDurationMs)
  } else {
    avgReadDurationMs = holdoverDuration(
      lastReadWindowAvgByStreams.get(key),
      pickLastOp(lastReadOpByStream, wanted),
    )
    readLatencyStale = avgReadDurationMs !== undefined
  }
  if (writeOps > 0) {
    avgWriteDurationMs = writeDurationSum / writeOps
    lastWriteWindowAvgByStreams.set(key, avgWriteDurationMs)
  } else {
    avgWriteDurationMs = holdoverDuration(
      lastWriteWindowAvgByStreams.get(key),
      pickLastOp(lastWriteOpByStream, wanted),
    )
    writeLatencyStale = avgWriteDurationMs !== undefined
  }
  return {
    windowMs,
    readOpsPerSec: readOps / seconds,
    writeOpsPerSec: writeOps / seconds,
    opsPerSec: (readOps + writeOps) / seconds,
    readBytesPerSec: readBytes / seconds,
    writeBytesPerSec: writeBytes / seconds,
    avgReadDurationMs,
    avgWriteDurationMs,
    readLatencyStale,
    writeLatencyStale,
  }
}
