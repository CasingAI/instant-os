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
  isInstantVmRuntimeToHostMessage,
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
    memoryMb: 512,
    bootOrder: 'cd-floppy-hdd' as const,
    cdromPath: '/user/android-x86-1.6-r2.iso',
  }
  assert.equal(settingsToStartConfig(cdromSettings).sendEnterAfterMs, 3000)

  const reactos = {
    ...defaultVirtualMachineSettings('ReactOS'),
    memoryMb: 512,
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
      hda: {
        present: false,
        busy: 'idle',
        sectorsRead: 0,
        bytesRead: 0,
        sectorsWritten: 0,
        bytesWritten: 0,
      },
      cdrom: {
        present: false,
        busy: 'idle',
        sectorsRead: 0,
        bytesRead: 0,
        sectorsWritten: 0,
        bytesWritten: 0,
      },
      fda: {
        present: false,
        busy: 'idle',
        sectorsRead: 0,
        bytesRead: 0,
        sectorsWritten: 0,
        bytesWritten: 0,
      },
      vga: { mode: 'graphical', width: 800, height: 600, bpp: 16 },
      mouse: false,
      mouseCapabilities: { hasAbsolute: false, hasRelative: false },
    }),
    '800×600×16',
  )
}

function testNetworkFields(): void {
  const withFetch = {
    ...defaultVirtualMachineSettings(),
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

function testCpuModelPassedThrough(): void {
  // 默认 → 不传 cpuidLevel
  const defaultCfg = settingsToStartConfig(defaultVirtualMachineSettings())
  assert.equal(defaultCfg.cpuidLevel, undefined)

  // windows-nt4 → cpuidLevel=2
  const nt4 = settingsToStartConfig({
    ...defaultVirtualMachineSettings(),
    cpuModel: 'windows-nt4',
  })
  assert.equal(nt4.cpuidLevel, 2)
}

function testOriginAllowList(): void {
  assert.deepEqual(parseAllowedOrigins('', ['http://localhost:6173']), ['http://localhost:6173'])
  assert.equal(isAllowedOrigin('http://localhost:6175', ['http://localhost:6175']), true)
  assert.equal(isAllowedOrigin('https://evil.example', ['http://localhost:6175']), false)
}

function testStatsMessage(): void {
  const stats = {
    type: INSTANT_VM_MESSAGE_TYPE.stats,
    runningMs: 19000,
    speedMips: 0.5,
    avgSpeedMips: 97.5,
    ideLabel: 'cdrom' as const,
    hda: {
      present: false,
      busy: 'idle' as const,
      sectorsRead: 0,
      bytesRead: 0,
      sectorsWritten: 0,
      bytesWritten: 0,
    },
    cdrom: {
      present: true,
      busy: 'read' as const,
      sectorsRead: 3779,
      bytesRead: 7_739_392,
      sectorsWritten: 0,
      bytesWritten: 0,
    },
    fda: {
      present: false,
      busy: 'idle' as const,
      sectorsRead: 0,
      bytesRead: 0,
      sectorsWritten: 0,
      bytesWritten: 0,
    },
    vga: { mode: 'graphical' as const, width: 800, height: 600, bpp: 16 },
    mouse: false,
  }
  assert.equal(isInstantVmRuntimeToHostMessage(stats), true)
  assert.equal(isInstantVmRuntimeToHostMessage({ ...stats, mouse: 'no' }), false)
}

testBootOrderMatchesV86()
testHasBootMedia()
testCdromSendsEnterAndHddDoesNot()
testStartMessageTransfers()
testReactOsRemoteStartMessage()
testPathSummaryForRemoteUrl()
testStatsFormatting()
testNetworkFields()
testCpuModelPassedThrough()
testOriginAllowList()
testStatsMessage()
console.log('virtual-machine-protocol.test.ts ok')
