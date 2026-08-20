export const VM_BACKEND_IDS = ['v86'] as const

export type VmBackendId = (typeof VM_BACKEND_IDS)[number]

/** v86 `memory_size` 要求 2 的幂；浏览器里再往上容易把标签页撑爆。 */
export const VM_MEMORY_MB_OPTIONS = [16, 32, 64, 128, 256, 512] as const

export type VmMemoryMb = (typeof VM_MEMORY_MB_OPTIONS)[number]

export const DEFAULT_VIRTUAL_MACHINE_MEMORY_MB: VmMemoryMb = 64

/** 对应 v86 `vga_memory_size`。 */
export const VM_VGA_MEMORY_MB_OPTIONS = [2, 4, 8, 16] as const

export type VmVgaMemoryMb = (typeof VM_VGA_MEMORY_MB_OPTIONS)[number]

export const DEFAULT_VIRTUAL_MACHINE_VGA_MEMORY_MB: VmVgaMemoryMb = 8

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

export const DEFAULT_VIRTUAL_MACHINE_ID = 'vm-default'
export const DEFAULT_VIRTUAL_MACHINE_NAME = '未命名虚拟机'

export const VIRTUAL_MACHINE_NAME_MAX_LENGTH = 80
export const VIRTUAL_MACHINE_PATH_MAX_LENGTH = 500

export type VirtualMachineSettings = {
  name: string
  backend: VmBackendId
  memoryMb: VmMemoryMb
  vgaMemoryMb: VmVgaMemoryMb
  bootOrder: VmBootOrderId
  acpi: boolean
  fastboot: boolean
  speaker: boolean
  keyboard: boolean
  mouse: boolean
  network: VmNetworkId
  hdaPath: string
  cdromPath: string
  fdaPath: string
  statePath: string
}

export type VirtualMachineRecord = VirtualMachineSettings & {
  id: string
  createdAt: number
}

export type VirtualMachineStore = {
  machines: VirtualMachineRecord[]
}
