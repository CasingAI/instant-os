/**
 * 系统诊断日志核心纯逻辑单测。
 * 运行：node --experimental-strip-types src/os/system-debug-log-core.test.ts
 */
import assert from 'node:assert/strict'
import {
  HOT_RING_CAPACITY,
  MainThreadHeartbeatMonitor,
  shortenDebugPath,
  stringifySystemDebugDetail,
  SystemDebugLogRecorder,
  TIMELINE_RING_CAPACITY,
  type HeartbeatHost,
  type SystemDebugLogLayer,
} from './system-debug-log-core.ts'

let failures = 0
function test(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`✓ ${name}`)
  } catch (error) {
    failures += 1
    console.error(`✗ ${name}`)
    console.error(error)
  }
}

// ---------------------------------------------------------------- 序列化

test('字符串原样，超长截断且总长不超上限', () => {
  assert.equal(stringifySystemDebugDetail('hello'), 'hello')
  const long = 'x'.repeat(5000)
  const truncated = stringifySystemDebugDetail(long)
  assert.ok(truncated !== undefined && truncated.length <= 600)
  assert.ok(truncated!.includes('5000'))
})

test('浅对象变成稳定短字符串', () => {
  const text = stringifySystemDebugDetail({ path: '/user/a/b/c/d.js', seg: 9, ok: true })
  assert.ok(text !== undefined)
  assert.ok(text!.includes('seg: 9'))
  assert.ok(text!.includes('ok: true'))
})

test('循环引用不抛，输出占位', () => {
  const obj: Record<string, unknown> = { name: 'loop' }
  obj.self = obj
  const text = stringifySystemDebugDetail(obj)
  assert.ok(text !== undefined)
  assert.ok(text!.includes('[Circular]'))
})

test('超深对象、超多键不抛且被截断', () => {
  const deep: Record<string, unknown> = {}
  let cursor = deep
  for (let i = 0; i < 20; i++) {
    cursor.next = {}
    cursor = cursor.next as Record<string, unknown>
  }
  const deepText = stringifySystemDebugDetail(deep)
  assert.ok(deepText !== undefined && deepText!.includes('{…}'))
  const wide: Record<string, unknown> = {}
  for (let i = 0; i < 50; i++) {
    wide[`key${i}`] = i
  }
  const wideText = stringifySystemDebugDetail(wide)
  assert.ok(wideText !== undefined)
  assert.ok(wideText!.includes('+38 keys'))
})

test('Error 对象输出 name + message', () => {
  const text = stringifySystemDebugDetail({ err: new Error('boom') })
  assert.ok(text !== undefined && text!.includes('Error: boom'))
})

test('路径缩短只留末 3 段', () => {
  assert.equal(shortenDebugPath('/a/b/c/d/e.js'), '…/c/d/e.js')
  assert.equal(shortenDebugPath('/a/b.js'), '/a/b.js')
  assert.equal(shortenDebugPath(''), undefined)
  assert.equal(shortenDebugPath(undefined), undefined)
})

// ---------------------------------------------------------------- 双环

function recordHotStorm(
  recorder: SystemDebugLogRecorder,
  layer: SystemDebugLogLayer,
  op: string,
  count: number,
): void {
  // 每条隔 5ms：不超过每层每秒限速（240/s），验证环覆盖语义本身
  for (let i = 0; i < count; i++) {
    const at = 1000 + i * 5
    recorder.recordHot({ layer, op, detail: `entry-${i}`, at }, at)
  }
}

test('热路径写满只覆盖热路径，时间线的 eval-start 还在', () => {
  const recorder = new SystemDebugLogRecorder()
  recorder.recordTimeline({ layer: 'qjs', op: 'eval-start', detail: 'i1 boot.js' }, 1000)
  recordHotStorm(recorder, 'vfs-resolve', 'resolveNode', HOT_RING_CAPACITY + 500)
  const timeline = recorder.getTimeline()
  assert.equal(timeline.length, 1)
  assert.equal(timeline[0]!.op, 'eval-start')
  assert.equal(recorder.getHot().length, HOT_RING_CAPACITY)
  // 覆盖后剩下的是最后 HOT_RING_CAPACITY 条
  const hot = recorder.getHot()
  assert.equal(hot[0]!.detail, `entry-500`)
})

test('短窗口相同记录合并成 ×N', () => {
  const recorder = new SystemDebugLogRecorder()
  for (let i = 0; i < 50; i++) {
    recorder.recordHot(
      { layer: 'vfs-resolve', op: 'resolveNode', detail: '/node_modules/typescript', at: 1000 + i },
      1000 + i,
    )
  }
  const hot = recorder.getHot()
  assert.equal(hot.length, 1)
  assert.equal(hot[0]!.repeat, 50)
  // 计数仍然是 50
  assert.equal(recorder.getCounters()['vfs-resolve:resolveNode']!.count, 50)
})

test('计数器在限速丢弃时仍增加', () => {
  const recorder = new SystemDebugLogRecorder()
  // 同一毫秒内塞爆每秒限速（240/s）：环丢弃但计数全收
  for (let i = 0; i < 2000; i++) {
    recorder.recordHot({ layer: 'qjs-fs', op: 'readFile', detail: `f${i}`, at: 5000 }, 5000)
  }
  const counter = recorder.getCounters()['qjs-fs:readFile']!
  assert.equal(counter.count, 2000)
  assert.ok(counter.dropped > 0)
  assert.ok(recorder.getHot().length < 2000)
})

test('addCountDelta 只加计数不进环', () => {
  const recorder = new SystemDebugLogRecorder()
  recorder.addCountDelta('vfs-resolve', 'resolveNode', 63, 3.2, 1000)
  const counters = recorder.getCounters()
  assert.equal(counters['vfs-resolve:resolveNode']!.count, 63)
  assert.equal(counters['vfs-resolve:resolveNode']!.slowestMs, 3.2)
  assert.equal(recorder.getHot().length, 0)
  assert.equal(recorder.getTimeline().length, 0)
})

test('slowestMs 记录最慢一次', () => {
  const recorder = new SystemDebugLogRecorder()
  recorder.recordHot({ layer: 'qjs-fs', op: 'stat', at: 1000 }, 1000)
  recorder.recordHot({ layer: 'qjs-fs', op: 'stat', durationMs: 42, at: 1001 }, 1001)
  recorder.addCountDelta('qjs-fs', 'stat', 10, 99, 1002)
  assert.equal(recorder.getCounters()['qjs-fs:stat']!.slowestMs, 99)
})

test('时间线容量限制', () => {
  const recorder = new SystemDebugLogRecorder()
  // 每条隔 50ms：不超过时间线每层限速（60/s）
  for (let i = 0; i < TIMELINE_RING_CAPACITY + 10; i++) {
    const at = 1000 + i * 50
    recorder.recordTimeline({ layer: 'system', op: `op${i}`, at }, at)
  }
  assert.equal(recorder.getTimeline().length, TIMELINE_RING_CAPACITY)
  // 最旧的被覆盖
  assert.equal(recorder.getTimeline()[0]!.op, `op10`)
})

test('clear 清空两环与计数器', () => {
  const recorder = new SystemDebugLogRecorder()
  recorder.recordTimeline({ layer: 'system', op: 'x' }, 1)
  recorder.recordHot({ layer: 'qjs-fs', op: 'y' }, 1)
  recorder.clear()
  assert.equal(recorder.getTimeline().length, 0)
  assert.equal(recorder.getHot().length, 0)
  assert.equal(Object.keys(recorder.getCounters()).length, 0)
})

// ---------------------------------------------------------------- 心跳

class FakeClockHost implements HeartbeatHost {
  nowMs = 0
  pings: number[] = []
  unresponsive: { sinceLastPongMs: number; missedPings: number }[] = []
  recover: { unresponsiveMs: number; missedPings: number }[] = []

  now(): number {
    return this.nowMs
  }

  sendPing(seq: number): void {
    this.pings.push(seq)
  }

  onUnresponsive(info: { sinceLastPongMs: number; missedPings: number }): void {
    this.unresponsive.push(info)
  }

  onRecover(info: { unresponsiveMs: number; missedPings: number }): void {
    this.recover.push(info)
  }
}

test('正常 pong 不触发未响应', () => {
  const host = new FakeClockHost()
  const monitor = new MainThreadHeartbeatMonitor(host)
  for (let i = 0; i < 10; i++) {
    const delay = monitor.tick()
    host.nowMs += delay
    monitor.notifyPong()
  }
  assert.equal(host.unresponsive.length, 0)
  assert.equal(host.recover.length, 0)
  assert.equal(host.pings.length, 10)
})

test('主线程卡死：连续 ping 无 pong → 判未响应；恢复 → 回调带时长与丢拍数', () => {
  const host = new FakeClockHost()
  const monitor = new MainThreadHeartbeatMonitor(host)
  monitor.tick()
  host.nowMs += 2000
  monitor.notifyPong() // 最后一次成功 pong 在 t=2000

  monitor.tick() // t=2000 发 ping2，无 pong
  host.nowMs += 2000 // t=4000
  monitor.tick() // 4000-2000=2000 < 5000，未触发
  host.nowMs += 2000 // t=6000
  monitor.tick() // 6000-2000=4000 < 5000，未触发
  host.nowMs += 2000 // t=8000
  monitor.tick() // 8000-2000=6000 ≥ 5000 → 未响应
  assert.equal(host.unresponsive.length, 1)
  assert.equal(host.unresponsive[0]!.missedPings, 1)

  // 未响应期间降频 ping
  host.nowMs += 4000 // t=12000
  monitor.tick()
  assert.equal(host.unresponsive.length, 1)

  // 主线程恢复
  host.nowMs += 1000 // t=13000
  monitor.notifyPong()
  assert.equal(host.recover.length, 1)
  assert.equal(host.recover[0]!.unresponsiveMs, 11000)
  assert.ok(monitor.isUnresponsive() === false)
})

test('启动初期无 pong：宽限期后仍能判未响应', () => {
  const host = new FakeClockHost()
  const monitor = new MainThreadHeartbeatMonitor(host)
  monitor.tick()
  host.nowMs += 2000
  monitor.tick()
  host.nowMs += 2000
  monitor.tick()
  host.nowMs += 2000
  monitor.tick() // t=6000，6000-0 ≥ 5000 → 未响应
  assert.equal(host.unresponsive.length, 1)
})

if (failures > 0) {
  console.error(`\n${failures} 个用例失败`)
  process.exit(1)
}
console.log('\n全部通过')
