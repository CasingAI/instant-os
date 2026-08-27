/**
 * 分辨率自动对齐 —— 宿主侧通道单测（第一期机制 + 语义层）。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/resolution-channel.test.ts
 *
 * 覆盖：32 位打包、clamp 先于移位、视口 CSS 像素最大化可见面积选档（不乘 DPR）、
 * native 下取、阈值、防抖合并（5 连发仅 1 次变更）、disconnect 停发、
 * 开关关闭时不挂 observer、协议消息与 start 配置映射。
 * ResizeObserver / 定时器 全部注入假实现，Node 里即可完整验证。
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

function testViewportMaximizesVisibleArea() {
  // 拉伸/等比按「可见画面最大化」选档：等比缩放后真正画进视口的面积最大，
  // 等价于黑边最少；宽高比一致的档位里再取面积最接近视口的（密度最匹配）。
  // 800×500(16:10)：16:10 族完美铺满，族内最小面积档胜出。
  assert.deepEqual(resolutionTargetFromViewport(800, 500), { width: 1280, height: 800 })
  // 1204×672：近 16:9 面板选 1280×720（可见面积远大于旧「面积最近」的 1024×768）。
  assert.deepEqual(resolutionTargetFromViewport(1204, 672), { width: 1280, height: 720 })
  // 恰为标准档位时原样通过。
  assert.deepEqual(resolutionTargetFromViewport(1280, 800), { width: 1280, height: 800 })
  // 真实用户面板（超宽短）：1096×441 下 1280×720 比 4:3 档少约 18 个百分点的黑边。
  assert.deepEqual(resolutionTargetFromViewport(1096, 441), { width: 1280, height: 720 })
  // 近方形视口没有对应比例，5:4 族已是可见面积最大的选择。
  assert.deepEqual(resolutionTargetFromViewport(640, 600), { width: 1280, height: 1024 })
  // 超大视口被天花板档接住。
  assert.deepEqual(resolutionTargetFromViewport(3000, 2000), { width: 2560, height: 1600 })
  // 非法输入仍无目标。
  assert.equal(resolutionTargetFromViewport(0, 500), undefined)
  assert.equal(resolutionTargetFromViewport(Number.NaN, 500), undefined)
}

function testNativeModeTakesLargestFittingMode() {
  // 「原始」模式画布 1 客机px = 1 CSS px 原样显示，超尺寸必被裁切滚动——
  // 所以只从两维都放得下的档位里取面积最大的。
  // 1096×618 装得下 800×600（600≤618），装不下 1024×768。
  assert.deepEqual(resolutionTargetFromViewport(1096, 618, 'native'), { width: 800, height: 600 })
  // 高度不够时宁小勿裁：1204×672 也只放得下 800×600（768 超 96px）。
  assert.deepEqual(resolutionTargetFromViewport(1204, 672, 'native'), { width: 800, height: 600 })
  // 视口够高才轮到更大的档：1150×800 恰好容纳 1024×768（1152×864 宽度超出）。
  assert.deepEqual(resolutionTargetFromViewport(1150, 800, 'native'), { width: 1024, height: 768 })
  // 只有 640×480 放得下。
  assert.deepEqual(resolutionTargetFromViewport(842, 545, 'native'), { width: 640, height: 480 })
  // 连地板档都放不下的小视口：裁切已不可避免，落地板保持「有目标可发」。
  assert.deepEqual(resolutionTargetFromViewport(443, 280, 'native'), { width: 640, height: 480 })
  // 对照：等比/拉伸会缩放画布适配视口，走「可见面积最大化」，不要求放得下。
  assert.deepEqual(resolutionTargetFromViewport(1204, 672, 'contain'), { width: 1280, height: 720 })
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
  aligner: ReturnType<typeof createResolutionAligner>
  element: Element
}

function createHarness(): AlignerHarness {
  const targets: ResolutionTarget[] = []
  const clock = createFakeClock()
  const observers = createFakeObserverFactory()
  // 初值恰为标准档位：映射是恒等的，断言只关注对齐器机制本身。
  let size = { width: 1024, height: 768 }
  const element = {} as Element
  const aligner = createResolutionAligner({
    onTarget: (target) => {
      targets.push(target)
    },
    schedule: (callback, ms) => clock.schedule(callback, ms),
    createObserver: observers.factory,
    measure: () => size,
  })
  return {
    targets,
    observers: observers.instances,
    setSize(width, height) {
      size = { width, height }
    },
    aligner,
    element,
  }
}

function testInitialAlignmentOnAttach() {
  const harness = createHarness()
  harness.aligner.observe(harness.element)
  // 挂上就对齐一次当前视口：开机后客机代理第一次轮询就能拿到现值。
  assert.deepEqual(harness.targets, [{ width: 1024, height: 768 }])
  assert.equal(harness.observers.length, 1)
  assert.equal(harness.observers[0].observed.length, 1)
}

function testDebounceEmitsOnceAfterQuietPeriod() {
  const harness = createHarness()
  const clock = createFakeClock()
  const observers = createFakeObserverFactory()
  let size = { width: 1024, height: 768 }
  const targets: ResolutionTarget[] = []
  const aligner = createResolutionAligner({
    onTarget: (target) => {
      targets.push(target)
    },
    schedule: (callback, ms) => clock.schedule(callback, ms),
    createObserver: observers.factory,
    measure: () => size,
  })
  const element = {} as Element
  aligner.observe(element)
  assert.deepEqual(targets, [{ width: 1024, height: 768 }])

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
  // 终值 1400×1000：可见面积最大的是 4:3 族里密度最匹配的 1280×960。
  assert.deepEqual(targets, [{ width: 1024, height: 768 }, { width: 1280, height: 960 }])
  assert.equal(targets.length, 2, '5 次连发只产生 1 次新目标')
}

function testSubThresholdChangeIgnored() {
  const clock = createFakeClock()
  const observers = createFakeObserverFactory()
  let size = { width: 1024, height: 768 }
  const targets: ResolutionTarget[] = []
  const aligner = createResolutionAligner({
    onTarget: (target) => {
      targets.push(target)
    },
    schedule: (callback, ms) => clock.schedule(callback, ms),
    createObserver: observers.factory,
    measure: () => size,
  })
  aligner.observe({} as Element)
  size = { width: 1030, height: 782 }
  observers.instances[0].fire()
  clock.advance(400)
  // 1030×782 与 1024×768 落在同一档：不重切，不发消息。
  assert.deepEqual(targets, [{ width: 1024, height: 768 }])
}

function testSmallViewportSnapsToFloorMode() {
  const clock = createFakeClock()
  const observers = createFakeObserverFactory()
  let size = { width: 1024, height: 768 }
  const targets: ResolutionTarget[] = []
  const aligner = createResolutionAligner({
    onTarget: (target) => {
      targets.push(target)
    },
    schedule: (callback, ms) => clock.schedule(callback, ms),
    createObserver: observers.factory,
    measure: () => size,
  })
  aligner.observe({} as Element)
  size = { width: 400, height: 300 }
  observers.instances[0].fire()
  clock.advance(400)
  // 小视口不再沉默（旧 clamp 路径会丢掉目标、客机停在旧的大档位被裁切放大）。
  assert.deepEqual(targets, [{ width: 1024, height: 768 }, { width: 640, height: 480 }])
}

function testDisconnectStopsEverything() {
  const harness = createHarness()
  harness.aligner.observe(harness.element)
  const observer = harness.observers[0]
  harness.setSize(1400, 1000)
  observer.fire()
  harness.aligner.disconnect()
  // debounce 被取消、observer 被 disconnect。
  assert.equal(observer.disconnected, true)
  harness.setSize(2000, 1500)
  observer.fire()
  assert.deepEqual(harness.targets, [{ width: 1024, height: 768 }], 'disconnect 后不再发目标')
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
testViewportMaximizesVisibleArea()
testNativeModeTakesLargestFittingMode()
testThreshold()
testInitialAlignmentOnAttach()
testDebounceEmitsOnceAfterQuietPeriod()
testSubThresholdChangeIgnored()
testSmallViewportSnapsToFloorMode()
testDisconnectStopsEverything()
testDisabledSwitchNeverAttaches()
testSetResolutionMessage()
testStartConfigCarriesFlagOnlyWhenEnabled()
testStoreNormalizesFlag()
console.log('resolution-channel.test.ts ok')
