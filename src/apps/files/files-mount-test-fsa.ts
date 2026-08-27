/**
 * 仅测试用：FSA（File System Access API）handle 的简化 mock。
 * createWritable 即清空既有文件、close 落盘、abort 丢弃（与真实 FSA 一致）。
 * 没有 move 方法 → 挂载卷覆盖写会走「读临时文件覆盖写本体」的非原子回退路径。
 */

export class MockWritableFileStream {
  file: MockFileHandle
  chunks: string[] = []
  closed = false
  constructor(file: MockFileHandle) {
    this.file = file
    // FSA createWritable() 立即清空既有文件
    this.file.text = ''
  }
  async write(data: string | Uint8Array): Promise<void> {
    if (this.closed) throw new Error('stream closed')
    this.chunks.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
  }
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.file.text = this.chunks.join('')
  }
  async abort(): Promise<void> {
    // 已 truncate；abort 不恢复旧内容（与真实 FSA 一致）
    this.closed = true
  }
}

export class MockFileHandle {
  kind = 'file' as const
  name: string
  text: string
  constructor(name: string, text: string) {
    this.name = name
    this.text = text
  }
  async getFile(): Promise<Blob> {
    return new Blob([this.text])
  }
  async createWritable(): Promise<MockWritableFileStream> {
    return new MockWritableFileStream(this)
  }
}

export class MockDirHandle {
  kind = 'directory' as const
  name: string
  children: Map<string, MockDirHandle | MockFileHandle>
  constructor(
    name: string,
    children: Map<string, MockDirHandle | MockFileHandle> = new Map(),
  ) {
    this.name = name
    this.children = children
  }
  async getDirectoryHandle(name: string): Promise<MockDirHandle> {
    const child = this.children.get(name)
    if (child?.kind === 'directory') return child
    throw new Error(`not a directory: ${name}`)
  }
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MockFileHandle> {
    const child = this.children.get(name)
    if (child?.kind === 'file') return child
    if (options?.create) {
      const created = new MockFileHandle(name, '')
      this.children.set(name, created)
      return created
    }
    throw new Error(`not a file: ${name}`)
  }
  async removeEntry(name: string): Promise<void> {
    this.children.delete(name)
  }
  async *entries(): AsyncGenerator<[string, MockDirHandle | MockFileHandle]> {
    for (const [name, handle] of this.children) yield [name, handle]
  }
  async queryPermission(): Promise<PermissionState> {
    return 'granted'
  }
  async requestPermission(): Promise<PermissionState> {
    return 'granted'
  }
}

/** 每次调用都返回全新根，避免用例间互相残留 */
export function createMockMountRoot(): MockDirHandle {
  return new MockDirHandle(
    'otterflow',
    new Map<string, MockDirHandle | MockFileHandle>([
      ['package.json', new MockFileHandle('package.json', '{"name":"x"}\n')],
      [
        'src',
        new MockDirHandle(
          'src',
          new Map<string, MockDirHandle | MockFileHandle>([
            ['main.ts', new MockFileHandle('main.ts', 'const x = 1\n')],
          ]),
        ),
      ],
    ]),
  )
}
