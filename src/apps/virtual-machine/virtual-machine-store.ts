import { createRegistryStore } from '../../os/registry-store.ts'
import {
  clampVmMemoryMb,
  defaultVirtualMachineSettings,
  migrateLegacyDrivePaths,
  settingsFromRecord,
} from './virtual-machine-config.ts'
import { normalizeVmKeyMappings } from './virtual-machine-keymap.ts'
import {
  DEFAULT_VIRTUAL_MACHINE_ID,
  DEFAULT_VIRTUAL_MACHINE_NAME,
  VIRTUAL_MACHINE_NAME_MAX_LENGTH,
  VIRTUAL_MACHINE_PATH_MAX_LENGTH,
  VM_BACKEND_IDS,
  VM_BOOT_ORDER_IDS,
  VM_BUILD_MODE_IDS,
  VM_CPU_MODEL_IDS,
  coerceVmDiskWriteMode,
  VM_DISPLAY_MODE_IDS,
  VM_NETWORK_BACKEND_IDS,
  VM_NETWORK_IDS,
  VM_OS_PRESET_IDS,
  VM_POINTER_MODE_IDS,
  VM_SNAP_EDGE_PX_MAX,
  VM_SNAP_EDGE_PX_MIN,
  VM_STORAGE_DEVICE_TYPES,
  VM_VGA_MEMORY_MB_OPTIONS,
  type VirtualMachineRecord,
  type VirtualMachineSettings,
  type VirtualMachineStore,
  type VmDiskWriteLoss,
  type VmStorageDevice,
} from './virtual-machine-types.ts'

export const VIRTUAL_MACHINE_STORE_CHANGED_EVENT = 'instant-os:virtual-machine-store-changed'

function emptyStore(): VirtualMachineStore {
  return { machines: [] }
}

function normalizeOneOf<T>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(raw) ? (raw as T) : fallback
}

function normalizeBoolean(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback
}

function normalizeName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined
  }
  const name = raw.trim().slice(0, VIRTUAL_MACHINE_NAME_MAX_LENGTH)
  return name || undefined
}

function normalizeMemoryMb(raw: unknown, fallback: number): number {
  const num = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(num)) {
    return fallback
  }
  return clampVmMemoryMb(num)
}

function normalizeVmSnapEdgePx(raw: unknown, fallback: number): number {
  const num = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(num)) {
    return fallback
  }
  return Math.round(Math.min(VM_SNAP_EDGE_PX_MAX, Math.max(VM_SNAP_EDGE_PX_MIN, num)))
}

function normalizePath(raw: unknown): string {
  if (typeof raw !== 'string') {
    return ''
  }
  const path = raw.trim().slice(0, VIRTUAL_MACHINE_PATH_MAX_LENGTH)
  if (!path) {
    return ''
  }
  if (/^https?:\/\//i.test(path)) {
    return ''
  }
  return path.startsWith('/') ? path : `/${path}`
}

function normalizeStorageDeviceType(raw: unknown): 'hdd' | 'cdrom' | 'floppy' | undefined {
  if (typeof raw !== 'string') {
    return undefined
  }
  const trimmed = raw.trim().toLowerCase()
  // 快照已禁用：旧记录里的 state 设备在这里被丢弃（连同快照差量，见 overlay 迁移）。
  if ((VM_STORAGE_DEVICE_TYPES as readonly string[]).includes(trimmed)) {
    return trimmed as 'hdd' | 'cdrom' | 'floppy'
  }
  return undefined
}

function normalizeStorageDeviceSource(raw: unknown): 'local' | undefined {
  if (typeof raw !== 'string') {
    return undefined
  }
  const trimmed = raw.trim().toLowerCase()
  if (trimmed === 'local' || trimmed === 'network' || trimmed === 'preset') {
    return 'local'
  }
  return undefined
}

function normalizeStorageDevice(raw: unknown): VmStorageDevice | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const record = raw as Record<string, unknown>
  const type = normalizeStorageDeviceType(record.type)
  if (!type) {
    return undefined
  }
  const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : createDeviceId()
  const source = normalizeStorageDeviceSource(record.source) ?? 'local'
  const path = normalizePath(record.path)
  if (!path && typeof record.path === 'string' && /^https?:\/\//i.test(record.path.trim())) {
    return undefined
  }
  // 只有显式 false 才落盘；缺省视为已连接，旧记录读入后写回字节不变。
  return record.connected === false ? { id, type, source, path, connected: false } : { id, type, source, path }
}

function createDeviceId(): string {
  return `vm-device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeDevices(record: Record<string, unknown>): VmStorageDevice[] {
  if (Array.isArray(record.devices)) {
    const devices: VmStorageDevice[] = []
    for (const raw of record.devices) {
      const device = normalizeStorageDevice(raw)
      if (device) {
        devices.push(device)
      }
    }
    return devices
  }
  return migrateLegacyDrivePaths({
    hdaPath: typeof record.hdaPath === 'string' ? record.hdaPath : undefined,
    cdromPath: typeof record.cdromPath === 'string' ? record.cdromPath : undefined,
    fdaPath: typeof record.fdaPath === 'string' ? record.fdaPath : undefined,
  })
}

export function normalizeVirtualMachineSettings(raw: unknown): VirtualMachineSettings | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const record = raw as Record<string, unknown>
  const name = normalizeName(record.name)
  if (!name) {
    return undefined
  }
  const defaults = defaultVirtualMachineSettings(name)
  return {
    name,
    backend: normalizeOneOf(record.backend, VM_BACKEND_IDS, defaults.backend),
    buildMode: normalizeOneOf(record.buildMode, VM_BUILD_MODE_IDS, defaults.buildMode),
    memoryMb: normalizeMemoryMb(record.memoryMb, defaults.memoryMb),
    vgaMemoryMb: normalizeOneOf(record.vgaMemoryMb, VM_VGA_MEMORY_MB_OPTIONS, defaults.vgaMemoryMb),
    cpuModel: normalizeOneOf(record.cpuModel, VM_CPU_MODEL_IDS, defaults.cpuModel),
    bootOrder: normalizeOneOf(record.bootOrder, VM_BOOT_ORDER_IDS, defaults.bootOrder),
    acpi: normalizeBoolean(record.acpi, defaults.acpi),
    fastboot: normalizeBoolean(record.fastboot, defaults.fastboot),
    speaker: normalizeBoolean(record.speaker, defaults.speaker),
    keyboard: normalizeBoolean(record.keyboard, defaults.keyboard),
    mouse: normalizeBoolean(record.mouse, defaults.mouse),
    pointerMode: normalizeOneOf(record.pointerMode, VM_POINTER_MODE_IDS, defaults.pointerMode),
    diskWriteMode: coerceVmDiskWriteMode(record.diskWriteMode) ?? defaults.diskWriteMode,
    resolutionAutoAlign: normalizeBoolean(
      record.resolutionAutoAlign,
      defaults.resolutionAutoAlign,
    ),
    keyMappingEnabled: normalizeBoolean(record.keyMappingEnabled, defaults.keyMappingEnabled),
    keyMappings: normalizeVmKeyMappings(record.keyMappings),
    network: normalizeOneOf(record.network, VM_NETWORK_IDS, defaults.network),
    networkBackend: normalizeOneOf(
      record.networkBackend,
      VM_NETWORK_BACKEND_IDS,
      defaults.networkBackend,
    ),
    displayMode: normalizeOneOf(record.displayMode, VM_DISPLAY_MODE_IDS, defaults.displayMode),
    devices: normalizeDevices(record),
    osPreset: normalizeOneOf(record.osPreset, VM_OS_PRESET_IDS, defaults.osPreset),
    enhanceClipboard: normalizeBoolean(record.enhanceClipboard, defaults.enhanceClipboard),
    enhanceFileTransfer: normalizeBoolean(record.enhanceFileTransfer, defaults.enhanceFileTransfer),
    enhanceAbsoluteMouse: normalizeBoolean(
      record.enhanceAbsoluteMouse,
      defaults.enhanceAbsoluteMouse,
    ),
    enhanceWindowSnap: normalizeBoolean(record.enhanceWindowSnap, defaults.enhanceWindowSnap),
    enhanceWindowSnapEdgePx: normalizeVmSnapEdgePx(
      record.enhanceWindowSnapEdgePx,
      defaults.enhanceWindowSnapEdgePx,
    ),
    sharedFolderEnabled: normalizeBoolean(
      record.sharedFolderEnabled,
      defaults.sharedFolderEnabled,
    ),
    // 旧记录没有 sharedFolderAdded 字段：曾经开着共享文件夹的机器视作已添加，
    // 升级后存储页设备条目不消失；新记录里显式的 false（用户删过设备）必须尊重。
    sharedFolderAdded:
      typeof record.sharedFolderAdded === 'boolean'
        ? record.sharedFolderAdded
        : record.sharedFolderEnabled === true,
    sharedFolderDrive:
      typeof record.sharedFolderDrive === 'string' && /^[A-Za-z]$/.test(record.sharedFolderDrive)
        ? record.sharedFolderDrive.toUpperCase()
        : defaults.sharedFolderDrive,
    sharedFolderConnected: normalizeBoolean(
      record.sharedFolderConnected,
      defaults.sharedFolderConnected,
    ),
    sharedFolderPath:
      typeof record.sharedFolderPath === 'string' && record.sharedFolderPath.startsWith('/')
        ? record.sharedFolderPath
        : defaults.sharedFolderPath,
  }
}

export function createDefaultVirtualMachine(createdAt = 0): VirtualMachineRecord {
  return {
    ...defaultVirtualMachineSettings(DEFAULT_VIRTUAL_MACHINE_NAME),
    id: DEFAULT_VIRTUAL_MACHINE_ID,
    createdAt,
  }
}

export function createVirtualMachineId(): string {
  return `vm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function nextVirtualMachineName(existing: readonly VirtualMachineRecord[]): string {
  const names = new Set(existing.map((machine) => machine.name))
  if (!names.has(DEFAULT_VIRTUAL_MACHINE_NAME)) {
    return DEFAULT_VIRTUAL_MACHINE_NAME
  }
  let index = 2
  while (names.has(`虚拟机 ${index}`)) {
    index += 1
  }
  return `虚拟机 ${index}`
}

export function normalizeVirtualMachineRecord(raw: unknown): VirtualMachineRecord | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const record = raw as Record<string, unknown>
  if (typeof record.id !== 'string' || record.id.trim() === '') {
    return undefined
  }
  const settings = normalizeVirtualMachineSettings(record)
  if (!settings) {
    return undefined
  }
  const createdAt =
    typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
      ? record.createdAt
      : 0
  const diskWriteLoss = normalizeDiskWriteLoss(record.diskWriteLoss)
  return {
    ...settings,
    id: record.id.trim(),
    createdAt,
    ...(diskWriteLoss ? { diskWriteLoss } : {}),
  }
}

/** 「上次未落盘」标记：形状不对就整条丢弃——宁可少一个警告，也不能显示一个假数字。 */
export function normalizeDiskWriteLoss(raw: unknown): VmDiskWriteLoss | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const record = raw as Record<string, unknown>
  const valid = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0
  const { at, droppedWrites, droppedBytes } = record
  // droppedWrites <= 0 的标记没有信息量，等同于「没丢过」，不该留在记录里。
  if (!valid(at) || at <= 0 || !valid(droppedWrites) || !valid(droppedBytes) || droppedWrites <= 0) {
    return undefined
  }
  return { at, droppedWrites, droppedBytes }
}

export function normalizeVirtualMachines(raw: unknown): VirtualMachineRecord[] {
  if (raw === undefined) {
    return [createDefaultVirtualMachine()]
  }
  if (!Array.isArray(raw)) {
    return [createDefaultVirtualMachine()]
  }
  const seen = new Set<string>()
  const machines: VirtualMachineRecord[] = []
  for (const item of raw) {
    const machine = normalizeVirtualMachineRecord(item)
    if (!machine || seen.has(machine.id)) {
      continue
    }
    seen.add(machine.id)
    machines.push(machine)
  }
  return machines
}

export function createVirtualMachineRecord(
  settings: VirtualMachineSettings,
  createdAt = Date.now(),
): VirtualMachineRecord {
  const normalized =
    normalizeVirtualMachineSettings(settings) ??
    defaultVirtualMachineSettings(nextVirtualMachineName([]))
  return {
    ...normalized,
    id: createVirtualMachineId(),
    createdAt,
  }
}

const registryStore = createRegistryStore<VirtualMachineStore>({
  appId: 'virtual-machine',
  defaultValue: emptyStore,
  fields: [
    {
      key: 'machines',
      valueType: 'json',
      read: (store) => store.machines,
      write: (value, draft) => ({ ...draft, machines: value }),
      normalize: normalizeVirtualMachines,
    },
    {
      key: 'lastSelectedId',
      read: (store) => store.lastSelectedId,
      write: (value, draft) => ({ ...draft, lastSelectedId: value }),
      serialize: (value) => value ?? '',
      deserialize: (raw) => {
        const trimmed = raw?.trim()
        return trimmed ? trimmed : undefined
      },
    },
  ],
  changedEventName: VIRTUAL_MACHINE_STORE_CHANGED_EVENT,
})

export function subscribeVirtualMachineStore(listener: () => void): () => void {
  return registryStore.subscribe(listener)
}

/**
 * store 的每个写入口都是「读整表 → 改一处 → 写回整表」，而 registryStore.write 内部没有互斥：
 * A 读、B 读、A 写、B 写的交错会让 A 的修改凭空消失。触发场景真实存在——多台机器同时收口
 * 各自触发 onDiskWriteLoss、或收口瞬间用户保存设置——而这条记录的唯一价值就是跨会话不丢。
 * 所以把整个读写面串成一条链，一次只跑一个。
 */
let storeChain: Promise<unknown> = Promise.resolve()

function serializeStoreTask<T>(task: () => Promise<T>): Promise<T> {
  // 前一个任务失败也必须继续跑后面的：同一个 task 同时挂 onFulfilled / onRejected。
  const run = storeChain.then(task, task)
  storeChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function readVirtualMachineStoreUnsafe(): Promise<VirtualMachineStore> {
  const store = await registryStore.read()
  const keys = await registryStore.keys()
  if (!keys.includes('machines')) {
    await registryStore.write(store)
  }
  return store
}

export function readVirtualMachineStore(): Promise<VirtualMachineStore> {
  return serializeStoreTask(readVirtualMachineStoreUnsafe)
}

async function writeVirtualMachineStoreUnsafe(store: VirtualMachineStore): Promise<void> {
  // 调用方通常只传 machines；合并当前值，避免把 lastSelectedId 等其他字段清掉。
  const current = await readVirtualMachineStoreUnsafe()
  await registryStore.write({
    ...current,
    ...store,
    machines: normalizeVirtualMachines(store.machines),
  })
}

export function writeVirtualMachineStore(store: VirtualMachineStore): Promise<void> {
  return serializeStoreTask(() => writeVirtualMachineStoreUnsafe(store))
}

export function addVirtualMachine(
  settings: VirtualMachineSettings,
): Promise<VirtualMachineRecord> {
  return serializeStoreTask(async () => {
    const store = await readVirtualMachineStoreUnsafe()
    const machine = createVirtualMachineRecord(settings)
    await writeVirtualMachineStoreUnsafe({
      machines: [...store.machines, machine],
    })
    return machine
  })
}

export function updateVirtualMachine(
  id: string,
  settings: VirtualMachineSettings,
): Promise<VirtualMachineRecord | undefined> {
  return serializeStoreTask(async () => {
    const store = await readVirtualMachineStoreUnsafe()
    const index = store.machines.findIndex((machine) => machine.id === id)
    const current = store.machines[index]
    if (!current) {
      return undefined
    }
    const normalized =
      normalizeVirtualMachineSettings(settings) ?? settingsFromRecord(current)
    const next: VirtualMachineRecord = {
      ...current,
      ...normalized,
      id: current.id,
      createdAt: current.createdAt,
    }
    const machines = [...store.machines]
    machines[index] = next
    await writeVirtualMachineStoreUnsafe({ machines })
    return next
  })
}

/**
 * 记下/清除「本次会话有写入没能落盘」。
 *
 * 单独一个写入口而不是走 updateVirtualMachine：那个函数只吃 VirtualMachineSettings，
 * 而这条标记属于记录级状态（和 createdAt 同级），不该混进设置里被规范化冲掉。
 * 传 undefined 表示用户已确认、清除标记。
 */
export function setVirtualMachineDiskWriteLoss(
  id: string,
  loss: VmDiskWriteLoss | undefined,
): Promise<VirtualMachineRecord | undefined> {
  return serializeStoreTask(async () => {
    const store = await readVirtualMachineStoreUnsafe()
    const index = store.machines.findIndex((machine) => machine.id === id)
    const current = store.machines[index]
    if (!current) {
      return undefined
    }
    const next: VirtualMachineRecord = { ...current }
    if (loss) {
      next.diskWriteLoss = loss
    } else {
      delete next.diskWriteLoss
    }
    const machines = [...store.machines]
    machines[index] = next
    await writeVirtualMachineStoreUnsafe({ machines })
    return next
  })
}

export function removeVirtualMachine(id: string): Promise<VirtualMachineRecord[]> {
  return serializeStoreTask(async () => {
    const store = await readVirtualMachineStoreUnsafe()
    const machines = store.machines.filter((machine) => machine.id !== id)
    await writeVirtualMachineStoreUnsafe({ machines })
    return machines
  })
}

export function setLastSelectedVirtualMachine(id: string): Promise<void> {
  return serializeStoreTask(async () => {
    const store = await readVirtualMachineStoreUnsafe()
    if (store.lastSelectedId === id) {
      return
    }
    await registryStore.write({ ...store, lastSelectedId: id })
  })
}

export function moveVirtualMachine(
  id: string,
  toIndex: number,
): Promise<VirtualMachineRecord[]> {
  return serializeStoreTask(async () => {
    const store = await readVirtualMachineStoreUnsafe()
    const from = store.machines.findIndex((machine) => machine.id === id)
    if (from === -1) {
      return store.machines
    }
    const machines = [...store.machines]
    const [moved] = machines.splice(from, 1)
    const target = Math.min(Math.max(toIndex, 0), machines.length)
    machines.splice(target, 0, moved)
    await writeVirtualMachineStoreUnsafe({ machines })
    return machines
  })
}
