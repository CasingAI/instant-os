/**
 * 磁盘工具数据层：挂载卷占用未知（不设 bytes），内置卷仍走 IndexedDB 统计。
 * 挂载卷内容在本机文件夹（File System Access），IndexedDB 口径恒为 0，不代表真实占用。
 * 运行：node --experimental-strip-types src/apps/disk-utility/disk-utility-data.test.ts
 */
import 'fake-indexeddb/auto'
import './../files/files-mount-test-window.ts'
import assert from 'node:assert/strict'
import { addMount, removeMount } from '../files/files-mount-store.ts'
import { createMockMountRoot } from '../files/files-mount-test-fsa.ts'
import { filesCreateBinary } from '../files/files-api.ts'
import { resetFilesDbForTests } from '../files/files-storage.ts'
import { resetImageMountsForTests } from '../files/files-image-mount-store.ts'
import { resetDiskImageOccupancyForTests } from '../files/files-disk-image-occupancy.ts'
import { loadDiskTree, type TreeNode } from './disk-utility-data.ts'

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>()

  get length(): number {
    return this.map.size
  }

  clear(): void {
    this.map.clear()
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.map.delete(key)
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}

;(globalThis as { localStorage?: Storage }).localStorage ??= new MemoryStorage()

function findNode(node: TreeNode, id: string): TreeNode | undefined {
  if (node.id === id) return node
  for (const child of node.children ?? []) {
    const found = findNode(child, id)
    if (found) return found
  }
  return undefined
}

async function testMountVolumeBytesUnknown(): Promise<void> {
  await resetFilesDbForTests()
  resetImageMountsForTests()
  resetDiskImageOccupancyForTests()

  const record = await addMount(createMockMountRoot())
  try {
    // 内置卷放一个文件，确认 IndexedDB 统计口径不受影响
    await filesCreateBinary('/user/notes.txt', new TextEncoder().encode('hello world').buffer)

    const tree = await loadDiskTree()

    const mountContainer = findNode(tree, 'container:mount')
    assert.ok(mountContainer, '存在挂载卷容器')
    assert.equal(mountContainer.bytes, undefined, '挂载卷容器不设 bytes')

    const guest = mountContainer.children?.[0]
    assert.ok(guest, '存在挂载卷节点')
    assert.equal(guest.bytes, undefined, '挂载卷节点不设 bytes')
    assert.equal(guest.label, 'otterflow')
    assert.equal(guest.pathRoot, `/mount/${record.id.slice('mount:'.length)}`)

    const dataSpace = findNode(tree, 'container:builtin')
    assert.ok(dataSpace, '存在数据空间容器')
    assert.equal(typeof dataSpace.bytes, 'number')
    const local = dataSpace.children?.find((child) => child.id === 'local')
    assert.ok(local, '存在用户文件卷')
    assert.ok((local.bytes ?? 0) > 0, '内置卷占用仍由 IndexedDB 统计')
  } finally {
    await removeMount(record.id)
  }
  console.log('ok: mount volume bytes unknown')
}

async function main(): Promise<void> {
  await testMountVolumeBytesUnknown()
  await testNoMountContainerWithoutMounts()
  console.log('disk-utility-data tests passed')
}

async function testNoMountContainerWithoutMounts(): Promise<void> {
  await resetFilesDbForTests()
  resetImageMountsForTests()
  resetDiskImageOccupancyForTests()

  const tree = await loadDiskTree()
  assert.equal(findNode(tree, 'container:mount'), undefined, '无挂载时不渲染挂载卷容器')
  console.log('ok: no mount container without mounts')
}

await main()
