/**
 * 虚拟机多实例运行时纯函数单测。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-runtime.test.ts
 */
import assert from 'node:assert/strict'
import {
  newVmRequestId,
  pickBackgroundMachineIds,
  pickDisplayedMachineId,
} from './virtual-machine-runtime.ts'

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

testRequestIdFormat()
testPickDisplayedMachineId()
testPickBackgroundMachineIds()
console.log('virtual-machine-runtime.test.ts ok')