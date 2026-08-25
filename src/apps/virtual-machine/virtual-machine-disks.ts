import {
  filesCreateSparseBinary,
  filesMkdir,
  filesReadBlob,
  filesStat,
} from '../files/files-api.ts'
import { isDiskImageFileName } from '../files/files-disk-image-name.ts'
import { recordSystemDebugTimeline } from '../../os/system-debug-log.ts'
import {
  claimDiskImagePath,
  releaseDiskImagePath,
  releaseDiskImagePathsForOccupant,
} from '../files/files-disk-image-occupancy.ts'
import {
  cpuidLevelForCpuModel,
  deviceTypeLabel,
} from './virtual-machine-config.ts'
import {
  registerVirtualMachineDiskStream,
  releaseVirtualMachineDiskStream,
} from './virtual-machine-disk-stream-host.ts'
import {
  INSTANT_VM_MESSAGE_TYPE,
  collectStartTransfers,
  isHttpDiskUrl,
  type InstantVmDiskStreamRef,
  type InstantVmStartConfig,
  type InstantVmStartMessage,
} from './virtual-machine-protocol.ts'
import type {
  VirtualMachineSettings,
  VmStorageDevice,
  VmStorageDeviceType,
} from './virtual-machine-types.ts'

export const VM_BLANK_DISK_DIR = '/user/Disks'
export const VM_BLANK_DISK_MIN_SIZE_MB = 16
export const VM_BLANK_DISK_MAX_SIZE_MB = 2048
export const VM_BLANK_DISK_DEFAULT_SIZE_MB = 128
export const VM_BLANK_DISK_SIZE_STEP_MB = 16

export type CreateBlankDiskOptions = {
  name?: string
  sizeMb: number
}

const BLANK_DISK_CHUNK_BYTES = 1024 * 1024

function clampBlankDiskSizeMb(sizeMb: number): number {
  const rounded = Math.round(sizeMb / VM_BLANK_DISK_SIZE_STEP_MB) * VM_BLANK_DISK_SIZE_STEP_MB
  return Math.max(
    VM_BLANK_DISK_MIN_SIZE_MB,
    Math.min(VM_BLANK_DISK_MAX_SIZE_MB, rounded),
  )
}

function normalizeBlankDiskName(raw: string): string {
  const trimmed = raw
    .trim()
    .replace(/[\\/:\u0000-\u001f\u007f]/g, '')
    .slice(0, 128)
  const name = trimmed || 'blank'
  return name.endsWith('.img') || name.endsWith('.raw') ? name : `${name}.img`
}

async function ensureBlankDiskDir(): Promise<void> {
  const stat = await filesStat(VM_BLANK_DISK_DIR)
  if (stat) {
    if (stat.kind !== 'folder') {
      throw new Error(`${VM_BLANK_DISK_DIR} 不是文件夹`)
    }
    return
  }
  await filesMkdir(VM_BLANK_DISK_DIR)
}

export async function createBlankVirtualMachineDisk(
  options: CreateBlankDiskOptions,
): Promise<string> {
  const sizeMb = clampBlankDiskSizeMb(options.sizeMb)
  const name = normalizeBlankDiskName(options.name ?? 'blank')
  await ensureBlankDiskDir()
  const path = `${VM_BLANK_DISK_DIR}/${name}`
  const existing = await filesStat(path)
  if (existing) {
    throw new Error(`文件已存在：${name}`)
  }
  await filesCreateSparseBinary(path, sizeMb * 1024 * 1024, {
    chunkSize: BLANK_DISK_CHUNK_BYTES,
  })
  return path
}

export function virtualMachineHasBootMedia(
  settings: Pick<VirtualMachineSettings, 'devices'>,
): boolean {
  return settings.devices.some(
    (device) =>
      (device.type === 'hdd' || device.type === 'cdrom' || device.type === 'floppy') &&
      device.path.trim().length > 0,
  )
}

export function settingsToStartConfig(settings: VirtualMachineSettings): InstantVmStartConfig {
  const cpuidLevel = cpuidLevelForCpuModel(settings.cpuModel)
  return {
    memoryMb: settings.memoryMb,
    vgaMemoryMb: settings.vgaMemoryMb,
    bootOrder: settings.bootOrder,
    acpi: settings.acpi,
    fastboot: settings.fastboot,
    speaker: settings.speaker,
    keyboard: settings.keyboard,
    mouse: settings.mouse,
    network: settings.network,
    networkBackend: settings.networkBackend,
    displayMode: settings.displayMode,
    pointerMode: settings.pointerMode,
    diskWriteMode: settings.diskWriteMode,
    ...(cpuidLevel !== undefined ? { cpuidLevel } : {}),
  }
}

/** 超过此阈值的本地卷镜像走范围流式读取，避免整文件分配 ArrayBuffer。 */
const DISK_BLOB_THRESHOLD_BYTES = 256 * 1024 * 1024

function isMountPath(path: string): boolean {
  return path.startsWith('/mount/')
}

export function virtualMachineMountWriteBackError(label: string, path: string): string {
  return `无法回写${label} ${path}：镜像在挂载目录上。挂载卷按偏移写会重写整份文件，不能用于实时或关机回写。请把镜像放到内部卷，或将硬盘写入设为不写入。`
}

export function assertVirtualMachineDiskCanPersistWrites(path: string, label: string): void {
  if (isMountPath(path.trim())) {
    throw new Error(virtualMachineMountWriteBackError(label, path.trim()))
  }
}

type LoadedDisk = {
  buffer?: ArrayBuffer
  blob?: Blob
  url?: string
  stream?: InstantVmDiskStreamRef
}

const SLOT_ORDER: Record<VmStorageDeviceType, ('hda' | 'hdb' | 'cdrom' | 'fda' | 'fdb' | 'state')[]> = {
  hdd: ['hda', 'hdb'],
  cdrom: ['cdrom'],
  floppy: ['fda', 'fdb'],
  state: ['state'],
}

type SlotName = 'hda' | 'hdb' | 'cdrom' | 'fda' | 'fdb' | 'state'

type SlotAssignment = {
  slot: SlotName
  label: string
  device: VmStorageDevice
}

export type VmMountedDiskSlots = {
  hda: boolean
  hdb: boolean
  cdrom: boolean
  fda: boolean
  fdb: boolean
}

export function emptyVmMountedDiskSlots(): VmMountedDiskSlots {
  return {
    hda: false,
    hdb: false,
    cdrom: false,
    fda: false,
    fdb: false,
  }
}

function assignDevicesToSlots(devices: readonly VmStorageDevice[]): SlotAssignment[] {
  const used = new Map<VmStorageDeviceType, number>()
  const assignments: SlotAssignment[] = []
  for (const device of devices) {
    if (!device.path.trim()) {
      continue
    }
    const index = used.get(device.type) ?? 0
    const slots = SLOT_ORDER[device.type]
    if (index >= slots.length) {
      continue
    }
    used.set(device.type, index + 1)
    assignments.push({ slot: slots[index], label: deviceTypeLabel(device.type), device })
  }
  return assignments
}

/** 设置里已填路径的存储槽位。指示灯按这个判断，不依赖模拟器回报的 present。 */
export function vmMountedDiskSlots(
  devices: readonly VmStorageDevice[] | undefined,
): VmMountedDiskSlots {
  const mounted = emptyVmMountedDiskSlots()
  if (!devices) {
    return mounted
  }
  for (const assignment of assignDevicesToSlots(devices)) {
    if (assignment.slot === 'state') {
      continue
    }
    mounted[assignment.slot] = true
  }
  return mounted
}

export function virtualMachineDiskPersistsWrites(
  type: VmStorageDeviceType,
  diskWriteMode: VirtualMachineSettings['diskWriteMode'] = 'none',
): boolean {
  if (diskWriteMode === 'none') {
    return false
  }
  return type === 'hdd' || type === 'floppy'
}

function fileNameOfPath(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(slash + 1) : path
}

export function claimVirtualMachineDiskImageOccupancy(
  machineId: string,
  devices: readonly VmStorageDevice[],
): void {
  const occupant = { kind: 'vm' as const, id: machineId }
  const claimed: string[] = []
  try {
    for (const device of devices) {
      if (device.type === 'state') continue
      const path = device.path.trim()
      if (!path || isHttpDiskUrl(path)) continue
      if (!isDiskImageFileName(fileNameOfPath(path))) continue
      claimDiskImagePath(path, occupant)
      claimed.push(path)
    }
  } catch (error) {
    for (const path of claimed) {
      releaseDiskImagePath(path, occupant)
    }
    throw error
  }
}

export function releaseVirtualMachineDiskImageOccupancy(machineId: string): void {
  releaseDiskImagePathsForOccupant({ kind: 'vm', id: machineId })
}

async function loadDisk(
  path: string,
  label: string,
  options: { persist?: boolean; stream?: boolean } = {},
): Promise<LoadedDisk> {
  const trimmed = path.trim()
  if (!trimmed) {
    return {}
  }
  if (isHttpDiskUrl(trimmed)) {
    throw new Error(`${label}只支持本地文件，不能从网络加载`)
  }

  const stat = await filesStat(trimmed)
  if (!stat || stat.kind !== 'file') {
    throw new Error(`无法读取${label} ${trimmed}：文件不存在`)
  }

  const persist = options.persist === true
  if (persist) {
    assertVirtualMachineDiskCanPersistWrites(trimmed, label)
    const id = await registerVirtualMachineDiskStream(trimmed, { writable: true })
    return { stream: { id, size: stat.byteSize } }
  }

  const allowStream = options.stream !== false
  if (allowStream && !isMountPath(trimmed) && stat.byteSize > DISK_BLOB_THRESHOLD_BYTES) {
    const id = await registerVirtualMachineDiskStream(trimmed, { writable: false })
    return { stream: { id, size: stat.byteSize } }
  }

  try {
    const readStartAt = performance.now()
    const blob = await filesReadBlob(trimmed)
    if (blob.size > DISK_BLOB_THRESHOLD_BYTES) {
      return { blob }
    }
    // 整读进内存：≤256MB 的盘（含全部 state 快照恢复路径）
    const buffer = await blob.arrayBuffer()
    recordSystemDebugTimeline({
      layer: 'vm',
      op: 'disk-load-buffer',
      detail: `${label} ${buffer.byteLength}B`,
      durationMs: Math.round(performance.now() - readStartAt),
    })
    return { buffer }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`无法读取${label} ${trimmed}：${detail}`)
  }
}

export async function loadVirtualMachineDisks(
  settings: Pick<VirtualMachineSettings, 'devices' | 'diskWriteMode'>,
): Promise<Partial<Pick<InstantVmStartMessage, SlotName | `${SlotName}Blob` | `${SlotName}Url` | `${SlotName}Stream`>>> {
  const assignments = assignDevicesToSlots(settings.devices)
  const loadedStreams: InstantVmDiskStreamRef[] = []
  const results = await Promise.allSettled(
    assignments.map(async (assignment) => {
      const loaded = await loadDisk(assignment.device.path, assignment.label, {
        persist: virtualMachineDiskPersistsWrites(
          assignment.device.type,
          settings.diskWriteMode,
        ),
        stream: assignment.device.type !== 'state',
      })
      if (loaded.stream) {
        loadedStreams.push(loaded.stream)
      }
      return { slot: assignment.slot, ...loaded }
    }),
  )
  const firstError = results.find((item) => item.status === 'rejected')
  if (firstError) {
    await Promise.all(
      loadedStreams.map((stream) =>
        releaseVirtualMachineDiskStream(stream.id).catch(() => undefined),
      ),
    )
    throw firstError.reason
  }
  const result: Partial<Pick<InstantVmStartMessage, SlotName | `${SlotName}Blob` | `${SlotName}Url` | `${SlotName}Stream`>> = {}
  for (const item of results) {
    if (item.status !== 'fulfilled') continue
    const loaded = item.value
    const slot = loaded.slot
    if (loaded.buffer) {
      result[slot] = loaded.buffer
    }
    if (loaded.blob) {
      result[`${slot}Blob`] = loaded.blob
    }
    if (loaded.url) {
      result[`${slot}Url`] = loaded.url
    }
    if (loaded.stream) {
      result[`${slot}Stream`] = loaded.stream
    }
  }
  return result
}

export function buildStartMessage(
  requestId: string,
  settings: VirtualMachineSettings,
  disks: Partial<Pick<InstantVmStartMessage, SlotName | `${SlotName}Blob` | `${SlotName}Url` | `${SlotName}Stream`>>,
): InstantVmStartMessage {
  const message: InstantVmStartMessage = {
    type: INSTANT_VM_MESSAGE_TYPE.start,
    requestId,
    config: settingsToStartConfig(settings),
  }
  const slots: SlotName[] = ['hda', 'hdb', 'cdrom', 'fda', 'fdb', 'state']
  for (const slot of slots) {
    const buffer = disks[slot]
    const blob = disks[`${slot}Blob` as const]
    const url = disks[`${slot}Url` as const]
    const stream = disks[`${slot}Stream` as const]
    if (buffer) {
      message[slot] = buffer
    }
    if (blob) {
      message[`${slot}Blob`] = blob
    }
    if (url) {
      message[`${slot}Url`] = url
    }
    if (stream) {
      message[`${slot}Stream`] = stream
    }
  }
  return message
}

export { collectStartTransfers }
