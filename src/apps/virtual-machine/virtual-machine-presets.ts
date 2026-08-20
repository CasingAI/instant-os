import { isHttpDiskUrl } from './virtual-machine-protocol.ts'
import type {
  VmBootOrderId,
  VmMemoryMb,
  VirtualMachineSettings,
} from './virtual-machine-types.ts'

export const VM_DRIVE_IDS = ['hdaPath', 'cdromPath', 'fdaPath', 'statePath'] as const

export type VmDriveId = (typeof VM_DRIVE_IDS)[number]

export type VmDriveSourceId = 'local' | 'network' | 'preset'

export const VM_DRIVE_SOURCE_IDS = ['local', 'network', 'preset'] as const

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
  paths: Partial<Record<VmDriveId, string>>
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
    paths: {
      cdromPath: VM_PRESET_ANDROID_CDROM_URL,
    },
  },
  {
    id: 'reactos',
    name: 'ReactOS',
    detail: 'copy.sh 硬盘 + 约 17 MB 快照。内存 512 MB，打开 ACPI，按块拉取。',
    memoryMb: 512,
    acpi: true,
    bootOrder: 'auto',
    paths: {
      hdaPath: VM_PRESET_REACTOS_HDA_URL,
      statePath: VM_PRESET_REACTOS_STATE_URL,
    },
  },
]

type DrivePaths = Pick<VirtualMachineSettings, VmDriveId>

export function emptyDrivePaths(): DrivePaths {
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

export function inferDriveSources(settings: DrivePaths): Record<VmDriveId, VmDriveSourceId> {
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
    VM_DRIVE_IDS.some((drive) => preset.paths[drive] === trimmed),
  )
}

export function guestPresetMatches(settings: DrivePaths, preset: VmGuestPreset): boolean {
  return VM_DRIVE_IDS.every((drive) => {
    const expected = preset.paths[drive] ?? ''
    return settings[drive].trim() === expected
  })
}

export function detectAppliedGuestPreset(settings: DrivePaths): VmGuestPresetId | undefined {
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
    ...emptyDrivePaths(),
    ...preset.paths,
  }
}

export function primaryDriveForPreset(presetId: VmGuestPresetId): VmDriveId {
  const preset = VM_GUEST_PRESETS.find((item) => item.id === presetId)
  if (preset?.paths.hdaPath) {
    return 'hdaPath'
  }
  if (preset?.paths.cdromPath) {
    return 'cdromPath'
  }
  if (preset?.paths.fdaPath) {
    return 'fdaPath'
  }
  return 'statePath'
}
