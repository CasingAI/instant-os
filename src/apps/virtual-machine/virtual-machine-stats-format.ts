import type {
  InstantVmDiskBusy,
  InstantVmDiskStats,
  InstantVmIdeLabel,
  InstantVmStatsSnapshot,
} from './virtual-machine-protocol.ts'

export function formatVmRunningDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }
  return `${seconds}s`
}

export function formatVmMips(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 mIPS'
  }
  const digits = value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} mIPS`
}

export function formatVmIdeLabel(label: InstantVmIdeLabel): string {
  if (label === 'hdd') {
    return '硬盘'
  }
  if (label === 'cdrom') {
    return '光盘'
  }
  return '无'
}

export function formatVmIdeStatus(stats: InstantVmStatsSnapshot): string {
  const busy: InstantVmDiskBusy[] = [stats.hda.busy, stats.cdrom.busy]
  if (busy.includes('read')) {
    return 'Reading'
  }
  if (busy.includes('write')) {
    return 'Writing'
  }
  return 'Idle'
}

export function formatVmVgaMode(stats: InstantVmStatsSnapshot): string {
  return stats.vga.mode === 'graphical' ? 'Graphical' : 'Text'
}

export function formatVmVgaResolution(stats: InstantVmStatsSnapshot): string {
  const { width, height, bpp, mode } = stats.vga
  if (!width || !height) {
    return '—'
  }
  if (mode === 'text' || bpp === 0) {
    return `${width}×${height}`
  }
  return `${width}×${height}×${bpp}`
}

export function diskActivityTitle(label: string, disk: InstantVmDiskStats): string {
  if (!disk.present) {
    return `${label}未挂载`
  }
  if (disk.busy === 'read') {
    return `${label}读取中`
  }
  if (disk.busy === 'write') {
    return `${label}写入中`
  }
  return `${label}空闲`
}
