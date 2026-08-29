import type { SettingsChoiceOption } from '../../ui/settings-choice-option-list.tsx'
import {
  DEFAULT_VIRTUAL_MACHINE_BOOT_ORDER,
  DEFAULT_VIRTUAL_MACHINE_BUILD_MODE,
  DEFAULT_VIRTUAL_MACHINE_CPU_MODEL,
  DEFAULT_VIRTUAL_MACHINE_DISK_WRITE_MODE,
  DEFAULT_VIRTUAL_MACHINE_DISPLAY_MODE,
  DEFAULT_VIRTUAL_MACHINE_MEMORY_MB,
  DEFAULT_VIRTUAL_MACHINE_NAME,
  DEFAULT_VIRTUAL_MACHINE_NETWORK,
  DEFAULT_VIRTUAL_MACHINE_NETWORK_BACKEND,
  DEFAULT_VIRTUAL_MACHINE_OS_PRESET,
  DEFAULT_VIRTUAL_MACHINE_PC_TYPE,
  DEFAULT_VIRTUAL_MACHINE_POINTER_MODE,
  DEFAULT_VIRTUAL_MACHINE_RESOLUTION_AUTO_ALIGN,
  DEFAULT_VIRTUAL_MACHINE_VGA_MEMORY_MB,
  VM_BACKEND_IDS,
  VM_BOOT_ORDER_IDS,
  VM_BUILD_MODE_IDS,
  VM_CPU_MODEL_IDS,
  VM_DISK_WRITE_MODE_IDS,
  VM_DISPLAY_MODE_IDS,
  VM_NETWORK_BACKEND_IDS,
  VM_NETWORK_IDS,
  VM_PC_TYPE_IDS,
  VM_OS_PRESET_IDS,
  VM_POINTER_MODE_IDS,
  VM_MEMORY_MB_MAX,
  VM_MEMORY_MB_MIN,
  VM_MEMORY_MB_STEP,
  VM_STORAGE_DEVICE_LIMITS,
  VM_STORAGE_DEVICE_SOURCES,
  VM_STORAGE_DEVICE_TYPES,
  VM_VGA_MEMORY_MB_OPTIONS,
  type VmBackendId,
  type VmBootOrderId,
  type VmBuildModeId,
  type VmCpuModelId,
  type VmDiskWriteModeId,
  type VmDisplayModeId,
  type VmMemoryMb,
  type VmNetworkBackendId,
  type VmNetworkId,
  type VmOsPresetId,
  type VmPcTypeId,
  type VmPointerModeId,
  type VmStorageDevice,
  type VmStorageDeviceSource,
  type VmStorageDeviceType,
  type VmVgaMemoryMb,
  type VirtualMachineRecord,
  type VirtualMachineSettings,
} from './virtual-machine-types.ts'
import { isHttpDiskUrl } from './virtual-machine-protocol.ts'

export function defaultVirtualMachineSettings(
  name = DEFAULT_VIRTUAL_MACHINE_NAME,
): VirtualMachineSettings {
  return {
    name,
    backend: 'v86',
    buildMode: DEFAULT_VIRTUAL_MACHINE_BUILD_MODE,
    memoryMb: DEFAULT_VIRTUAL_MACHINE_MEMORY_MB,
    vgaMemoryMb: DEFAULT_VIRTUAL_MACHINE_VGA_MEMORY_MB,
    cpuModel: DEFAULT_VIRTUAL_MACHINE_CPU_MODEL,
    bootOrder: DEFAULT_VIRTUAL_MACHINE_BOOT_ORDER,
    acpi: false,
    fastboot: false,
    speaker: true,
    keyboard: true,
    mouse: true,
    pointerMode: DEFAULT_VIRTUAL_MACHINE_POINTER_MODE,
    diskWriteMode: DEFAULT_VIRTUAL_MACHINE_DISK_WRITE_MODE,
    resolutionAutoAlign: DEFAULT_VIRTUAL_MACHINE_RESOLUTION_AUTO_ALIGN,
    keyMappingEnabled: true,
    keyMappings: [],
    network: DEFAULT_VIRTUAL_MACHINE_NETWORK,
    networkBackend: DEFAULT_VIRTUAL_MACHINE_NETWORK_BACKEND,
    displayMode: DEFAULT_VIRTUAL_MACHINE_DISPLAY_MODE,
    devices: [],
    osPreset: DEFAULT_VIRTUAL_MACHINE_OS_PRESET,
    enhanceClipboard: true,
    enhanceFileTransfer: true,
    enhanceAbsoluteMouse: true,
  }
}

export function settingsFromRecord(record: VirtualMachineRecord): VirtualMachineSettings {
  return {
    name: record.name,
    backend: record.backend,
    buildMode: record.buildMode,
    memoryMb: record.memoryMb,
    vgaMemoryMb: record.vgaMemoryMb,
    cpuModel: record.cpuModel,
    bootOrder: record.bootOrder,
    acpi: record.acpi,
    fastboot: record.fastboot,
    speaker: record.speaker,
    keyboard: record.keyboard,
    mouse: record.mouse,
    pointerMode: record.pointerMode,
    diskWriteMode: record.diskWriteMode,
    resolutionAutoAlign: record.resolutionAutoAlign,
    keyMappingEnabled: record.keyMappingEnabled,
    keyMappings: record.keyMappings,
    network: record.network,
    networkBackend: record.networkBackend,
    displayMode: record.displayMode,
    devices: record.devices,
    osPreset: record.osPreset,
    enhanceClipboard: record.enhanceClipboard,
    enhanceFileTransfer: record.enhanceFileTransfer,
    enhanceAbsoluteMouse: record.enhanceAbsoluteMouse,
  }
}

export function createStorageDevice(
  type: VmStorageDeviceType,
  path: string,
): VmStorageDevice {
  return {
    id: `vm-device-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`,
    type,
    source: 'local',
    path,
  }
}

export function migrateLegacyDrivePaths(record: {
  hdaPath?: string
  cdromPath?: string
  fdaPath?: string
  statePath?: string
  devices?: VmStorageDevice[]
}): VmStorageDevice[] {
  if (Array.isArray(record.devices)) {
    return record.devices
  }
  const devices: VmStorageDevice[] = []
  const paths: { type: VmStorageDeviceType; path: string }[] = [
    { type: 'hdd', path: record.hdaPath ?? '' },
    { type: 'cdrom', path: record.cdromPath ?? '' },
    { type: 'floppy', path: record.fdaPath ?? '' },
    { type: 'state', path: record.statePath ?? '' },
  ]
  for (const { type, path } of paths) {
    const trimmed = path.trim()
    if (trimmed && !isHttpDiskUrl(trimmed)) {
      devices.push(createStorageDevice(type, trimmed))
    }
  }
  return devices
}

export function deviceTypeLabel(type: VmStorageDeviceType): string {
  if (type === 'hdd') {
    return '硬盘'
  }
  if (type === 'cdrom') {
    return '光盘'
  }
  if (type === 'floppy') {
    return '软盘'
  }
  return '快照'
}

export function deviceTypeSlotLabel(type: VmStorageDeviceType, index: number): string {
  const label = deviceTypeLabel(type)
  return `${label} ${index + 1}`
}

export function deviceAcceptExtensions(type: VmStorageDeviceType): readonly string[] {
  if (type === 'hdd') {
    return VM_HARD_DISK_ACCEPT_EXTENSIONS
  }
  if (type === 'cdrom') {
    return VM_CDROM_ACCEPT_EXTENSIONS
  }
  if (type === 'floppy') {
    return VM_FLOPPY_ACCEPT_EXTENSIONS
  }
  return VM_STATE_ACCEPT_EXTENSIONS
}

export function devicePickTitle(type: VmStorageDeviceType): string {
  if (type === 'hdd') {
    return '选择硬盘镜像'
  }
  if (type === 'cdrom') {
    return '选择光盘镜像'
  }
  if (type === 'floppy') {
    return '选择软盘镜像'
  }
  return '选择快照'
}

export function devicesByType(
  devices: readonly VmStorageDevice[],
  type: VmStorageDeviceType,
): VmStorageDevice[] {
  return devices.filter((device) => device.type === type)
}

export function canAddDeviceType(
  devices: readonly VmStorageDevice[],
  type: VmStorageDeviceType,
): boolean {
  const limit = VM_STORAGE_DEVICE_LIMITS.find((item) => item.type === type)
  if (!limit) {
    return false
  }
  return devices.filter((device) => device.type === type).length < limit.maxCount
}

export function isVmStorageDeviceType(value: string): value is VmStorageDeviceType {
  return (VM_STORAGE_DEVICE_TYPES as readonly string[]).includes(value)
}

export function isVmStorageDeviceSource(value: string): value is VmStorageDeviceSource {
  return (VM_STORAGE_DEVICE_SOURCES as readonly string[]).includes(value)
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
  ne2k: 'NE2000',
  virtio: 'VirtIO',
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
  auto: '自动',
  follow: '强制跟随',
  lock: '强制独占',
}

const DISK_WRITE_MODE_LABELS: Record<VmDiskWriteModeId, string> = {
  none: '不写入',
  live: '实时写入',
  poweroff: '关机时写入',
}

const BUILD_MODE_LABELS: Record<VmBuildModeId, string> = {
  debug: 'Debug（调试版）',
  release: 'Release（正式版）',
}

const CPU_MODEL_LABELS: Record<VmCpuModelId, string> = {
  default: '默认（Pentium III 级别）',
  'windows-nt4': 'Windows NT 4.0 兼容（CPUID level 2）',
}

const PC_TYPE_LABELS: Record<VmPcTypeId, string> = {
  standard: 'Standard PC',
  acpi: 'ACPI PC',
}

export function formatVmPointerModeLabel(id: VmPointerModeId): string {
  return POINTER_MODE_LABELS[id]
}

export function formatVmDiskWriteModeLabel(id: VmDiskWriteModeId): string {
  return DISK_WRITE_MODE_LABELS[id]
}

export function formatVmPointerModeRuntimeLabel(
  policy: VmPointerModeId,
  absoluteMouse: boolean | undefined,
): string {
  const base = formatVmPointerModeLabel(policy)
  // 绝对坐标接管期间 auto/lock 都按跟随生效，标签同步标注当前实际形态。
  if ((policy !== 'auto' && policy !== 'lock') || absoluteMouse === undefined) {
    return base
  }
  return `${base}（当前${absoluteMouse ? '跟随' : '独占'}）`
}

export function formatVmBuildModeLabel(id: VmBuildModeId): string {
  return BUILD_MODE_LABELS[id]
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

export function formatVmCpuModelLabel(id: VmCpuModelId): string {
  return CPU_MODEL_LABELS[id]
}

export function formatVmPcTypeLabel(id: VmPcTypeId): string {
  return PC_TYPE_LABELS[id]
}

export function pcTypeFromAcpi(acpi: boolean): VmPcTypeId {
  return acpi ? 'acpi' : 'standard'
}

export function acpiFromPcType(pcType: VmPcTypeId): boolean {
  return pcType === 'acpi'
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

export const VM_BUILD_MODE_CHOICES: readonly SettingsChoiceOption[] = VM_BUILD_MODE_IDS.map(
  (id) => ({
    id,
    label:
      id === DEFAULT_VIRTUAL_MACHINE_BUILD_MODE
        ? `${formatVmBuildModeLabel(id)} 默认`
        : formatVmBuildModeLabel(id),
  }),
)

export const VM_CPU_MODEL_CHOICES: readonly SettingsChoiceOption[] = VM_CPU_MODEL_IDS.map(
  (id) => ({
    id,
    label:
      id === DEFAULT_VIRTUAL_MACHINE_CPU_MODEL
        ? `${formatVmCpuModelLabel(id)} 默认`
        : formatVmCpuModelLabel(id),
  }),
)

export const VM_PC_TYPE_CHOICES: readonly SettingsChoiceOption[] = VM_PC_TYPE_IDS.map((id) => ({
  id,
  label:
    id === DEFAULT_VIRTUAL_MACHINE_PC_TYPE
      ? `${formatVmPcTypeLabel(id)} 默认`
      : formatVmPcTypeLabel(id),
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

export const VM_DISK_WRITE_MODE_CHOICES: readonly SettingsChoiceOption[] =
  VM_DISK_WRITE_MODE_IDS.map((id) => ({
    id,
    label:
      id === DEFAULT_VIRTUAL_MACHINE_DISK_WRITE_MODE
        ? `${formatVmDiskWriteModeLabel(id)} 默认`
        : formatVmDiskWriteModeLabel(id),
  }))

/** 体验增强的客机系统选择；目前只有 Windows XP，先占住位置。 */
export const VM_OS_PRESET_CHOICES: readonly SettingsChoiceOption[] = VM_OS_PRESET_IDS.map(
  (id) => ({ id, label: id === 'windows-xp' ? 'Windows XP' : id }),
)

export { VM_MEMORY_MB_MIN, VM_MEMORY_MB_MAX, VM_MEMORY_MB_STEP }
export { VM_STORAGE_DEVICE_LIMITS }

export const VM_HARD_DISK_ACCEPT_EXTENSIONS = ['img', 'raw', 'bin', 'dsk'] as const
export const VM_CDROM_ACCEPT_EXTENSIONS = ['iso'] as const
export const VM_FLOPPY_ACCEPT_EXTENSIONS = ['img', 'ima', 'bin'] as const
export const VM_STATE_ACCEPT_EXTENSIONS = ['bin', 'zst'] as const

export function isVmBackendId(value: string): value is VmBackendId {
  return (VM_BACKEND_IDS as readonly string[]).includes(value)
}

export function isVmMemoryMb(value: number): value is VmMemoryMb {
  return (
    Number.isInteger(value) &&
    value >= VM_MEMORY_MB_MIN &&
    value <= VM_MEMORY_MB_MAX &&
    value % VM_MEMORY_MB_STEP === 0
  )
}

export function clampVmMemoryMb(value: number): number {
  const rounded = Math.round(value / VM_MEMORY_MB_STEP) * VM_MEMORY_MB_STEP
  return Math.max(VM_MEMORY_MB_MIN, Math.min(VM_MEMORY_MB_MAX, rounded))
}

export function isVmVgaMemoryMb(value: number): value is VmVgaMemoryMb {
  return (VM_VGA_MEMORY_MB_OPTIONS as readonly number[]).includes(value)
}

export function isVmCpuModelId(value: string): value is VmCpuModelId {
  return (VM_CPU_MODEL_IDS as readonly string[]).includes(value)
}

export function isVmPcTypeId(value: string): value is VmPcTypeId {
  return (VM_PC_TYPE_IDS as readonly string[]).includes(value)
}

export function cpuidLevelForCpuModel(id: VmCpuModelId): number | undefined {
  if (id === 'windows-nt4') {
    return 2
  }
  return undefined
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

export function isVmDiskWriteModeId(value: string): value is VmDiskWriteModeId {
  return (VM_DISK_WRITE_MODE_IDS as readonly string[]).includes(value)
}

export function isVmBuildModeId(value: string): value is VmBuildModeId {
  return (VM_BUILD_MODE_IDS as readonly string[]).includes(value)
}

export function isVmOsPresetId(value: string): value is VmOsPresetId {
  return (VM_OS_PRESET_IDS as readonly string[]).includes(value)
}
