export const VM_BACKEND_IDS = ['v86'] as const

export type VmBackendId = (typeof VM_BACKEND_IDS)[number]

/** 画面呈现比例，不影响 Guest 内部分辨率。 */
export const VM_DISPLAY_MODE_IDS = ['stretch', 'contain', 'native'] as const

export type VmDisplayModeId = (typeof VM_DISPLAY_MODE_IDS)[number]

export const DEFAULT_VIRTUAL_MACHINE_DISPLAY_MODE: VmDisplayModeId = 'contain'

/** v86 用有符号 32 位处理 `memory_size`，2048 MB 会溢出；16 MB 步进下最大可用 2032 MB。 */
export type VmMemoryMb = number

export const VM_MEMORY_MB_MIN = 16
export const VM_MEMORY_MB_MAX = 2032
export const VM_MEMORY_MB_STEP = 16
export const DEFAULT_VIRTUAL_MACHINE_MEMORY_MB: VmMemoryMb = 64

/** 对应 v86 `vga_memory_size`。 */
export const VM_VGA_MEMORY_MB_OPTIONS = [2, 4, 8, 16] as const

export type VmVgaMemoryMb = (typeof VM_VGA_MEMORY_MB_OPTIONS)[number]

export const DEFAULT_VIRTUAL_MACHINE_VGA_MEMORY_MB: VmVgaMemoryMb = 8

/**
 * v86 能调整的「处理器」参数只有 `cpuid_level`。
 * - `default`：不覆盖，使用 v86 默认值（Pentium III 级别）。
 * - `windows-nt4`：cpuid_level=2，供 Windows NT 4.0 等老系统启动。
 */
export const VM_CPU_MODEL_IDS = ['default', 'windows-nt4'] as const

export type VmCpuModelId = (typeof VM_CPU_MODEL_IDS)[number]

export const DEFAULT_VIRTUAL_MACHINE_CPU_MODEL: VmCpuModelId = 'default'

/**
 * 对应 Windows 安装程序中的 HAL 选择，以及 v86 `acpi` 开关。
 * - `standard`：Standard PC（acpi=false）
 * - `acpi`：ACPI PC（acpi=true）
 */
export const VM_PC_TYPE_IDS = ['standard', 'acpi'] as const

export type VmPcTypeId = (typeof VM_PC_TYPE_IDS)[number]

export const DEFAULT_VIRTUAL_MACHINE_PC_TYPE: VmPcTypeId = 'standard'

/**
 * 对应 v86 `BootOrder`。
 * AUTO / CD_FLOPPY_HARDDISK / CD_HARDDISK_FLOPPY / FLOPPY_CD_HARDDISK /
 * FLOPPY_HARDDISK_CD / HARDDISK_CD_FLOPPY
 */
export const VM_BOOT_ORDER_IDS = [
  'auto',
  'cd-floppy-hdd',
  'cd-hdd-floppy',
  'floppy-cd-hdd',
  'floppy-hdd-cd',
  'hdd-cd-floppy',
] as const

export type VmBootOrderId = (typeof VM_BOOT_ORDER_IDS)[number]

export const DEFAULT_VIRTUAL_MACHINE_BOOT_ORDER: VmBootOrderId = 'auto'

/** `none` 不挂网卡；其余对应 v86 `net_device.type`。 */
export const VM_NETWORK_IDS = ['none', 'ne2k', 'virtio'] as const

export type VmNetworkId = (typeof VM_NETWORK_IDS)[number]

export const DEFAULT_VIRTUAL_MACHINE_NETWORK: VmNetworkId = 'none'

/** `off` 网卡不接线（保持离线）；`fetch` 使用 V86 内置 fetch 后端（仅 HTTP，需目标站放行 CORS）。 */
export const VM_NETWORK_BACKEND_IDS = ['off', 'fetch'] as const

export type VmNetworkBackendId = (typeof VM_NETWORK_BACKEND_IDS)[number]

export const DEFAULT_VIRTUAL_MACHINE_NETWORK_BACKEND: VmNetworkBackendId = 'off'

/** 指针工作方式：`auto` 按客机绝对坐标能力自动切换；`follow` 强制跟随；`lock` 强制独占。 */
export const VM_POINTER_MODE_IDS = ['auto', 'follow', 'lock'] as const

export type VmPointerModeId = (typeof VM_POINTER_MODE_IDS)[number]

export const DEFAULT_VIRTUAL_MACHINE_POINTER_MODE: VmPointerModeId = 'auto'

/** V86 构建模式：`debug`（未压缩，可单步调试）；`release`（压缩混淆，性能更好）。 */
export const VM_BUILD_MODE_IDS = ['debug', 'release'] as const

export type VmBuildModeId = (typeof VM_BUILD_MODE_IDS)[number]

export const DEFAULT_VIRTUAL_MACHINE_BUILD_MODE: VmBuildModeId = 'release'

export const DEFAULT_VIRTUAL_MACHINE_ID = 'vm-default'
export const DEFAULT_VIRTUAL_MACHINE_NAME = '未命名虚拟机'

export const VIRTUAL_MACHINE_NAME_MAX_LENGTH = 80
export const VIRTUAL_MACHINE_PATH_MAX_LENGTH = 500

export const VM_STORAGE_DEVICE_TYPES = ['hdd', 'cdrom', 'floppy', 'state'] as const

export type VmStorageDeviceType = (typeof VM_STORAGE_DEVICE_TYPES)[number]

export const VM_STORAGE_DEVICE_SOURCES = ['local', 'network', 'preset'] as const

export type VmStorageDeviceSource = (typeof VM_STORAGE_DEVICE_SOURCES)[number]

export type VmStorageDevice = {
  id: string
  type: VmStorageDeviceType
  source: VmStorageDeviceSource
  path: string
}

export type VirtualMachineSettings = {
  name: string
  backend: VmBackendId
  buildMode: VmBuildModeId
  memoryMb: VmMemoryMb
  vgaMemoryMb: VmVgaMemoryMb
  cpuModel: VmCpuModelId
  bootOrder: VmBootOrderId
  acpi: boolean
  fastboot: boolean
  speaker: boolean
  keyboard: boolean
  mouse: boolean
  pointerMode: VmPointerModeId
  network: VmNetworkId
  networkBackend: VmNetworkBackendId
  displayMode: VmDisplayModeId
  devices: VmStorageDevice[]
}

export type VirtualMachineRecord = VirtualMachineSettings & {
  id: string
  createdAt: number
}

export type VirtualMachineStore = {
  machines: VirtualMachineRecord[]
}

export type VmStorageDeviceTypeWithLimits = {
  type: VmStorageDeviceType
  maxCount: number
}

export const VM_STORAGE_DEVICE_LIMITS: readonly VmStorageDeviceTypeWithLimits[] = [
  { type: 'hdd', maxCount: 2 },
  { type: 'cdrom', maxCount: 1 },
  { type: 'floppy', maxCount: 2 },
  { type: 'state', maxCount: 1 },
] as const
