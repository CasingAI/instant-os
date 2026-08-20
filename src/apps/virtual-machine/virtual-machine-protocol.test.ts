/**
 * Virtual Machine 协议与启动配置单测。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-protocol.test.ts
 */
import assert from 'node:assert/strict'
import {
  defaultVirtualMachineSettings,
  formatVmPathSummary,
} from './virtual-machine-config.ts'
import {
  buildStartMessage,
  settingsToStartConfig,
  virtualMachineHasBootMedia,
} from './virtual-machine-disks.ts'
import {
  INSTANT_VM_BOOT_ORDER_TO_V86,
  INSTANT_VM_MESSAGE_TYPE,
  collectStartTransfers,
  isAllowedOrigin,
  isInstantVmStartMessage,
  parseAllowedOrigins,
  startMessageHasDisk,
} from './virtual-machine-protocol.ts'

function testBootOrderMatchesV86(): void {
  assert.equal(INSTANT_VM_BOOT_ORDER_TO_V86.auto, 0)
  assert.equal(INSTANT_VM_BOOT_ORDER_TO_V86['cd-floppy-hdd'], 0x213)
  assert.equal(INSTANT_VM_BOOT_ORDER_TO_V86['cd-hdd-floppy'], 0x123)
  assert.equal(INSTANT_VM_BOOT_ORDER_TO_V86['floppy-cd-hdd'], 0x231)
  assert.equal(INSTANT_VM_BOOT_ORDER_TO_V86['floppy-hdd-cd'], 0x321)
  assert.equal(INSTANT_VM_BOOT_ORDER_TO_V86['hdd-cd-floppy'], 0x132)
}

function testHasBootMedia(): void {
  const empty = defaultVirtualMachineSettings()
  assert.equal(virtualMachineHasBootMedia(empty), false)
  assert.equal(virtualMachineHasBootMedia({ ...empty, cdromPath: '/user/android.iso' }), true)
  assert.equal(virtualMachineHasBootMedia({ ...empty, hdaPath: '/user/disk.img' }), true)
  assert.equal(
    virtualMachineHasBootMedia({
      ...empty,
      hdaPath: 'https://i.copy.sh/reactos-v3/.img',
    }),
    true,
  )
}

function testCdromSendsEnterAndHddDoesNot(): void {
  const cdromSettings = {
    ...defaultVirtualMachineSettings('Android'),
    memoryMb: 512 as const,
    bootOrder: 'cd-floppy-hdd' as const,
    cdromPath: '/user/android-x86-1.6-r2.iso',
  }
  assert.equal(settingsToStartConfig(cdromSettings).sendEnterAfterMs, 3000)

  const reactos = {
    ...defaultVirtualMachineSettings('ReactOS'),
    memoryMb: 512 as const,
    acpi: true,
    hdaPath: 'https://i.copy.sh/reactos-v3/.img',
    statePath: 'https://i.copy.sh/reactos_state-v3.bin.zst',
  }
  assert.equal(settingsToStartConfig(reactos).sendEnterAfterMs, undefined)
}

function testStartMessageTransfers(): void {
  const cdrom = new ArrayBuffer(8)
  const message = buildStartMessage(
    'req-1',
    {
      ...defaultVirtualMachineSettings(),
      cdromPath: '/user/android.iso',
    },
    { cdrom },
  )
  assert.equal(isInstantVmStartMessage(message), true)
  assert.equal(startMessageHasDisk(message), true)
  assert.deepEqual(collectStartTransfers(message), [cdrom])
  assert.equal(message.type, INSTANT_VM_MESSAGE_TYPE.start)
}

function testReactOsRemoteStartMessage(): void {
  const message = buildStartMessage(
    'req-2',
    {
      ...defaultVirtualMachineSettings('ReactOS'),
      memoryMb: 512,
      acpi: true,
      hdaPath: 'https://i.copy.sh/reactos-v3/.img',
      statePath: 'https://i.copy.sh/reactos_state-v3.bin.zst',
    },
    {
      hdaUrl: 'https://i.copy.sh/reactos-v3/.img',
      stateUrl: 'https://i.copy.sh/reactos_state-v3.bin.zst',
    },
  )
  assert.equal(isInstantVmStartMessage(message), true)
  assert.equal(startMessageHasDisk(message), true)
  assert.deepEqual(collectStartTransfers(message), [])
  assert.equal(message.hdaUrl, 'https://i.copy.sh/reactos-v3/.img')
  assert.equal(message.stateUrl, 'https://i.copy.sh/reactos_state-v3.bin.zst')
  assert.equal(message.config.sendEnterAfterMs, undefined)
}

function testPathSummaryForRemoteUrl(): void {
  assert.equal(formatVmPathSummary(''), '未挂载')
  assert.equal(formatVmPathSummary('/user/disks/a.img'), 'a.img')
  assert.equal(
    formatVmPathSummary('https://i.copy.sh/reactos-v3/.img'),
    'i.copy.sh/reactos-v3/.img',
  )
}

function testOriginAllowList(): void {
  assert.deepEqual(parseAllowedOrigins('', ['http://localhost:6173']), ['http://localhost:6173'])
  assert.equal(isAllowedOrigin('http://localhost:6175', ['http://localhost:6175']), true)
  assert.equal(isAllowedOrigin('https://evil.example', ['http://localhost:6175']), false)
}

testBootOrderMatchesV86()
testHasBootMedia()
testCdromSendsEnterAndHddDoesNot()
testStartMessageTransfers()
testReactOsRemoteStartMessage()
testPathSummaryForRemoteUrl()
testOriginAllowList()
console.log('virtual-machine-protocol.test.ts ok')
