/**
 * 虚拟机多实例运行时纯函数单测。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-runtime.test.ts
 */
import assert from 'node:assert/strict'
import {
  newVmRequestId,
  pickBackgroundMachineIds,
  pickDisplayedMachineId,
  isUnsolicitedVmStopped,
  shouldSurfaceUnsolicitedVmError,
  createDiskWriteFailedWatchdog,
  DISK_WRITE_FAILED_FORCE_STOP_MS,
  DISK_WRITE_FAILED_FORCE_STOP_HINT,
  DISK_IMAGE_INCOMPLETE_HINT,
  READING_DISK_IMAGE_HINT,
  STARTING_EMULATOR_HINT,
  isTransientBootHint,
  withAckDeadline,
  STOP_ACK_DEADLINE_MS,
} from './virtual-machine-runtime.ts'
import { INSTANT_VM_MESSAGE_TYPE } from './virtual-machine-protocol.ts'

function testRequestIdFormat(): void {
  const id = newVmRequestId()
  assert.match(id, /^vm-[0-9a-z]+-[0-9a-f]+$/)
  assert.notEqual(id, newVmRequestId())
}

function testPickDisplayedMachineId(): void {
  assert.equal(pickDisplayedMachineId(undefined, []), undefined)
  assert.equal(pickDisplayedMachineId('a', []), undefined)

  assert.equal(pickDisplayedMachineId('b', ['a', 'b', 'c']), 'b')
  assert.equal(pickDisplayedMachineId('a', ['a']), 'a')
  // 选中未运行的机器时，绝不能把另一台正在跑的画面顶到右侧
  assert.equal(pickDisplayedMachineId('b', ['a']), undefined)
  assert.equal(pickDisplayedMachineId('missing', ['a', 'b']), undefined)
  assert.equal(pickDisplayedMachineId(undefined, ['a', 'b']), undefined)
}

function testPickBackgroundMachineIds(): void {
  assert.deepEqual(pickBackgroundMachineIds(undefined, []), [])
  assert.deepEqual(pickBackgroundMachineIds('b', ['a', 'b', 'c']), ['a', 'c'])
  assert.deepEqual(pickBackgroundMachineIds('a', ['a']), [])
  assert.deepEqual(pickBackgroundMachineIds(undefined, ['a', 'b']), ['a', 'b'])
}

function testUnsolicitedStopped(): void {
  assert.equal(isUnsolicitedVmStopped({ type: INSTANT_VM_MESSAGE_TYPE.stopped }), true)
  assert.equal(
    isUnsolicitedVmStopped({ type: INSTANT_VM_MESSAGE_TYPE.stopped, requestId: 'r1' }),
    false,
  )
  assert.equal(isUnsolicitedVmStopped({ type: INSTANT_VM_MESSAGE_TYPE.started }), false)
}

function testShouldSurfaceUnsolicitedVmError(): void {
  assert.equal(
    shouldSurfaceUnsolicitedVmError({ type: INSTANT_VM_MESSAGE_TYPE.error }, 0),
    true,
  )
  assert.equal(
    shouldSurfaceUnsolicitedVmError({ type: INSTANT_VM_MESSAGE_TYPE.error }, 1),
    false,
    '开机请求还在飞时由该请求的失败路径提示，避免同一崩溃弹两次',
  )
  assert.equal(
    shouldSurfaceUnsolicitedVmError(
      { type: INSTANT_VM_MESSAGE_TYPE.error, requestId: 'r1' },
      0,
    ),
    false,
  )
  assert.equal(
    shouldSurfaceUnsolicitedVmError({ type: INSTANT_VM_MESSAGE_TYPE.stopped }, 0),
    false,
  )
}

function testDiskWriteFailedWatchdogForceStopsWhenStillRunning(): void {
  const running = new Set(['vm-1'])
  const forced: string[] = []
  const scheduled: Array<{ callback: () => void; ms: number }> = []
  const watchdog = createDiskWriteFailedWatchdog({
    isRunning: (id) => running.has(id),
    onForceStop: (id) => {
      running.delete(id)
      forced.push(id)
    },
    schedule: (callback, ms) => {
      scheduled.push({ callback, ms })
      return () => {
        const index = scheduled.findIndex((item) => item.callback === callback)
        if (index >= 0) {
          scheduled.splice(index, 1)
        }
      }
    },
  })
  watchdog.arm('vm-1')
  watchdog.arm('vm-1')
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0]?.ms, DISK_WRITE_FAILED_FORCE_STOP_MS)
  scheduled[0]?.callback()
  assert.deepEqual(forced, ['vm-1'])
  assert.equal(running.has('vm-1'), false)
}

function testDiskWriteFailedWatchdogCancelsWhenStopped(): void {
  const running = new Set(['vm-1'])
  const forced: string[] = []
  const scheduled: Array<{ callback: () => void; ms: number }> = []
  const watchdog = createDiskWriteFailedWatchdog({
    isRunning: (id) => running.has(id),
    onForceStop: (id) => {
      forced.push(id)
    },
    schedule: (callback, ms) => {
      scheduled.push({ callback, ms })
      return () => {
        const index = scheduled.findIndex((item) => item.callback === callback)
        if (index >= 0) {
          scheduled.splice(index, 1)
        }
      }
    },
  })
  watchdog.arm('vm-1')
  watchdog.cancel('vm-1')
  assert.equal(scheduled.length, 0)
  assert.deepEqual(forced, [])
}

function testTransientBootHint(): void {
  assert.equal(isTransientBootHint(READING_DISK_IMAGE_HINT), true)
  assert.equal(isTransientBootHint(STARTING_EMULATOR_HINT), true)
  // 警告类 hint 开机后仍有用，模拟器已启动也不能清
  assert.equal(isTransientBootHint(undefined), false)
  assert.equal(isTransientBootHint('已挂网卡但未选网络后端，按离线启动'), false)
  assert.equal(isTransientBootHint(DISK_WRITE_FAILED_FORCE_STOP_HINT), false)
  assert.equal(isTransientBootHint(DISK_IMAGE_INCOMPLETE_HINT), false)
  assert.equal(isTransientBootHint('启动失败：运行时无响应'), false)
}

function makeRecordingSchedule() {
  const scheduled: Array<{ callback: () => void; ms: number }> = []
  const schedule = (callback: () => void, ms: number) => {
    scheduled.push({ callback, ms })
    return () => {
      const index = scheduled.findIndex((item) => item.callback === callback)
      if (index >= 0) {
        scheduled.splice(index, 1)
      }
    }
  }
  return { scheduled, schedule }
}

async function testWithAckDeadlineAcksFirst(): Promise<void> {
  const { scheduled, schedule } = makeRecordingSchedule()
  const promise = withAckDeadline({ command: async () => {}, schedule })
  assert.equal(scheduled[0]?.ms, STOP_ACK_DEADLINE_MS)
  assert.equal(await promise, 'acked')
  // 正常 ack 后 deadline 定时器必须被取消，不能留悬挂计时器
  assert.equal(scheduled.length, 0)
}

async function testWithAckDeadlineDeadlineWins(): Promise<void> {
  const { scheduled, schedule } = makeRecordingSchedule()
  const promise = withAckDeadline({
    // 永不回执：模拟客机卡死后 iframe 事件循环收不了消息
    command: () => new Promise<void>(() => {}),
    schedule,
  })
  scheduled[0]?.callback()
  assert.equal(await promise, 'deadline')
  assert.equal(scheduled.length, 0)
}

async function testWithAckDeadlineCommandFailed(): Promise<void> {
  const { scheduled, schedule } = makeRecordingSchedule()
  const promise = withAckDeadline({
    // post 直接失败（如 iframe 已卸载）：不外抛，交由调用方决定强拆收场
    command: async () => {
      throw new Error('post 失败：iframe 已卸载')
    },
    schedule,
  })
  assert.equal(await promise, 'command-failed')
  assert.equal(scheduled.length, 0)
}

testRequestIdFormat()
testPickDisplayedMachineId()
testPickBackgroundMachineIds()
testUnsolicitedStopped()
testShouldSurfaceUnsolicitedVmError()
testDiskWriteFailedWatchdogForceStopsWhenStillRunning()
testDiskWriteFailedWatchdogCancelsWhenStopped()
testTransientBootHint()
await testWithAckDeadlineAcksFirst()
await testWithAckDeadlineDeadlineWins()
await testWithAckDeadlineCommandFailed()
console.log('virtual-machine-runtime.test.ts ok')
