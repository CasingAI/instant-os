/** localStorage 硬上限 5 MB */
export const DEVICE_CAPACITY_BYTES = 5 * 1024 * 1024

export const STORAGE_CHANGED_EVENT = 'instant-os:storage-changed'

export const GENERATED_APP_DATA_KEY_PREFIX = 'instant-os-generated-app-data:'

export const DEVICE_STORAGE_KEYS = {
  generatedApps: 'instant-os-generated-apps',
  /** 生成应用本体索引：已迁到 Contents 的 appId 列表（轻量） */
  generatedAppsIndex: 'instant-os-generated-apps-index',
  listingDetails: 'instant-os-listing-details',
  listingReviews: 'instant-os-listing-reviews',
  storeListings: 'instant-os-store-listings',
  safariHistory: 'instant-os-safari-history',
  safariBookmarks: 'instant-os-safari-bookmarks',
  safariTokenUsage: 'instant-os-safari-token-usage',
  safariSettings: 'instant-os-safari-settings',
  chromoBookmarks: 'instant-os-chromo-bookmarks',
  chromoSettings: 'instant-os-chromo-settings',
  chromoHistory: 'instant-os-chromo-history',
  chromoSession: 'instant-os-chromo-session',
  mail: 'instant-os-mail',
  news: 'instant-os-news',
  newsTokenUsage: 'instant-os-news-token-usage',
  windowSizes: 'instant-os:window-sizes',
  accountSettings: 'instant-os-account-settings',
  githubCredentials: 'instant-os-github-credentials',
  githubAccountCache: 'instant-os-github-account-cache',
  githubDesktopPrefs: 'instant-os-github-desktop-prefs',
  proxyServerSettings: 'instant-os-proxy-server-settings',
  npmRegistrySettings: 'instant-os-npm-registry-settings',
  packagesAppProjectRoot: 'instant-os-packages-app-project-root',
  displaySettings: 'instant-os-display-settings',
  dateTimeSettings: 'instant-os-date-time-settings',
  dockSettings: 'instant-os-dock-settings',
  wallpaperSettings: 'instant-os-wallpaper-settings',
  experimentalSettings: 'instant-os-experimental-settings',
  startupItemsSettings: 'instant-os-startup-items-settings',
  scene3dLabArchives: 'instant-os-scene3d-lab-archives',
  scene3dLabPrefs: 'instant-os-scene3d-lab-prefs',
  notificationCenterWidgets: 'instant-os-notification-center-widgets',
  notificationCenterSettings: 'instant-os-notification-center-settings',
  systemSoundSettings: 'instant-os-system-sound-settings',
  speechSettings: 'instant-os-speech-settings',
  weather: 'instant-os-weather',
  calendar: 'instant-os-calendar',
  stocks: 'instant-os-stocks',
  catgpt: 'instant-os-catgpt',
  produde: 'instant-os-produde',
  gomoku: 'instant-os-gomoku',
  launcherLayout: 'instant-os-launcher-layout',
  books: 'instant-os-books',
  icodeInternalProjects: 'instant-os-icode-internal-projects',
  icodeProjects: 'instant-os-icode-projects',
  vscodePrefs: 'instant-os-vscode-prefs',
  vscodeSession: 'instant-os-vscode-session',
  vscodeAiChat: 'instant-os-vscode-ai-chat',
  terminalCommandHistory: 'instant-os-terminal-command-history',
  systemDebugLogSettings: 'instant-os-system-debug-log-settings',
  backgroundRefreshSettings: 'instant-os-background-refresh-settings',
  serviceStartupSettings: 'instant-os-service-startup-settings',
  modelPricingCache: 'instant-os-model-pricing-cache',
  openRouterPricingCache: 'instant-os-openrouter-pricing-cache',
  musicLyricOffsets: 'instant-os-music-lyric-offsets',
  musicVolume: 'instant-os-music-volume',
  systemVolume: 'instant-os-system-volume',
  llmPlayground: 'instant-os-llm-playground',
  attunebench: 'instant-os-attunebench',
  welcomeSeen: 'instant-os-welcome-seen',
  modelSourceSettings: 'instant-os-model-source-settings',
} as const

/** Frimousse 表情选择器缓存的 localStorage 键前缀 */
export const FRIMOUSSE_DATA_KEY_PREFIX = 'frimousse/data/'

const ACCOUNTED_STORAGE_KEYS: ReadonlySet<string> = new Set(Object.values(DEVICE_STORAGE_KEYS))

const ACCOUNTED_STORAGE_PREFIXES = [GENERATED_APP_DATA_KEY_PREFIX] as const

const OTHER_STORAGE_LABELS: ReadonlyArray<{ prefix: string; label: string }> = [
  { prefix: FRIMOUSSE_DATA_KEY_PREFIX, label: 'Emoji键盘' },
]

export class DeviceStorageFullError extends Error {
  constructor() {
    super('设备存储空间已满（5 MB 上限）')
    this.name = 'DeviceStorageFullError'
  }
}

function byteSize(value: string): number {
  return new TextEncoder().encode(value).length
}

export function getLocalStorageKeyBytes(key: string): number {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) {
      return 0
    }
    return byteSize(raw)
  } catch {
    return 0
  }
}

export function getTotalLocalStorageBytes(): number {
  try {
    let total = 0
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key) {
        continue
      }
      total += getLocalStorageKeyBytes(key)
    }
    return total
  } catch {
    return 0
  }
}

export function sumLocalStorageKeys(keys: readonly string[]): number {
  return keys.reduce((total, key) => total + getLocalStorageKeyBytes(key), 0)
}

export function sumLocalStorageKeysByPrefix(prefix: string): number {
  try {
    let total = 0
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key?.startsWith(prefix)) {
        total += getLocalStorageKeyBytes(key)
      }
    }
    return total
  } catch {
    return 0
  }
}

export type UnaccountedStorageEntry = {
  key: string
  bytes: number
}

export type OtherStorageEntry = {
  id: string
  label: string
  bytes: number
  detail?: string
}

function otherStorageLabelForKey(key: string): string | undefined {
  return OTHER_STORAGE_LABELS.find((item) => key.startsWith(item.prefix))?.label
}

export function isAccountedStorageKey(key: string): boolean {
  if (ACCOUNTED_STORAGE_KEYS.has(key)) {
    return true
  }

  return ACCOUNTED_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
}

export function listUnaccountedStorageKeys(): UnaccountedStorageEntry[] {
  const entries: UnaccountedStorageEntry[] = []

  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key || isAccountedStorageKey(key)) {
        continue
      }
      entries.push({ key, bytes: getLocalStorageKeyBytes(key) })
    }
  } catch {
    return []
  }

  return entries.sort((left, right) => right.bytes - left.bytes)
}

export function getOtherStorageBytes(): number {
  return listUnaccountedStorageKeys().reduce((total, entry) => total + entry.bytes, 0)
}

export function listOtherStorageEntries(): OtherStorageEntry[] {
  const unaccounted = listUnaccountedStorageKeys()
  const grouped = new Map<string, OtherStorageEntry>()

  for (const entry of unaccounted) {
    const label = otherStorageLabelForKey(entry.key)
    if (label) {
      const existing = grouped.get(label)
      if (existing) {
        existing.bytes += entry.bytes
        existing.detail = existing.detail ? `${existing.detail}, ${entry.key}` : entry.key
      } else {
        grouped.set(label, {
          id: `__other-label:${label}`,
          label,
          bytes: entry.bytes,
          detail: entry.key,
        })
      }
      continue
    }

    grouped.set(entry.key, {
      id: entry.key,
      label: entry.key,
      bytes: entry.bytes,
    })
  }

  return [...grouped.values()].sort((left, right) => right.bytes - left.bytes)
}

export function projectedStorageBytes(key: string, value: string): number {
  const currentTotal = getTotalLocalStorageBytes()
  const previousKeyBytes = getLocalStorageKeyBytes(key)
  return currentTotal - previousKeyBytes + byteSize(value)
}

export function wouldExceedDeviceStorage(key: string, value: string): boolean {
  return projectedStorageBytes(key, value) > DEVICE_CAPACITY_BYTES
}

export function writeLocalStorageItem(key: string, value: string): boolean {
  if (wouldExceedDeviceStorage(key, value)) {
    return false
  }

  try {
    localStorage.setItem(key, value)
    window.dispatchEvent(new CustomEvent(STORAGE_CHANGED_EVENT))
    return true
  } catch {
    return false
  }
}

export function assertDeviceStorageCapacity(key: string, value: string): void {
  if (!writeLocalStorageItem(key, value)) {
    throw new DeviceStorageFullError()
  }
}

export const DEV_SYSTEM_FILL_KEY = 'instant-os-dev-system-fill'

/** 开发者调试：将系统空间写入至硬上限。 */
export function fillSystemStorageToCapacityForDev(): {
  addedBytes: number
  totalBytes: number
} {
  const startTotal = getTotalLocalStorageBytes()
  const existingBytes = getLocalStorageKeyBytes(DEV_SYSTEM_FILL_KEY)
  const valueBudget = DEVICE_CAPACITY_BYTES - (startTotal - existingBytes)

  if (valueBudget <= 0) {
    return { addedBytes: 0, totalBytes: startTotal }
  }

  // 二进制搜索最大可写入长度，避免一次构造过大字符串后被浏览器配额拒绝
  let low = 0
  let high = valueBudget
  let bestValue = ''

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = 'x'.repeat(mid)
    if (wouldExceedDeviceStorage(DEV_SYSTEM_FILL_KEY, candidate)) {
      high = mid - 1
      continue
    }

    try {
      localStorage.setItem(DEV_SYSTEM_FILL_KEY, candidate)
      bestValue = candidate
      low = mid + 1
    } catch {
      high = mid - 1
    }
  }

  if (bestValue) {
    try {
      localStorage.setItem(DEV_SYSTEM_FILL_KEY, bestValue)
    } catch {
      // 已在搜索过程中写入过更小值；忽略最终放大失败
    }
  }

  const totalBytes = getTotalLocalStorageBytes()
  if (totalBytes !== startTotal && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(STORAGE_CHANGED_EVENT))
  }

  return {
    addedBytes: totalBytes - startTotal,
    totalBytes,
  }
}

/** 开发者调试：清除「写满系统空间」产生的填充数据。 */
export function clearDevSystemStorageFill(): void {
  const existingBytes = getLocalStorageKeyBytes(DEV_SYSTEM_FILL_KEY)
  if (existingBytes <= 0) {
    return
  }

  try {
    localStorage.removeItem(DEV_SYSTEM_FILL_KEY)
  } catch {
    return
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(STORAGE_CHANGED_EVENT))
  }
}
