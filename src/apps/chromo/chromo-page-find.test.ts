/**
 * 运行：node --experimental-strip-types src/apps/chromo/chromo-page-find.test.ts
 */
import assert from 'node:assert/strict'
import {
  buildChromoFindSearchEval,
  countChromoFindMatches,
  parseChromoFindResult,
} from './chromo-page-find.ts'

function testCountMatches(): void {
  assert.equal(countChromoFindMatches('Hello hello HELLO', 'hello'), 3)
  assert.equal(countChromoFindMatches('aaaa', 'aa'), 2)
  assert.equal(countChromoFindMatches('nothing', 'xyz'), 0)
  assert.equal(countChromoFindMatches('abc', ''), 0)
  assert.equal(countChromoFindMatches('aaa', 'a', 2), 2)
  console.log('ok: find match count')
}

function testParseFindResult(): void {
  assert.deepEqual(parseChromoFindResult({ count: 4, index: 1 }), { count: 4, index: 1 })
  assert.equal(parseChromoFindResult({ error: '页面查找尚未就绪' }).error, '页面查找尚未就绪')
  assert.equal(parseChromoFindResult(null).count, 0)
  assert.ok(buildChromoFindSearchEval('café').includes('café'))
  console.log('ok: parse find result')
}

testCountMatches()
testParseFindResult()
console.log('chromo-page-find tests passed')
