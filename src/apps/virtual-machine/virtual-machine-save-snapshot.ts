import { filesMkdir, filesOpenStreamWrite, filesStat } from '../files/files-api.ts'
import { createStorageDevice } from './virtual-machine-config.ts'
import { VM_BLANK_DISK_DIR } from './virtual-machine-disks.ts'
import { isHttpDiskUrl } from './virtual-machine-protocol.ts'
import { updateVirtualMachine } from './virtual-machine-store.ts'
import type { VirtualMachineRecord, VmStorageDevice } from './virtual-machine-types.ts'

const SNAPSHOT_CHUNK_BYTES = 4 * 1024 * 1024

export function isSnapshotPathWritable(path: string): boolean {
  const trimmed = path.trim()
  if (!trimmed) {
    return false
  }
  if (isHttpDiskUrl(trimmed)) {
    return false
  }
  return trimmed.startsWith('/')
}

export function sanitizeSnapshotFileName(name: string): string {
  const trimmed = name.trim().replace(/[\\/:*\u0000-\u001f\u007f]/g, '-')
  const base = trimmed || 'snapshot'
  return base.endsWith('.bin') ? base : `${base}.bin`
}

export async function ensureSnapshotDirectory(): Promise<void> {
  const stat = await filesStat(VM_BLANK_DISK_DIR)
  if (stat) {
    if (stat.kind !== 'folder') {
      throw new Error(`${VM_BLANK_DISK_DIR} 不是文件夹`)
    }
    return
  }
  await filesMkdir(VM_BLANK_DISK_DIR)
}

async function findUniqueSnapshotPath(basePath: string): Promise<string> {
  if (!(await filesStat(basePath))) {
    return basePath
  }
  const lastDot = basePath.lastIndexOf('.')
  const prefix = lastDot === -1 ? basePath : basePath.slice(0, lastDot)
  const suffix = lastDot === -1 ? '' : basePath.slice(lastDot)
  let index = 2
  while (index < 1000) {
    const candidate = `${prefix}-${index}${suffix}`
    if (!(await filesStat(candidate))) {
      return candidate
    }
    index += 1
  }
  throw new Error('无法为快照生成唯一文件名')
}

function resolveSnapshotTargetPath(machine: VirtualMachineRecord): {
  path: string
  isNew: boolean
} {
  const stateDevice = machine.devices.find((device) => device.type === 'state')
  if (stateDevice && isSnapshotPathWritable(stateDevice.path)) {
    return { path: stateDevice.path, isNew: false }
  }
  const fileName = sanitizeSnapshotFileName(machine.name)
  return {
    path: `${VM_BLANK_DISK_DIR}/${fileName}`,
    isNew: true,
  }
}

async function writeStateBuffer(state: ArrayBuffer, path: string): Promise<void> {
  await ensureSnapshotDirectory()
  const writer = await filesOpenStreamWrite(path)
  try {
    const bytes = new Uint8Array(state)
    let offset = 0
    while (offset < bytes.byteLength) {
      const end = Math.min(offset + SNAPSHOT_CHUNK_BYTES, bytes.byteLength)
      await writer.write(bytes.subarray(offset, end))
      offset = end
    }
    await writer.close()
  } catch (error) {
    await writer.abort().catch(() => {})
    throw error
  }
}

function replaceStateDevice(devices: readonly VmStorageDevice[], path: string): VmStorageDevice[] {
  const next = devices.filter((device) => device.type !== 'state')
  next.push(createStorageDevice('state', path))
  return next
}

export async function saveVirtualMachineSnapshot(
  machine: VirtualMachineRecord,
  state: ArrayBuffer,
): Promise<{ path: string; isNew: boolean }> {
  const { path: rawPath, isNew } = resolveSnapshotTargetPath(machine)
  const path = isNew ? await findUniqueSnapshotPath(rawPath) : rawPath
  await writeStateBuffer(state, path)
  await updateVirtualMachine(machine.id, {
    ...machine,
    devices: replaceStateDevice(machine.devices, path),
  })
  return { path, isNew }
}
