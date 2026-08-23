/**
 * 虚拟机预制镜像单测。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-presets.test.ts
 */
import assert from 'node:assert/strict'
import { defaultVirtualMachineSettings } from './virtual-machine-config.ts'
import {
  applyGuestPreset,
  detectAppliedGuestPreset,
  inferDriveSource,
  isGuestPresetPath,
  VM_PRESET_ANDROID_CDROM_URL,
  VM_PRESET_REACTOS_HDA_URL,
  VM_PRESET_REACTOS_STATE_URL,
} from './virtual-machine-presets.ts'

function testInferSource(): void {
  assert.equal(inferDriveSource(''), 'local')
  assert.equal(inferDriveSource('/user/disks/a.img'), 'local')
  assert.equal(inferDriveSource('https://example.com/disk.img'), 'network')
  assert.equal(inferDriveSource(VM_PRESET_REACTOS_HDA_URL), 'preset')
  assert.equal(inferDriveSource(VM_PRESET_ANDROID_CDROM_URL), 'preset')
}

function testIsGuestPresetPath(): void {
  assert.equal(isGuestPresetPath(VM_PRESET_REACTOS_HDA_URL), true)
  assert.equal(isGuestPresetPath(VM_PRESET_ANDROID_CDROM_URL), true)
  assert.equal(isGuestPresetPath('/user/disks/a.img'), false)
}

function testApplyAndroid(): void {
  const next = applyGuestPreset(defaultVirtualMachineSettings('测试'), 'android-x86-1.6-r2')
  assert.equal(next.memoryMb, 512)
  assert.equal(next.acpi, false)
  assert.equal(next.bootOrder, 'cd-floppy-hdd')
  assert.equal(next.devices.length, 1)
  assert.equal(next.devices[0]?.type, 'cdrom')
  assert.equal(next.devices[0]?.path, VM_PRESET_ANDROID_CDROM_URL)
  assert.equal(next.devices[0]?.source, 'preset')
  assert.equal(detectAppliedGuestPreset(next), 'android-x86-1.6-r2')
}

function testApplyReactOsReplacesOtherMedia(): void {
  const dirty = {
    ...defaultVirtualMachineSettings('测试'),
    devices: [
      { id: 'x', type: 'cdrom', source: 'local', path: '/user/old.iso' },
      { id: 'y', type: 'floppy', source: 'local', path: '/user/boot.img' },
    ],
  }
  const next = applyGuestPreset(dirty, 'reactos')
  assert.equal(next.memoryMb, 512)
  assert.equal(next.acpi, true)
  assert.equal(next.bootOrder, 'auto')
  assert.equal(next.devices.length, 2)
  assert.equal(next.devices[0]?.type, 'hdd')
  assert.equal(next.devices[0]?.path, VM_PRESET_REACTOS_HDA_URL)
  assert.equal(next.devices[1]?.type, 'state')
  assert.equal(next.devices[1]?.path, VM_PRESET_REACTOS_STATE_URL)
  assert.equal(detectAppliedGuestPreset(next), 'reactos')
}

function testDetectRequiresExactSet(): void {
  assert.equal(detectAppliedGuestPreset(defaultVirtualMachineSettings()), undefined)
  assert.equal(
    detectAppliedGuestPreset({
      ...defaultVirtualMachineSettings(),
      devices: [{ id: 'x', type: 'hdd', source: 'preset', path: VM_PRESET_REACTOS_HDA_URL }],
    }),
    undefined,
  )
}

testInferSource()
testIsGuestPresetPath()
testApplyAndroid()
testApplyReactOsReplacesOtherMedia()
testDetectRequiresExactSet()
console.log('virtual-machine-presets.test.ts ok')
