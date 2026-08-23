import { isHttpDiskUrl } from './virtual-machine-protocol.ts'
import type {
  VmBootOrderId,
  VmMemoryMb,
  VirtualMachineSettings,
  VmStorageDevice,
} from './virtual-machine-types.ts'

/** @deprecated 旧固定槽位 ID，仅作迁移/兼容用。 */
export const VM_DRIVE_IDS = ['hdaPath', 'cdromPath', 'fdaPath', 'statePath'] as const

/** @deprecated 旧固定槽位 ID 类型。 */
export type VmDriveId = (typeof VM_DRIVE_IDS)[number]

export type VmDriveSourceId = 'local' | 'network' | 'preset'

export const VM_DRIVE_SOURCE_IDS = ['local', 'network', 'preset'] as const

/** @deprecated 旧固定槽位标签，保留供外部引用。 */
export const VM_DRIVE_LABELS: Record<VmDriveId, string> = {
  hdaPath: '硬盘',
  cdromPath: '光盘',
  fdaPath: '软盘',
  statePath: '快照',
}

export const VM_DRIVE_SOURCE_LABELS: Record<VmDriveSourceId, string> = {
  local: '本地',
  network: '网络',
  preset: '预制',
}

export const VM_PRESET_ANDROID_CDROM_URL = 'https://i.copy.sh/android-x86-1.6-r2/.iso'
export const VM_PRESET_REACTOS_HDA_URL = 'https://i.copy.sh/reactos-v3/.img'
export const VM_PRESET_REACTOS_STATE_URL = 'https://i.copy.sh/reactos_state-v3.bin.zst'

export const VM_GUEST_PRESET_IDS = ['android-x86-1.6-r2', 'reactos'] as const

export type VmGuestPresetId = (typeof VM_GUEST_PRESET_IDS)[number]

export type VmGuestPreset = {
  id: VmGuestPresetId
  name: string
  detail: string
  memoryMb: VmMemoryMb
  acpi: boolean
  bootOrder: VmBootOrderId
  devices: VmStorageDevice[]
}

function createDevice(
  type: VmStorageDevice['type'],
  path: string,
): VmStorageDevice {
  return {
    id: `vm-preset-${type}-${Date.now().toString(36)}`,
    type,
    source: 'preset',
    path,
  }
}

/** copy.sh 公开镜像；CORS 为 `*`，运行时 iframe 可直接按块拉取。 */
export const VM_GUEST_PRESETS: readonly VmGuestPreset[] = [
  {
    id: 'android-x86-1.6-r2',
    name: 'Android-x86 1.6-r2',
    detail: 'copy.sh 光盘，约 54 MB 分片 ISO。内存 512 MB，光盘启动。',
    memoryMb: 512,
    acpi: false,
    bootOrder: 'cd-floppy-hdd',
    devices: [createDevice('cdrom', VM_PRESET_ANDROID_CDROM_URL)],
  },
  {
    id: 'reactos',
    name: 'ReactOS',
    detail: 'copy.sh 硬盘 + 约 17 MB 快照。内存 512 MB，打开 ACPI，按块拉取。',
    memoryMb: 512,
    acpi: true,
    bootOrder: 'auto',
    devices: [
      createDevice('hdd', VM_PRESET_REACTOS_HDA_URL),
      createDevice('state', VM_PRESET_REACTOS_STATE_URL),
    ],
  },
]

/** @deprecated 用 settings.devices 数组代替。 */
export function emptyDrivePaths(): {
  hdaPath: string
  cdromPath: string
  fdaPath: string
  statePath: string
} {
  return {
    hdaPath: '',
    cdromPath: '',
    fdaPath: '',
    statePath: '',
  }
}

export function inferDriveSource(path: string): VmDriveSourceId {
  const trimmed = path.trim()
  if (!trimmed) {
    return 'local'
  }
  if (isGuestPresetPath(trimmed)) {
    return 'preset'
  }
  if (isHttpDiskUrl(trimmed)) {
    return 'network'
  }
  return 'local'
}

/** @deprecated 用 inferStorageDeviceSource 代替。 */
export function inferDriveSources(settings: {
  hdaPath: string
  cdromPath: string
  fdaPath: string
  statePath: string
}): Record<VmDriveId, VmDriveSourceId> {
  return {
    hdaPath: inferDriveSource(settings.hdaPath),
    cdromPath: inferDriveSource(settings.cdromPath),
    fdaPath: inferDriveSource(settings.fdaPath),
    statePath: inferDriveSource(settings.statePath),
  }
}

export function isGuestPresetPath(path: string): boolean {
  const trimmed = path.trim()
  if (!trimmed) {
    return false
  }
  return VM_GUEST_PRESETS.some((preset) =>
    preset.devices.some((device) => device.path === trimmed),
  )
}

export function guestPresetMatches(
  settings: VirtualMachineSettings,
  preset: VmGuestPreset,
): boolean {
  if (preset.devices.length === 0) {
    return settings.devices.length === 0
  }
  const trimmedPaths = new Set(settings.devices.map((device) => device.path.trim()))
  return preset.devices.every((device) => trimmedPaths.has(device.path.trim()))
}

export function detectAppliedGuestPreset(
  settings: VirtualMachineSettings,
): VmGuestPresetId | undefined {
  return VM_GUEST_PRESETS.find((preset) => guestPresetMatches(settings, preset))?.id
}

export function applyGuestPreset(
  settings: VirtualMachineSettings,
  presetId: VmGuestPresetId,
): VirtualMachineSettings {
  const preset = VM_GUEST_PRESETS.find((item) => item.id === presetId)
  if (!preset) {
    return settings
  }
  return {
    ...settings,
    memoryMb: preset.memoryMb,
    acpi: preset.acpi,
    bootOrder: preset.bootOrder,
    devices: preset.devices.map((device) => ({ ...device, id: createDevice(device.type, device.path).id })),
  }
}

export function primaryDriveForPreset(presetId: VmGuestPresetId): 'cdrom' | 'hdd' | 'state' {
  const preset = VM_GUEST_PRESETS.find((item) => item.id === presetId)
  const first = preset?.devices[0]
  if (!first) {
    return 'state'
  }
  if (first.type === 'cdrom') {
    return 'cdrom'
  }
  if (first.type === 'hdd') {
    return 'hdd'
  }
  return 'state'
}
