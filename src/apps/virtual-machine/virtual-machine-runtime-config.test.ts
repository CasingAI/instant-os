/**
 * 虚拟机运行时 origin 单测。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-runtime-config.test.ts
 */
import assert from 'node:assert/strict'
import { defaultDevRuntimeOrigin } from './virtual-machine-runtime-config.ts'

function testOppositeLoopback(): void {
  assert.equal(defaultDevRuntimeOrigin('http://localhost:6173'), 'http://127.0.0.1:6175')
  assert.equal(defaultDevRuntimeOrigin('http://127.0.0.1:6173'), 'http://localhost:6175')
}

function testFallback(): void {
  assert.equal(defaultDevRuntimeOrigin(), 'http://localhost:6175')
  assert.equal(defaultDevRuntimeOrigin('https://os.example'), 'http://localhost:6175')
  assert.equal(defaultDevRuntimeOrigin('not a url'), 'http://localhost:6175')
}

testOppositeLoopback()
testFallback()
console.log('virtual-machine-runtime-config.test.ts ok')
