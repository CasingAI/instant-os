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
  inferDriveSources,
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

function testApplyAndroid(): void {
  const next = applyGuestPreset(defaultVirtualMachineSettings('测试'), 'android-x86-1.6-r2')
  assert.equal(next.memoryMb, 512)
  assert.equal(next.acpi, false)
  assert.equal(next.bootOrder, 'cd-floppy-hdd')
  assert.equal(next.cdromPath, VM_PRESET_ANDROID_CDROM_URL)
  assert.equal(next.hdaPath, '')
  assert.equal(next.statePath, '')
  assert.equal(detectAppliedGuestPreset(next), 'android-x86-1.6-r2')
}

function testApplyReactOsReplacesOtherMedia(): void {
  const dirty = {
    ...defaultVirtualMachineSettings('测试'),
    cdromPath: '/user/old.iso',
    fdaPath: '/user/boot.img',
  }
  const next = applyGuestPreset(dirty, 'reactos')
  assert.equal(next.memoryMb, 512)
  assert.equal(next.acpi, true)
  assert.equal(next.bootOrder, 'auto')
  assert.equal(next.hdaPath, VM_PRESET_REACTOS_HDA_URL)
  assert.equal(next.statePath, VM_PRESET_REACTOS_STATE_URL)
  assert.equal(next.cdromPath, '')
  assert.equal(next.fdaPath, '')
  assert.equal(detectAppliedGuestPreset(next), 'reactos')
  assert.deepEqual(inferDriveSources(next), {
    hdaPath: 'preset',
    cdromPath: 'local',
    fdaPath: 'local',
    statePath: 'preset',
  })
}

function testDetectRequiresExactSet(): void {
  assert.equal(detectAppliedGuestPreset(defaultVirtualMachineSettings()), undefined)
  assert.equal(
    detectAppliedGuestPreset({
      ...defaultVirtualMachineSettings(),
      hdaPath: VM_PRESET_REACTOS_HDA_URL,
    }),
    undefined,
  )
}

testInferSource()
testApplyAndroid()
testApplyReactOsReplacesOtherMedia()
testDetectRequiresExactSet()
console.log('virtual-machine-presets.test.ts ok')
