/**
 * Virtual Machine 机器列表存储单测。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-store.test.ts
 *
 * 覆盖：缺省播种；空数组不回种；坏数据回落；新建 / 更新 / 删除往返。
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
  assert.equal(machines[0]?.hdaPath, '')
  assert.equal(machines[0]?.statePath, '')
  assert.equal(machines[0]?.speaker, true)
  assert.equal(machines[0]?.acpi, false)
  assert.equal(machines[0]?.buildMode, DEFAULT_VIRTUAL_MACHINE_BUILD_MODE)
}

function testNormalizeBuildModeFallback(): void {
  // 缺失 buildMode → 回退到默认 release
  const noMode = normalizeVirtualMachineSettings({ name: 'test' })
  assert.equal(noMode?.buildMode, 'release')

  // 非法值 → 回退到默认
  const badMode = normalizeVirtualMachineSettings({ name: 'test', buildMode: 'unknown' })
  assert.equal(badMode?.buildMode, 'release')

  // 合法值保留
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
      hdaPath: 'user/disks/a.img',
      cdromPath: '/user/iso/linux.iso',
      fdaPath: '   ',
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
  assert.equal(machines[0]?.hdaPath, '/user/disks/a.img')
  assert.equal(machines[0]?.cdromPath, '/user/iso/linux.iso')
  assert.equal(machines[0]?.fdaPath, '')
  assert.equal(machines[0]?.statePath, '')
  assert.equal(machines[0]?.createdAt, 12)
  assert.equal(machines[0]?.buildMode, 'release') // 非法 backend 不影响 buildMode 回退
  assert.equal(machines[1]?.id, 'c')
  assert.equal(machines[1]?.memoryMb, DEFAULT_VIRTUAL_MACHINE_MEMORY_MB)
  assert.equal(machines[1]?.network, 'none')
  assert.equal(machines[1]?.networkBackend, 'off')
}

function testNormalizeMemoryMbRange(): void {
  // 旧值 512 在范围内，保留
  const a = normalizeVirtualMachineSettings({ name: 'test', memoryMb: 512 })
  assert.equal(a?.memoryMb, 512)

  // 非 16 倍数，向下取整到 16 的倍数
  const b = normalizeVirtualMachineSettings({ name: 'test', memoryMb: 100 })
  assert.equal(b?.memoryMb, 96)

  // 超过上限 2032，clamp 到 2032（v86 无法使用满 2048 MB）
  const c = normalizeVirtualMachineSettings({ name: 'test', memoryMb: 8192 })
  assert.equal(c?.memoryMb, 2032)

  // 低于下限 16，clamp 到 16
  const d = normalizeVirtualMachineSettings({ name: 'test', memoryMb: 1 })
  assert.equal(d?.memoryMb, 16)

  // 缺失 → 默认值
  const e = normalizeVirtualMachineSettings({ name: 'test' })
  assert.equal(e?.memoryMb, DEFAULT_VIRTUAL_MACHINE_MEMORY_MB)
}

function testNormalizeCpuModelFallback(): void {
  // 缺失 → 默认值
  const a = normalizeVirtualMachineSettings({ name: 'test' })
  assert.equal(a?.cpuModel, DEFAULT_VIRTUAL_MACHINE_CPU_MODEL)

  // 合法值保留
  const b = normalizeVirtualMachineSettings({ name: 'test', cpuModel: 'windows-nt4' })
  assert.equal(b?.cpuModel, 'windows-nt4')

  // 非法值 → 回退
  const c = normalizeVirtualMachineSettings({ name: 'test', cpuModel: 'fake-cpu' })
  assert.equal(c?.cpuModel, DEFAULT_VIRTUAL_MACHINE_CPU_MODEL)
}

function testNormalizeKeepsHttpUrls(): void {
  const machines = normalizeVirtualMachines([
    {
      id: 'reactos',
      name: 'ReactOS',
      hdaPath: 'https://i.copy.sh/reactos-v3/.img',
      statePath: 'https://i.copy.sh/reactos_state-v3.bin.zst',
    },
  ])
  assert.equal(machines[0]?.hdaPath, 'https://i.copy.sh/reactos-v3/.img')
  assert.equal(machines[0]?.statePath, 'https://i.copy.sh/reactos_state-v3.bin.zst')
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
    hdaPath: '/user/vm/disk.img',
    acpi: true,
  })
  assert.equal(updated?.id, created.id)
  assert.equal(updated?.name, '改名')
  assert.equal(updated?.memoryMb, 256)
  assert.equal(updated?.cpuModel, 'windows-nt4')
  assert.equal(updated?.network, 'ne2k')
  assert.equal(updated?.networkBackend, 'fetch')
  assert.equal(updated?.hdaPath, '/user/vm/disk.img')
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
testNormalizeKeepsHttpUrls()
testNormalizeRecordRejectsInvalid()
testNormalizeBuildModeFallback()
testNormalizeMemoryMbRange()
testNormalizeCpuModelFallback()
testNextMachineName()
await testFirstReadPersistsDefault()
await testEmptyWriteDoesNotReseed()
await testAddUpdateAndRemoveRoundTrip()
console.log('virtual-machine-store.test.ts ok')
