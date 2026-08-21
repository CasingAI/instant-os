import { createRegistryStore } from '../../os/registry-store.ts'
import { defaultVirtualMachineSettings, settingsFromRecord } from './virtual-machine-config.ts'
import {
  DEFAULT_VIRTUAL_MACHINE_ID,
  DEFAULT_VIRTUAL_MACHINE_NAME,
  VIRTUAL_MACHINE_NAME_MAX_LENGTH,
  VIRTUAL_MACHINE_PATH_MAX_LENGTH,
  VM_BACKEND_IDS,
  VM_BOOT_ORDER_IDS,
  VM_DISPLAY_MODE_IDS,
  VM_MEMORY_MB_OPTIONS,
  VM_NETWORK_BACKEND_IDS,
  VM_NETWORK_IDS,
  VM_VGA_MEMORY_MB_OPTIONS,
  type VirtualMachineRecord,
  type VirtualMachineSettings,
  type VirtualMachineStore,
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

function normalizePath(raw: unknown): string {
  if (typeof raw !== 'string') {
    return ''
  }
  const path = raw.trim().slice(0, VIRTUAL_MACHINE_PATH_MAX_LENGTH)
  if (!path) {
    return ''
  }
  if (/^https?:\/\//i.test(path)) {
    return path
  }
  return path.startsWith('/') ? path : `/${path}`
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
    memoryMb: normalizeOneOf(record.memoryMb, VM_MEMORY_MB_OPTIONS, defaults.memoryMb),
    vgaMemoryMb: normalizeOneOf(record.vgaMemoryMb, VM_VGA_MEMORY_MB_OPTIONS, defaults.vgaMemoryMb),
    bootOrder: normalizeOneOf(record.bootOrder, VM_BOOT_ORDER_IDS, defaults.bootOrder),
    acpi: normalizeBoolean(record.acpi, defaults.acpi),
    fastboot: normalizeBoolean(record.fastboot, defaults.fastboot),
    speaker: normalizeBoolean(record.speaker, defaults.speaker),
    keyboard: normalizeBoolean(record.keyboard, defaults.keyboard),
    mouse: normalizeBoolean(record.mouse, defaults.mouse),
    network: normalizeOneOf(record.network, VM_NETWORK_IDS, defaults.network),
    networkBackend: normalizeOneOf(
      record.networkBackend,
      VM_NETWORK_BACKEND_IDS,
      defaults.networkBackend,
    ),
    displayMode: normalizeOneOf(record.displayMode, VM_DISPLAY_MODE_IDS, defaults.displayMode),
    hdaPath: normalizePath(record.hdaPath),
    cdromPath: normalizePath(record.cdromPath),
    fdaPath: normalizePath(record.fdaPath),
    statePath: normalizePath(record.statePath),
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
  return {
    ...settings,
    id: record.id.trim(),
    createdAt,
  }
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
  ],
  changedEventName: VIRTUAL_MACHINE_STORE_CHANGED_EVENT,
})

export function subscribeVirtualMachineStore(listener: () => void): () => void {
  return registryStore.subscribe(listener)
}

export async function readVirtualMachineStore(): Promise<VirtualMachineStore> {
  const store = await registryStore.read()
  const keys = await registryStore.keys()
  if (!keys.includes('machines')) {
    await registryStore.write(store)
  }
  return store
}

export async function writeVirtualMachineStore(store: VirtualMachineStore): Promise<void> {
  await registryStore.write({
    machines: normalizeVirtualMachines(store.machines),
  })
}

export async function addVirtualMachine(
  settings: VirtualMachineSettings,
): Promise<VirtualMachineRecord> {
  const store = await readVirtualMachineStore()
  const machine = createVirtualMachineRecord(settings)
  await writeVirtualMachineStore({
    machines: [...store.machines, machine],
  })
  return machine
}

export async function updateVirtualMachine(
  id: string,
  settings: VirtualMachineSettings,
): Promise<VirtualMachineRecord | undefined> {
  const store = await readVirtualMachineStore()
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
  await writeVirtualMachineStore({ machines })
  return next
}

export async function removeVirtualMachine(id: string): Promise<VirtualMachineRecord[]> {
  const store = await readVirtualMachineStore()
  const machines = store.machines.filter((machine) => machine.id !== id)
  await writeVirtualMachineStore({ machines })
  return machines
}
