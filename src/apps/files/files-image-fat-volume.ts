import { mount } from 'libmount'

const SECTOR = 512
const PREFETCH_MIN = 4096
const WRITE_BEHIND_IDLE_MS = 100
const WRITE_BEHIND_DIRTY_BYTES = 256 * 1024
export const SECTOR_CACHE_MAX_RESIDENT_BYTES = 32 * 1024 * 1024
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

export function adaptFatFileNode(file: FatFile): {
  firstCluster: number
  setLength: (size: number) => void
} {
  const wrapped = file as unknown as { node?: FatFileNode }
  const node = wrapped.node
  if (
    !node ||
    typeof node.fstClus !== 'number' ||
    !node.dirEntry ||
    typeof node.dirEntry.FileSize !== 'number'
  ) {
    throw new Error('无法读取 FAT 文件内部结构：节点形状不符合预期')
  }
  return {
    firstCluster: node.fstClus,
    setLength(size: number) {
      node.dirEntry.FileSize = size
    },
  }
}

export function adaptFatClusterLayout(fs: FatFileSystem): {
  contentOffset: (clusNum: number) => number
  nextCluster: (clusNum: number) => number
} {
  const internals = fs as unknown as {
    getContentOffset?: (clusNum: number) => unknown
    FAT?: { getNextClusNum?: (clusNum: number) => unknown }
  }
  if (typeof internals.getContentOffset !== 'function') {
    throw new Error('无法读取 FAT 卷内部结构：缺少簇内容偏移')
  }
  if (typeof internals.FAT?.getNextClusNum !== 'function') {
    throw new Error('无法读取 FAT 卷内部结构：缺少簇链接口')
  }
  return {
    contentOffset(clusNum: number) {
      const offset = internals.getContentOffset!(clusNum)
      if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0) {
        throw new Error('无法读取 FAT 卷内部结构：簇内容偏移无效')
      }
      return offset
    },
    nextCluster(clusNum: number) {
      const next = internals.FAT!.getNextClusNum!(clusNum)
      if (typeof next !== 'number' || !Number.isFinite(next)) {
        throw new Error('无法读取 FAT 卷内部结构：下一簇号无效')
      }
      return next
    },
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

export class SectorCache {
  private readonly chunks = new Map<number, Uint8Array>()
  private readonly dirty = new Set<number>()
  private readonly capacity: number
  private readonly maxResidentSectors: number

  constructor(capacity: number, maxResidentBytes = SECTOR_CACHE_MAX_RESIDENT_BYTES) {
    this.capacity = capacity
    this.maxResidentSectors = Math.max(1, Math.floor(maxResidentBytes / SECTOR))
  }

  get residentSectorCount(): number {
    return this.chunks.size
  }

  get dirtySectorCount(): number {
    return this.dirty.size
  }

  hasSector(index: number): boolean {
    return this.chunks.has(index)
  }

  private touch(index: number): void {
    const chunk = this.chunks.get(index)
    if (!chunk) return
    this.chunks.delete(index)
    this.chunks.set(index, chunk)
  }

  private evictClean(protectFrom?: number, protectTo?: number): void {
    if (this.chunks.size <= this.maxResidentSectors) return
    for (const index of [...this.chunks.keys()]) {
      if (this.chunks.size <= this.maxResidentSectors) return
      if (this.dirty.has(index)) continue
      if (
        protectFrom !== undefined &&
        protectTo !== undefined &&
        index >= protectFrom &&
        index <= protectTo
      ) {
        continue
      }
      this.chunks.delete(index)
    }
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
      this.touch(index)
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
      this.touch(index)
      cursor += take
      source += take
      remaining -= take
    }
    this.evictClean()
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
    const requestedBegin = Math.floor(begin / SECTOR)
    const requestedLast = Math.floor((Math.min(this.capacity, offset + Math.max(length, 1)) - 1) / SECTOR)
    this.evictClean(requestedBegin, requestedLast)
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
    this.evictClean()
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

  constructor(io: ImageDiskIo, options?: { maxResidentBytes?: number }) {
    this.io = io
    this.cache = new SectorCache(io.size, options?.maxResidentBytes)
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

  private clusterLayout() {
    return adaptFatClusterLayout(this.ensureMounted())
  }

  private clusterSize(): number {
    return this.ensureMounted().getSizeOfCluster()
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
    const layout = this.clusterLayout()
    const maxClus = this.ensureMounted().getCountOfClusters() + 1
    const node = adaptFatFileNode(file)
    const chain: number[] = []
    let clus = node.firstCluster
    while (clus >= 2 && clus <= maxClus && chain.length <= maxClus) {
      chain.push(clus)
      const next = layout.nextCluster(clus)
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

  private noteDirtyCache(): void {
    if (this.cache.dirtyBytes() > 0) this.markDirty()
  }

  hasUnflushedSectors(): boolean {
    return this.cache.dirtyBytes() > 0
  }

  get residentSectorCount(): number {
    return this.cache.residentSectorCount
  }

  private async flushIfNeeded(): Promise<void> {
    if (!this.dirty && this.cache.dirtyBytes() === 0) return
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    await this.flushNow()
  }

  private async flushNow(): Promise<void> {
    await this.enqueue(async () => {
      try {
        await this.cache.flush(this.io)
        if (this.cache.dirtyBytes() === 0) {
          this.dirty = false
        }
      } catch (error) {
        this.dirty = true
        throw error
      }
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
    if (this.cache.dirtyBytes() > 0) {
      await this.flushNow()
    }
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

        const io = file.open()
        if (!io) throw new Error('无法读取文件')
        io.rewind()
        const startCluster = Math.floor(start / clusterSize)
        const endCluster = Math.floor((start + want - 1) / clusterSize)
        for (let i = 0; i < startCluster; i += 1) {
          if (io.skipClus() === 0) return new Uint8Array(0)
        }
        const out = new Uint8Array((endCluster - startCluster + 1) * clusterSize)
        let cursor = 0
        for (let i = startCluster; i <= endCluster; i += 1) {
          const buf = new Uint8Array(clusterSize)
          const n = io.readClus(buf)
          if (n === 0) break
          out.set(buf.subarray(0, n), cursor)
          cursor += n
        }
        const sliceStart = start % clusterSize
        return out.subarray(sliceStart, Math.min(sliceStart + want, cursor))
      })
    })
  }

  async writeFile(relativePath: string, data: Uint8Array): Promise<FatVolumeEntry> {
    return this.enqueue(async () => {
      try {
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
        return entry
      } finally {
        this.noteDirtyCache()
      }
    })
  }

  async writeFileRange(relativePath: string, offset: number, data: Uint8Array): Promise<FatVolumeEntry> {
    return this.enqueue(async () => {
      try {
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
          const layout = this.clusterLayout()
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
            const diskOffset = layout.contentOffset(clus)
            const clusterBuf = new Uint8Array(clusterSize)
            clusterBuf.set(this.driver.read(diskOffset, clusterSize))
            overlayRangeOnCluster(clusterBuf, i, clusterSize, offset, data)
            this.driver.write(diskOffset, clusterBuf)
          }

          if (newSize !== oldSize) {
            adaptFatFileNode(file).setLength(newSize)
          }
          file.setLastModified(new Date())
          return this.toEntry(file)
        })
        this.invalidateClusterCache(relativePath)
        return entry
      } finally {
        this.noteDirtyCache()
      }
    })
  }

  async streamWriteFile(
    relativePath: string,
    options?: { isNew?: boolean; expectedSize?: number },
  ): Promise<{ write(chunk: Uint8Array): Promise<void>; close(): Promise<FatVolumeEntry>; abort(): Promise<void> }> {
    const isNew = options?.isNew === true
    const expectedSize = options?.expectedSize
    type Opened = NonNullable<ReturnType<FatFile['open']>>
    const state: {
      file: FatFile | undefined
      io: Opened | undefined
      clusterSize: number
      pending: Uint8Array
      totalWritten: number
      aborted: boolean
      closed: boolean
    } = {
      file: undefined,
      io: undefined,
      clusterSize: 0,
      pending: new Uint8Array(0),
      totalWritten: 0,
      aborted: false,
      closed: false,
    }

    const start = async (): Promise<void> => {
      if (state.file && state.io) return
      await this.withRoot((root) => {
        const file = root.makeFile(relativePath)
        if (!file) throw new Error('无法写入文件')
        if (!isNew) {
          // 覆盖已有文件：打开阶段立即截断原内容。
          // 若后续 write/close 前调用 abort()，文件会保持为空；调用方应自行保证可接受此语义。
          const trunc = file.open()
          if (!trunc) throw new Error('无法写入文件')
          trunc.writeData(new Uint8Array(0))
        }
        const io = file.open()
        if (!io) throw new Error('无法写入文件')
        const clusterSize = this.clusterSize()
        if (expectedSize !== undefined && expectedSize > 0) {
          const zeros = new Uint8Array(clusterSize)
          const needed = Math.ceil(expectedSize / clusterSize)
          for (let i = 0; i < needed; i += 1) {
            const writeLen = Math.min(clusterSize, Math.max(1, expectedSize - i * clusterSize))
            if (io.writeClus(zeros.subarray(0, writeLen)) === 0) {
              throw new Error('磁盘空间不足')
            }
          }
          io.rewind()
        }
        state.file = file
        state.io = io
        state.clusterSize = clusterSize
      })
      this.noteDirtyCache()
    }

    await this.enqueue(async () => {
      await start()
    })

    return {
      write: (chunk) =>
        this.enqueue(async () => {
          if (state.closed || state.aborted) return
          try {
            await this.withSectors(async () => {
              await start()
              const io = state.io
              if (!io) throw new Error('无法写入文件')
              const combined = new Uint8Array(state.pending.byteLength + chunk.byteLength)
              combined.set(state.pending)
              combined.set(chunk, state.pending.byteLength)
              state.pending = combined
              while (state.pending.byteLength >= state.clusterSize) {
                const full = state.pending.subarray(0, state.clusterSize)
                if (io.writeClus(full) === 0) throw new Error('磁盘空间不足')
                state.totalWritten += state.clusterSize
                state.pending = state.pending.subarray(state.clusterSize)
              }
            })
          } finally {
            this.noteDirtyCache()
          }
        }),
      close: () =>
        this.enqueue(async () => {
          if (state.closed || state.aborted) {
            if (!state.file) throw new Error('无法写入文件')
            return this.toEntry(state.file)
          }
          state.closed = true
          try {
            await this.withSectors(async () => {
              await start()
              const file = state.file
              const io = state.io
              if (!file || !io) throw new Error('无法写入文件')
              while (state.pending.byteLength > 0) {
                const writeSize = Math.min(state.clusterSize, state.pending.byteLength)
                const piece = state.pending.subarray(0, writeSize)
                if (io.writeClus(piece) === 0) throw new Error('磁盘空间不足')
                state.totalWritten += writeSize
                state.pending = state.pending.subarray(writeSize)
              }
              adaptFatFileNode(file).setLength(state.totalWritten)
              file.setLastModified(new Date())
            })
            this.invalidateClusterCache(relativePath)
            if (!state.file) throw new Error('无法写入文件')
            return this.toEntry(state.file)
          } finally {
            this.noteDirtyCache()
          }
        }),
      abort: () =>
        this.enqueue(async () => {
          if (state.closed) return
          state.aborted = true
          state.pending = new Uint8Array(0)
          try {
            await this.withRoot((root) => {
              const file = state.file ?? root.getFile(relativePath)
              if (!file) return
              const io = file.open()
              io?.writeData(new Uint8Array(0))
              if (isNew) file.delete()
            })
            this.invalidateClusterCache(relativePath)
          } finally {
            this.noteDirtyCache()
          }
        }),
    }
  }

  async mkdir(relativePath: string): Promise<FatVolumeEntry> {
    return this.enqueue(async () => {
      try {
        const entry = await this.withRoot((root) => {
          const dir = root.makeDir(relativePath)
          if (!dir) {
            throw new Error('无法创建文件夹')
          }
          return this.toEntry(dir)
        })
        return entry
      } finally {
        this.noteDirtyCache()
      }
    })
  }

  async remove(relativePath: string): Promise<void> {
    await this.enqueue(async () => {
      try {
        await this.withRoot((root) => {
          const file = root.getFile(relativePath)
          if (!file) {
            throw new Error('项目不存在')
          }
          file.delete()
        })
        this.invalidateClusterCache(relativePath)
      } finally {
        this.noteDirtyCache()
      }
    })
  }

  async rename(fromRelative: string, toRelative: string): Promise<FatVolumeEntry> {
    return this.enqueue(async () => {
      try {
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
        return entry
      } finally {
        this.noteDirtyCache()
      }
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
