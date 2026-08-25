import { mount } from 'libmount'

const SECTOR = 512
const PREFETCH_MIN = 4096
const WRITE_BEHIND_IDLE_MS = 100
const WRITE_BEHIND_DIRTY_BYTES = 256 * 1024
const FAT_PARTITION_TYPES = new Set([
  0x01, 0x04, 0x06, 0x0b, 0x0c, 0x0e, 0x11, 0x14, 0x16, 0x1b, 0x1c,
])

export type ImageDiskIo = {
  size: number
  read(offset: number, length: number): Promise<Uint8Array>
  write(offset: number, data: Uint8Array): Promise<void>
  /** 卸载 / 停止时调用，关闭底层写入会话 */
  close?(): Promise<void>
  /** 由卷 flush 触发，把已写入数据刷入持久层 */
  flush?(): Promise<void>
}

type FatDisk = ReturnType<typeof mount>
type FatFileSystem = NonNullable<ReturnType<FatDisk['getFileSystem']>>
type FatFile = ReturnType<FatFileSystem['getRoot']>
type FatPartition = ReturnType<FatDisk['getPartitions']>[number]

type FatFileNode = {
  fstClus: number
  dirEntry: { FileSize: number }
}

type FatFileSystemInternals = {
  getSizeOfCluster(): number
  getContentOffset(clusNum: number): number
  FAT: {
    getNextClusNum(clusNum: number): number
  }
}

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

function overlayRangeOnCluster(
  clusterBuf: Uint8Array,
  clusterIndex: number,
  clusterSize: number,
  rangeOffset: number,
  data: Uint8Array,
): void {
  const pos = clusterIndex * clusterSize
  const overlapStart = Math.max(0, rangeOffset - pos)
  const overlapEnd = Math.min(clusterSize, rangeOffset + data.byteLength - pos)
  if (overlapEnd <= overlapStart) return
  const srcStart = pos + overlapStart - rangeOffset
  clusterBuf.set(data.subarray(srcStart, srcStart + (overlapEnd - overlapStart)), overlapStart)
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

  dirtyBytes(): number {
    return this.dirty.size * SECTOR
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
  private flushing: Promise<void> = Promise.resolve()
  private readonly io: ImageDiskIo
  private mountedFileSystem: FatFileSystem | undefined
  private dirty = false
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private clusterChains = new Map<string, number[]>()
  private clusterSizes = new Map<string, number>()

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
    const partitions = disk.getPartitions()
    if (partitions.length === 0) {
      throw new Error('无法识别此镜像的文件系统：可能是空白盘或不受支持的格式')
    }
    const fatPartition = partitions.find((item) => isFatPartition(item))
    if (!fatPartition) {
      throw new Error('分区的文件系统不受支持（仅支持 FAT12/16/32）')
    }
    this.partition = fatPartition
    const partitioned = mount(this.driver, { partition: fatPartition })
    const fileSystem = partitioned.getFileSystem()
    if (!fileSystem) {
      throw new Error('FAT 文件系统无法解析，镜像可能已损坏')
    }
    return fileSystem
  }

  private ensureMounted(): FatFileSystem {
    if (this.mountedFileSystem) return this.mountedFileSystem
    const fs = this.resolveFileSystem(this.attach())
    this.mountedFileSystem = fs
    return fs
  }

  private async withRoot<T>(fn: (root: FatFile) => T | Promise<T>): Promise<T> {
    return this.withSectors(async () => {
      const fileSystem = this.ensureMounted()
      return await fn(fileSystem.getRoot())
    })
  }

  private fsInternals(): FatFileSystemInternals {
    return this.ensureMounted() as unknown as FatFileSystemInternals
  }

  private fileInternals(file: FatFile): FatFileNode {
    const wrapped = file as unknown as { node?: FatFileNode }
    const node = wrapped.node
    if (!node || typeof node.fstClus !== 'number' || !node.dirEntry) {
      throw new Error('无法读取 FAT 文件内部结构')
    }
    return node
  }

  private clusterSize(): number {
    return this.fsInternals().getSizeOfCluster()
  }

  private setCachedClusterSize(relativePath: string, size: number): void {
    this.clusterSizes.set(relativePath, size)
  }

  private getCachedClusterChain(relativePath: string): number[] | undefined {
    return this.clusterChains.get(relativePath)
  }

  private setCachedClusterChain(relativePath: string, chain: number[]): void {
    this.clusterChains.set(relativePath, chain)
  }

  private invalidateClusterCache(relativePath: string): void {
    this.clusterChains.delete(relativePath)
    this.clusterSizes.delete(relativePath)
  }

  private clusterChainFromFile(file: FatFile): number[] {
    const fs = this.fsInternals()
    const maxClus = this.ensureMounted().getCountOfClusters() + 1
    const node = this.fileInternals(file)
    const chain: number[] = []
    let clus = node.fstClus
    while (clus >= 2 && clus <= maxClus && chain.length <= maxClus) {
      chain.push(clus)
      const next = fs.FAT.getNextClusNum(clus)
      if (next === clus) break
      clus = next
    }
    return chain
  }

  private getClusterChain(relativePath: string, file: FatFile): number[] {
    const cached = this.getCachedClusterChain(relativePath)
    if (cached) return cached
    const chain = this.clusterChainFromFile(file)
    this.setCachedClusterChain(relativePath, chain)
    this.setCachedClusterSize(relativePath, this.clusterSize())
    return chain
  }

  private kickFlush(): void {
    this.flushing = this.flushing.then(
      () => this.flushIfNeeded(),
      () => this.flushIfNeeded(),
    )
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      this.kickFlush()
    }, WRITE_BEHIND_IDLE_MS)
  }

  private markDirty(): void {
    this.dirty = true
    if (this.cache.dirtyBytes() >= WRITE_BEHIND_DIRTY_BYTES) {
      this.kickFlush()
    } else {
      this.scheduleFlush()
    }
  }

  private async flushIfNeeded(): Promise<void> {
    if (!this.dirty) return
    this.dirty = false
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    await this.flushNow()
  }

  private async flushNow(): Promise<void> {
    await this.enqueue(async () => {
      await this.cache.flush(this.io)
    })
  }

  async prepare(): Promise<void> {
    await this.enqueue(async () => {
      await this.withRoot(() => undefined)
    })
  }

  async flush(): Promise<void> {
    this.kickFlush()
    await this.flushing
    await this.io.flush?.()
  }

  async close(): Promise<void> {
    await this.flush()
    await this.io.close?.()
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

  async readFileRange(relativePath: string, offset: number, length: number): Promise<Uint8Array> {
    return this.enqueue(async () => {
      return this.withSectors(async () => {
        const fs = this.ensureMounted()
        const root = fs.getRoot()
        const file = root.getFile(relativePath)
        if (!file?.isRegularFile()) {
          throw new Error('文件不存在')
        }
        const fileSize = file.length()
        const clusterSize = fs.getSizeOfCluster()
        const start = Math.max(0, offset)
        const want = Math.max(0, Math.min(length, fileSize - start))
        if (want <= 0) return new Uint8Array(0)

        if (want >= fileSize) {
          const io = file.open()
          if (!io) throw new Error('无法读取文件')
          return copyBytes(io.readData())
        }

        const internals = this.fsInternals()
        const chain = this.getClusterChain(relativePath, file)
        const startCluster = Math.floor(start / clusterSize)
        const endCluster = Math.floor((start + want - 1) / clusterSize)
        const out = new Uint8Array((endCluster - startCluster + 1) * clusterSize)
        let cursor = 0
        for (let i = startCluster; i <= endCluster; i += 1) {
          const clus = chain[i]
          if (clus === undefined) break
          const offsetBytes = internals.getContentOffset(clus)
          out.set(this.driver.read(offsetBytes, clusterSize), cursor)
          cursor += clusterSize
        }
        const sliceStart = start % clusterSize
        return out.subarray(sliceStart, sliceStart + want)
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
      this.invalidateClusterCache(relativePath)
      this.markDirty()
      return entry
    })
  }

  async writeFileRange(relativePath: string, offset: number, data: Uint8Array): Promise<FatVolumeEntry> {
    return this.enqueue(async () => {
      const entry = await this.withSectors(async () => {
        const fs = this.ensureMounted()
        const file = fs.getRoot().getFile(relativePath)
        if (!file?.isRegularFile()) {
          throw new Error('文件不存在')
        }
        const clusterSize = fs.getSizeOfCluster()
        const oldSize = file.length()
        if (offset > oldSize) {
          throw new Error('offset 超出文件末尾，当前不支持空洞扩展')
        }
        if (data.byteLength === 0) {
          file.setLastModified(new Date())
          return this.toEntry(file)
        }
        const newSize = Math.max(oldSize, offset + data.byteLength)
        const internals = this.fsInternals()
        let chain = this.getClusterChain(relativePath, file)
        const allocatedBefore = chain.length
        const neededClusters = Math.ceil(newSize / clusterSize)
        const startCluster = Math.floor(offset / clusterSize)
        const endCluster = Math.floor((offset + data.byteLength - 1) / clusterSize)

        if (neededClusters > allocatedBefore) {
          const io = file.open()
          if (!io) {
            throw new Error('无法写入文件')
          }
          io.rewind()
          for (let i = 0; i < allocatedBefore; i += 1) {
            io.skipClus()
          }
          for (let i = allocatedBefore; i < neededClusters; i += 1) {
            const clusterBuf = new Uint8Array(clusterSize)
            overlayRangeOnCluster(clusterBuf, i, clusterSize, offset, data)
            const writeLen = Math.min(clusterSize, Math.max(1, newSize - i * clusterSize))
            if (io.writeClus(clusterBuf.subarray(0, writeLen)) === 0) {
              throw new Error('磁盘空间不足')
            }
          }
          this.invalidateClusterCache(relativePath)
          chain = this.getClusterChain(relativePath, file)
        }

        const lastExisting = Math.min(endCluster, allocatedBefore - 1)
        for (let i = startCluster; i <= lastExisting; i += 1) {
          const clus = chain[i]
          if (clus === undefined) break
          const diskOffset = internals.getContentOffset(clus)
          const clusterBuf = new Uint8Array(clusterSize)
          clusterBuf.set(this.driver.read(diskOffset, clusterSize))
          overlayRangeOnCluster(clusterBuf, i, clusterSize, offset, data)
          this.driver.write(diskOffset, clusterBuf)
        }

        if (newSize !== oldSize) {
          this.fileInternals(file).dirEntry.FileSize = newSize
        }
        file.setLastModified(new Date())
        return this.toEntry(file)
      })
      this.invalidateClusterCache(relativePath)
      this.markDirty()
      return entry
    })
  }

  async streamWriteFile(
    relativePath: string,
  ): Promise<{ write(chunk: Uint8Array): Promise<void>; close(): Promise<FatVolumeEntry>; abort(): Promise<void> }> {
    const volume = this
    return this.enqueue(async () => {
      return this.withRoot((root) => {
        const file = root.makeFile(relativePath)
        if (!file) {
          throw new Error('无法写入文件')
        }
        const io = file.open()
        if (!io) {
          throw new Error('无法写入文件')
        }
        const clusterSize = this.clusterSize()
        let pending = new Uint8Array(0)
        let totalWritten = 0
        let aborted = false
        let closed = false

        const flushPending = async (): Promise<void> => {
          if (pending.byteLength === 0) return
          const writeSize = Math.min(clusterSize, pending.byteLength)
          const chunk = pending.subarray(0, writeSize)
          io.writeClus(chunk)
          totalWritten += writeSize
          pending = pending.subarray(writeSize)
          if (pending.byteLength > 0) {
            await flushPending()
          }
        }

        return {
          async write(chunk) {
            if (closed || aborted) return
            const combined = new Uint8Array(pending.byteLength + chunk.byteLength)
            combined.set(pending)
            combined.set(chunk, pending.byteLength)
            pending = combined
            while (pending.byteLength >= clusterSize) {
              const full = pending.subarray(0, clusterSize)
              io.writeClus(full)
              totalWritten += clusterSize
              pending = pending.subarray(clusterSize)
            }
          },
          async close() {
            if (closed || aborted) return volume.toEntry(file)
            closed = true
            await flushPending()
            const node = volume.fileInternals(file)
            node.dirEntry.FileSize = totalWritten + pending.byteLength
            if (pending.byteLength > 0) {
              io.writeClus(pending)
              totalWritten += pending.byteLength
              pending = new Uint8Array(0)
            }
            node.dirEntry.FileSize = totalWritten
            file.setLastModified(new Date())
            volume.invalidateClusterCache(relativePath)
            volume.markDirty()
            return volume.toEntry(file)
          },
          async abort() {
            if (closed) return
            aborted = true
            pending = new Uint8Array(0)
            try {
              io.rewind()
              // writeData with empty data would unlink clusters; instead just truncate via writeFile
              await volume.writeFile(relativePath, new Uint8Array(0))
            } catch {
              // 忽略清理失败
            }
          },
        }
      })
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
      this.markDirty()
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
      this.invalidateClusterCache(relativePath)
      this.markDirty()
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
      this.invalidateClusterCache(fromRelative)
      this.invalidateClusterCache(toRelative)
      this.markDirty()
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
