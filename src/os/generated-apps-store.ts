/**
 * 生成应用本体存储中枢：内存缓存 + localStorage 索引 + 一次性迁移。
 * 已安装生成应用的本体存于 /Applications/{appBundleDirName(appId)}/Contents 真实文件，
 * localStorage 只保留 appId 索引（instant-os-generated-apps-index）。
 * 同步读取走内存缓存；写入异步到 files 层；启动时 hydrate 到内存。
 */
import {
  DEVICE_STORAGE_KEYS,
  getLocalStorageKeyBytes,
  writeLocalStorageItem,
} from './device-storage.ts'
import type {
  AppCapabilityTag,
} from '../apps/appstore/app-capability-tags.ts'
import type {
  GeneratedAppRecord,
  GeneratedAppVersionSnapshot,
} from '../apps/appstore/types.ts'
import {
  migrateAppRecord,
  normalizeVersionSnapshots,
} from '../apps/appstore/generated-app-versions.ts'
import {
  deleteGeneratedAppVersionFile,
  getGeneratedAppContentsBytes,
  readGeneratedAppHtmlFile,
  readGeneratedAppManifest,
  removeGeneratedAppContents,
  writeGeneratedAppHtmlFile,
  writeGeneratedAppManifest,
  type GeneratedAppManifest,
} from './generated-apps-files.ts'
import {
  getMaxFormalVersionNumber,
  readVersionManifest,
  readVersionsPackageIndex,
  removeGeneratedAppBundle,
} from './generated-app-versions-layout.ts'

const INDEX_KEY = DEVICE_STORAGE_KEYS.generatedAppsIndex
const LEGACY_KEY = DEVICE_STORAGE_KEYS.generatedApps

/** 内存缓存：appId → 完整 record（含 html 与版本历史） */
let cache = new Map<string, GeneratedAppRecord>()
let hydrated = false

// ---- 索引（localStorage 轻量 appId 列表） ----

function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string')
  } catch {
    return []
  }
}

function writeIndex(ids: readonly string[]): boolean {
  return writeLocalStorageItem(INDEX_KEY, JSON.stringify(ids))
}

/** 生成应用本体索引的 localStorage 字节 */
export function getGeneratedAppIndexBytes(): number {
  return getLocalStorageKeyBytes(INDEX_KEY)
}

/** 旧 localStorage 大键剩余字节（迁移未完成前计入，迁移后为 0） */
export function getLegacyGeneratedAppBytes(): number {
  return getLocalStorageKeyBytes(LEGACY_KEY)
}

/** 该生成应用本体是否已迁到 files Contents（索引命中即视为已迁移） */
export function isGeneratedAppBundleStored(appId: string): boolean {
  return readIndex().includes(appId)
}

// ---- Contents 读写 ----

function manifestVersions(record: GeneratedAppRecord): GeneratedAppVersionSnapshot[] {
  return normalizeVersionSnapshots(record)
}

function manifestFromRecord(
  record: GeneratedAppRecord,
  versions: GeneratedAppVersionSnapshot[],
): GeneratedAppManifest {
  return {
    format: 'instant-os-generated-app',
    id: record.id,
    name: record.name,
    description: record.description,
    category: record.category,
    iconEmoji: record.iconEmoji,
    themeColor: record.themeColor,
    tags: record.tags,
    version: record.version ?? versions[versions.length - 1]?.version ?? 'V1',
    pendingUpdate: record.pendingUpdate,
    icodeProjectId: record.icodeProjectId,
    versions: versions.map((snap) => ({ version: snap.version, savedAt: snap.savedAt })),
  }
}

/** 把单个应用 record 全量落盘到 Contents（差分写版本 html）。 */
async function persistAppContents(record: GeneratedAppRecord): Promise<void> {
  // 版本文件夹布局（iCode 管理）：本体由版本布局模块管理，这里只保留索引注册
  if (record.versionsLayout) return

  const prev = cache.get(record.id)
  const prevVersions = prev ? manifestVersions(prev) : []
  const versions = manifestVersions(record)

  for (const snap of versions) {
    const prevSnap = prevVersions.find((item) => item.version === snap.version)
    if (prevSnap && prevSnap.html === snap.html) continue
    await writeGeneratedAppHtmlFile(record.id, snap.version, snap.html)
  }

  const nextVersionSet = new Set(versions.map((snap) => snap.version))
  for (const prevSnap of prevVersions) {
    if (!nextVersionSet.has(prevSnap.version)) {
      await deleteGeneratedAppVersionFile(record.id, prevSnap.version)
    }
  }

  await writeGeneratedAppManifest(record.id, manifestFromRecord(record, versions))
}

/**
 * 版本文件夹布局（iCode 管理）：从包内重建运行时记录。
 * 桌面身份只认当前最大正式版文件夹里那份清单；尚无正式版时用包级出生占位身份。
 */
async function loadVersionsLayoutRecord(
  appId: string,
): Promise<GeneratedAppRecord | undefined> {
  const index = await readVersionsPackageIndex(appId)
  const max = await getMaxFormalVersionNumber(appId)
  const manifest = max === undefined ? undefined : await readVersionManifest(appId, max)

  if (max === undefined && !index?.placeholder) {
    return undefined
  }

  const identity =
    manifest ??
    (index?.placeholder
      ? {
          name: index.placeholder.name,
          description: index.placeholder.description,
          category: index.placeholder.category,
          iconEmoji: index.placeholder.iconEmoji,
          themeColor: index.placeholder.themeColor,
          tags: [] as AppCapabilityTag[],
        }
      : undefined)

  return {
    id: appId as `gen:${string}`,
    name: identity?.name ?? index?.placeholder?.name ?? '未命名应用',
    description: identity?.description ?? '',
    category: identity?.category ?? '实用工具',
    iconEmoji: identity?.iconEmoji ?? '📦',
    themeColor: identity?.themeColor ?? '#5856d6',
    tags: identity?.tags ?? [],
    html: '',
    version: max === undefined ? '1' : String(max),
    icodeProjectId: index?.icodeProjectId,
    versionsLayout: true,
    activeVersion: max ?? 0,
  }
}

/** 从 Contents 读取单个应用完整 record；缺失返回 undefined */
async function loadAppContents(appId: string): Promise<GeneratedAppRecord | undefined> {
  const manifest = await readGeneratedAppManifest(appId)
  if (!manifest) {
    // 包级索引（极轻、无 name 等字段，过不了完整清单校验）或索引损坏：
    // 按版本文件夹布局识别（readVersionsPackageIndex 自己解析 Contents/manifest.json）
    return loadVersionsLayoutRecord(appId)
  }

  const versions: GeneratedAppVersionSnapshot[] = []
  for (const item of manifest.versions) {
    const html = await readGeneratedAppHtmlFile(appId, item.version)
    if (html === undefined) continue
    versions.push({ version: item.version, html, savedAt: item.savedAt })
  }
  if (versions.length === 0) return undefined

  const active = versions[versions.length - 1]
  return migrateAppRecord({
    id: appId as `gen:${string}`,
    name: manifest.name,
    description: manifest.description,
    category: manifest.category,
    iconEmoji: manifest.iconEmoji,
    themeColor: manifest.themeColor,
    tags: manifest.tags,
    html: active.html,
    version: manifest.version,
    pendingUpdate: manifest.pendingUpdate,
    icodeProjectId: manifest.icodeProjectId,
    versions,
  } as GeneratedAppRecord)
}

// ---- 旧 localStorage 大键读取（迁移源） ----

function isValidVersionSnapshot(value: unknown): value is GeneratedAppVersionSnapshot {
  if (typeof value !== 'object' || value === undefined) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.version === 'string' &&
    typeof record.html === 'string' &&
    typeof record.savedAt === 'number'
  )
}

function isValidGeneratedAppRecord(value: unknown): value is GeneratedAppRecord {
  if (typeof value !== 'object' || value === undefined) return false
  const record = value as Record<string, unknown>
  if (
    typeof record.id !== 'string' ||
    !record.id.startsWith('gen:') ||
    typeof record.name !== 'string' ||
    typeof record.description !== 'string' ||
    typeof record.category !== 'string' ||
    typeof record.iconEmoji !== 'string' ||
    typeof record.themeColor !== 'string' ||
    typeof record.html !== 'string'
  ) {
    return false
  }
  if (record.versions !== undefined) {
    if (!Array.isArray(record.versions)) return false
    if (!record.versions.every(isValidVersionSnapshot)) return false
  }
  return true
}

function readLegacyInstalledAppsRaw(): GeneratedAppRecord[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidGeneratedAppRecord).map(migrateAppRecord)
  } catch {
    return []
  }
}

/** 一次性迁移：旧 localStorage 大键 → Contents 文件 + 索引，成功后删除旧键。幂等（索引存在即完成）。 */
export async function migrateGeneratedAppBundlesOnce(): Promise<{
  migrated: string[]
  failed: string[]
  skipped: boolean
}> {
  if (localStorage.getItem(INDEX_KEY) !== null) {
    return { migrated: [], failed: [], skipped: true }
  }

  const legacy = readLegacyInstalledAppsRaw()
  const migrated: string[] = []
  const failed: string[] = []
  for (const record of legacy) {
    try {
      await persistAppContents(record)
      migrated.push(record.id)
    } catch {
      failed.push(record.id)
    }
  }

  if (failed.length > 0) {
    // 有失败项：保留旧键待下次重试；部分成功的 appId 也写入索引，避免重复写
    writeIndex(migrated)
    return { migrated, failed, skipped: false }
  }

  writeIndex(migrated)
  try {
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    // 忽略：即使残留旧键，索引已存在，下次启动跳过迁移
  }
  return { migrated, failed, skipped: false }
}

/** 启动时调用一次：先迁移旧键，再按索引从 Contents 载入内存缓存。幂等。 */
export async function hydrateInstalledAppsFromFiles(): Promise<void> {
  if (hydrated) return
  await migrateGeneratedAppBundlesOnce()

  const ids = readIndex()
  const loaded: GeneratedAppRecord[] = []
  for (const id of ids) {
    const record = await loadAppContents(id)
    if (record) loaded.push(record)
  }
  cache = new Map(loaded.map((record) => [record.id, record]))
  hydrated = true
}

/** 同步读取已安装生成应用（内存缓存，未 hydrate 时为空） */
export function loadInstalledAppsFromCache(): GeneratedAppRecord[] {
  return [...cache.values()]
}

/**
 * 异步保存全部已安装生成应用（差分写 Contents，删除已卸载应用的 Contents）。
 * 供 context 写点调用；成功返回 true。写入过程经 files 全局 8GB 配额。
 */
export async function saveInstalledAppsToFiles(apps: GeneratedAppRecord[]): Promise<boolean> {
  const nextIds: Set<string> = new Set(apps.map((app) => app.id))
  const prevIds = new Set(cache.keys())
  try {
    for (const app of apps) {
      await persistAppContents(app)
    }
    for (const prevId of prevIds) {
      if (!nextIds.has(prevId)) {
        // 版本文件夹布局的应用卸载时删整包（Versions / Developer / Data / Contents）
        if (cache.get(prevId)?.versionsLayout) {
          await removeGeneratedAppBundle(prevId)
        } else {
          await removeGeneratedAppContents(prevId)
        }
      }
    }
    if (!writeIndex([...nextIds])) return false
    cache = new Map(apps.map((app) => [app.id, app]))
    hydrated = true
    return true
  } catch {
    return false
  }
}

/** 生成应用 Contents 本体的累计字节（供记账/去重；无则 0） */
export async function getGeneratedAppBodiesBytes(): Promise<Record<string, number>> {
  const ids = readIndex()
  const result: Record<string, number> = {}
  for (const id of ids) {
    const bytes = await getGeneratedAppContentsBytes(id)
    if (bytes > 0) result[id] = bytes
  }
  return result
}

/** 供测试：仅重置内存缓存与 hydrate 状态（不触碰 localStorage 索引，避免破坏待 hydrate 的数据） */
export function __resetGeneratedAppStoreForTest(): void {
  cache = new Map()
  hydrated = false
}

/**
 * 版本文件夹布局应用：从包内重建运行时记录（读最大正式版清单）并更新内存缓存。
 * 发布 / 治理 / 导入后由 context 调用，随后随 saveInstalledApps 落索引。
 */
export async function rebuildVersionsLayoutRecord(
  appId: string,
): Promise<GeneratedAppRecord | undefined> {
  const record = await loadVersionsLayoutRecord(appId)
  if (record) {
    cache.set(appId, record)
  }
  return record
}
