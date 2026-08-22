import { filesReadBlob, filesStat } from '../files/files-api.ts'
import { cpuidLevelForCpuModel } from './virtual-machine-config.ts'
import {
  registerVirtualMachineDiskStream,
} from './virtual-machine-disk-stream-host.ts'
import {
  INSTANT_VM_MESSAGE_TYPE,
  collectStartTransfers,
  isHttpDiskUrl,
  type InstantVmDiskStreamRef,
  type InstantVmStartConfig,
  type InstantVmStartMessage,
} from './virtual-machine-protocol.ts'
import type { VirtualMachineSettings } from './virtual-machine-types.ts'

export function virtualMachineHasBootMedia(
  settings: Pick<VirtualMachineSettings, 'hdaPath' | 'cdromPath' | 'fdaPath'>,
): boolean {
  return [settings.hdaPath, settings.cdromPath, settings.fdaPath].some(
    (path) => path.trim().length > 0,
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
    ...(cpuidLevel !== undefined ? { cpuidLevel } : {}),
    sendEnterAfterMs: settings.cdromPath.trim() ? 3000 : undefined,
  }
}

/** 超过此阈值的本地卷镜像走范围流式读取，避免整文件分配 ArrayBuffer。 */
const DISK_BLOB_THRESHOLD_BYTES = 256 * 1024 * 1024

function isMountPath(path: string): boolean {
  return path.startsWith('/mount/')
}

type LoadedDisk = {
  buffer?: ArrayBuffer
  blob?: Blob
  url?: string
  stream?: InstantVmDiskStreamRef
}

async function loadDisk(path: string, label: string): Promise<LoadedDisk> {
  const trimmed = path.trim()
  if (!trimmed) {
    return {}
  }
  if (isHttpDiskUrl(trimmed)) {
    return { url: trimmed }
  }

  const stat = await filesStat(trimmed)
  if (!stat || stat.kind !== 'file') {
    throw new Error(`无法读取${label} ${trimmed}：文件不存在`)
  }

  if (!isMountPath(trimmed) && stat.byteSize > DISK_BLOB_THRESHOLD_BYTES) {
    const id = await registerVirtualMachineDiskStream(trimmed)
    return { stream: { id, size: stat.byteSize } }
  }

  try {
    const blob = await filesReadBlob(trimmed)
    if (blob.size > DISK_BLOB_THRESHOLD_BYTES) {
      return { blob }
    }
    return { buffer: await blob.arrayBuffer() }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`无法读取${label} ${trimmed}：${detail}`)
  }
}

export async function loadVirtualMachineDisks(
  settings: Pick<VirtualMachineSettings, 'hdaPath' | 'cdromPath' | 'fdaPath' | 'statePath'>,
): Promise<
  Pick<
    InstantVmStartMessage,
    | 'hda'
    | 'cdrom'
    | 'fda'
    | 'state'
    | 'hdaBlob'
    | 'cdromBlob'
    | 'fdaBlob'
    | 'stateBlob'
    | 'hdaUrl'
    | 'cdromUrl'
    | 'fdaUrl'
    | 'stateUrl'
    | 'hdaStream'
    | 'cdromStream'
    | 'fdaStream'
    | 'stateStream'
  >
> {
  const [hda, cdrom, fda, state] = await Promise.all([
    loadDisk(settings.hdaPath, '硬盘'),
    loadDisk(settings.cdromPath, '光盘'),
    loadDisk(settings.fdaPath, '软盘'),
    loadDisk(settings.statePath, '快照'),
  ])
  return {
    hda: hda.buffer,
    cdrom: cdrom.buffer,
    fda: fda.buffer,
    state: state.buffer,
    hdaBlob: hda.blob,
    cdromBlob: cdrom.blob,
    fdaBlob: fda.blob,
    stateBlob: state.blob,
    hdaUrl: hda.url,
    cdromUrl: cdrom.url,
    fdaUrl: fda.url,
    stateUrl: state.url,
    hdaStream: hda.stream,
    cdromStream: cdrom.stream,
    fdaStream: fda.stream,
    stateStream: state.stream,
  }
}

export function buildStartMessage(
  requestId: string,
  settings: VirtualMachineSettings,
  disks: Pick<
    InstantVmStartMessage,
    | 'hda'
    | 'cdrom'
    | 'fda'
    | 'state'
    | 'hdaBlob'
    | 'cdromBlob'
    | 'fdaBlob'
    | 'stateBlob'
    | 'hdaUrl'
    | 'cdromUrl'
    | 'fdaUrl'
    | 'stateUrl'
    | 'hdaStream'
    | 'cdromStream'
    | 'fdaStream'
    | 'stateStream'
  >,
): InstantVmStartMessage {
  const message: InstantVmStartMessage = {
    type: INSTANT_VM_MESSAGE_TYPE.start,
    requestId,
    config: settingsToStartConfig(settings),
  }
  if (disks.hda) {
    message.hda = disks.hda
  }
  if (disks.cdrom) {
    message.cdrom = disks.cdrom
  }
  if (disks.fda) {
    message.fda = disks.fda
  }
  if (disks.state) {
    message.state = disks.state
  }
  if (disks.hdaBlob) {
    message.hdaBlob = disks.hdaBlob
  }
  if (disks.cdromBlob) {
    message.cdromBlob = disks.cdromBlob
  }
  if (disks.fdaBlob) {
    message.fdaBlob = disks.fdaBlob
  }
  if (disks.stateBlob) {
    message.stateBlob = disks.stateBlob
  }
  if (disks.hdaUrl) {
    message.hdaUrl = disks.hdaUrl
  }
  if (disks.cdromUrl) {
    message.cdromUrl = disks.cdromUrl
  }
  if (disks.fdaUrl) {
    message.fdaUrl = disks.fdaUrl
  }
  if (disks.stateUrl) {
    message.stateUrl = disks.stateUrl
  }
  if (disks.hdaStream) {
    message.hdaStream = disks.hdaStream
  }
  if (disks.cdromStream) {
    message.cdromStream = disks.cdromStream
  }
  if (disks.fdaStream) {
    message.fdaStream = disks.fdaStream
  }
  if (disks.stateStream) {
    message.stateStream = disks.stateStream
  }
  return message
}

export { collectStartTransfers }
