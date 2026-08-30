import type { VmKeyMapping } from './virtual-machine-keymap.ts'

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

/**
 * 对应 v86 `vga_memory_size`。默认 16MB：任意分辨率直推后密阶梯最大档
 * 需 ~15.5MiB（2552×1595×32），低于此值高分辨率模式会被驱动显存校验拒绝
 * （todo/vm-arbitrary-resolution R9）。上限 256MB 为 v86 硬上限
 * （vga.js `VGA_MAX_MEMORY_SIZE`），v86 会把非 2 的幂向上取整。
 */
export const VM_VGA_MEMORY_MB_OPTIONS = [2, 4, 8, 16, 32, 64, 128, 256] as const

export type VmVgaMemoryMb = (typeof VM_VGA_MEMORY_MB_OPTIONS)[number]

export const DEFAULT_VIRTUAL_MACHINE_VGA_MEMORY_MB: VmVgaMemoryMb = 16

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

/**
 * 体验增强面向的客机系统。`none` 表示不启用增强：客机不是 XP（或暂不参与），
 * 选中后体验增强各子项全部停用，电源动作也按「无 Agent」静态判定为断电。
 * 其他系统的增强组件（agent、驱动）还没有做，先不让选。
 */
export const VM_OS_PRESET_IDS = ['windows-xp', 'none'] as const

export type VmOsPresetId = (typeof VM_OS_PRESET_IDS)[number]

/**
 * 默认「不启用增强」：宿主无法得知客机里装没装增强组件（agent、驱动），
 * 新建虚拟机按无增强对待（电源动作呈现断电），用户选了 Windows XP 才开启。
 */
export const DEFAULT_VIRTUAL_MACHINE_OS_PRESET: VmOsPresetId = 'none'

/**
 * 各客机预设是否带增强组件（ivm-agent）：决定电源动作呈现为「关机」（优雅关机）
 * 还是「断电」（硬切电源）。按预设静态判定，不随运行时心跳翻转——Agent 瞬时
 * 失联时按钮仍是「关机」，点按走现场验证护栏，不会悄悄变成硬断电。
 */
export const VM_OS_PRESET_AGENT_SUPPORTED: Record<VmOsPresetId, boolean> = {
  'windows-xp': true,
  none: false,
}

/** 指针工作方式：`auto` 按客机绝对坐标能力自动切换；`follow` 强制跟随；`lock` 强制独占。
 * 绝对坐标接管期间 auto/lock 一律按跟随生效（独占 + 绝对坐标 = 指针消失），退出后恢复独占。 */
export const VM_POINTER_MODE_IDS = ['auto', 'follow', 'lock'] as const

export type VmPointerModeId = (typeof VM_POINTER_MODE_IDS)[number]

export const DEFAULT_VIRTUAL_MACHINE_POINTER_MODE: VmPointerModeId = 'auto'

/**
 * 硬盘回写时机。
 * - `none`：客户机改动只留在内存，要保留就靠快照，不改镜像。
 * - `live`：运行中把扇区写回镜像。
 * - `poweroff`：运行中只攒脏块，关机/断电时一次性刷入镜像。
 */
export const VM_DISK_WRITE_MODE_IDS = ['none', 'live', 'poweroff'] as const

export type VmDiskWriteModeId = (typeof VM_DISK_WRITE_MODE_IDS)[number]

export const DEFAULT_VIRTUAL_MACHINE_DISK_WRITE_MODE: VmDiskWriteModeId = 'none'

/**
 * 分辨率自动对齐：宿主视口尺寸变化时把目标分辨率递给客机代理（经 io 端口），
 * 客机内部走标准模式切换路径。默认关：不装客机代理的镜像完全不受影响。
 */
export const DEFAULT_VIRTUAL_MACHINE_RESOLUTION_AUTO_ALIGN = false

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

/** 存储只挂本地文件。旧的 `network` / `preset` 来源读入时迁成 `local`。 */
export const VM_STORAGE_DEVICE_SOURCES = ['local'] as const

export type VmStorageDeviceSource = (typeof VM_STORAGE_DEVICE_SOURCES)[number]

export type VmStorageDevice = {
  id: string
  type: VmStorageDeviceType
  source: VmStorageDeviceSource
  path: string
  /**
   * 是否连接到虚拟机。缺省视为已连接；仅显式 false 表示弹出/断开
   * （光驱空托盘、软驱空驱）。光盘/软盘运行中可热切换，硬盘只在关机时生效。
   */
  connected?: boolean
}

/** 可以热插拔的存储类型：运行中允许切换连接状态。 */
export function isVmRemovableDeviceType(type: VmStorageDeviceType): boolean {
  return type === 'cdrom' || type === 'floppy'
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
  diskWriteMode: VmDiskWriteModeId
  resolutionAutoAlign: boolean
  /** 按键映射总开关；关闭时不改写任何按键（规则保留）。 */
  keyMappingEnabled: boolean
  /** 物理键 → 目标键改写规则，注入客机前由宿主翻译。 */
  keyMappings: VmKeyMapping[]
  network: VmNetworkId
  networkBackend: VmNetworkBackendId
  displayMode: VmDisplayModeId
  devices: VmStorageDevice[]
  /** 体验增强面向的客机系统；目前仅 Windows XP 可选。 */
  osPreset: VmOsPresetId
  /** 剪贴板同步：宿主与客机之间互相同步文本剪贴板。 */
  enhanceClipboard: boolean
  /** 文件互传：宿主 Files 与客机资源管理器之间互拷文件。 */
  enhanceFileTransfer: boolean
  /** 绝对坐标鼠标：客机装好 VMware 鼠标驱动后光标 1:1 跟随宿主光标。 */
  enhanceAbsoluteMouse: boolean
  /** 窗口吸附：客机内拖窗口到屏幕边缘贴半屏/最大化（Aero Snap，OP_SNAP 下发）。 */
  enhanceWindowSnap: boolean
}

export type VirtualMachineRecord = VirtualMachineSettings & {
  id: string
  createdAt: number
}

export type VirtualMachineStore = {
  machines: VirtualMachineRecord[]
  /** 上一次选中的虚拟机：打开 App 时自动恢复选中。悬空 id（机器已删）由读取方校验后忽略。 */
  lastSelectedId?: string
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
