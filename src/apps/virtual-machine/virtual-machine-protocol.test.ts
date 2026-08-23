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
  formatVmMips,
  formatVmRunningDuration,
  formatVmVgaResolution,
} from './virtual-machine-stats-format.ts'
import {
  INSTANT_VM_BOOT_ORDER_TO_V86,
  INSTANT_VM_MESSAGE_TYPE,
  collectStartTransfers,
  isAllowedOrigin,
  isInstantVmHostToRuntimeMessage,
  isInstantVmKeyboardMessage,
  isInstantVmRuntimeToHostMessage,
  isInstantVmStartMessage,
  parseAllowedOrigins,
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
      devices: [
        { id: 'h', type: 'hdd', source: 'network', path: 'https://i.copy.sh/reactos-v3/.img' },
      ],
    }),
    true,
  )
}

function testCdromSendsEnterAndHddDoesNot(): void {
  const cdromSettings = {
    ...sampleSettings(),
    memoryMb: 512,
    bootOrder: 'cd-floppy-hdd' as const,
    devices: [{ id: 'c', type: 'cdrom', source: 'local', path: '/user/android-x86-1.6-r2.iso' }],
  }
  assert.equal(settingsToStartConfig(cdromSettings).sendEnterAfterMs, 3000)

  const reactos = {
    ...sampleSettings(),
    memoryMb: 512,
    acpi: true,
    devices: [
      { id: 'h', type: 'hdd', source: 'network', path: 'https://i.copy.sh/reactos-v3/.img' },
      { id: 's', type: 'state', source: 'network', path: 'https://i.copy.sh/reactos_state-v3.bin.zst' },
    ],
  }
  assert.equal(settingsToStartConfig(reactos).sendEnterAfterMs, undefined)
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

function testReactOsRemoteStartMessage(): void {
  const message = buildStartMessage(
    'req-2',
    {
      ...sampleSettings('ReactOS'),
      memoryMb: 512,
      acpi: true,
      devices: [
        { id: 'h', type: 'hdd', source: 'network', path: 'https://i.copy.sh/reactos-v3/.img' },
        { id: 's', type: 'state', source: 'network', path: 'https://i.copy.sh/reactos_state-v3.bin.zst' },
      ],
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
    hdaUrl: 'https://i.copy.sh/reactos-v3/.img',
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
}

function testDefaultPointerModeInStartConfig(): void {
  const config = settingsToStartConfig(sampleSettings())
  assert.equal(config.pointerMode, 'lock')
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
  }
  assert.equal(isInstantVmRuntimeToHostMessage(stats), true)
  assert.equal(isInstantVmRuntimeToHostMessage({ ...stats, mouse: 'no' }), false)
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

testBootOrderMatchesV86()
testHasBootMedia()
testCdromSendsEnterAndHddDoesNot()
testStartMessageTransfers()
testStartMessageMapsMultipleHdds()
testHighMemoryAndDiskStreamStartMessage()
testReactOsRemoteStartMessage()
testPathSummaryForRemoteUrl()
testStatsFormatting()
testNetworkFields()
testDefaultPointerModeInStartConfig()
testCpuModelPassedThrough()
testOriginAllowList()
testStatsMessage()
testSaveStateMessage()
testStoppedWithoutRequestId()
testKeyboardMessage()
console.log('virtual-machine-protocol.test.ts ok')
