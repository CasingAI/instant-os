/**
 * 数据空间上限配置：默认、升降档、步进与上限 clamp。
 * 运行：node --experimental-strip-types src/os/data-capacity-settings-storage.test.ts
 */
import assert from 'node:assert/strict'
import { DEVICE_STORAGE_KEYS } from './device-storage.ts'
import {
  clampDataCapacityBytes,
  DATA_CAPACITY_MAX_BYTES,
  DATA_CAPACITY_PLAN_BYTES,
  DATA_CAPACITY_STEP_BYTES,
  DEFAULT_DATA_CAPACITY_BYTES,
  listDataCapacityPlans,
  loadDataCapacityBytes,
  saveDataCapacityBytes,
} from './data-capacity-settings-storage.ts'

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
;(globalThis as { window?: EventTarget }).window ??= new EventTarget()

function resetCapacitySettings(): void {
  localStorage.removeItem(DEVICE_STORAGE_KEYS.dataCapacitySettings)
}

{
  resetCapacitySettings()
  assert.equal(loadDataCapacityBytes(), DEFAULT_DATA_CAPACITY_BYTES)
}

{
  resetCapacitySettings()
  const sixteenGb = 16 * 1024 * 1024 * 1024
  assert.equal(saveDataCapacityBytes(sixteenGb), true)
  assert.equal(loadDataCapacityBytes(), sixteenGb)
}

{
  resetCapacitySettings()
  const sixteenGb = 16 * 1024 * 1024 * 1024
  const eightGb = DEFAULT_DATA_CAPACITY_BYTES
  saveDataCapacityBytes(sixteenGb)
  assert.equal(saveDataCapacityBytes(eightGb), true)
  assert.equal(loadDataCapacityBytes(), eightGb)
}

{
  resetCapacitySettings()
  const overMax = DATA_CAPACITY_MAX_BYTES + DATA_CAPACITY_STEP_BYTES
  assert.equal(clampDataCapacityBytes(overMax), DATA_CAPACITY_MAX_BYTES)
}

{
  resetCapacitySettings()
  const misaligned = DEFAULT_DATA_CAPACITY_BYTES + DATA_CAPACITY_STEP_BYTES / 2
  assert.equal(
    clampDataCapacityBytes(misaligned),
    DEFAULT_DATA_CAPACITY_BYTES + DATA_CAPACITY_STEP_BYTES,
  )
}

{
  const gb = 1024 * 1024 * 1024
  assert.deepEqual([...DATA_CAPACITY_PLAN_BYTES], [8 * gb, 16 * gb, 32 * gb, 64 * gb])
  assert.deepEqual(listDataCapacityPlans(8 * gb), [8 * gb, 16 * gb, 32 * gb, 64 * gb])
  assert.deepEqual(listDataCapacityPlans(16 * gb), [8 * gb, 16 * gb, 32 * gb, 64 * gb])
  assert.deepEqual(listDataCapacityPlans(12 * gb), [8 * gb, 12 * gb, 16 * gb, 32 * gb, 64 * gb])
  assert.deepEqual(listDataCapacityPlans(64 * gb), [8 * gb, 16 * gb, 32 * gb, 64 * gb])
}

console.log('data-capacity-settings-storage.test.ts ok')
