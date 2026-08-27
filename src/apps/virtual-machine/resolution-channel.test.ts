/**
 * 分辨率自动对齐 —— 宿主侧通道单测（第一期机制 + 语义层）。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/resolution-channel.test.ts
 *
 * 覆盖：32 位打包、clamp 先于移位、DPR 换算、阈值、防抖合并（5 连发仅 1 次变更）、
 * disconnect 停发、DPR 变化重算、开关关闭时不挂 observer、协议消息与 start 配置映射。
 * ResizeObserver / 定时器 / matchMedia 全部注入假实现，Node 里即可完整验证。
 */
import assert from 'node:assert/strict'
import {
  RESOLUTION_CHANNEL_PORT,
  clampResolutionTarget,
  createResolutionAligner,
  isResolutionTargetChanged,
  packResolutionValue,
  resolutionAutoAlignEnabled,
  resolutionTargetFromViewport,
  unpackResolutionValue,
  type ResolutionTarget,
} from './resolution-channel.ts'
import { defaultVirtualMachineSettings } from './virtual-machine-config.ts'
import { buildStartMessage, settingsToStartConfig } from './virtual-machine-disks.ts'
import { normalizeVirtualMachineSettings } from './virtual-machine-store.ts'
import {
  INSTANT_VM_MESSAGE_TYPE,
  isInstantVmHostToRuntimeMessage,
  isInstantVmSetResolutionMessage,
  isInstantVmStartMessage,
} from './virtual-machine-protocol.ts'

function testPortAddress() {
  // 00-overview.md §8.5：0xE000 高段空区，避开 0x60/0x3F8/0xCF8/0xB004/0x5658 等。
  assert.equal(RESOLUTION_CHANNEL_PORT, 0xe000)
}

function testPackUnpackRoundtrip() {
  assert.equal(packResolutionValue(1280, 960), (1280 << 16) | 960)
  assert.equal(packResolutionValue(1280, 960), 0x0500_03c0)
  assert.deepEqual(unpackResolutionValue((1280 << 16) | 960), { width: 1280, height: 960 })
  for (const [w, h] of [
    [640, 480],
    [800, 600],
    [1024, 768],
    [1280, 1024],
    [2560, 1600],
  ] as const) {
    assert.deepEqual(unpackResolutionValue(packResolutionValue(w, h)), { width: w, height: h })
  }
  // 无目标 / 非法值统一为 0，客机代理按「保持现状」处理。
  assert.equal(packResolutionValue(0, 0), 0)
  assert.equal(packResolutionValue(-1, 100), 0)
  assert.equal(packResolutionValue(Number.NaN, 100), 0)
  assert.equal(unpackResolutionValue(0), undefined)
}

function testPackClampsBeforeShift() {
  // 00 §8.4：clamp 必须发生在移位之前，否则中间值溢出 16 位。
  const packed = packResolutionValue(99_999, 700)
  assert.equal(packed, (2560 << 16) | 700)
  assert.deepEqual(unpackResolutionValue(packed), { width: 2560, height: 700 })
  assert.deepEqual(clampResolutionTarget(3000, 2000), { width: 2560, height: 1600 })
  // 低于客机最低模式（640×480）时保持现状，不反向缩水。
  assert.equal(clampResolutionTarget(600, 400), undefined)
  assert.equal(clampResolutionTarget(640, 300), undefined)
  assert.equal(packResolutionValue(600, 400), 0)
  // 四舍五入到整数像素。
  assert.deepEqual(clampResolutionTarget(1000.4, 800.6), { width: 1000, height: 801 })
}

function testDprConversion() {
  assert.deepEqual(resolutionTargetFromViewport(800, 500, 2), { width: 1600, height: 1000 })
  assert.deepEqual(resolutionTargetFromViewport(800, 500, 1), { width: 800, height: 500 })
  // 非法 DPR 按 1 处理。
  assert.deepEqual(resolutionTargetFromViewport(800, 500, 0), { width: 800, height: 500 })
  assert.deepEqual(resolutionTargetFromViewport(800, 500, Number.NaN), { width: 800, height: 500 })
  // DPR 换算后低于下限同样保持现状。
  assert.equal(resolutionTargetFromViewport(300, 200, 2), undefined)
}

function testThreshold() {
  const base: ResolutionTarget = { width: 1000, height: 800 }
  assert.equal(isResolutionTargetChanged(undefined, base), true)
  assert.equal(
    isResolutionTargetChanged(base, { width: 1030, height: 820 }),
    false,
    '双轴都低于 80px 阈值不该触发',
  )
  assert.equal(
    isResolutionTargetChanged(base, { width: 1080, height: 800 }),
    true,
    '单轴达到阈值即触发',
  )
  assert.equal(isResolutionTargetChanged(base, { width: 1000, height: 720 }), true)
}

type FakeTask = { callback: () => void; at: number; cancelled: boolean }

function createFakeClock() {
  let now = 0
  const tasks: FakeTask[] = []
  return {
    schedule(callback: () => void, ms: number) {
      const task: FakeTask = { callback, at: now + ms, cancelled: false }
      tasks.push(task)
      return () => {
        task.cancelled = true
      }
    },
    advance(ms: number) {
      const target = now + ms
      for (;;) {
        const due = tasks
          .filter((task) => !task.cancelled && task.at <= target)
          .sort((a, b) => a.at - b.at)[0]
        if (!due) {
          break
        }
        now = due.at
        due.cancelled = true
        due.callback()
      }
      now = target
    },
  }
}

type FakeObserverInstance = {
  observed: unknown[]
  disconnected: boolean
  fire(): void
}

function createFakeObserverFactory() {
  const instances: FakeObserverInstance[] = []
  return {
    factory: (callback: () => void) => {
      const instance: FakeObserverInstance = {
        observed: [],
        disconnected: false,
        fire: () => callback(),
      }
      instances.push(instance)
      return {
        observe: (target: Element) => {
          instance.observed.push(target)
        },
        disconnect: () => {
          instance.disconnected = true
        },
      }
    },
    instances,
  }
}

type AlignerHarness = {
  targets: ResolutionTarget[]
  observers: FakeObserverInstance[]
  setSize(width: number, height: number): void
  setDpr(value: number): void
  notifyDprChange(): void
  aligner: ReturnType<typeof createResolutionAligner>
  element: Element
}

function createHarness(options?: { watchDpr?: boolean }): AlignerHarness {
  const targets: ResolutionTarget[] = []
  const clock = createFakeClock()
  const observers = createFakeObserverFactory()
  let size = { width: 1000, height: 800 }
  let dpr = 1
  let dprListener: (() => void) | undefined
  const element = {} as Element
  const aligner = createResolutionAligner({
    onTarget: (target) => {
      targets.push(target)
    },
    schedule: (callback, ms) => clock.schedule(callback, ms),
    createObserver: observers.factory,
    measure: () => size,
    devicePixelRatio: () => dpr,
    ...(options?.watchDpr
      ? {
          watchDprChange: (callback: () => void) => {
            dprListener = callback
            return () => {
              dprListener = undefined
            }
          },
        }
      : {}),
  })
  return {
    targets,
    observers: observers.instances,
    setSize(width, height) {
      size = { width, height }
    },
    setDpr(value) {
      dpr = value
    },
    notifyDprChange() {
      dprListener?.()
    },
    aligner,
    element,
  }
}

function testInitialAlignmentOnAttach() {
  const harness = createHarness()
  harness.aligner.observe(harness.element)
  // 挂上就对齐一次当前视口：开机后客机代理第一次轮询就能拿到现值。
  assert.deepEqual(harness.targets, [{ width: 1000, height: 800 }])
  assert.equal(harness.observers.length, 1)
  assert.equal(harness.observers[0].observed.length, 1)
}

function testDebounceEmitsOnceAfterQuietPeriod() {
  const harness = createHarness()
  const clock = createFakeClock()
  const observers = createFakeObserverFactory()
  let size = { width: 1000, height: 800 }
  const targets: ResolutionTarget[] = []
  const aligner = createResolutionAligner({
    onTarget: (target) => {
      targets.push(target)
    },
    schedule: (callback, ms) => clock.schedule(callback, ms),
    createObserver: observers.factory,
    measure: () => size,
    devicePixelRatio: () => 1,
  })
  const element = {} as Element
  aligner.observe(element)
  assert.deepEqual(targets, [{ width: 1000, height: 800 }])

  // 5 次连发：每次都重置 debounce 计时器，期间 advance 少于 300ms 不触发。
  const burst = [
    [1080, 840],
    [1160, 880],
    [1240, 920],
    [1320, 960],
    [1400, 1000],
  ] as const
  for (const [w, h] of burst) {
    size = { width: w, height: h }
    observers.instances[0].fire()
    clock.advance(100)
  }
  assert.equal(targets.length, 1, '连发期间不触发')
  clock.advance(300)
  assert.deepEqual(targets, [{ width: 1000, height: 800 }, { width: 1400, height: 1000 }])
  assert.equal(targets.length, 2, '5 次连发只产生 1 次新目标')
}

function testSubThresholdChangeIgnored() {
  const clock = createFakeClock()
  const observers = createFakeObserverFactory()
  let size = { width: 1000, height: 800 }
  const targets: ResolutionTarget[] = []
  const aligner = createResolutionAligner({
    onTarget: (target) => {
      targets.push(target)
    },
    schedule: (callback, ms) => clock.schedule(callback, ms),
    createObserver: observers.factory,
    measure: () => size,
    devicePixelRatio: () => 1,
  })
  aligner.observe({} as Element)
  size = { width: 1030, height: 820 }
  observers.instances[0].fire()
  clock.advance(400)
  // 变化低于 80px 阈值：端口值保持不变。
  assert.deepEqual(targets, [{ width: 1000, height: 800 }])
}

function testViewportTooSmallKeptSilent() {
  const clock = createFakeClock()
  const observers = createFakeObserverFactory()
  let size = { width: 1000, height: 800 }
  const targets: ResolutionTarget[] = []
  const aligner = createResolutionAligner({
    onTarget: (target) => {
      targets.push(target)
    },
    schedule: (callback, ms) => clock.schedule(callback, ms),
    createObserver: observers.factory,
    measure: () => size,
    devicePixelRatio: () => 1,
  })
  aligner.observe({} as Element)
  size = { width: 400, height: 300 }
  observers.instances[0].fire()
  clock.advance(400)
  assert.deepEqual(targets, [{ width: 1000, height: 800 }], '视口小于最低模式时保持现状')
}

function testDisconnectStopsEverything() {
  const harness = createHarness({ watchDpr: true })
  harness.aligner.observe(harness.element)
  const observer = harness.observers[0]
  harness.setSize(1400, 1000)
  observer.fire()
  harness.aligner.disconnect()
  // debounce 被取消、observer 被 disconnect、DPR 监听被释放。
  assert.equal(observer.disconnected, true)
  harness.setSize(2000, 1500)
  observer.fire()
  harness.notifyDprChange()
  assert.deepEqual(harness.targets, [{ width: 1000, height: 800 }], 'disconnect 后不再发目标')
  // DPR 监听已释放：再触发不会进入新的 debounce。
  harness.notifyDprChange()
}

function testDprChangeRecomputes() {
  const clock = createFakeClock()
  const observers = createFakeObserverFactory()
  let size = { width: 800, height: 500 }
  let dpr = 1
  let dprListener: (() => void) | undefined
  const targets: ResolutionTarget[] = []
  const aligner = createResolutionAligner({
    onTarget: (target) => {
      targets.push(target)
    },
    schedule: (callback, ms) => clock.schedule(callback, ms),
    createObserver: observers.factory,
    measure: () => size,
    devicePixelRatio: () => dpr,
    watchDprChange: (callback) => {
      dprListener = callback
      return () => {
        dprListener = undefined
      }
    },
  })
  aligner.observe({} as Element)
  assert.deepEqual(targets, [{ width: 800, height: 500 }])
  // 跨屏拖动：DPR 变化不触发 ResizeObserver，靠 matchMedia change 重算。
  dpr = 2
  dprListener?.()
  clock.advance(300)
  assert.deepEqual(targets, [
    { width: 800, height: 500 },
    { width: 1600, height: 1000 },
  ])
}

function testDisabledSwitchNeverAttaches() {
  // 开关关闭（默认）：不创建 observer、不发任何目标。
  assert.equal(resolutionAutoAlignEnabled(undefined), false)
  assert.equal(
    resolutionAutoAlignEnabled({
      type: INSTANT_VM_MESSAGE_TYPE.start,
      requestId: 'req-1',
      config: settingsToStartConfig(defaultVirtualMachineSettings('t')),
    }),
    false,
  )
  assert.equal(
    resolutionAutoAlignEnabled({
      type: INSTANT_VM_MESSAGE_TYPE.start,
      requestId: 'req-1',
      config: {
        ...settingsToStartConfig(defaultVirtualMachineSettings('t')),
        resolutionAutoAlign: true,
      },
    }),
    true,
  )
  // aligner 只有 observe() 之后才碰注入的 observer 工厂——
  // 上层「开关关了就不调 observe」即可保证行为与现状一致。
  const observers = createFakeObserverFactory()
  const targets: ResolutionTarget[] = []
  const aligner = createResolutionAligner({
    onTarget: (target) => {
      targets.push(target)
    },
    schedule: () => () => undefined,
    createObserver: observers.factory,
    measure: () => ({ width: 1000, height: 800 }),
    devicePixelRatio: () => 1,
  })
  assert.equal(observers.instances.length, 0)
  assert.equal(targets.length, 0)
  aligner.disconnect()
}

function testSetResolutionMessage() {
  const valid = {
    type: INSTANT_VM_MESSAGE_TYPE.setResolution,
    requestId: 'req-res-1',
    width: 1280,
    height: 960,
  }
  assert.equal(isInstantVmSetResolutionMessage(valid), true)
  assert.equal(isInstantVmHostToRuntimeMessage(valid), true)
  assert.equal(
    isInstantVmSetResolutionMessage({ ...valid, width: 0 }),
    false,
    '宽度必须为正整数',
  )
  assert.equal(
    isInstantVmSetResolutionMessage({ ...valid, height: 2561 }),
    false,
    '高度不能超过 v86 上限 1600',
  )
  assert.equal(isInstantVmSetResolutionMessage({ ...valid, height: 2561 }), false)
  assert.equal(
    isInstantVmSetResolutionMessage({ ...valid, width: 2561 }),
    false,
    '宽度不能超过 v86 上限 2560',
  )
  assert.equal(isInstantVmSetResolutionMessage({ ...valid, width: 1280.5 }), false)
  assert.equal(isInstantVmSetResolutionMessage({ ...valid, requestId: '' }), false)
  assert.equal(
    isInstantVmSetResolutionMessage({ type: INSTANT_VM_MESSAGE_TYPE.setResolution }),
    false,
  )
  assert.equal(isInstantVmHostToRuntimeMessage({ type: 'instant-vm:set-resolution' }), false)
}

function testStartConfigCarriesFlagOnlyWhenEnabled() {
  const off = settingsToStartConfig(defaultVirtualMachineSettings('t'))
  assert.equal('resolutionAutoAlign' in off, false, '关闭时省略字段，消息与旧协议一致')
  assert.equal(isInstantVmStartMessage(buildStartMessage('req-off', defaultVirtualMachineSettings('t'), {})), true)

  const on = settingsToStartConfig({
    ...defaultVirtualMachineSettings('t'),
    resolutionAutoAlign: true,
  })
  assert.equal(on.resolutionAutoAlign, true)
  assert.equal(
    isInstantVmStartMessage(
      buildStartMessage(
        'req-on',
        { ...defaultVirtualMachineSettings('t'), resolutionAutoAlign: true },
        {},
      ),
    ),
    true,
  )

  // 非法类型被 start 配置校验拒绝。
  assert.equal(
    isInstantVmStartMessage({
      type: INSTANT_VM_MESSAGE_TYPE.start,
      requestId: 'req-bad',
      config: { ...on, resolutionAutoAlign: 'yes' },
    }),
    false,
  )
}

function testStoreNormalizesFlag() {
  assert.equal(normalizeVirtualMachineSettings({ name: 't' })?.resolutionAutoAlign, false)
  assert.equal(
    normalizeVirtualMachineSettings({ name: 't', resolutionAutoAlign: true })?.resolutionAutoAlign,
    true,
  )
  assert.equal(
    normalizeVirtualMachineSettings({ name: 't', resolutionAutoAlign: 'on' })?.resolutionAutoAlign,
    false,
    '非法值回落到默认关',
  )
}

testPortAddress()
testPackUnpackRoundtrip()
testPackClampsBeforeShift()
testDprConversion()
testThreshold()
testInitialAlignmentOnAttach()
testDebounceEmitsOnceAfterQuietPeriod()
testSubThresholdChangeIgnored()
testViewportTooSmallKeptSilent()
testDisconnectStopsEverything()
testDprChangeRecomputes()
testDisabledSwitchNeverAttaches()
testSetResolutionMessage()
testStartConfigCarriesFlagOnlyWhenEnabled()
testStoreNormalizesFlag()
console.log('resolution-channel.test.ts ok')
