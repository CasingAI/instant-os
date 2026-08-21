import type { SettingsChoiceOption } from '../../ui/settings-choice-option-list.tsx'
import {
  DEFAULT_VIRTUAL_MACHINE_BOOT_ORDER,
  DEFAULT_VIRTUAL_MACHINE_DISPLAY_MODE,
  DEFAULT_VIRTUAL_MACHINE_MEMORY_MB,
  DEFAULT_VIRTUAL_MACHINE_NAME,
  DEFAULT_VIRTUAL_MACHINE_NETWORK,
  DEFAULT_VIRTUAL_MACHINE_NETWORK_BACKEND,
  DEFAULT_VIRTUAL_MACHINE_POINTER_MODE,
  DEFAULT_VIRTUAL_MACHINE_VGA_MEMORY_MB,
  VM_BACKEND_IDS,
  VM_BOOT_ORDER_IDS,
  VM_DISPLAY_MODE_IDS,
  VM_MEMORY_MB_OPTIONS,
  VM_NETWORK_BACKEND_IDS,
  VM_NETWORK_IDS,
  VM_POINTER_MODE_IDS,
  VM_VGA_MEMORY_MB_OPTIONS,
  type VmBackendId,
  type VmBootOrderId,
  type VmDisplayModeId,
  type VmMemoryMb,
  type VmNetworkBackendId,
  type VmNetworkId,
  type VmPointerModeId,
  type VmVgaMemoryMb,
  type VirtualMachineRecord,
  type VirtualMachineSettings,
} from './virtual-machine-types.ts'

export function defaultVirtualMachineSettings(
  name = DEFAULT_VIRTUAL_MACHINE_NAME,
): VirtualMachineSettings {
  return {
    name,
    backend: 'v86',
    memoryMb: DEFAULT_VIRTUAL_MACHINE_MEMORY_MB,
    vgaMemoryMb: DEFAULT_VIRTUAL_MACHINE_VGA_MEMORY_MB,
    bootOrder: DEFAULT_VIRTUAL_MACHINE_BOOT_ORDER,
    acpi: false,
    fastboot: false,
    speaker: true,
    keyboard: true,
    mouse: true,
    pointerMode: DEFAULT_VIRTUAL_MACHINE_POINTER_MODE,
    network: DEFAULT_VIRTUAL_MACHINE_NETWORK,
    networkBackend: DEFAULT_VIRTUAL_MACHINE_NETWORK_BACKEND,
    displayMode: DEFAULT_VIRTUAL_MACHINE_DISPLAY_MODE,
    hdaPath: '',
    cdromPath: '',
    fdaPath: '',
    statePath: '',
  }
}

export function settingsFromRecord(record: VirtualMachineRecord): VirtualMachineSettings {
  return {
    name: record.name,
    backend: record.backend,
    memoryMb: record.memoryMb,
    vgaMemoryMb: record.vgaMemoryMb,
    bootOrder: record.bootOrder,
    acpi: record.acpi,
    fastboot: record.fastboot,
    speaker: record.speaker,
    keyboard: record.keyboard,
    mouse: record.mouse,
    pointerMode: record.pointerMode,
    network: record.network,
    networkBackend: record.networkBackend,
    displayMode: record.displayMode,
    hdaPath: record.hdaPath,
    cdromPath: record.cdromPath,
    fdaPath: record.fdaPath,
    statePath: record.statePath,
  }
}

const BOOT_ORDER_LABELS: Record<VmBootOrderId, string> = {
  auto: '自动',
  'cd-floppy-hdd': '光盘 → 软盘 → 硬盘',
  'cd-hdd-floppy': '光盘 → 硬盘 → 软盘',
  'floppy-cd-hdd': '软盘 → 光盘 → 硬盘',
  'floppy-hdd-cd': '软盘 → 硬盘 → 光盘',
  'hdd-cd-floppy': '硬盘 → 光盘 → 软盘',
}

const NETWORK_LABELS: Record<VmNetworkId, string> = {
  none: '关闭',
  ne2k: 'NE2000 旧系统',
  virtio: 'VirtIO 现代 Linux',
}

const NETWORK_BACKEND_LABELS: Record<VmNetworkBackendId, string> = {
  off: '关闭',
  fetch: 'Fetch 直接连通，仅 HTTP',
}

const DISPLAY_MODE_LABELS: Record<VmDisplayModeId, string> = {
  stretch: '拉伸',
  contain: '等比',
  native: '原始',
}

const POINTER_MODE_LABELS: Record<VmPointerModeId, string> = {
  follow: '跟随',
  lock: '独占',
}

export function formatVmPointerModeLabel(id: VmPointerModeId): string {
  return POINTER_MODE_LABELS[id]
}

export function formatVmDisplayModeLabel(id: VmDisplayModeId): string {
  return DISPLAY_MODE_LABELS[id]
}

export function formatVmBootOrderLabel(id: VmBootOrderId): string {
  return BOOT_ORDER_LABELS[id]
}

export function formatVmNetworkLabel(id: VmNetworkId): string {
  return NETWORK_LABELS[id]
}

export function formatVmNetworkBackendLabel(id: VmNetworkBackendId): string {
  return NETWORK_BACKEND_LABELS[id]
}

export function formatVmMemoryLabel(mb: number): string {
  return `${mb} MB`
}

export function formatVmPathSummary(path: string, emptyLabel = '未挂载'): string {
  const trimmed = path.trim()
  if (!trimmed) {
    return emptyLabel
  }
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed)
      return `${parsed.host}${parsed.pathname}`
    } catch {
      return trimmed
    }
  }
  const parts = trimmed.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? trimmed
}

export const VM_BACKEND_CHOICES: readonly SettingsChoiceOption[] = VM_BACKEND_IDS.map((id) => ({
  id,
  label: id === 'v86' ? 'V86' : id,
}))

export const VM_MEMORY_CHOICES: readonly SettingsChoiceOption[] = VM_MEMORY_MB_OPTIONS.map((mb) => ({
  id: String(mb),
  label: formatVmMemoryLabel(mb),
}))

export const VM_VGA_MEMORY_CHOICES: readonly SettingsChoiceOption[] = VM_VGA_MEMORY_MB_OPTIONS.map(
  (mb) => ({
    id: String(mb),
    label: mb === DEFAULT_VIRTUAL_MACHINE_VGA_MEMORY_MB ? `${mb} MB 默认` : `${mb} MB`,
  }),
)

export const VM_BOOT_ORDER_CHOICES: readonly SettingsChoiceOption[] = VM_BOOT_ORDER_IDS.map((id) => ({
  id,
  label: formatVmBootOrderLabel(id),
}))

export const VM_NETWORK_CHOICES: readonly SettingsChoiceOption[] = VM_NETWORK_IDS.map((id) => ({
  id,
  label: formatVmNetworkLabel(id),
}))

export const VM_NETWORK_BACKEND_CHOICES: readonly SettingsChoiceOption[] =
  VM_NETWORK_BACKEND_IDS.map((id) => ({
    id,
    label: formatVmNetworkBackendLabel(id),
  }))

export const VM_DISPLAY_MODE_CHOICES: readonly SettingsChoiceOption[] = VM_DISPLAY_MODE_IDS.map(
  (id) => ({
    id,
    label:
      id === DEFAULT_VIRTUAL_MACHINE_DISPLAY_MODE
        ? `${formatVmDisplayModeLabel(id)} 默认`
        : formatVmDisplayModeLabel(id),
  }),
)

export const VM_POINTER_MODE_CHOICES: readonly SettingsChoiceOption[] = VM_POINTER_MODE_IDS.map(
  (id) => ({
    id,
    label:
      id === DEFAULT_VIRTUAL_MACHINE_POINTER_MODE
        ? `${formatVmPointerModeLabel(id)} 默认`
        : formatVmPointerModeLabel(id),
  }),
)

export const VM_HARD_DISK_ACCEPT_EXTENSIONS = ['img', 'raw', 'bin', 'dsk'] as const
export const VM_CDROM_ACCEPT_EXTENSIONS = ['iso'] as const
export const VM_FLOPPY_ACCEPT_EXTENSIONS = ['img', 'ima', 'bin'] as const
export const VM_STATE_ACCEPT_EXTENSIONS = ['bin', 'zst'] as const

export function isVmBackendId(value: string): value is VmBackendId {
  return (VM_BACKEND_IDS as readonly string[]).includes(value)
}

export function isVmMemoryMb(value: number): value is VmMemoryMb {
  return (VM_MEMORY_MB_OPTIONS as readonly number[]).includes(value)
}

export function isVmVgaMemoryMb(value: number): value is VmVgaMemoryMb {
  return (VM_VGA_MEMORY_MB_OPTIONS as readonly number[]).includes(value)
}

export function isVmBootOrderId(value: string): value is VmBootOrderId {
  return (VM_BOOT_ORDER_IDS as readonly string[]).includes(value)
}

export function isVmNetworkId(value: string): value is VmNetworkId {
  return (VM_NETWORK_IDS as readonly string[]).includes(value)
}

export function isVmNetworkBackendId(value: string): value is VmNetworkBackendId {
  return (VM_NETWORK_BACKEND_IDS as readonly string[]).includes(value)
}

export function isVmDisplayModeId(value: string): value is VmDisplayModeId {
  return (VM_DISPLAY_MODE_IDS as readonly string[]).includes(value)
}

export function isVmPointerModeId(value: string): value is VmPointerModeId {
  return (VM_POINTER_MODE_IDS as readonly string[]).includes(value)
}
