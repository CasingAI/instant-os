import { mount } from 'libmount'

const SECTOR = 512
const PREFETCH_MIN = 4096
const FAT_PARTITION_TYPES = new Set([
  0x01, 0x04, 0x06, 0x0b, 0x0c, 0x0e, 0x11, 0x14, 0x16, 0x1b, 0x1c,
])

export type ImageDiskIo = {
  size: number
  read(offset: number, length: number): Promise<Uint8Array>
  write(offset: number, data: Uint8Array): Promise<void>
}

type FatDisk = ReturnType<typeof mount>
type FatFileSystem = NonNullable<ReturnType<FatDisk['getFileSystem']>>
type FatFile = ReturnType<FatFileSystem['getRoot']>
type FatPartition = ReturnType<FatDisk['getPartitions']>[number]

export type FatVolumeEntry = {
  name: string
  kind: 'file' | 'folder'
  byteSize: number
  createdAt: number
  updatedAt: number
}

class ImageSectorMiss extends Error {
  readonly offset: number
  readonly length: number

  constructor(offset: number, length: number) {
    super('image-sector-miss')
    this.name = 'ImageSectorMiss'
    this.offset = offset
    this.length = length
  }
}

function isFatPartition(partition: FatPartition): boolean {
  return FAT_PARTITION_TYPES.has(partition.type)
}

function copyBytes(source: Uint8Array): Uint8Array {
  const out = new Uint8Array(source.byteLength)
  out.set(source)
  return out
}

function posixJoin(parent: string, name: string): string {
  if (!parent) return name
  return `${parent}/${name}`
}

function posixDirname(path: string): string {
  const slash = path.lastIndexOf('/')
  if (slash < 0) return ''
  return path.slice(0, slash)
}

function posixBasename(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(slash + 1) : path
}

class SectorCache {
  private readonly chunks = new Map<number, Uint8Array>()
  private readonly dirty = new Set<number>()
  private readonly capacity: number

  constructor(capacity: number) {
    this.capacity = capacity
  }

  read(address: number, count: number): Uint8Array {
    if (address < 0 || count < 0 || address + count > this.capacity) {
      throw new Error('镜像读取超出范围')
    }
    const begin = Math.floor(address / SECTOR)
    const last = Math.floor((address + Math.max(count, 1) - 1) / SECTOR)
    for (let index = begin; index <= last; index += 1) {
      if (!this.chunks.has(index)) {
        throw new ImageSectorMiss(begin * SECTOR, (last - begin + 1) * SECTOR)
      }
    }
    const out = new Uint8Array(count)
    let remaining = count
    let cursor = address
    let dest = 0
    while (remaining > 0) {
      const index = Math.floor(cursor / SECTOR)
      const start = cursor % SECTOR
      const take = Math.min(SECTOR - start, remaining)
      const chunk = this.chunks.get(index)
      if (!chunk) {
        throw new ImageSectorMiss(cursor, remaining)
      }
      out.set(chunk.subarray(start, start + take), dest)
      cursor += take
      dest += take
      remaining -= take
    }
    return out
  }

  write(address: number, data: Uint8Array): void {
    if (address < 0 || address + data.byteLength > this.capacity) {
      throw new Error('镜像写入超出范围')
    }
    let remaining = data.byteLength
    let cursor = address
    let source = 0
    while (remaining > 0) {
      const index = Math.floor(cursor / SECTOR)
      const start = cursor % SECTOR
      const take = Math.min(SECTOR - start, remaining)
      let chunk = this.chunks.get(index)
      if (!chunk) {
        if (start !== 0 || take !== SECTOR) {
          throw new ImageSectorMiss(index * SECTOR, SECTOR)
        }
        chunk = new Uint8Array(SECTOR)
        this.chunks.set(index, chunk)
      }
      chunk.set(data.subarray(source, source + take), start)
      this.dirty.add(index)
      cursor += take
      source += take
      remaining -= take
    }
  }

  async fill(io: ImageDiskIo, offset: number, length: number): Promise<void> {
    const begin = Math.max(0, Math.floor(offset / SECTOR) * SECTOR)
    const wantEnd = Math.min(this.capacity, offset + Math.max(length, 1) + PREFETCH_MIN)
    const end = Math.min(this.capacity, Math.ceil(wantEnd / SECTOR) * SECTOR)
    const bytes = await io.read(begin, Math.max(0, end - begin))
    for (let pos = 0; pos < bytes.byteLength; pos += SECTOR) {
      const index = (begin + pos) / SECTOR
      if (this.chunks.has(index)) continue
      const chunk = new Uint8Array(SECTOR)
      chunk.set(bytes.subarray(pos, Math.min(pos + SECTOR, bytes.byteLength)))
      this.chunks.set(index, chunk)
    }
  }

  async flush(io: ImageDiskIo): Promise<void> {
    if (this.dirty.size === 0) return
    const indexes = [...this.dirty].sort((a, b) => a - b)
    let runStart = indexes[0] ?? 0
    let runEnd = indexes[0] ?? 0
    const flushRun = async (from: number, to: number) => {
      const payload = new Uint8Array((to - from + 1) * SECTOR)
      for (let index = from; index <= to; index += 1) {
        const chunk = this.chunks.get(index)
        if (chunk) payload.set(chunk, (index - from) * SECTOR)
      }
      await io.write(from * SECTOR, payload)
    }
    for (let i = 1; i < indexes.length; i += 1) {
      const index = indexes[i] ?? runEnd
      if (index === runEnd + 1) {
        runEnd = index
        continue
      }
      await flushRun(runStart, runEnd)
      runStart = index
      runEnd = index
    }
    await flushRun(runStart, runEnd)
    this.dirty.clear()
  }
}

export class FatImageVolume {
  private readonly cache: SectorCache
  private readonly driver: {
    readonly capacity: number
    read: (address: number, count: number) => Uint8Array
    write: (address: number, data: Uint8Array) => void
  }
  private partition: FatPartition | undefined
  private chain: Promise<void> = Promise.resolve()
  private readonly io: ImageDiskIo

  constructor(io: ImageDiskIo) {
    this.io = io
    this.cache = new SectorCache(io.size)
    this.driver = {
      capacity: io.size,
      read: (address, count) => this.cache.read(address, count),
      write: (address, data) => this.cache.write(address, copyBytes(data)),
    }
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(work, work)
    this.chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async withSectors<T>(fn: () => T | Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        return await fn()
      } catch (error) {
        if (error instanceof ImageSectorMiss) {
          await this.cache.fill(this.io, error.offset, error.length)
          continue
        }
        throw error
      }
    }
    throw new Error('磁盘镜像读取失败：扇区预取次数过多')
  }

  private attach(): FatDisk {
    return this.partition
      ? mount(this.driver, { partition: this.partition })
      : mount(this.driver)
  }

  private resolveFileSystem(disk: FatDisk): FatFileSystem {
    const direct = disk.getFileSystem()
    if (direct) return direct
    const fatPartition = disk.getPartitions().find((item) => isFatPartition(item))
    if (!fatPartition) {
      throw new Error('无法识别 FAT 文件系统。空白盘需要先格式化。')
    }
    this.partition = fatPartition
    const partitioned = mount(this.driver, { partition: fatPartition })
    const fileSystem = partitioned.getFileSystem()
    if (!fileSystem) {
      throw new Error('无法识别 FAT 文件系统。空白盘需要先格式化。')
    }
    return fileSystem
  }

  private async withRoot<T>(fn: (root: FatFile) => T | Promise<T>): Promise<T> {
    return this.withSectors(async () => {
      const fileSystem = this.resolveFileSystem(this.attach())
      return await fn(fileSystem.getRoot())
    })
  }

  async prepare(): Promise<void> {
    await this.enqueue(async () => {
      await this.withRoot(() => undefined)
    })
  }

  async flush(): Promise<void> {
    await this.enqueue(async () => {
      await this.cache.flush(this.io)
    })
  }

  async list(relativeDir: string): Promise<FatVolumeEntry[]> {
    return this.enqueue(async () => {
      return this.withRoot((root) => {
        const dir = relativeDir ? root.getFile(relativeDir) : root
        if (!dir?.isDirectory()) {
          throw new Error('文件夹不存在')
        }
        return (dir.listFiles() ?? [])
          .filter((item) => {
            const name = item.getName()
            return name !== '.' && name !== '..'
          })
          .map((item) => this.toEntry(item))
      })
    })
  }

  async stat(relativePath: string): Promise<FatVolumeEntry | undefined> {
    if (!relativePath) return undefined
    return this.enqueue(async () => {
      return this.withRoot((root) => {
        const file = root.getFile(relativePath)
        return file ? this.toEntry(file) : undefined
      })
    })
  }

  async readFile(relativePath: string): Promise<Uint8Array> {
    return this.enqueue(async () => {
      return this.withRoot((root) => {
        const file = root.getFile(relativePath)
        if (!file?.isRegularFile()) {
          throw new Error('文件不存在')
        }
        const io = file.open()
        if (!io) {
          throw new Error('无法读取文件')
        }
        return copyBytes(io.readData())
      })
    })
  }

  async writeFile(relativePath: string, data: Uint8Array): Promise<FatVolumeEntry> {
    return this.enqueue(async () => {
      const entry = await this.withRoot((root) => {
        const file = root.makeFile(relativePath)
        if (!file) {
          throw new Error('无法写入文件')
        }
        const io = file.open()
        if (!io) {
          throw new Error('无法写入文件')
        }
        io.writeData(data)
        return this.toEntry(file)
      })
      await this.cache.flush(this.io)
      return entry
    })
  }

  async mkdir(relativePath: string): Promise<FatVolumeEntry> {
    return this.enqueue(async () => {
      const entry = await this.withRoot((root) => {
        const dir = root.makeDir(relativePath)
        if (!dir) {
          throw new Error('无法创建文件夹')
        }
        return this.toEntry(dir)
      })
      await this.cache.flush(this.io)
      return entry
    })
  }

  async remove(relativePath: string): Promise<void> {
    await this.enqueue(async () => {
      await this.withRoot((root) => {
        const file = root.getFile(relativePath)
        if (!file) {
          throw new Error('项目不存在')
        }
        file.delete()
      })
      await this.cache.flush(this.io)
    })
  }

  async rename(fromRelative: string, toRelative: string): Promise<FatVolumeEntry> {
    return this.enqueue(async () => {
      const entry = await this.withRoot((root) => {
        const file = root.getFile(fromRelative)
        if (!file) {
          throw new Error('项目不存在')
        }
        const dest =
          posixDirname(toRelative) === posixDirname(fromRelative)
            ? posixBasename(toRelative)
            : toRelative
        const moved = file.moveTo(dest)
        if (!moved) {
          throw new Error('无法重命名')
        }
        return this.toEntry(moved)
      })
      await this.cache.flush(this.io)
      return entry
    })
  }

  private toEntry(file: FatFile): FatVolumeEntry {
    const updated = file.getLastModified()?.getTime() ?? Date.now()
    const created = file.getCreationTime()?.getTime() ?? updated
    return {
      name: file.getName(),
      kind: file.isDirectory() ? 'folder' : 'file',
      byteSize: file.isDirectory() ? 0 : file.length(),
      createdAt: created,
      updatedAt: updated,
    }
  }
}

export function joinFatRelativePath(parent: string, name: string): string {
  return posixJoin(parent, name)
}

export function fatParentRelativePath(path: string): string {
  return posixDirname(path)
}

export function fatBaseName(path: string): string {
  return posixBasename(path)
}
