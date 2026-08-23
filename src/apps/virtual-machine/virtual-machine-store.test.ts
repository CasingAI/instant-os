/**
 * Virtual Machine 机器列表存储单测。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-store.test.ts
 *
 * 覆盖：缺省播种；空数组不回种；坏数据回落；新建 / 更新 / 删除往返；devices 数组迁移。
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { __resetRegistryCacheForTest } from '../../os/app-registry.ts'
import { resetRegistryDbForTests } from '../../os/app-registry-db.ts'
import { defaultVirtualMachineSettings } from './virtual-machine-config.ts'
import {
  addVirtualMachine,
  createDefaultVirtualMachine,
  nextVirtualMachineName,
  normalizeVirtualMachineRecord,
  normalizeVirtualMachineSettings,
  normalizeVirtualMachines,
  readVirtualMachineStore,
  removeVirtualMachine,
  updateVirtualMachine,
  writeVirtualMachineStore,
} from './virtual-machine-store.ts'
import {
  DEFAULT_VIRTUAL_MACHINE_BUILD_MODE,
  DEFAULT_VIRTUAL_MACHINE_CPU_MODEL,
  DEFAULT_VIRTUAL_MACHINE_ID,
  DEFAULT_VIRTUAL_MACHINE_MEMORY_MB,
  DEFAULT_VIRTUAL_MACHINE_NAME,
  DEFAULT_VIRTUAL_MACHINE_VGA_MEMORY_MB,
} from './virtual-machine-types.ts'

async function resetState(): Promise<void> {
  __resetRegistryCacheForTest()
  await resetRegistryDbForTests()
}

function testNormalizeMissingSeedsDefault(): void {
  const machines = normalizeVirtualMachines(undefined)
  assert.equal(machines.length, 1)
  assert.equal(machines[0]?.id, DEFAULT_VIRTUAL_MACHINE_ID)
  assert.equal(machines[0]?.name, DEFAULT_VIRTUAL_MACHINE_NAME)
  assert.equal(machines[0]?.backend, 'v86')
  assert.equal(machines[0]?.memoryMb, DEFAULT_VIRTUAL_MACHINE_MEMORY_MB)
  assert.equal(machines[0]?.vgaMemoryMb, DEFAULT_VIRTUAL_MACHINE_VGA_MEMORY_MB)
  assert.equal(machines[0]?.cpuModel, DEFAULT_VIRTUAL_MACHINE_CPU_MODEL)
  assert.equal(machines[0]?.bootOrder, 'auto')
  assert.equal(machines[0]?.network, 'none')
  assert.equal(machines[0]?.networkBackend, 'off')
  assert.deepEqual(machines[0]?.devices, [])
  assert.equal(machines[0]?.speaker, true)
  assert.equal(machines[0]?.acpi, false)
  assert.equal(machines[0]?.buildMode, DEFAULT_VIRTUAL_MACHINE_BUILD_MODE)
}

function testNormalizeBuildModeFallback(): void {
  const noMode = normalizeVirtualMachineSettings({ name: 'test' })
  assert.equal(noMode?.buildMode, 'release')

  const badMode = normalizeVirtualMachineSettings({ name: 'test', buildMode: 'unknown' })
  assert.equal(badMode?.buildMode, 'release')

  const debugMode = normalizeVirtualMachineSettings({ name: 'test', buildMode: 'debug' })
  assert.equal(debugMode?.buildMode, 'debug')
}

function testNormalizeEmptyArrayStaysEmpty(): void {
  assert.deepEqual(normalizeVirtualMachines([]), [])
}

function testNormalizeDropsGarbageAndDuplicates(): void {
  const machines = normalizeVirtualMachines([
    null,
    {
      id: 'a',
      name: '  Alpha  ',
      backend: 'unknown',
      memoryMb: 128,
      vgaMemoryMb: 4,
      bootOrder: 'hdd-cd-floppy',
      acpi: true,
      fastboot: true,
      speaker: false,
      keyboard: false,
      mouse: false,
      network: 'virtio',
      networkBackend: 'fetch',
      devices: [
        { id: 'd1', type: 'hdd', source: 'local', path: '/user/disks/a.img' },
        { id: 'd2', type: 'cdrom', source: 'local', path: '/user/iso/linux.iso' },
      ],
      createdAt: 12,
    },
    { id: 'a', name: 'Dup' },
    { name: 'no-id' },
    { id: 'b', name: '   ' },
    { id: 'c', name: 'Charlie', backend: 'v86', networkBackend: 'nope' },
  ])
  assert.equal(machines.length, 2)
  assert.equal(machines[0]?.id, 'a')
  assert.equal(machines[0]?.name, 'Alpha')
  assert.equal(machines[0]?.backend, 'v86')
  assert.equal(machines[0]?.memoryMb, 128)
  assert.equal(machines[0]?.vgaMemoryMb, 4)
  assert.equal(machines[0]?.bootOrder, 'hdd-cd-floppy')
  assert.equal(machines[0]?.acpi, true)
  assert.equal(machines[0]?.fastboot, true)
  assert.equal(machines[0]?.speaker, false)
  assert.equal(machines[0]?.keyboard, false)
  assert.equal(machines[0]?.mouse, false)
  assert.equal(machines[0]?.network, 'virtio')
  assert.equal(machines[0]?.networkBackend, 'fetch')
  assert.equal(machines[0]?.devices.length, 2)
  assert.equal(machines[0]?.devices[0]?.path, '/user/disks/a.img')
  assert.equal(machines[0]?.devices[1]?.path, '/user/iso/linux.iso')
  assert.equal(machines[0]?.createdAt, 12)
  assert.equal(machines[0]?.buildMode, 'release')
  assert.equal(machines[1]?.id, 'c')
  assert.equal(machines[1]?.memoryMb, DEFAULT_VIRTUAL_MACHINE_MEMORY_MB)
  assert.equal(machines[1]?.network, 'none')
  assert.equal(machines[1]?.networkBackend, 'off')
  assert.deepEqual(machines[1]?.devices, [])
}

function testNormalizeMigratesLegacyPaths(): void {
  const migrated = normalizeVirtualMachineSettings({
    name: 'legacy',
    hdaPath: '/user/disks/hda.img',
    cdromPath: 'https://example.com/os.iso',
    fdaPath: '   ',
    statePath: '/user/state.bin',
  })
  assert.equal(migrated?.devices.length, 2)
  assert.equal(migrated?.devices[0]?.type, 'hdd')
  assert.equal(migrated?.devices[0]?.path, '/user/disks/hda.img')
  assert.equal(migrated?.devices[0]?.source, 'local')
  assert.equal(migrated?.devices[1]?.type, 'state')
  assert.equal(migrated?.devices[1]?.path, '/user/state.bin')
}

function testNormalizeDevicesArray(): void {
  const array = normalizeVirtualMachineSettings({
    name: 'array',
    devices: [
      { id: 'x', type: 'hdd', source: 'local', path: '/a.img' },
      { type: 'unknown', source: 'network', path: 'https://x' },
      { type: 'cdrom', source: 'preset', path: 'https://p' },
    ],
  })
  assert.equal(array?.devices.length, 1)
  assert.equal(array?.devices[0]?.id, 'x')
  assert.equal(array?.devices[0]?.type, 'hdd')
}

function testNormalizeMemoryMbRange(): void {
  const a = normalizeVirtualMachineSettings({ name: 'test', memoryMb: 512 })
  assert.equal(a?.memoryMb, 512)

  const b = normalizeVirtualMachineSettings({ name: 'test', memoryMb: 100 })
  assert.equal(b?.memoryMb, 96)

  const c = normalizeVirtualMachineSettings({ name: 'test', memoryMb: 8192 })
  assert.equal(c?.memoryMb, 2032)

  const d = normalizeVirtualMachineSettings({ name: 'test', memoryMb: 1 })
  assert.equal(d?.memoryMb, 16)

  const e = normalizeVirtualMachineSettings({ name: 'test' })
  assert.equal(e?.memoryMb, DEFAULT_VIRTUAL_MACHINE_MEMORY_MB)
}

function testNormalizeCpuModelFallback(): void {
  const a = normalizeVirtualMachineSettings({ name: 'test' })
  assert.equal(a?.cpuModel, DEFAULT_VIRTUAL_MACHINE_CPU_MODEL)

  const b = normalizeVirtualMachineSettings({ name: 'test', cpuModel: 'windows-nt4' })
  assert.equal(b?.cpuModel, 'windows-nt4')

  const c = normalizeVirtualMachineSettings({ name: 'test', cpuModel: 'fake-cpu' })
  assert.equal(c?.cpuModel, DEFAULT_VIRTUAL_MACHINE_CPU_MODEL)
}

function testNormalizeDropsHttpUrls(): void {
  const machines = normalizeVirtualMachines([
    {
      id: 'reactos',
      name: 'ReactOS',
      devices: [
        { id: 'h', type: 'hdd', source: 'network', path: 'https://i.copy.sh/reactos-v3/.img' },
        { id: 's', type: 'state', source: 'network', path: 'https://i.copy.sh/reactos_state-v3.bin.zst' },
        { id: 'l', type: 'cdrom', source: 'local', path: '/user/os.iso' },
      ],
    },
  ])
  assert.equal(machines[0]?.devices.length, 1)
  assert.equal(machines[0]?.devices[0]?.path, '/user/os.iso')
  assert.equal(machines[0]?.devices[0]?.source, 'local')
}

function testNormalizeRecordRejectsInvalid(): void {
  assert.equal(normalizeVirtualMachineRecord(undefined), undefined)
  assert.equal(normalizeVirtualMachineRecord('vm'), undefined)
  assert.equal(normalizeVirtualMachineRecord({ id: '', name: 'x' }), undefined)
  assert.equal(normalizeVirtualMachineSettings({ name: '   ' }), undefined)
}

function testNextMachineName(): void {
  assert.equal(nextVirtualMachineName([]), DEFAULT_VIRTUAL_MACHINE_NAME)
  assert.equal(
    nextVirtualMachineName([createDefaultVirtualMachine()]),
    '虚拟机 2',
  )
  assert.equal(
    nextVirtualMachineName([
      createDefaultVirtualMachine(),
      { ...createDefaultVirtualMachine(), id: 'x', name: '虚拟机 2' },
    ]),
    '虚拟机 3',
  )
}

async function testFirstReadPersistsDefault(): Promise<void> {
  await resetState()
  const first = await readVirtualMachineStore()
  assert.equal(first.machines.length, 1)
  assert.equal(first.machines[0]?.id, DEFAULT_VIRTUAL_MACHINE_ID)
  const second = await readVirtualMachineStore()
  assert.deepEqual(second.machines, first.machines)
}

async function testEmptyWriteDoesNotReseed(): Promise<void> {
  await resetState()
  await readVirtualMachineStore()
  await writeVirtualMachineStore({ machines: [] })
  const store = await readVirtualMachineStore()
  assert.deepEqual(store.machines, [])
}

async function testAddUpdateAndRemoveRoundTrip(): Promise<void> {
  await resetState()
  await writeVirtualMachineStore({ machines: [] })
  const created = await addVirtualMachine(
    defaultVirtualMachineSettings('  测试机  '),
  )
  assert.equal(created.name, '测试机')
  assert.equal(created.backend, 'v86')
  assert.equal(created.memoryMb, DEFAULT_VIRTUAL_MACHINE_MEMORY_MB)
  assert.equal(created.cpuModel, DEFAULT_VIRTUAL_MACHINE_CPU_MODEL)
  const afterAdd = await readVirtualMachineStore()
  assert.equal(afterAdd.machines.length, 1)
  assert.equal(afterAdd.machines[0]?.id, created.id)

  const updated = await updateVirtualMachine(created.id, {
    ...defaultVirtualMachineSettings('改名'),
    memoryMb: 256,
    cpuModel: 'windows-nt4',
    network: 'ne2k',
    networkBackend: 'fetch',
    devices: [{ id: 'd', type: 'hdd', source: 'local', path: '/user/vm/disk.img' }],
    acpi: true,
  })
  assert.equal(updated?.id, created.id)
  assert.equal(updated?.name, '改名')
  assert.equal(updated?.memoryMb, 256)
  assert.equal(updated?.cpuModel, 'windows-nt4')
  assert.equal(updated?.network, 'ne2k')
  assert.equal(updated?.networkBackend, 'fetch')
  assert.equal(updated?.devices[0]?.path, '/user/vm/disk.img')
  assert.equal(updated?.acpi, true)
  assert.equal(updated?.createdAt, created.createdAt)

  const missing = await updateVirtualMachine('no-such', defaultVirtualMachineSettings('x'))
  assert.equal(missing, undefined)

  const remaining = await removeVirtualMachine(created.id)
  assert.equal(remaining.length, 0)
  const afterRemove = await readVirtualMachineStore()
  assert.deepEqual(afterRemove.machines, [])
}

testNormalizeMissingSeedsDefault()
testNormalizeEmptyArrayStaysEmpty()
testNormalizeDropsGarbageAndDuplicates()
testNormalizeMigratesLegacyPaths()
testNormalizeDevicesArray()
testNormalizeDropsHttpUrls()
testNormalizeRecordRejectsInvalid()
testNormalizeBuildModeFallback()
testNormalizeMemoryMbRange()
testNormalizeCpuModelFallback()
testNextMachineName()
await testFirstReadPersistsDefault()
await testEmptyWriteDoesNotReseed()
await testAddUpdateAndRemoveRoundTrip()
console.log('virtual-machine-store.test.ts ok')
