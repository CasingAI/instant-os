/**
 * 磁盘镜像占用：文件挂载与虚拟机互斥（含 Web Locks 跨页签层）。
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
const WEB_LOCK_NAME = `instant-vm-disk:${PATH}`

/**
 * Web Locks mock：同源语义简化为按名字互斥，锁被持有直到 claim 回调返回的
 * promise resolve（与真实 API 一致，模块靠长持锁 promise 占住锁）。
 */
function installWebLocksMock(): {
  /** 模拟另一个窗口拿锁：拿到（回调立即返回释放）返回 true，被占用返回 false */
  tryLockFromOtherWindow: (name: string) => Promise<boolean>
  isHeld: (name: string) => boolean
} {
  const held = new Set<string>()
  const manager = {
    request(
      name: string,
      options: { mode: 'exclusive'; ifAvailable: true },
      callback: (lock: unknown) => Promise<void> | void,
    ): Promise<unknown> {
      if (options.ifAvailable && held.has(name)) {
        return Promise.resolve().then(() => callback(null))
      }
      held.add(name)
      return Promise.resolve().then(async () => {
        try {
          await callback({ name, mode: options.mode })
          return undefined
        } finally {
          held.delete(name)
        }
      })
    },
  }
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: { locks: manager },
  })
  return {
    async tryLockFromOtherWindow(name: string) {
      let acquired = false
      await manager.request(name, { mode: 'exclusive', ifAvailable: true }, (lock) => {
        acquired = lock !== null
      })
      return acquired
    },
    isHeld: (name: string) => held.has(name),
  }
}

function uninstallWebLocksMock(): void {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: {},
  })
}

function reset(): void {
  resetDiskImageOccupancyForTests()
}

async function testSameOccupantCanReclaim(): Promise<void> {
  reset()
  const occupant = { kind: 'files-mount' as const, id: 'image:win' }
  await claimDiskImagePath(PATH, occupant)
  await claimDiskImagePath(PATH, occupant)
  assert.deepEqual(getDiskImageOccupant(PATH), occupant)
}

async function testVmBlocksFilesMount(): Promise<void> {
  reset()
  await claimDiskImagePath(PATH, { kind: 'vm', id: 'vm-1' })
  await assert.rejects(
    () => claimDiskImagePath(PATH, { kind: 'files-mount', id: 'image:win' }),
    (error: unknown) =>
      error instanceof Error && error.message === diskImageOccupiedByVmError(PATH),
  )
}

async function testFilesMountBlocksVm(): Promise<void> {
  reset()
  await claimDiskImagePath(PATH, { kind: 'files-mount', id: 'image:win' })
  await assert.rejects(
    () => claimDiskImagePath(PATH, { kind: 'vm', id: 'vm-1' }),
    (error: unknown) =>
      error instanceof Error && error.message === diskImageOccupiedByFilesMountError(PATH),
  )
}

async function testReleaseAllowsTheOtherSide(): Promise<void> {
  reset()
  const files = { kind: 'files-mount' as const, id: 'image:win' }
  await claimDiskImagePath(PATH, files)
  releaseDiskImagePath(PATH, files)
  await claimDiskImagePath(PATH, { kind: 'vm', id: 'vm-1' })
  assert.equal(getDiskImageOccupant(PATH)?.kind, 'vm')
}

async function testReleaseByOccupantClearsAllPaths(): Promise<void> {
  reset()
  const vm = { kind: 'vm' as const, id: 'vm-1' }
  await claimDiskImagePath('/user/a.img', vm)
  await claimDiskImagePath('/user/b.img', vm)
  releaseDiskImagePathsForOccupant(vm)
  assert.equal(getDiskImageOccupant('/user/a.img'), undefined)
  assert.equal(getDiskImageOccupant('/user/b.img'), undefined)
}

function testKnownKindFileOpWordingUnchanged(): void {
  reset()
  const vm = { kind: 'vm', id: 'vm-1' }
  const files = { kind: 'files-mount', id: 'image:win' }
  assert.equal(
    diskImageOccupiedForFileOpError(PATH, vm, '删除'),
    `无法删除 ${PATH}：虚拟机正在使用这份磁盘镜像。请先关机或从虚拟机里去掉这块盘再删除。`,
  )
  assert.equal(
    diskImageOccupiedForFileOpError(PATH, files, '移入废纸篓'),
    `无法移入废纸篓 ${PATH}：这份磁盘镜像正在文件里挂载使用。请先推出镜像卷再移入废纸篓。`,
  )
}

async function testThirdPartyOccupantGenericMessaging(): Promise<void> {
  reset()
  const burner = {
    kind: 'burner',
    id: 'burn-1',
    label: '刻录工具',
    releaseHint: '请先在刻录工具中结束任务',
  }
  await claimDiskImagePath(PATH, burner)
  // 同一占用方幂等重入
  await claimDiskImagePath(PATH, burner)
  assert.deepEqual(getDiskImageOccupant(PATH), burner)

  // 与内置占用方互斥，冲突文案带第三方展示名与释放建议
  await assert.rejects(
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

async function testThirdPartyWithoutLabelFallsBackToKind(): Promise<void> {
  reset()
  const editor = { kind: 'editor', id: 'e1' }
  await claimDiskImagePath(PATH, editor)
  await assert.rejects(
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

async function testClaimHoldsWebLockUntilRelease(): Promise<void> {
  const mock = installWebLocksMock()
  try {
    reset()
    const vm = { kind: 'vm' as const, id: 'vm-1' }
    await claimDiskImagePath(PATH, vm)
    assert.equal(mock.isHeld(WEB_LOCK_NAME), true, 'claim 后跨页签锁应被持有')
    // 另一个窗口拿不到这把锁
    assert.equal(await mock.tryLockFromOtherWindow(WEB_LOCK_NAME), false)
    releaseDiskImagePath(PATH, vm)
    // 释放经微任务链传播到 mock 的锁登记，先排空再断言
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(mock.isHeld(WEB_LOCK_NAME), false, 'release 后跨页签锁应让出')
    assert.equal(await mock.tryLockFromOtherWindow(WEB_LOCK_NAME), true)
  } finally {
    uninstallWebLocksMock()
    reset()
  }
}

async function testClaimFailsWhenOtherWindowHoldsLock(): Promise<void> {
  const mock = installWebLocksMock()
  try {
    reset()
    // 模拟另一个窗口长持锁不放手
    let foreignRelease = () => undefined
    const manager = (globalThis as { navigator: { locks: { request: Function } } }).navigator.locks
    const foreign = manager.request(
      WEB_LOCK_NAME,
      { mode: 'exclusive', ifAvailable: true },
      () =>
        new Promise<void>((resolve) => {
          foreignRelease = resolve
        }),
    )
    await assert.rejects(
      () => claimDiskImagePath(PATH, { kind: 'vm', id: 'vm-2' }),
      /已被另一个窗口占用/,
    )
    // 内存表也不能留下半份声明
    assert.equal(getDiskImageOccupant(PATH), undefined)
    foreignRelease()
    await foreign
    // 锁让出后本窗口可以正常 claim
    const vm = { kind: 'vm' as const, id: 'vm-1' }
    await claimDiskImagePath(PATH, vm)
    assert.equal(mock.isHeld(WEB_LOCK_NAME), true)
    releaseDiskImagePath(PATH, vm)
  } finally {
    uninstallWebLocksMock()
    reset()
  }
}

async function testClaimDegradesWithoutWebLocks(): Promise<void> {
  installWebLocksMock()
  try {
    // navigator.locks 缺失（非安全上下文）：退化为仅内存互斥，claim 照常成功
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      writable: true,
      value: {},
    })
    reset()
    const vm = { kind: 'vm' as const, id: 'vm-1' }
    await claimDiskImagePath(PATH, vm)
    assert.deepEqual(getDiskImageOccupant(PATH), vm)
    releaseDiskImagePath(PATH, vm)
  } finally {
    uninstallWebLocksMock()
    reset()
  }
}

await testSameOccupantCanReclaim()
await testVmBlocksFilesMount()
await testFilesMountBlocksVm()
await testReleaseAllowsTheOtherSide()
await testReleaseByOccupantClearsAllPaths()
testKnownKindFileOpWordingUnchanged()
await testThirdPartyOccupantGenericMessaging()
await testThirdPartyWithoutLabelFallsBackToKind()
await testClaimHoldsWebLockUntilRelease()
await testClaimFailsWhenOtherWindowHoldsLock()
await testClaimDegradesWithoutWebLocks()
console.log('files-disk-image-occupancy.test.ts ok')
