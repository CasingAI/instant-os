/**
 * 快照保存路径规则单测。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-save-snapshot.test.ts
 */
import assert from 'node:assert/strict'
import { isSnapshotPathWritable, sanitizeSnapshotFileName } from './virtual-machine-save-snapshot.ts'

function testIsSnapshotPathWritable(): void {
  assert.equal(isSnapshotPathWritable(''), false)
  assert.equal(isSnapshotPathWritable('   '), false)
  assert.equal(isSnapshotPathWritable('https://example.com/state.bin'), false)
  assert.equal(isSnapshotPathWritable('http://example.com/state.bin'), false)
  assert.equal(isSnapshotPathWritable('/user/Disks/vm.bin'), true)
}

function testSanitizeSnapshotFileName(): void {
  assert.equal(sanitizeSnapshotFileName(''), 'snapshot.bin')
  assert.equal(sanitizeSnapshotFileName('   '), 'snapshot.bin')
  assert.equal(sanitizeSnapshotFileName('XP Machine'), 'XP Machine.bin')
  assert.equal(sanitizeSnapshotFileName('a/b:c*d.bin'), 'a-b-c-d.bin')
  assert.equal(sanitizeSnapshotFileName('快照.bin'), '快照.bin')
}

testIsSnapshotPathWritable()
testSanitizeSnapshotFileName()
console.log('virtual-machine-save-snapshot.test.ts ok')
