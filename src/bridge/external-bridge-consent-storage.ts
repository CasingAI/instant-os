const STORAGE_KEY = 'instant-os-external-bridge-consents'

export const EXTERNAL_BRIDGE_CONSENT_CHANGED_EVENT = 'instant-os-external-bridge-consent-changed'

export type ExternalBridgeConsentRecord = {
  appId: string
  origin: string
  appName?: string
  approvedAt: number
}

type BridgeConsentStore = {
  version: 1
  records: ExternalBridgeConsentRecord[]
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
  window.dispatchEvent(new Event(EXTERNAL_BRIDGE_CONSENT_CHANGED_EVENT))
}

export function listExternalBridgeConsents(): ExternalBridgeConsentRecord[] {
  return [...readStore().records].sort((left, right) => right.approvedAt - left.approvedAt)
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
