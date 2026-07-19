import {
  DEVICE_CAPACITY_BYTES,
  DEVICE_STORAGE_KEYS,
  GENERATED_APP_DATA_KEY_PREFIX,
  getLocalStorageKeyBytes,
  getTotalLocalStorageBytes,
  isAccountedStorageKey,
} from '../os/device-storage.ts'
import { DATA_CAPACITY_BYTES } from '../os/device-data-storage.ts'
import { formatStorageSize } from '../os/format-storage-size.ts'
import { loadInstalledApps } from '../os/generated-apps-storage.ts'
import {
  getStorageSummary,
  loadDataStorageBreakdown,
} from '../apps/settings/app-storage.ts'

const DEFAULT_MAX_CHARS = 12_000
const HARD_MAX_CHARS = 24_000

/** 禁止返回正文的 localStorage 键（含 API Key 等） */
const BLOCKED_VALUE_KEYS = new Set<string>([DEVICE_STORAGE_KEYS.accountSettings])

const SENSITIVE_FIELD_PATTERN =
  /^(api[_-]?key|password|secret|token|authorization|access[_-]?token|refresh[_-]?token|private[_-]?key)$/i

const KEY_LABELS: Record<string, string> = {
  [DEVICE_STORAGE_KEYS.generatedApps]: '已安装微应用列表',
  [DEVICE_STORAGE_KEYS.listingDetails]: '应用集市详情',
  [DEVICE_STORAGE_KEYS.listingReviews]: '应用集市评论',
  [DEVICE_STORAGE_KEYS.storeListings]: '应用集市列表',
  [DEVICE_STORAGE_KEYS.safariHistory]: '网络浏览器历史',
  [DEVICE_STORAGE_KEYS.safariBookmarks]: '网络浏览器书签',
  [DEVICE_STORAGE_KEYS.safariTokenUsage]: '网络浏览器 AI 用量',
  [DEVICE_STORAGE_KEYS.safariSettings]: '网络浏览器设置',
  [DEVICE_STORAGE_KEYS.mail]: '邮件数据',
  [DEVICE_STORAGE_KEYS.news]: '新闻数据',
  [DEVICE_STORAGE_KEYS.newsTokenUsage]: '新闻 AI 用量',
  [DEVICE_STORAGE_KEYS.windowSizes]: '窗口尺寸记忆',
  [DEVICE_STORAGE_KEYS.accountSettings]: '账户与 API Key（敏感，不可读内容）',
  [DEVICE_STORAGE_KEYS.displaySettings]: '显示设置',
  [DEVICE_STORAGE_KEYS.dateTimeSettings]: '日期与时间设置',
  [DEVICE_STORAGE_KEYS.dockSettings]: '程序坞设置',
  [DEVICE_STORAGE_KEYS.wallpaperSettings]: '壁纸设置',
  [DEVICE_STORAGE_KEYS.experimentalSettings]: '开发者选项',
  [DEVICE_STORAGE_KEYS.scene3dLabArchives]: '3D 实验室档案',
  [DEVICE_STORAGE_KEYS.scene3dLabPrefs]: '3D 实验室偏好',
  [DEVICE_STORAGE_KEYS.notificationCenterWidgets]: '通知中心小组件',
  [DEVICE_STORAGE_KEYS.notificationCenterSettings]: '通知中心设置',
  [DEVICE_STORAGE_KEYS.weather]: '天气数据',
  [DEVICE_STORAGE_KEYS.calendar]: '月历数据',
  [DEVICE_STORAGE_KEYS.stocks]: '股票数据',
  [DEVICE_STORAGE_KEYS.catgpt]: 'CatGPT 对话',
  [DEVICE_STORAGE_KEYS.gomoku]: '五子棋数据',
  [DEVICE_STORAGE_KEYS.launcherLayout]: '桌面布局',
  [DEVICE_STORAGE_KEYS.books]: '书架索引',
  [DEVICE_STORAGE_KEYS.icodeInternalProjects]: 'iCode 工程',
  [DEVICE_STORAGE_KEYS.icodeProjects]: 'iCode 工程（旧键）',
  'instant-os-external-bridge-consents': '外链 AI 授权记录',
}

export type LocalStorageKeyInfo = {
  key: string
  label: string
  bytes: number
  bytesLabel: string
  accounted: boolean
  valueReadable: boolean
  blockedReason?: string
}

export function getLocalStorageKeyLabel(key: string): string {
  return labelForKey(key)
}

function labelForKey(key: string): string {
  const known = KEY_LABELS[key]
  if (known) {
    return known
  }
  if (key.startsWith(GENERATED_APP_DATA_KEY_PREFIX)) {
    const appId = key.slice(GENERATED_APP_DATA_KEY_PREFIX.length)
    return `微应用数据（${appId || '未知'}）`
  }
  if (key.startsWith('frimousse/data/')) {
    return 'Emoji 键盘缓存'
  }
  return '未标注的本地键'
}

function blockedReasonForKey(key: string): string | undefined {
  if (BLOCKED_VALUE_KEYS.has(key)) {
    return '含账户与 API Key，禁止读取内容；仅可查看键名与占用体积'
  }
  return undefined
}

/** 禁止经终端/检查工具直接读写正文的 localStorage 键（含 API Key） */
export function isLocalStorageValueBlocked(key: string): boolean {
  return BLOCKED_VALUE_KEYS.has(key)
}

function listAllLocalStorageKeys(): string[] {
  const keys: string[] = []
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key) {
        keys.push(key)
      }
    }
  } catch {
    return []
  }
  return keys
}

export function listLocalStorageKeyInfos(options?: {
  prefix?: string
  accountedOnly?: boolean
}): LocalStorageKeyInfo[] {
  const prefix = options?.prefix?.trim()
  const accountedOnly = options?.accountedOnly === true

  return listAllLocalStorageKeys()
    .filter((key) => {
      if (prefix && !key.startsWith(prefix)) {
        return false
      }
      if (accountedOnly && !isAccountedStorageKey(key)) {
        return false
      }
      return true
    })
    .map((key) => {
      const blockedReason = blockedReasonForKey(key)
      const bytes = getLocalStorageKeyBytes(key)
      return {
        key,
        label: labelForKey(key),
        bytes,
        bytesLabel: formatStorageSize(bytes),
        accounted: isAccountedStorageKey(key),
        valueReadable: blockedReason === undefined,
        blockedReason,
      }
    })
    .sort((left, right) => right.bytes - left.bytes)
}

function redactSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveFields(item))
  }
  if (typeof value !== 'object' || value === null) {
    return value
  }

  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_FIELD_PATTERN.test(key) && typeof child === 'string') {
      result[key] = child.length > 0 ? `[已隐藏，长度 ${child.length}]` : '[已隐藏]'
      continue
    }
    result[key] = redactSensitiveFields(child)
  }
  return result
}

function redactRawTextSecrets(text: string): string {
  return text
    .replace(
      /("?(?:api[_-]?key|password|secret|access[_-]?token|refresh[_-]?token|private[_-]?key)"?\s*:\s*")([^"]*)(")/gi,
      '$1[已隐藏]$3',
    )
    .replace(/(Bearer\s+)[A-Za-z0-9._\-+=/]+/gi, '$1[已隐藏]')
}

export function readLocalStorageKeyValue(
  key: string,
  options?: { maxChars?: number },
):
  | {
      key: string
      label: string
      bytes: number
      bytesLabel: string
      blocked: true
      reason: string
    }
  | {
      key: string
      label: string
      bytes: number
      bytesLabel: string
      blocked: false
      missing?: true
      parsedJson?: unknown
      value?: string
      truncated: boolean
      maxChars: number
      note?: string
    } {
  const trimmedKey = key.trim()
  const blockedReason = blockedReasonForKey(trimmedKey)
  const bytes = getLocalStorageKeyBytes(trimmedKey)
  const label = labelForKey(trimmedKey)

  if (blockedReason) {
    return {
      key: trimmedKey,
      label,
      bytes,
      bytesLabel: formatStorageSize(bytes),
      blocked: true,
      reason: blockedReason,
    }
  }

  let raw: string | undefined
  try {
    raw = localStorage.getItem(trimmedKey) ?? undefined
  } catch {
    raw = undefined
  }

  if (raw === undefined) {
    return {
      key: trimmedKey,
      label,
      bytes: 0,
      bytesLabel: formatStorageSize(0),
      blocked: false,
      missing: true,
      truncated: false,
      maxChars: DEFAULT_MAX_CHARS,
    }
  }

  const requested =
    typeof options?.maxChars === 'number' && Number.isFinite(options.maxChars)
      ? Math.floor(options.maxChars)
      : DEFAULT_MAX_CHARS
  const maxChars = Math.min(HARD_MAX_CHARS, Math.max(500, requested))

  let parsedJson: unknown
  let note: string | undefined
  try {
    parsedJson = redactSensitiveFields(JSON.parse(raw) as unknown)
    note = '已按 JSON 解析，并对疑似密钥字段做了隐藏'
  } catch {
    parsedJson = undefined
  }

  if (parsedJson !== undefined) {
    const serialized = JSON.stringify(parsedJson, undefined, 2)
    const truncated = serialized.length > maxChars
    return {
      key: trimmedKey,
      label,
      bytes,
      bytesLabel: formatStorageSize(bytes),
      blocked: false,
      parsedJson: truncated ? undefined : parsedJson,
      value: truncated ? `${serialized.slice(0, maxChars)}\n…[已截断]` : serialized,
      truncated,
      maxChars,
      note: truncated
        ? `${note}；内容过长已截断，可用更大 max_chars 或结合源码理解结构`
        : note,
    }
  }

  const redacted = redactRawTextSecrets(raw)
  const truncated = redacted.length > maxChars
  return {
    key: trimmedKey,
    label,
    bytes,
    bytesLabel: formatStorageSize(bytes),
    blocked: false,
    value: truncated ? `${redacted.slice(0, maxChars)}\n…[已截断]` : redacted,
    truncated,
    maxChars,
    note: '非 JSON 文本；已尝试隐藏疑似密钥片段',
  }
}

export async function getStorageUsageSnapshot(): Promise<{
  system: {
    usedBytes: number
    usedLabel: string
    capacityBytes: number
    capacityLabel: string
    availableBytes: number
    availableLabel: string
    usedPercent: number
  }
  data: {
    usedBytes: number
    usedLabel: string
    capacityBytes: number
    capacityLabel: string
    availableBytes: number
    availableLabel: string
    usedPercent: number
    breakdown: {
      safariCacheBytes: number
      safariCacheLabel: string
      booksDataBytes: number
      booksDataLabel: string
      filesBytes: number
      filesLabel: string
      aiUsageBytes: number
      aiUsageLabel: string
      aiEventLogBytes: number
      aiEventLogLabel: string
      folderIconSnapshotsBytes: number
      folderIconSnapshotsLabel: string
      modelVisionBytes: number
      modelVisionLabel: string
    }
  }
  categories: {
    installedAppsAndDataLabel: string
    mailLabel: string
    newsLabel: string
    booksIndexLabel: string
    browserSystemLabel: string
    otherLabel: string
  }
  topApps: Array<{
    id: string
    name: string
    kind: 'builtin' | 'generated'
    totalBytes: number
    totalLabel: string
    documentsBytes: number
    documentsLabel: string
    dataBytes: number
    dataLabel: string
    appSizeBytes: number
    appSizeLabel: string
    versionHistoryBytes: number
    versionHistoryLabel: string
  }>
  note: string
}> {
  const installedApps = loadInstalledApps()
  const dataStorage = await loadDataStorageBreakdown()
  const summary = getStorageSummary(installedApps, dataStorage)
  const systemUsedPercent =
    DEVICE_CAPACITY_BYTES > 0
      ? Math.min(100, Math.round((summary.usedBytes / DEVICE_CAPACITY_BYTES) * 1000) / 10)
      : 0
  const dataUsedPercent =
    DATA_CAPACITY_BYTES > 0
      ? Math.min(100, Math.round((summary.dataUsedBytes / DATA_CAPACITY_BYTES) * 1000) / 10)
      : 0

  const topApps = summary.entries
    .map((entry) => {
      const totalBytes =
        entry.appSizeBytes + entry.documentsBytes + entry.dataBytes + entry.versionHistoryBytes
      return {
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
        totalBytes,
        totalLabel: formatStorageSize(totalBytes),
        documentsBytes: entry.documentsBytes,
        documentsLabel: formatStorageSize(entry.documentsBytes),
        dataBytes: entry.dataBytes,
        dataLabel: formatStorageSize(entry.dataBytes),
        appSizeBytes: entry.appSizeBytes,
        appSizeLabel: formatStorageSize(entry.appSizeBytes),
        versionHistoryBytes: entry.versionHistoryBytes,
        versionHistoryLabel: formatStorageSize(entry.versionHistoryBytes),
      }
    })
    .filter((entry) => entry.totalBytes > 0)
    .slice(0, 16)

  return {
    system: {
      usedBytes: summary.usedBytes,
      usedLabel: formatStorageSize(summary.usedBytes),
      capacityBytes: DEVICE_CAPACITY_BYTES,
      capacityLabel: formatStorageSize(DEVICE_CAPACITY_BYTES),
      availableBytes: summary.availableBytes,
      availableLabel: formatStorageSize(summary.availableBytes),
      usedPercent: systemUsedPercent,
    },
    data: {
      usedBytes: summary.dataUsedBytes,
      usedLabel: formatStorageSize(summary.dataUsedBytes),
      capacityBytes: DATA_CAPACITY_BYTES,
      capacityLabel: formatStorageSize(DATA_CAPACITY_BYTES),
      availableBytes: summary.dataAvailableBytes,
      availableLabel: formatStorageSize(summary.dataAvailableBytes),
      usedPercent: dataUsedPercent,
      breakdown: {
        safariCacheBytes: summary.safariCacheBytes,
        safariCacheLabel: formatStorageSize(summary.safariCacheBytes),
        booksDataBytes: summary.booksDataBytes,
        booksDataLabel: formatStorageSize(summary.booksDataBytes),
        filesBytes: summary.filesBytes,
        filesLabel: formatStorageSize(summary.filesBytes),
        aiUsageBytes: summary.aiUsageBytes,
        aiUsageLabel: formatStorageSize(summary.aiUsageBytes),
        aiEventLogBytes: summary.aiEventLogBytes,
        aiEventLogLabel: formatStorageSize(summary.aiEventLogBytes),
        folderIconSnapshotsBytes: summary.folderIconSnapshotsBytes,
        folderIconSnapshotsLabel: formatStorageSize(summary.folderIconSnapshotsBytes),
        modelVisionBytes: summary.modelVisionBytes,
        modelVisionLabel: formatStorageSize(summary.modelVisionBytes),
      },
    },
    categories: {
      installedAppsAndDataLabel: formatStorageSize(summary.appsBytes),
      mailLabel: formatStorageSize(summary.mailDataBytes),
      newsLabel: formatStorageSize(summary.newsDataBytes),
      booksIndexLabel: formatStorageSize(summary.booksIndexBytes),
      browserSystemLabel: formatStorageSize(summary.browserSystemBytes),
      otherLabel: formatStorageSize(summary.otherBytes),
    },
    topApps,
    note:
      '系统空间=localStorage（约 5MB）；数据空间=IndexedDB（约 150MB，含网页缓存、图书正文、文件应用用户文件、AI 用量与事件日志等）。本工具只读，不能清理或卸载。账户/API Key 内容不可读。',
  }
}

/** 供测试或调试：总字节（localStorage） */
export function getInspectedLocalStorageTotalBytes(): number {
  return getTotalLocalStorageBytes()
}
