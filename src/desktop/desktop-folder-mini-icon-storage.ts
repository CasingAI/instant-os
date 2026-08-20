import { osNowMs } from '../os/os-clock.ts'
import {
  wouldExceedDataCapacity,
  DATA_META_STORE,
  DATA_STORAGE_CHANGED_EVENT,
  FOLDER_ICON_SNAPSHOTS_STORE,
  runDataStoreTransaction,
} from '../os/device-data-storage.ts'

export type FolderIconSnapshotRecord = {
  key: string
  dataUrl: string
  byteSize: number
  updatedAt: number
}

function estimateSnapshotBytes(dataUrl: string): number {
  return new TextEncoder().encode(dataUrl).length
}

async function readByteTotal(): Promise<number> {
  try {
    const meta = await runDataStoreTransaction<{ totalBytes?: number } | undefined>(
      DATA_META_STORE,
      'readonly',
      (store) => store.get('byte-total'),
    )
    return meta?.totalBytes ?? 0
  } catch {
    return 0
  }
}

async function writeByteTotal(totalBytes: number): Promise<void> {
  await runDataStoreTransaction(DATA_META_STORE, 'readwrite', (store) =>
    store.put({ key: 'byte-total', totalBytes }),
  )
}

function emitDataStorageChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DATA_STORAGE_CHANGED_EVENT))
  }
}

export async function getFolderIconSnapshot(key: string): Promise<string | undefined> {
  try {
    const record = await runDataStoreTransaction<FolderIconSnapshotRecord | undefined>(
      FOLDER_ICON_SNAPSHOTS_STORE,
      'readonly',
      (store) => store.get(key),
    )
    return record?.dataUrl
  } catch {
    return undefined
  }
}

export async function getAllFolderIconSnapshots(): Promise<FolderIconSnapshotRecord[]> {
  try {
    return await runDataStoreTransaction<FolderIconSnapshotRecord[]>(
      FOLDER_ICON_SNAPSHOTS_STORE,
      'readonly',
      (store) => store.getAll(),
    )
  } catch {
    return []
  }
}

export async function putFolderIconSnapshot(key: string, dataUrl: string): Promise<boolean> {
  try {
    const existing = await runDataStoreTransaction<FolderIconSnapshotRecord | undefined>(
      FOLDER_ICON_SNAPSHOTS_STORE,
      'readonly',
      (store) => store.get(key),
    )
    const byteSize = estimateSnapshotBytes(dataUrl)
    const currentTotal = await readByteTotal()
    const projectedTotal = currentTotal - (existing?.byteSize ?? 0) + byteSize

    if (await wouldExceedDataCapacity(projectedTotal)) {
      return false
    }

    const record: FolderIconSnapshotRecord = {
      key,
      dataUrl,
      byteSize,
      updatedAt: osNowMs(),
    }

    await runDataStoreTransaction(FOLDER_ICON_SNAPSHOTS_STORE, 'readwrite', (store) =>
      store.put(record),
    )
    await writeByteTotal(projectedTotal)
    emitDataStorageChanged()
    return true
  } catch {
    return false
  }
}

export async function deleteFolderIconSnapshot(key: string): Promise<void> {
  try {
    const existing = await runDataStoreTransaction<FolderIconSnapshotRecord | undefined>(
      FOLDER_ICON_SNAPSHOTS_STORE,
      'readonly',
      (store) => store.get(key),
    )
    if (!existing) {
      return
    }

    await runDataStoreTransaction(FOLDER_ICON_SNAPSHOTS_STORE, 'readwrite', (store) =>
      store.delete(key),
    )
    const currentTotal = await readByteTotal()
    await writeByteTotal(Math.max(0, currentTotal - existing.byteSize))
    emitDataStorageChanged()
  } catch {
    // ignore
  }
}

export async function deleteFolderIconSnapshotsForApp(appId: string): Promise<void> {
  try {
    const records = await runDataStoreTransaction<FolderIconSnapshotRecord[]>(
      FOLDER_ICON_SNAPSHOTS_STORE,
      'readonly',
      (store) => store.getAll(),
    )
    const matches = records.filter((record) => record.key.includes(`:${appId}`))
    if (matches.length === 0) {
      return
    }

    const freedBytes = matches.reduce((total, record) => total + record.byteSize, 0)
    await runDataStoreTransaction(FOLDER_ICON_SNAPSHOTS_STORE, 'readwrite', (store) => {
      for (const record of matches) {
        store.delete(record.key)
      }
      return store.count()
    })

    const currentTotal = await readByteTotal()
    await writeByteTotal(Math.max(0, currentTotal - freedBytes))
    emitDataStorageChanged()
  } catch {
    // ignore
  }
}
