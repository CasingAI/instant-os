/**
 * IDB 事务诊断文案单测。
 * 运行：node --experimental-strip-types src/os/idb-transaction.test.ts
 */
import assert from 'node:assert/strict'
import { formatIdbTransactionFailure } from './idb-transaction.ts'

const fakeDb = {
  name: 'instant-os-data',
  version: 9,
  objectStoreNames: {
    [Symbol.iterator]: function* () {
      yield 'book-chapters'
      yield 'ai-event-log'
    },
  },
} as unknown as IDBDatabase

{
  const message = formatIdbTransactionFailure(
    fakeDb,
    'vscode-ai-chat',
    new DOMException(
      "Failed to execute 'transaction' on 'IDBDatabase': One of the specified object stores was not found.",
      'NotFoundError',
    ),
  )
  assert.match(message, /db=instant-os-data/)
  assert.match(message, /version=9/)
  assert.match(message, /请求 store=\[vscode-ai-chat\]/)
  assert.match(message, /缺失=\[vscode-ai-chat\]/)
  assert.match(message, /现有=\[book-chapters, ai-event-log\]/)
  assert.match(message, /NotFoundError|object stores was not found/)
}

{
  const message = formatIdbTransactionFailure(fakeDb, ['book-chapters', 'missing'], 'boom')
  assert.match(message, /请求 store=\[book-chapters, missing\]/)
  assert.match(message, /缺失=\[missing\]/)
  assert.match(message, /boom/)
}

console.log('idb-transaction.test.ts: ok')
