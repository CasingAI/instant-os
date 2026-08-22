import { filesReadBlob } from '../files/files-api.ts'
import { cpuidLevelForCpuModel } from './virtual-machine-config.ts'
import {
  INSTANT_VM_MESSAGE_TYPE,
  collectStartTransfers,
  isHttpDiskUrl,
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

type LoadedDisk = {
  buffer?: ArrayBuffer
  url?: string
}

async function loadDisk(path: string, label: string): Promise<LoadedDisk> {
  const trimmed = path.trim()
  if (!trimmed) {
    return {}
  }
  if (isHttpDiskUrl(trimmed)) {
    return { url: trimmed }
  }
  try {
    const blob = await filesReadBlob(trimmed)
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
    'hda' | 'cdrom' | 'fda' | 'state' | 'hdaUrl' | 'cdromUrl' | 'fdaUrl' | 'stateUrl'
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
    hdaUrl: hda.url,
    cdromUrl: cdrom.url,
    fdaUrl: fda.url,
    stateUrl: state.url,
  }
}

export function buildStartMessage(
  requestId: string,
  settings: VirtualMachineSettings,
  disks: Pick<
    InstantVmStartMessage,
    'hda' | 'cdrom' | 'fda' | 'state' | 'hdaUrl' | 'cdromUrl' | 'fdaUrl' | 'stateUrl'
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
  return message
}

export { collectStartTransfers }
