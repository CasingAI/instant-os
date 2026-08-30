/**
 * 磁盘镜像占用：文件挂载与虚拟机互斥。
 * 运行：node --experimental-strip-types src/apps/files/files-disk-image-occupancy.test.ts
 */
import assert from 'node:assert/strict'
import {
  claimDiskImagePath,
  diskImageOccupiedByFilesMountError,
  diskImageOccupiedByVmError,
  diskImageOccupiedForFileOpError,
  findOccupiedDiskImagePathUnder,
  genericDiskImageOccupiedError,
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

function testKnownKindFileOpWordingUnchanged(): void {
  reset()
  const vm = { kind: 'vm' as const, id: 'vm-1' }
  const files = { kind: 'files-mount' as const, id: 'image:win' }
  assert.equal(
    diskImageOccupiedForFileOpError(PATH, vm, '删除'),
    `无法删除 ${PATH}：虚拟机正在使用这份磁盘镜像。请先关机或从虚拟机里去掉这块盘再删除。`,
  )
  assert.equal(
    diskImageOccupiedForFileOpError(PATH, files, '移入废纸篓'),
    `无法移入废纸篓 ${PATH}：这份磁盘镜像正在文件里挂载使用。请先推出镜像卷再移入废纸篓。`,
  )
}

function testThirdPartyOccupantGenericMessaging(): void {
  reset()
  const burner = {
    kind: 'burner',
    id: 'burn-1',
    label: '刻录工具',
    releaseHint: '请先在刻录工具中结束任务',
  }
  claimDiskImagePath(PATH, burner)
  // 同一占用方幂等重入
  claimDiskImagePath(PATH, burner)
  assert.deepEqual(getDiskImageOccupant(PATH), burner)

  // 与内置占用方互斥，冲突文案带第三方展示名与释放建议
  assert.throws(
    () => claimDiskImagePath(PATH, { kind: 'vm', id: 'vm-1' }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === genericDiskImageOccupiedError(PATH, burner),
  )

  // 文件操作守卫走通用文案
  const message = diskImageOccupiedForFileOpError(PATH, burner, '删除')
  assert.ok(message.includes(`无法删除 ${PATH}`), message)
  assert.ok(message.includes('「刻录工具」'), message)
  assert.ok(message.includes('请先在刻录工具中结束任务'), message)
  assert.ok(message.includes('后再删除'), message)

  // 前缀匹配对第三方声明的路径同样生效（删除父文件夹被拦）
  const hit = findOccupiedDiskImagePathUnder('/user/Disks')
  assert.ok(hit && hit.occupant.kind === 'burner')

  releaseDiskImagePathsForOccupant(burner)
  assert.equal(getDiskImageOccupant(PATH), undefined)
}

function testThirdPartyWithoutLabelFallsBackToKind(): void {
  reset()
  const editor = { kind: 'editor', id: 'e1' }
  claimDiskImagePath(PATH, editor)
  assert.throws(
    () => claimDiskImagePath(PATH, { kind: 'files-mount', id: 'image:win' }),
    (error: unknown) => {
      if (!(error instanceof Error)) return false
      // 未提供 label 时回退到 kind 本身，释放建议给通用兜底
      assert.ok(error.message.includes('「editor」'), error.message)
      assert.ok(error.message.includes('请先在使用方（editor）中停止使用'), error.message)
      return true
    },
  )
}

testSameOccupantCanReclaim()
testVmBlocksFilesMount()
testFilesMountBlocksVm()
testReleaseAllowsTheOtherSide()
testReleaseByOccupantClearsAllPaths()
testKnownKindFileOpWordingUnchanged()
testThirdPartyOccupantGenericMessaging()
testThirdPartyWithoutLabelFallsBackToKind()
console.log('files-disk-image-occupancy.test.ts ok')
