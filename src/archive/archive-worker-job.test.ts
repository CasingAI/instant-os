/**
 * 归档 Worker 任务协调层单测。
 *
 * 运行：node --experimental-strip-types src/archive/archive-worker-job.test.ts
 */
import assert from 'node:assert/strict'
import { runArchiveWorkerJob, type ArchiveJobWorker } from './archive-worker-job.ts'
import type { ArchiveWorkerRequest, ArchiveWorkerResponse } from './archive-worker.ts'

class MockArchiveWorker implements ArchiveJobWorker {
  terminateCount = 0
  hang = false
  delayMs = 20
  private listeners = new Map<string, Set<(event: Event) => void>>()

  addEventListener(type: 'message' | 'error', listener: (event: Event) => void): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }

  terminate(): void {
    this.terminateCount += 1
    this.hang = true
    this.listeners.clear()
  }

  postMessage(message: ArchiveWorkerRequest): void {
    if (this.hang) return
    const response = replyFor(message)
    setTimeout(() => {
      if (this.terminateCount > 0) return
      const set = this.listeners.get('message')
      if (!set) return
      const event = { data: response } as MessageEvent<ArchiveWorkerResponse>
      for (const listener of set) listener(event)
    }, this.delayMs)
  }
}

function replyFor(request: ArchiveWorkerRequest): Exclude<ArchiveWorkerResponse, { type: 'error' }> {
  if (request.type === 'list') {
    return { type: 'list-done', id: request.id, format: 'zip', entries: [] }
  }
  if (request.type === 'encode') {
    return { type: 'encode-done', id: request.id, bytes: new ArrayBuffer(4) }
  }
  return { type: 'decode-done', id: request.id, entries: [] }
}

function listRequest(id: number): ArchiveWorkerRequest {
  return { type: 'list', id, format: 'auto', bytes: new ArrayBuffer(0) }
}

{
  const worker = new MockArchiveWorker()
  const response = await runArchiveWorkerJob({
    createWorker: () => worker,
    request: listRequest(1),
    transfer: [],
  })
  assert.equal(response.type, 'list-done')
  assert.equal(response.id, 1)
  assert.equal(worker.terminateCount, 1)
  console.log('success terminates worker: ok')
}

{
  const worker = new MockArchiveWorker()
  worker.hang = true
  const abort = new AbortController()
  const job = runArchiveWorkerJob({
    createWorker: () => worker,
    request: listRequest(2),
    transfer: [],
    signal: abort.signal,
  })
  abort.abort()
  await assert.rejects(job, (error: unknown) => error instanceof Error && error.message === 'aborted')
  assert.equal(worker.terminateCount, 1)
  console.log('abort terminates that worker: ok')
}

{
  const hung = new MockArchiveWorker()
  hung.hang = true
  const other = new MockArchiveWorker()
  other.delayMs = 30
  const abort = new AbortController()
  const jobA = runArchiveWorkerJob({
    createWorker: () => hung,
    request: listRequest(3),
    transfer: [],
    signal: abort.signal,
  })
  const jobB = runArchiveWorkerJob({
    createWorker: () => other,
    request: listRequest(4),
    transfer: [],
  })
  abort.abort()
  await assert.rejects(jobA, (error: unknown) => error instanceof Error && error.message === 'aborted')
  const responseB = await jobB
  assert.equal(responseB.type, 'list-done')
  assert.equal(responseB.id, 4)
  assert.ok(hung.terminateCount >= 1)
  assert.equal(other.terminateCount, 1)
  console.log('abort A does not fail B: ok')
}

{
  const worker = new MockArchiveWorker()
  const abort = new AbortController()
  abort.abort()
  await assert.rejects(
    runArchiveWorkerJob({
      createWorker: () => worker,
      request: listRequest(5),
      transfer: [],
      signal: abort.signal,
    }),
    (error: unknown) => error instanceof Error && error.message === 'aborted',
  )
  assert.equal(worker.terminateCount, 0)
  console.log('pre-aborted does not create work: ok')
}

console.log('archive-worker-job.test.ts: ok')
