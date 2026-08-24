/**
 * 归档进度分数纯函数测试。
 *
 * 运行：node --experimental-strip-types src/archive/archive-progress.test.ts
 */
import assert from 'node:assert/strict'
import { archiveJobProgressFraction } from './archive-progress.ts'

assert.equal(archiveJobProgressFraction({ phase: 'read', bytesDone: 50, bytesTotal: 100 }), 0.5)
assert.equal(archiveJobProgressFraction({ phase: 'write', bytesDone: 10, bytesTotal: 10 }), 1)
assert.equal(archiveJobProgressFraction({ phase: 'encode', bytesDone: 100, bytesTotal: 100 }), undefined)
assert.equal(archiveJobProgressFraction({ phase: 'decode', bytesDone: 0, bytesTotal: 8 }), undefined)
assert.equal(archiveJobProgressFraction({ phase: 'read', bytesDone: 0, bytesTotal: 0 }), 0)
assert.equal(archiveJobProgressFraction({ phase: 'write', bytesDone: 4, bytesTotal: 0 }), 1)

console.log('archive-progress.test.ts: ok')
