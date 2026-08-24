import { useEffect, useState } from 'preact/hooks'
import {
  formatFilesIoBytesPerSec,
  formatFilesIoDurationMs,
  formatFilesIoOpsPerSec,
} from '../../os/files-io-metrics.ts'
import type { InstantVmDiskStats, InstantVmStatsSnapshot } from './virtual-machine-protocol.ts'
import {
  emptyVmDiskStreamIoSnapshot,
  getVmDiskStreamIoSnapshot,
  type VmDiskStreamIoSnapshot,
} from './virtual-machine-disk-stream-metrics.ts'
import {
  diskActivityTitle,
  formatVmIdeLabel,
  formatVmIdeStatus,
  formatVmMips,
  formatVmRunningDuration,
  formatVmVgaMode,
  formatVmVgaResolution,
} from './virtual-machine-stats-format.ts'

type LedKind = 'hdd1' | 'hdd2' | 'cdrom' | 'fd1' | 'fd2' | 'cpu'

const DISK_IO_POLL_MS = 500

function ledState(disk: InstantVmDiskStats | undefined, running: boolean): 'off' | 'idle' | 'busy' {
  if (!disk?.present) {
    return 'off'
  }
  if (!running) {
    return 'off'
  }
  if (disk.busy === 'read' || disk.busy === 'write') {
    return 'busy'
  }
  return 'idle'
}

function cpuLedState(stats: InstantVmStatsSnapshot | undefined, running: boolean): 'off' | 'idle' | 'busy' {
  if (!running || !stats) {
    return 'off'
  }
  return stats.speedMips > 0.05 ? 'busy' : 'idle'
}

function ActivityLed({
  kind,
  label,
  state,
  title,
}: {
  kind: LedKind
  label: string
  state: 'off' | 'idle' | 'busy'
  title: string
}) {
  return (
    <span
      class={`virtual-machine__led virtual-machine__led--${kind} virtual-machine__led--${state}`}
      title={title}
    >
      <span class="virtual-machine__led-lamp" aria-hidden="true" />
      <span class="virtual-machine__led-label">{label}</span>
    </span>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div class="virtual-machine__stats-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function formatHostDiskLatency(ms: number | undefined, hasStream: boolean): string {
  if (!hasStream) {
    return '—'
  }
  return formatFilesIoDurationMs(ms)
}

function formatHostDiskOps(opsPerSec: number, hasStream: boolean): string {
  if (!hasStream) {
    return '—'
  }
  return formatFilesIoOpsPerSec(opsPerSec)
}

function formatHostDiskSpeed(bytesPerSec: number, hasStream: boolean): string {
  if (!hasStream) {
    return '—'
  }
  return formatFilesIoBytesPerSec(bytesPerSec)
}

export function VirtualMachineActivity({
  stats,
  running,
  diskStreamIds = [],
}: {
  stats: InstantVmStatsSnapshot | undefined
  running: boolean
  diskStreamIds?: readonly string[]
}) {
  const [open, setOpen] = useState(false)
  const [diskIo, setDiskIo] = useState<VmDiskStreamIoSnapshot>(() => emptyVmDiskStreamIoSnapshot())
  const hasStream = diskStreamIds.length > 0
  const streamKey = diskStreamIds.join('\0')

  useEffect(() => {
    if (!open || !running || !hasStream) {
      setDiskIo(emptyVmDiskStreamIoSnapshot())
      return
    }
    const ids = streamKey ? streamKey.split('\0') : []
    const tick = () => {
      setDiskIo(getVmDiskStreamIoSnapshot(ids))
    }
    tick()
    const timer = window.setInterval(tick, DISK_IO_POLL_MS)
    return () => window.clearInterval(timer)
  }, [hasStream, open, running, streamKey])

  const hda = stats?.hda
  const hdb = stats?.hdb
  const cdrom = stats?.cdrom
  const fda = stats?.fda
  const fdb = stats?.fdb
  const ide = stats
    ? stats.ideLabel === 'hdd'
      ? stats.hda
      : stats.ideLabel === 'cdrom'
        ? stats.cdrom
        : undefined
    : undefined

  return (
    <div class="virtual-machine__activity">
      <div class="virtual-machine__bezel">
        <div class="virtual-machine__leds" role="group" aria-label="设备指示灯">
          <ActivityLed
            kind="hdd1"
            label="HD1"
            state={ledState(hda, running)}
            title={hda ? diskActivityTitle('硬盘 1', hda) : '硬盘 1 未挂载'}
          />
          <ActivityLed
            kind="hdd2"
            label="HD2"
            state={ledState(hdb, running)}
            title={hdb ? diskActivityTitle('硬盘 2', hdb) : '硬盘 2 未挂载'}
          />
          <ActivityLed
            kind="cdrom"
            label="CD"
            state={ledState(cdrom, running)}
            title={cdrom ? diskActivityTitle('光盘', cdrom) : '光盘未挂载'}
          />
          <ActivityLed
            kind="fd1"
            label="FD1"
            state={ledState(fda, running)}
            title={fda ? diskActivityTitle('软盘 1', fda) : '软盘 1 未挂载'}
          />
          <ActivityLed
            kind="fd2"
            label="FD2"
            state={ledState(fdb, running)}
            title={fdb ? diskActivityTitle('软盘 2', fdb) : '软盘 2 未挂载'}
          />
          <ActivityLed
            kind="cpu"
            label="CPU"
            state={cpuLedState(stats, running)}
            title={
              running && stats
                ? `CPU ${formatVmMips(stats.speedMips)}`
                : 'CPU 未运行'
            }
          />
        </div>
        <button
          type="button"
          class="virtual-machine__stats-toggle"
          aria-expanded={open}
          disabled={!running && !stats}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? '收起详情' : '运行详情'}
        </button>
      </div>
      {open ? (
        <dl class="virtual-machine__stats-panel">
          {stats && running ? (
            <>
              <DetailRow label="Running" value={formatVmRunningDuration(stats.runningMs)} />
              <DetailRow label="Speed" value={formatVmMips(stats.speedMips)} />
              <DetailRow label="Avg speed" value={formatVmMips(stats.avgSpeedMips)} />
              <DetailRow label="IDE device" value={formatVmIdeLabel(stats.ideLabel)} />
              <DetailRow label="Sectors read" value={String(ide?.sectorsRead ?? 0)} />
              <DetailRow label="Bytes read" value={String(ide?.bytesRead ?? 0)} />
              <DetailRow label="Sectors written" value={String(ide?.sectorsWritten ?? 0)} />
              <DetailRow label="Bytes written" value={String(ide?.bytesWritten ?? 0)} />
              <DetailRow
                label="Read latency"
                value={formatHostDiskLatency(diskIo.avgReadDurationMs, hasStream)}
              />
              <DetailRow
                label="Write latency"
                value={formatHostDiskLatency(diskIo.avgWriteDurationMs, hasStream)}
              />
              <DetailRow
                label="Requests/s"
                value={formatHostDiskOps(diskIo.opsPerSec, hasStream)}
              />
              <DetailRow
                label="Reads/s"
                value={formatHostDiskOps(diskIo.readOpsPerSec, hasStream)}
              />
              <DetailRow
                label="Writes/s"
                value={formatHostDiskOps(diskIo.writeOpsPerSec, hasStream)}
              />
              <DetailRow
                label="Read speed"
                value={formatHostDiskSpeed(diskIo.readBytesPerSec, hasStream)}
              />
              <DetailRow
                label="Write speed"
                value={formatHostDiskSpeed(diskIo.writeBytesPerSec, hasStream)}
              />
              <DetailRow label="Status" value={formatVmIdeStatus(stats)} />
              <DetailRow label="VGA" value={formatVmVgaMode(stats)} />
              <DetailRow label="Resolution" value={formatVmVgaResolution(stats)} />
              <DetailRow label="Mouse" value={stats.mouse ? 'Yes' : 'No'} />
              <DetailRow label="Absolute mouse" value={stats.absoluteMouse ? 'Yes' : 'No'} />
            </>
          ) : (
            <p class="virtual-machine__stats-empty">开机后显示速度、磁盘读写和显示模式。</p>
          )}
        </dl>
      ) : null}
    </div>
  )
}
