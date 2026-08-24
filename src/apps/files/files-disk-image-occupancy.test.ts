/**
 * 磁盘镜像占用：文件挂载与虚拟机互斥。
 * 运行：node --experimental-strip-types src/apps/files/files-disk-image-occupancy.test.ts
 */
import assert from 'node:assert/strict'
import {
  claimDiskImagePath,
  diskImageOccupiedByFilesMountError,
  diskImageOccupiedByVmError,
  getDiskImageOccupant,
  releaseDiskImagePath,
  releaseDiskImagePathsForOccupant,
  resetDiskImageOccupancyForTests,
} from './files-disk-image-occupancy.ts'

const PATH = '/user/Disks/win.img'

function reset(): void {
  resetDiskImageOccupancyForTests()
}

function testSameOccupantCanReclaim(): void {
  reset()
  const occupant = { kind: 'files-mount' as const, id: 'image:win' }
  claimDiskImagePath(PATH, occupant)
  claimDiskImagePath(PATH, occupant)
  assert.deepEqual(getDiskImageOccupant(PATH), occupant)
}

function testVmBlocksFilesMount(): void {
  reset()
  claimDiskImagePath(PATH, { kind: 'vm', id: 'vm-1' })
  assert.throws(
    () => claimDiskImagePath(PATH, { kind: 'files-mount', id: 'image:win' }),
    (error: unknown) =>
      error instanceof Error && error.message === diskImageOccupiedByVmError(PATH),
  )
}

function testFilesMountBlocksVm(): void {
  reset()
  claimDiskImagePath(PATH, { kind: 'files-mount', id: 'image:win' })
  assert.throws(
    () => claimDiskImagePath(PATH, { kind: 'vm', id: 'vm-1' }),
    (error: unknown) =>
      error instanceof Error && error.message === diskImageOccupiedByFilesMountError(PATH),
  )
}

function testReleaseAllowsTheOtherSide(): void {
  reset()
  const files = { kind: 'files-mount' as const, id: 'image:win' }
  claimDiskImagePath(PATH, files)
  releaseDiskImagePath(PATH, files)
  claimDiskImagePath(PATH, { kind: 'vm', id: 'vm-1' })
  assert.equal(getDiskImageOccupant(PATH)?.kind, 'vm')
}

function testReleaseByOccupantClearsAllPaths(): void {
  reset()
  const vm = { kind: 'vm' as const, id: 'vm-1' }
  claimDiskImagePath('/user/a.img', vm)
  claimDiskImagePath('/user/b.img', vm)
  releaseDiskImagePathsForOccupant(vm)
  assert.equal(getDiskImageOccupant('/user/a.img'), undefined)
  assert.equal(getDiskImageOccupant('/user/b.img'), undefined)
}

testSameOccupantCanReclaim()
testVmBlocksFilesMount()
testFilesMountBlocksVm()
testReleaseAllowsTheOtherSide()
testReleaseByOccupantClearsAllPaths()
console.log('files-disk-image-occupancy.test.ts ok')
