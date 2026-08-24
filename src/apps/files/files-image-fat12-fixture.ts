/** 构造最小可挂载的 FAT12 软盘镜像，供测试使用。 */

const SECTOR = 512

function setFat12Entry(fat: Uint8Array, cluster: number, value: number): void {
  const offset = Math.floor((cluster * 3) / 2)
  if ((cluster & 1) === 0) {
    fat[offset] = value & 0xff
    fat[offset + 1] = (fat[offset + 1] & 0xf0) | ((value >> 8) & 0x0f)
  } else {
    fat[offset] = (fat[offset] & 0x0f) | ((value & 0x0f) << 4)
    fat[offset + 1] = (value >> 4) & 0xff
  }
}

export function createFat12Image(sizeBytes = 64 * 1024): Uint8Array {
  if (sizeBytes % SECTOR !== 0) {
    throw new Error('镜像大小必须是扇区整数倍')
  }
  const totalSectors = sizeBytes / SECTOR
  const reservedSectors = 1
  const fatCount = 2
  const rootEntries = 16
  const sectorsPerCluster = 1
  const rootDirSectors = Math.ceil((rootEntries * 32) / SECTOR)
  let fatSectors = 1
  for (;;) {
    const dataSectors = totalSectors - reservedSectors - fatCount * fatSectors - rootDirSectors
    const clusters = Math.floor(dataSectors / sectorsPerCluster)
    const needed = Math.ceil(((clusters + 2) * 3) / 2 / SECTOR)
    if (needed <= fatSectors) break
    fatSectors = needed
  }

  const image = new Uint8Array(sizeBytes)
  image[0] = 0xeb
  image[1] = 0x3c
  image[2] = 0x90
  const oem = new TextEncoder().encode('MSDOS5.0')
  image.set(oem, 3)
  image[11] = SECTOR & 0xff
  image[12] = SECTOR >> 8
  image[13] = sectorsPerCluster
  image[14] = reservedSectors & 0xff
  image[15] = reservedSectors >> 8
  image[16] = fatCount
  image[17] = rootEntries & 0xff
  image[18] = rootEntries >> 8
  if (totalSectors < 0x10000) {
    image[19] = totalSectors & 0xff
    image[20] = totalSectors >> 8
  } else {
    image[19] = 0
    image[20] = 0
    image[32] = totalSectors & 0xff
    image[33] = (totalSectors >> 8) & 0xff
    image[34] = (totalSectors >> 16) & 0xff
    image[35] = (totalSectors >> 24) & 0xff
  }
  image[21] = 0xf8
  image[22] = fatSectors & 0xff
  image[23] = fatSectors >> 8
  image[24] = 32
  image[25] = 0
  image[26] = 2
  image[27] = 0
  image[38] = 0x29
  image[39] = 0x12
  image[40] = 0x34
  image[41] = 0x56
  image[42] = 0x78
  const label = new TextEncoder().encode('NO NAME    ')
  image.set(label, 43)
  const fsType = new TextEncoder().encode('FAT12   ')
  image.set(fsType, 54)
  image[510] = 0x55
  image[511] = 0xaa

  const fat = new Uint8Array(fatSectors * SECTOR)
  setFat12Entry(fat, 0, 0xff8)
  setFat12Entry(fat, 1, 0xfff)
  const fatOffset = reservedSectors * SECTOR
  image.set(fat, fatOffset)
  image.set(fat, fatOffset + fat.byteLength)
  return image
}
