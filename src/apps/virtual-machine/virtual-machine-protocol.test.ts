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
  virtualMachineDiskPersistsWrites,
  virtualMachineHasBootMedia,
} from './virtual-machine-disks.ts'
import {
  formatVmMips,
  formatVmRunningDuration,
  formatVmVgaResolution,
} from './virtual-machine-stats-format.ts'
import {
  INSTANT_VM_BOOT_ORDER_TO_V86,
  INSTANT_VM_DISK_RANGE_MAX_BYTES,
  INSTANT_VM_MESSAGE_TYPE,
  collectStartTransfers,
  isAllowedOrigin,
  isInstantVmDiskWriteMessage,
  isInstantVmDiskWriteResultMessage,
  isInstantVmHostToRuntimeMessage,
  isInstantVmKeyboardMessage,
  isInstantVmRuntimeToHostMessage,
  isInstantVmStartMessage,
  parseAllowedOrigins,
  resolveEffectivePointerMode,
  startMessageHasDisk,
} from './virtual-machine-protocol.ts'

function sampleSettings(): ReturnType<typeof defaultVirtualMachineSettings> {
  return defaultVirtualMachineSettings('test')
}

function testBootOrderMatchesV86(): void {
  assert.equal(INSTANT_VM_BOOT_ORDER_TO_V86.auto, 0)
  assert.equal(INSTANT_VM_BOOT_ORDER_TO_V86['cd-floppy-hdd'], 0x213)
  assert.equal(INSTANT_VM_BOOT_ORDER_TO_V86['cd-hdd-floppy'], 0x123)
  assert.equal(INSTANT_VM_BOOT_ORDER_TO_V86['floppy-cd-hdd'], 0x231)
  assert.equal(INSTANT_VM_BOOT_ORDER_TO_V86['floppy-hdd-cd'], 0x321)
  assert.equal(INSTANT_VM_BOOT_ORDER_TO_V86['hdd-cd-floppy'], 0x132)
}

function testHasBootMedia(): void {
  const empty = sampleSettings()
  assert.equal(virtualMachineHasBootMedia(empty), false)
  assert.equal(
    virtualMachineHasBootMedia({
      ...empty,
      devices: [{ id: 'c', type: 'cdrom', source: 'local', path: '/user/android.iso' }],
    }),
    true,
  )
  assert.equal(
    virtualMachineHasBootMedia({
      ...empty,
      devices: [{ id: 'h', type: 'hdd', source: 'local', path: '/user/disk.img' }],
    }),
    true,
  )
  assert.equal(
    virtualMachineHasBootMedia({
      ...empty,
      devices: [{ id: 'h', type: 'hdd', source: 'local', path: '/user/disks/reactos.img' }],
    }),
    true,
  )
}

function testPersistWritesOnlyHddAndFloppy(): void {
  assert.equal(virtualMachineDiskPersistsWrites('hdd'), true)
  assert.equal(virtualMachineDiskPersistsWrites('floppy'), true)
  assert.equal(virtualMachineDiskPersistsWrites('cdrom'), false)
  assert.equal(virtualMachineDiskPersistsWrites('state'), false)
}

function testStartMessageTransfers(): void {
  const cdrom = new ArrayBuffer(8)
  const message = buildStartMessage(
    'req-1',
    {
      ...sampleSettings(),
      devices: [{ id: 'c', type: 'cdrom', source: 'local', path: '/user/android.iso' }],
    },
    { cdrom },
  )
  assert.equal(isInstantVmStartMessage(message), true)
  assert.equal(startMessageHasDisk(message), true)
  assert.deepEqual(collectStartTransfers(message), [cdrom])
  assert.equal(message.type, INSTANT_VM_MESSAGE_TYPE.start)
}

function testStartMessageMapsMultipleHdds(): void {
  const hda = new ArrayBuffer(8)
  const hdb = new ArrayBuffer(4)
  const message = buildStartMessage(
    'req-multi',
    {
      ...sampleSettings(),
      devices: [
        { id: 'h1', type: 'hdd', source: 'local', path: '/user/a.img' },
        { id: 'h2', type: 'hdd', source: 'local', path: '/user/b.img' },
        { id: 'c', type: 'cdrom', source: 'local', path: '/user/os.iso' },
      ],
    },
    { hda, hdb },
  )
  assert.equal(message.hda, hda)
  assert.equal(message.hdb, hdb)
  assert.equal(message.cdrom, undefined)
}

function testHighMemoryAndDiskStreamStartMessage(): void {
  const message = buildStartMessage(
    'req-stream',
    {
      ...sampleSettings(),
      memoryMb: 1024,
      devices: [{ id: 'h', type: 'hdd', source: 'local', path: '/user/Downloads/windowsxp.img' }],
    },
    { hdaStream: { id: 'ds-xp', size: 2 * 1024 * 1024 * 1024 } },
  )
  assert.equal(isInstantVmStartMessage(message), true)
  assert.equal(startMessageHasDisk(message), true)
  assert.equal(message.config.memoryMb, 1024)
  assert.deepEqual(message.hdaStream, { id: 'ds-xp', size: 2 * 1024 * 1024 * 1024 })
  assert.equal(message.hdbStream, undefined)
}

function testLocalDiskStartMessage(): void {
  const hda = new ArrayBuffer(8)
  const state = new ArrayBuffer(4)
  const message = buildStartMessage(
    'req-2',
    {
      ...sampleSettings('ReactOS'),
      memoryMb: 512,
      acpi: true,
      devices: [
        { id: 'h', type: 'hdd', source: 'local', path: '/user/disks/reactos.img' },
        { id: 's', type: 'state', source: 'local', path: '/user/disks/reactos.bin' },
      ],
    },
    { hda, state },
  )
  assert.equal(isInstantVmStartMessage(message), true)
  assert.equal(startMessageHasDisk(message), true)
  assert.deepEqual(collectStartTransfers(message), [hda, state])
  assert.equal(message.hda, hda)
  assert.equal(message.state, state)
  assert.equal(message.hdaUrl, undefined)
  assert.equal(message.stateUrl, undefined)
}

function testPathSummaryForRemoteUrl(): void {
  assert.equal(formatVmPathSummary(''), '未挂载')
  assert.equal(formatVmPathSummary('/user/disks/a.img'), 'a.img')
  assert.equal(
    formatVmPathSummary('https://i.copy.sh/reactos-v3/.img'),
    'i.copy.sh/reactos-v3/.img',
  )
}

function emptyDiskStats() {
  return {
    present: false,
    busy: 'idle' as const,
    sectorsRead: 0,
    bytesRead: 0,
    sectorsWritten: 0,
    bytesWritten: 0,
  }
}

function testStatsFormatting(): void {
  assert.equal(formatVmRunningDuration(19_000), '19s')
  assert.equal(formatVmRunningDuration(65_000), '1m 5s')
  assert.equal(formatVmMips(0.5), '0.50 mIPS')
  assert.equal(formatVmMips(97.5), '97.5 mIPS')
  assert.equal(
    formatVmVgaResolution({
      runningMs: 0,
      speedMips: 0,
      avgSpeedMips: 0,
      ideLabel: 'none',
      hda: emptyDiskStats(),
      hdb: emptyDiskStats(),
      cdrom: emptyDiskStats(),
      fda: emptyDiskStats(),
      fdb: emptyDiskStats(),
      vga: { mode: 'graphical', width: 800, height: 600, bpp: 16 },
      mouse: false,
    }),
    '800×600×16',
  )
}

function testNetworkFields(): void {
  const withFetch = {
    ...sampleSettings(),
    network: 'virtio' as const,
    networkBackend: 'fetch' as const,
  }
  const config = settingsToStartConfig(withFetch)
  assert.equal(config.network, 'virtio')
  assert.equal(config.networkBackend, 'fetch')

  const message = buildStartMessage('req-net', withFetch, {
    hda: new ArrayBuffer(8),
  })
  assert.equal(isInstantVmStartMessage(message), true)
  assert.equal(
    isInstantVmStartMessage({
      ...message,
      config: { ...config, network: 'e1000' },
    }),
    false,
  )
  assert.equal(
    isInstantVmStartMessage({
      ...message,
      config: { ...config, networkBackend: 'wsproxy' },
    }),
    false,
  )
  assert.equal(
    isInstantVmStartMessage({
      ...message,
      config: { ...config, pointerMode: 'grab' },
    }),
    false,
  )
  assert.equal(
    isInstantVmStartMessage({
      ...message,
      config: { ...config, pointerMode: 'auto' },
    }),
    true,
  )
}

function testDefaultPointerModeInStartConfig(): void {
  const config = settingsToStartConfig(sampleSettings())
  assert.equal(config.pointerMode, 'auto')
}

function testResolveEffectivePointerMode(): void {
  assert.equal(resolveEffectivePointerMode('auto', false), 'lock')
  assert.equal(resolveEffectivePointerMode('auto', true), 'follow')
  assert.equal(resolveEffectivePointerMode('follow', false), 'follow')
  assert.equal(resolveEffectivePointerMode('lock', true), 'lock')
}

function testCpuModelPassedThrough(): void {
  const defaultCfg = settingsToStartConfig(sampleSettings())
  assert.equal(defaultCfg.cpuidLevel, undefined)

  const nt4 = settingsToStartConfig({
    ...sampleSettings(),
    cpuModel: 'windows-nt4',
  })
  assert.equal(nt4.cpuidLevel, 2)
}

function testOriginAllowList(): void {
  assert.deepEqual(parseAllowedOrigins('', ['http://localhost:6173']), ['http://localhost:6173'])
  assert.equal(isAllowedOrigin('http://localhost:6175', ['http://localhost:6175']), true)
  assert.equal(isAllowedOrigin('https://evil.example', ['http://localhost:6175']), false)

  const prodAllowed = [
    'http://localhost:6173',
    'http://127.0.0.1:6173',
    'https://*.instant-os.pages.dev',
    'https://*.casing-ai.com',
  ]
  assert.equal(isAllowedOrigin('https://experimental.instant-os.pages.dev', prodAllowed), true)
  assert.equal(isAllowedOrigin('https://instant-os.pages.dev', prodAllowed), true)
  assert.equal(isAllowedOrigin('https://vm.casing-ai.com', prodAllowed), true)
  assert.equal(isAllowedOrigin('http://experimental.instant-os.pages.dev', prodAllowed), false)
  assert.equal(isAllowedOrigin('https://evil.example', prodAllowed), false)
}

function testStatsMessage(): void {
  const stats = {
    type: INSTANT_VM_MESSAGE_TYPE.stats,
    runningMs: 19000,
    speedMips: 0.5,
    avgSpeedMips: 97.5,
    ideLabel: 'cdrom' as const,
    hda: emptyDiskStats(),
    hdb: emptyDiskStats(),
    cdrom: {
      ...emptyDiskStats(),
      present: true,
      busy: 'read' as const,
      sectorsRead: 3779,
      bytesRead: 7_739_392,
    },
    fda: emptyDiskStats(),
    fdb: emptyDiskStats(),
    vga: { mode: 'graphical' as const, width: 800, height: 600, bpp: 16 },
    mouse: false,
    absoluteMouse: false,
  }
  assert.equal(isInstantVmRuntimeToHostMessage(stats), true)
  assert.equal(isInstantVmRuntimeToHostMessage({ ...stats, mouse: 'no' }), false)
  assert.equal(isInstantVmRuntimeToHostMessage({ ...stats, absoluteMouse: 'no' }), false)
}

function testSaveStateMessage(): void {
  assert.equal(
    isInstantVmHostToRuntimeMessage({
      type: INSTANT_VM_MESSAGE_TYPE.saveState,
      requestId: 'rs-1',
    }),
    true,
  )
  assert.equal(
    isInstantVmHostToRuntimeMessage({
      type: INSTANT_VM_MESSAGE_TYPE.saveState,
      requestId: '',
    }),
    false,
  )
  const state = new ArrayBuffer(8)
  assert.equal(
    isInstantVmRuntimeToHostMessage({
      type: INSTANT_VM_MESSAGE_TYPE.saveStateResult,
      requestId: 'rs-2',
      state,
    }),
    true,
  )
  assert.equal(
    isInstantVmRuntimeToHostMessage({
      type: INSTANT_VM_MESSAGE_TYPE.saveStateResult,
      requestId: 'rs-3',
    }),
    false,
  )
  assert.equal(
    isInstantVmRuntimeToHostMessage({
      type: INSTANT_VM_MESSAGE_TYPE.saveStateResult,
      requestId: 'rs-4',
      state: new Uint8Array(8),
    }),
    false,
  )
}

function testStoppedWithoutRequestId(): void {
  assert.equal(
    isInstantVmRuntimeToHostMessage({ type: INSTANT_VM_MESSAGE_TYPE.stopped }),
    true,
  )
  assert.equal(
    isInstantVmRuntimeToHostMessage({ type: INSTANT_VM_MESSAGE_TYPE.stopped, requestId: 'a' }),
    true,
  )
  assert.equal(
    isInstantVmRuntimeToHostMessage({ type: INSTANT_VM_MESSAGE_TYPE.stopped, requestId: '' }),
    false,
  )
}

function testKeyboardMessage(): void {
  const message = {
    type: INSTANT_VM_MESSAGE_TYPE.keyboard,
    phase: 'down' as const,
    key: 'a',
    code: 'KeyA',
    keyCode: 65,
    location: 0,
    repeat: false,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
  }
  assert.equal(isInstantVmKeyboardMessage(message), true)
  assert.equal(isInstantVmHostToRuntimeMessage(message), true)
  assert.equal(isInstantVmKeyboardMessage({ ...message, phase: 'hold' }), false)
}

function testDiskWriteMessages(): void {
  const bytes = new Uint8Array([1, 2, 3, 4]).buffer
  const write = {
    type: INSTANT_VM_MESSAGE_TYPE.diskWrite,
    requestId: 'dw-1',
    streamId: 'ds-hda',
    offset: 512,
    bytes,
  }
  assert.equal(isInstantVmDiskWriteMessage(write), true)
  assert.equal(isInstantVmRuntimeToHostMessage(write), true)
  assert.equal(isInstantVmHostToRuntimeMessage(write), false)
  assert.equal(isInstantVmDiskWriteMessage({ ...write, bytes: new Uint8Array(4) }), false)
  assert.equal(isInstantVmDiskWriteMessage({ ...write, bytes: new ArrayBuffer(0) }), false)
  assert.equal(
    isInstantVmDiskWriteMessage({ ...write, bytes: new ArrayBuffer(INSTANT_VM_DISK_RANGE_MAX_BYTES + 1) }),
    false,
  )
  assert.equal(isInstantVmDiskWriteMessage({ ...write, offset: -1 }), false)
  const result = {
    type: INSTANT_VM_MESSAGE_TYPE.diskWriteResult,
    requestId: 'dw-1',
    streamId: 'ds-hda',
    status: 200,
    totalSize: 1024,
  }
  assert.equal(isInstantVmDiskWriteResultMessage(result), true)
  assert.equal(isInstantVmRuntimeToHostMessage(result), false)
  assert.equal(isInstantVmHostToRuntimeMessage(result), false)
  assert.equal(isInstantVmDiskWriteResultMessage({ ...result, status: 1.5 }), false)
}

testBootOrderMatchesV86()
testHasBootMedia()
testPersistWritesOnlyHddAndFloppy()
testStartMessageTransfers()
testStartMessageMapsMultipleHdds()
testHighMemoryAndDiskStreamStartMessage()
testLocalDiskStartMessage()
testPathSummaryForRemoteUrl()
testStatsFormatting()
testNetworkFields()
testDefaultPointerModeInStartConfig()
testResolveEffectivePointerMode()
testCpuModelPassedThrough()
testOriginAllowList()
testStatsMessage()
testSaveStateMessage()
testStoppedWithoutRequestId()
testKeyboardMessage()
testDiskWriteMessages()
console.log('virtual-machine-protocol.test.ts ok')
