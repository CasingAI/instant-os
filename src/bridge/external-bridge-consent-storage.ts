const STORAGE_KEY = 'instant-os-external-bridge-consents'

type BridgeConsentRecord = {
  appId: string
  origin: string
  appName?: string
  approvedAt: number
}

type BridgeConsentStore = {
  version: 1
  records: BridgeConsentRecord[]
}

function readStore(): BridgeConsentStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return { version: 1, records: [] }
    }

    const parsed = JSON.parse(raw) as BridgeConsentStore
    if (parsed.version !== 1 || !Array.isArray(parsed.records)) {
      return { version: 1, records: [] }
    }

    return parsed
  } catch {
    return { version: 1, records: [] }
  }
}

function writeStore(store: BridgeConsentStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

export function hasExternalBridgeConsent(appId: string, origin: string): boolean {
  return readStore().records.some((record) => record.appId === appId && record.origin === origin)
}

export function grantExternalBridgeConsent(
  appId: string,
  origin: string,
  appName?: string,
): void {
  const store = readStore()
  const nextRecords = store.records.filter(
    (record) => !(record.appId === appId && record.origin === origin),
  )

  nextRecords.push({
    appId,
    origin,
    appName: appName?.trim() || undefined,
    approvedAt: Date.now(),
  })

  writeStore({
    version: 1,
    records: nextRecords,
  })
}

export function revokeExternalBridgeConsent(appId: string, origin: string): void {
  const store = readStore()
  writeStore({
    version: 1,
    records: store.records.filter(
      (record) => !(record.appId === appId && record.origin === origin),
    ),
  })
}
