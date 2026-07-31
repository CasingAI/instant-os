/**
 * 带诊断信息的 IndexedDB transaction 封装。
 * 原生 NotFoundError 不含库名/store；在此补全便于 Console 排查。
 */

function listStoreNames(storeNames: string | string[]): string[] {
  return Array.isArray(storeNames) ? [...storeNames] : [storeNames]
}

export function formatIdbTransactionFailure(
  db: IDBDatabase,
  storeNames: string | string[],
  error: unknown,
): string {
  const requested = listStoreNames(storeNames)
  const available = Array.from(db.objectStoreNames)
  const missing = requested.filter((name) => !available.includes(name))
  return [
    `IndexedDB 事务失败：db=${db.name} version=${db.version}`,
    `请求 store=[${requested.join(', ')}]`,
    missing.length > 0 ? `缺失=[${missing.join(', ')}]` : undefined,
    `现有=[${available.join(', ') || '（空）'}]`,
    error instanceof Error ? error.message : String(error),
  ]
    .filter(Boolean)
    .join(' · ')
}

/** 等价于 db.transaction，失败时抛出带库名/缺失 store 的 Error */
export function beginIdbTransaction(
  db: IDBDatabase,
  storeNames: string | string[],
  mode: IDBTransactionMode,
): IDBTransaction {
  try {
    return db.transaction(storeNames, mode)
  } catch (error) {
    const message = formatIdbTransactionFailure(db, storeNames, error)
    console.error(message)
    throw new Error(message, { cause: error })
  }
}
