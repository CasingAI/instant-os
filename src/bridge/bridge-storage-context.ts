/** bridge 跨站 iframe 内，经 Storage Access API 获得的非分区 localStorage。 */

let unpartitionedLocalStorage: Storage | undefined

export function getBridgeStorageOverride(): Storage | undefined {
  return unpartitionedLocalStorage
}

export function setBridgeStorageOverride(storage: Storage | undefined): void {
  unpartitionedLocalStorage = storage
}

export function resolveBridgeStorage(): Storage {
  return unpartitionedLocalStorage ?? localStorage
}
