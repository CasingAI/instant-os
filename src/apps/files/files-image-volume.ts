/**
 * 磁盘镜像卷的统一能力接口。
 *
 * 挂载层（files-image-mount-store.ts）按镜像的文件系统类型选择实现：
 * FAT12/16/32 走 FatImageVolume（libmount），exFAT 走 ExfatImageVolume。
 * 上层（files-location-image.ts）只依赖该接口，不感知具体文件系统。
 */

export type ImageVolumeEntry = {
  name: string
  kind: 'file' | 'folder'
  byteSize: number
  createdAt: number
  updatedAt: number
}

export type ImageVolumeStreamWriter = {
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<ImageVolumeEntry>
  abort(): Promise<void>
}

export type ImageVolumeStreamOptions = {
  isNew?: boolean
  expectedSize?: number
}

export type ImageVolumeFsInfo = {
  fsType: 'FAT12' | 'FAT16' | 'FAT32' | 'exFAT'
  /** 数据区容量：簇数 × 簇大小（与 Windows/macOS 资源管理器口径一致） */
  totalBytes: number
  usedBytes: number
  freeBytes: number
  clusterBytes: number
}

export type ImageVolume = {
  prepare(): Promise<void>
  flush(): Promise<void>
  close(): Promise<void>
  hasUnflushedSectors(): boolean
  readonly unflushedBytes: number
  readonly residentSectorCount: number
  hasResidentSector(index: number): boolean
  list(relativeDir: string): Promise<ImageVolumeEntry[]>
  stat(relativePath: string): Promise<ImageVolumeEntry | undefined>
  /** 卷容量概况：文件系统类型与总/已用/可用空间；解析失败时抛错 */
  getFsInfo(): Promise<ImageVolumeFsInfo>
  readFile(relativePath: string): Promise<Uint8Array>
  readFileRange(relativePath: string, offset: number, length: number): Promise<Uint8Array>
  writeFile(relativePath: string, data: Uint8Array): Promise<ImageVolumeEntry>
  writeFileRange(relativePath: string, offset: number, data: Uint8Array): Promise<ImageVolumeEntry>
  streamWriteFile(
    relativePath: string,
    options?: ImageVolumeStreamOptions,
  ): Promise<ImageVolumeStreamWriter>
  mkdir(relativePath: string): Promise<ImageVolumeEntry>
  remove(relativePath: string): Promise<void>
  rename(fromRelative: string, toRelative: string): Promise<ImageVolumeEntry>
}
