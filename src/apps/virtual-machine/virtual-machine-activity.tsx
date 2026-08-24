import { useEffect, useRef, useState } from 'preact/hooks'
import {
  formatFilesIoBytesPerSec,
  formatFilesIoDurationMs,
  formatFilesIoOpsPerSec,
} from '../../os/files-io-metrics.ts'
import type { VmMountedDiskSlots } from './virtual-machine-disks.ts'
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
  if (!running) {
    return 'off'
  }
  if (disk?.busy === 'read' || disk?.busy === 'write') {
    return 'busy'
  }
  return 'idle'
}

function diskLedVisible(mounted: boolean, disk: InstantVmDiskStats | undefined): boolean {
  return mounted || Boolean(disk?.present)
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

function DetailSection({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <section class="virtual-machine__stats-section">
      <h4 class="virtual-machine__stats-section-title">{title}</h4>
      <dl class="virtual-machine__stats-section-body">{children}</dl>
    </section>
  )
}

function DetailRow({
  label,
  value,
  stale,
}: {
  label: string
  value: string
  stale?: boolean
}) {
  return (
    <div
      class={
        stale
          ? 'virtual-machine__stats-row virtual-machine__stats-row--stale'
          : 'virtual-machine__stats-row'
      }
    >
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
  mountedSlots,
}: {
  stats: InstantVmStatsSnapshot | undefined
  running: boolean
  diskStreamIds?: readonly string[]
  mountedSlots?: VmMountedDiskSlots
}) {
  const rootRef = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }
      if (rootRef.current?.contains(target)) {
        return
      }
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      event.preventDefault()
      setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const hda = stats?.hda
  const hdb = stats?.hdb
  const cdrom = stats?.cdrom
  const fda = stats?.fda
  const fdb = stats?.fdb
  const showHda = diskLedVisible(Boolean(mountedSlots?.hda), hda)
  const showHdb = diskLedVisible(Boolean(mountedSlots?.hdb), hdb)
  const showCdrom = diskLedVisible(Boolean(mountedSlots?.cdrom), cdrom)
  const showFda = diskLedVisible(Boolean(mountedSlots?.fda), fda)
  const showFdb = diskLedVisible(Boolean(mountedSlots?.fdb), fdb)
  const ide = stats
    ? stats.ideLabel === 'hdd'
      ? stats.hda
      : stats.ideLabel === 'cdrom'
        ? stats.cdrom
        : undefined
    : undefined

  return (
    <div class="virtual-machine__activity" ref={rootRef}>
      <div class="virtual-machine__bezel">
        <div class="virtual-machine__leds" role="group" aria-label="设备指示灯">
          {showHda ? (
            <ActivityLed
              kind="hdd1"
              label="硬盘 1"
              state={ledState(hda, running)}
              title={diskActivityTitle('硬盘 1', hda, running)}
            />
          ) : undefined}
          {showHdb ? (
            <ActivityLed
              kind="hdd2"
              label="硬盘 2"
              state={ledState(hdb, running)}
              title={diskActivityTitle('硬盘 2', hdb, running)}
            />
          ) : undefined}
          {showCdrom ? (
            <ActivityLed
              kind="cdrom"
              label="光盘"
              state={ledState(cdrom, running)}
              title={diskActivityTitle('光盘', cdrom, running)}
            />
          ) : undefined}
          {showFda ? (
            <ActivityLed
              kind="fd1"
              label="软盘 1"
              state={ledState(fda, running)}
              title={diskActivityTitle('软盘 1', fda, running)}
            />
          ) : undefined}
          {showFdb ? (
            <ActivityLed
              kind="fd2"
              label="软盘 2"
              state={ledState(fdb, running)}
              title={diskActivityTitle('软盘 2', fdb, running)}
            />
          ) : undefined}
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
          aria-haspopup="dialog"
          disabled={!running && !stats}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? '收起详情' : '运行详情'}
        </button>
      </div>
      {open ? (
        <div class="virtual-machine__stats-panel" role="dialog" aria-label="运行详情">
          {stats && running ? (
            <>
              <DetailSection title="CPU">
                <DetailRow label="已运行" value={formatVmRunningDuration(stats.runningMs)} />
                <DetailRow label="速度" value={formatVmMips(stats.speedMips)} />
                <DetailRow label="平均速度" value={formatVmMips(stats.avgSpeedMips)} />
              </DetailSection>
              <DetailSection title="客户机磁盘">
                <DetailRow label="IDE 设备" value={formatVmIdeLabel(stats.ideLabel)} />
                <DetailRow label="状态" value={formatVmIdeStatus(stats)} />
                <DetailRow label="已读扇区" value={String(ide?.sectorsRead ?? 0)} />
                <DetailRow label="已读字节" value={String(ide?.bytesRead ?? 0)} />
                <DetailRow label="已写扇区" value={String(ide?.sectorsWritten ?? 0)} />
                <DetailRow label="已写字节" value={String(ide?.bytesWritten ?? 0)} />
              </DetailSection>
              <DetailSection title="宿主磁盘">
                <DetailRow
                  label="读取延迟"
                  value={formatHostDiskLatency(diskIo.avgReadDurationMs, hasStream)}
                  stale={hasStream && diskIo.readLatencyStale}
                />
                <DetailRow
                  label="写入延迟"
                  value={formatHostDiskLatency(diskIo.avgWriteDurationMs, hasStream)}
                  stale={hasStream && diskIo.writeLatencyStale}
                />
                <DetailRow
                  label="请求/秒"
                  value={formatHostDiskOps(diskIo.opsPerSec, hasStream)}
                />
                <DetailRow
                  label="读取/秒"
                  value={formatHostDiskOps(diskIo.readOpsPerSec, hasStream)}
                />
                <DetailRow
                  label="写入/秒"
                  value={formatHostDiskOps(diskIo.writeOpsPerSec, hasStream)}
                />
                <DetailRow
                  label="读取速度"
                  value={formatHostDiskSpeed(diskIo.readBytesPerSec, hasStream)}
                />
                <DetailRow
                  label="写入速度"
                  value={formatHostDiskSpeed(diskIo.writeBytesPerSec, hasStream)}
                />
              </DetailSection>
              <DetailSection title="显示">
                <DetailRow label="VGA" value={formatVmVgaMode(stats)} />
                <DetailRow label="分辨率" value={formatVmVgaResolution(stats)} />
                <DetailRow label="鼠标" value={stats.mouse ? '是' : '否'} />
                <DetailRow label="绝对鼠标" value={stats.absoluteMouse ? '是' : '否'} />
              </DetailSection>
            </>
          ) : (
            <p class="virtual-machine__stats-empty">开机后显示速度、磁盘读写和显示模式。</p>
          )}
        </div>
      ) : undefined}
    </div>
  )
}
