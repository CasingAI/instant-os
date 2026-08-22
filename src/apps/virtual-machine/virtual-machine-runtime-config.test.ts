/**
 * 虚拟机运行时 origin 单测。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-runtime-config.test.ts
 */
import assert from 'node:assert/strict'
import { buildVmRuntimeOriginWithMode, defaultDevRuntimeOrigin } from './virtual-machine-runtime-config.ts'

function testOppositeLoopback(): void {
  assert.equal(defaultDevRuntimeOrigin('http://localhost:6173'), 'http://127.0.0.1:6175')
  assert.equal(defaultDevRuntimeOrigin('http://127.0.0.1:6173'), 'http://localhost:6175')
}

function testFallback(): void {
  assert.equal(defaultDevRuntimeOrigin(), 'http://localhost:6175')
  assert.equal(defaultDevRuntimeOrigin('https://os.example'), 'http://localhost:6175')
  assert.equal(defaultDevRuntimeOrigin('not a url'), 'http://localhost:6175')
}

function testBuildVmRuntimeOriginWithMode(): void {
  assert.equal(buildVmRuntimeOriginWithMode(undefined, 'debug'), undefined)
  assert.equal(buildVmRuntimeOriginWithMode(undefined, 'release'), undefined)

  assert.equal(
    buildVmRuntimeOriginWithMode('http://localhost:6175', 'debug'),
    'http://localhost:6175/?v86=debug',
  )
  assert.equal(
    buildVmRuntimeOriginWithMode('http://localhost:6175', 'release'),
    'http://localhost:6175/?v86=release',
  )
  assert.equal(
    buildVmRuntimeOriginWithMode('http://127.0.0.1:6175', 'debug'),
    'http://127.0.0.1:6175/?v86=debug',
  )

  // 保留已有查询参数
  assert.equal(
    buildVmRuntimeOriginWithMode('http://localhost:6175/?foo=bar', 'debug'),
    'http://localhost:6175/?foo=bar&v86=debug',
  )

  // 非法 URL 兜底
  assert.equal(buildVmRuntimeOriginWithMode('not a url', 'debug'), 'not a url')
}

testOppositeLoopback()
testFallback()
testBuildVmRuntimeOriginWithMode()
console.log('virtual-machine-runtime-config.test.ts ok')
