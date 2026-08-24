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
  createDiskWriteFailedWatchdog,
  DISK_WRITE_FAILED_FORCE_STOP_MS,
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

testRequestIdFormat()
testPickDisplayedMachineId()
testPickBackgroundMachineIds()
testUnsolicitedStopped()
testDiskWriteFailedWatchdogForceStopsWhenStillRunning()
testDiskWriteFailedWatchdogCancelsWhenStopped()
console.log('virtual-machine-runtime.test.ts ok')
