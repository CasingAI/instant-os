/**
 * 虚拟机文件传输服务单测：重点覆盖宿主 → XP 的「桥接管」清单推送。
 *
 * 桥接管方案下，pushFilesToVm 把选中的文件/文件夹递归展开成相对路径树
 *（目录条目 path 以 / 结尾且 size=0；文件条目 path 不含尾 /，size=byteSize），
 * 并按 PENDING 帧 entries 区字节上限（≈32716）分片，同 session 连续调用
 * filePending 推给 XP 侧桥。
 */
import assert from 'node:assert/strict'
import {
  fileTransferTestHooks,
  handleVmFileEvent,
  pushFilesToVm,
  registerVmFileTransferBackend,
} from './virtual-machine-file-transfer.ts'
import type { FilesApiEntry } from '../files/files-api.ts'
import type { VmAgentController } from './virtual-machine-agent.ts'

type MockCall = { method: string; args: unknown[] }

type TestEntry = {
  path: string
  name: string
  kind: 'file' | 'folder'
  byteSize: number
  content?: string
}

function dummyFileEntry(path: string, byteSize = 0): FilesApiEntry {
  return {
    path,
    name: path.split('/').pop() ?? '',
    kind: 'file',
    byteSize,
    mimeType: undefined,
    createdAt: 0,
    updatedAt: 0,
    writable: true,
  }
}

function makeMockAgent(calls: MockCall[]): VmAgentController {
  const stub = () => Promise.resolve(true)
  return {
    state: () => Promise.resolve({}),
    key: () => Promise.resolve(),
    keyEvent: () => Promise.resolve(),
    ping: () => Promise.resolve(),
    exec: () => Promise.resolve(),
    execResult: () => Promise.resolve({ ok: true, exitCode: 0, timedOut: false }),
    clipboardWrite: () => Promise.resolve(true),
    filePending: (_session, _mode, files) => {
      calls.push({ method: 'filePending', args: [files] })
      return Promise.resolve(true)
    },
    fileClear: () => {
      calls.push({ method: 'fileClear', args: [] })
      return Promise.resolve(true)
    },
    fileReq: stub,
    fileChunk: stub,
    fileDone: stub,
    fileWindow: () => Promise.resolve(true),
    fileWindowsClear: () => {
      calls.push({ method: 'fileWindowsClear', args: [] })
      return Promise.resolve(true)
    },
    click: () => Promise.resolve(),
    dblclick: () => Promise.resolve(),
    snap: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
    reboot: () => Promise.resolve(),
    raw: () => Promise.resolve(true),
  }
}

function makeEntry(path: string, kind: 'file' | 'folder', byteSize = 0, content?: string): TestEntry {
  const parts = path.split('/')
  const name = parts[parts.length - 1]
  return { path, name, kind, byteSize, content }
}

function blobOf(text: string): Blob {
  return new Blob([new TextEncoder().encode(text)])
}

function reset() {
  fileTransferTestHooks({
    readSource: undefined,
    statSource: undefined,
    listSource: undefined,
    readBlobSource: undefined,
    trashSource: undefined,
    pushSession: null,
  })
  registerVmFileTransferBackend(null)
}

function createMockFs(entries: TestEntry[]) {
  const stats = new Map<string, TestEntry>()
  const lists = new Map<string, TestEntry[]>()
  const contents = new Map<string, string>()
  for (const e of entries) {
    stats.set(e.path, e)
    if (e.content !== undefined) {
      contents.set(e.path, e.content)
    }
  }
  for (const e of entries) {
    const parts = e.path.split('/')
    parts.pop()
    const parent = parts.join('/') || '/'
    const siblings = lists.get(parent) ?? []
    siblings.push(e)
    lists.set(parent, siblings)
  }
  return {
    statSource: async (path: string) => {
      const e = stats.get(path)
      return e
        ? {
            path: e.path,
            name: e.name,
            kind: e.kind,
            byteSize: e.byteSize,
            mimeType: undefined,
            createdAt: 0,
            updatedAt: 0,
            writable: true,
          }
        : undefined
    },
    listSource: async (path: string) => {
      return (lists.get(path) ?? []).map((e) => ({
        path: e.path,
        name: e.name,
        kind: e.kind,
        byteSize: e.byteSize,
        mimeType: undefined,
        createdAt: 0,
        updatedAt: 0,
        writable: true,
      }))
    },
    readBlobSource: async (path: string, start: number, length: number) => {
      const text = contents.get(path) ?? ''
      return blobOf(text.slice(start, start + length))
    },
  }
}

async function main() {
  // #1 复制单个文件夹 → 展开成目录树条目
  {
    reset()
    const calls: MockCall[] = []
    registerVmFileTransferBackend(makeMockAgent(calls))
    const { statSource, listSource, readBlobSource } = createMockFs([
      makeEntry('/docs', 'folder'),
      makeEntry('/docs/readme.txt', 'file', 5, 'hello'),
      makeEntry('/docs/sub', 'folder'),
      makeEntry('/docs/sub/a.txt', 'file', 5, 'world'),
    ])
    fileTransferTestHooks({ statSource, listSource, readBlobSource })

    await pushFilesToVm(['/docs'], 'copy')
    const pending = calls.filter((c) => c.method === 'filePending')
    assert.ok(pending.length > 0, '应调用 filePending')
    const all = pending.flatMap((c) => c.args[0] as { path: string; size: number }[])
    assert.deepEqual(all, [
      { path: 'docs/', size: 0 },
      { path: 'docs/readme.txt', size: 5 },
      { path: 'docs/sub/', size: 0 },
      { path: 'docs/sub/a.txt', size: 5 },
    ])
  }

  // #2 多选混合 → 顶层文件 + 顶层文件夹树
  {
    reset()
    const calls: MockCall[] = []
    registerVmFileTransferBackend(makeMockAgent(calls))
    const { statSource, listSource, readBlobSource } = createMockFs([
      makeEntry('/file.txt', 'file', 3, 'abc'),
      makeEntry('/empty', 'folder'),
      makeEntry('/empty/inner.txt', 'file', 2, 'in'),
    ])
    fileTransferTestHooks({ statSource, listSource, readBlobSource })

    await pushFilesToVm(['/file.txt', '/empty'], 'copy')
    const pending = calls.filter((c) => c.method === 'filePending')
    const all = pending.flatMap((c) => c.args[0] as { path: string; size: number }[])
    assert.deepEqual(all, [
      { path: 'file.txt', size: 3 },
      { path: 'empty/', size: 0 },
      { path: 'empty/inner.txt', size: 2 },
    ])
  }

  // #3 单个文件 → 直接推送
  {
    reset()
    const calls: MockCall[] = []
    registerVmFileTransferBackend(makeMockAgent(calls))
    const { statSource, listSource, readBlobSource } = createMockFs([
      makeEntry('/single.txt', 'file', 4, 'data'),
    ])
    fileTransferTestHooks({ statSource, listSource, readBlobSource })

    await pushFilesToVm(['/single.txt'], 'copy')
    const pending = calls.find((c) => c.method === 'filePending')
    const files = pending?.args[0] as { path: string; size: number }[]
    assert.deepEqual(files, [{ path: 'single.txt', size: 4 }])
  }

  // #4 推送失败时清理旧清单
  {
    reset()
    const calls: MockCall[] = []
    const { statSource, listSource, readBlobSource } = createMockFs([
      makeEntry('/bad', 'folder'),
      makeEntry('/bad/a.txt', 'file', 3, 'xyz'),
    ])
    fileTransferTestHooks({
      statSource,
      listSource,
      readBlobSource,
      pushSession: {
        session: 42,
        mode: 'copy',
        files: [{ name: 'old.txt', hostPath: '/old.txt', size: 1, isDir: false }],
        currentFile: 0,
        windows: [],
        queuedWindows: new Set(),
        windowQueue: Promise.resolve(),
      },
    })
    const failingAgent = makeMockAgent(calls)
    failingAgent.filePending = () => Promise.resolve(false)
    registerVmFileTransferBackend(failingAgent)

    await assert.rejects(() => pushFilesToVm(['/bad'], 'copy'), /虚拟机信箱忙/)
    assert.ok(calls.some((c) => c.method === 'fileClear'), '失败时应调用 fileClear')
  }

  // #5 cut 模式粘贴成功后删除原文件
  {
    reset()
    const trashed: string[] = []
    registerVmFileTransferBackend(makeMockAgent([]))
    fileTransferTestHooks({
      trashSource: async (path) => {
        trashed.push(path)
        return dummyFileEntry(path)
      },
      pushSession: {
        session: 123,
        mode: 'cut',
        files: [{ name: 'x.txt', hostPath: '/src/x.txt', size: 10, isDir: false }],
        currentFile: 0,
        windows: [],
        queuedWindows: new Set(),
        windowQueue: Promise.resolve(),
        cutSourcePaths: ['/src/folder'],
      },
    })
    handleVmFileEvent({ kind: 'done', session: 123, result: 'ok' } as any)
    await new Promise((r) => setTimeout(r, 50))
    assert.deepEqual(trashed, ['/src/folder'])
  }

  // #6 文件夹里某个子文件 stat 缺失时跳过，不影响其他文件
  {
    reset()
    const calls: MockCall[] = []
    registerVmFileTransferBackend(makeMockAgent(calls))
    const base = createMockFs([
      makeEntry('/docs', 'folder'),
      makeEntry('/docs/readme.txt', 'file', 5, 'hello'),
      makeEntry('/docs/missing.txt', 'file', 3, 'x'),
    ])
    const statSource = async (path: string) => {
      if (path === '/docs/missing.txt') return undefined
      return base.statSource(path)
    }
    fileTransferTestHooks({ statSource, listSource: base.listSource, readBlobSource: base.readBlobSource })

    await pushFilesToVm(['/docs'], 'copy')
    const pending = calls.find((c) => c.method === 'filePending')
    assert.ok(pending, '应调用 filePending')
    const files = pending?.args[0] as { path: string; size: number }[]
    assert.deepEqual(files, [
      { path: 'docs/', size: 0 },
      { path: 'docs/readme.txt', size: 5 },
    ])
  }

  // #7 顶层选中路径无法 stat 时静默跳过，不抛错
  {
    reset()
    const calls: MockCall[] = []
    registerVmFileTransferBackend(makeMockAgent(calls))
    const base = createMockFs([makeEntry('/existent.txt', 'file', 4, 'data')])
    fileTransferTestHooks({
      statSource: async (path: string) => {
        if (path === '/missing.txt') return undefined
        return base.statSource(path)
      },
      listSource: base.listSource,
      readBlobSource: base.readBlobSource,
    })

    await pushFilesToVm(['/missing.txt'], 'copy')
    assert.ok(!calls.some((c) => c.method === 'filePending'), '不应推送任何文件')
  }

  // #8 大清单分片：构造 900 个短名字文件，应触发多次 filePending 但同 session
  {
    reset()
    const calls: MockCall[] = []
    registerVmFileTransferBackend(makeMockAgent(calls))
    const entries: TestEntry[] = [makeEntry('/big', 'folder')]
    const expected: { path: string; size: number }[] = [{ path: 'big/', size: 0 }]
    for (let i = 0; i < 900; i++) {
      const name = `file-${i.toString().padStart(4, '0')}.txt`
      entries.push(makeEntry(`/big/${name}`, 'file', 100 + i))
      expected.push({ path: `big/${name}`, size: 100 + i })
    }
    const { statSource, listSource, readBlobSource } = createMockFs(entries)
    fileTransferTestHooks({ statSource, listSource, readBlobSource })

    await pushFilesToVm(['/big'], 'copy')
    const pending = calls.filter((c) => c.method === 'filePending')
    assert.ok(pending.length > 1, '大清单应分片发送')
    const all = pending.flatMap((c) => c.args[0] as { path: string; size: number }[])
    assert.deepEqual(all, expected)
  }

  // #9 目录条目语义：空文件 size 为 0 但不以 / 结尾
  {
    reset()
    const calls: MockCall[] = []
    registerVmFileTransferBackend(makeMockAgent(calls))
    const { statSource, listSource, readBlobSource } = createMockFs([
      makeEntry('/empty-file.txt', 'file', 0),
      makeEntry('/folder', 'folder'),
    ])
    fileTransferTestHooks({ statSource, listSource, readBlobSource })

    await pushFilesToVm(['/empty-file.txt', '/folder'], 'copy')
    const pending = calls.find((c) => c.method === 'filePending')
    const files = pending?.args[0] as { path: string; size: number }[]
    assert.deepEqual(files, [
      { path: 'empty-file.txt', size: 0 },
      { path: 'folder/', size: 0 },
    ])
  }

  reset()
  console.log('virtual-machine-file-transfer.test.ts ok')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
