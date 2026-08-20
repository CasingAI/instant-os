import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'
import { isVscodeTabDirty, type VscodeTab } from './vscode-tabs.ts'

/** 脏标签草稿：正文 + 产生时的磁盘基准（用于区分「未保存编辑」与「磁盘被外部改过」） */
export type VscodeDraftEntry = {
  text: string
  /**
   * 草稿对应的上次已知磁盘内容。
   * 缺省（旧会话格式）时恢复不弹冲突，直接按未保存编辑处理。
   */
  baseline: string | undefined
}

export type VscodeSession = {
  openPaths: string[]
  activePath: string | undefined
  /** 脏标签 / 已删除标签：path → 草稿 */
  drafts: Record<string, VscodeDraftEntry>
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.vscodeSession

/** 单文件草稿正文上限（UTF-8 字节） */
const MAX_DRAFT_BYTES = 400 * 1024
/** 整份会话 JSON 上限 */
const MAX_SESSION_BYTES = 1024 * 1024

const EMPTY_SESSION: VscodeSession = {
  openPaths: [],
  activePath: undefined,
  drafts: {},
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function normalizePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed.startsWith('/')) return undefined
  return trimmed
}

function draftEntryByteLength(entry: VscodeDraftEntry): number {
  return utf8ByteLength(entry.text) + utf8ByteLength(entry.baseline ?? '')
}

function normalizeDraftEntry(value: unknown): VscodeDraftEntry | undefined {
  if (typeof value === 'string') {
    if (utf8ByteLength(value) > MAX_DRAFT_BYTES) return undefined
    return { text: value, baseline: undefined }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as { text?: unknown; baseline?: unknown }
  if (typeof raw.text !== 'string') return undefined
  if (utf8ByteLength(raw.text) > MAX_DRAFT_BYTES) return undefined
  const baseline = typeof raw.baseline === 'string' ? raw.baseline : undefined
  if (baseline !== undefined && utf8ByteLength(baseline) > MAX_DRAFT_BYTES) {
    return { text: raw.text, baseline: undefined }
  }
  return { text: raw.text, baseline }
}

function normalizeDrafts(value: unknown): Record<string, VscodeDraftEntry> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const drafts: Record<string, VscodeDraftEntry> = {}
  for (const [rawPath, rawEntry] of Object.entries(value as Record<string, unknown>)) {
    const path = normalizePath(rawPath)
    if (!path) continue
    const entry = normalizeDraftEntry(rawEntry)
    if (!entry) continue
    drafts[path] = entry
  }
  return drafts
}

export function normalizeVscodeSession(value: unknown): VscodeSession {
  if (!value || typeof value !== 'object') return { ...EMPTY_SESSION, drafts: {} }

  const raw = value as Partial<VscodeSession>
  const seen = new Set<string>()
  const openPaths: string[] = []
  const rawPaths = Array.isArray(raw.openPaths) ? raw.openPaths : []
  for (const item of rawPaths) {
    const path = normalizePath(item)
    if (!path || seen.has(path)) continue
    seen.add(path)
    openPaths.push(path)
  }

  const drafts = normalizeDrafts(raw.drafts)
  const activePath = normalizePath(raw.activePath)
  return {
    openPaths,
    activePath: activePath && seen.has(activePath) ? activePath : openPaths[0],
    drafts: Object.fromEntries(
      Object.entries(drafts).filter(([path]) => seen.has(path)),
    ),
  }
}

export function loadVscodeSession(): VscodeSession {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...EMPTY_SESSION, drafts: {} }
    return normalizeVscodeSession(JSON.parse(raw) as unknown)
  } catch {
    return { ...EMPTY_SESSION, drafts: {} }
  }
}

function trimDraftsToFit(session: VscodeSession): VscodeSession {
  let drafts = { ...session.drafts }
  const build = (): VscodeSession => ({
    openPaths: session.openPaths,
    activePath: session.activePath,
    drafts,
  })

  let serialized = JSON.stringify(build())
  if (utf8ByteLength(serialized) <= MAX_SESSION_BYTES) return build()

  const ranked = Object.entries(drafts).sort(
    (a, b) => draftEntryByteLength(b[1]) - draftEntryByteLength(a[1]),
  )
  for (const [path] of ranked) {
    delete drafts[path]
    serialized = JSON.stringify(build())
    if (utf8ByteLength(serialized) <= MAX_SESSION_BYTES) break
  }
  return build()
}

export function saveVscodeSession(session: VscodeSession): boolean {
  const normalized = normalizeVscodeSession(session)
  const fitted = trimDraftsToFit(normalized)
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(fitted))
}

export function lookupVscodeDraft(
  drafts: Record<string, VscodeDraftEntry>,
  ...paths: string[]
): VscodeDraftEntry | undefined {
  for (const path of paths) {
    const hit = drafts[path]
    if (hit) return hit
  }
  return undefined
}

/**
 * 从当前标签构建会话。
 * 脏标签与已删除标签都会写入 drafts（含 baseline = savedText）。
 * 超大草稿只记路径、不写正文。
 */
export function buildVscodeSessionFromTabs(
  tabs: readonly VscodeTab[],
  activeTabId: string | undefined,
): VscodeSession {
  // 二进制询问尚未确认前不写入会话，避免误把未打开的文件记进恢复列表
  const persistable = tabs.filter((tab) => !tab.binaryPrompt)
  const openPaths = persistable.map((tab) => tab.path)
  const activeTab =
    persistable.find((tab) => tab.id === activeTabId) ?? persistable[0]
  const drafts: Record<string, VscodeDraftEntry> = {}
  for (const tab of persistable) {
    if (!isVscodeTabDirty(tab) && !tab.deleted) continue
    if (utf8ByteLength(tab.text) > MAX_DRAFT_BYTES) continue
    drafts[tab.path] = {
      text: tab.text,
      // 未解决冲突时保留原基准，下次仍能检出冲突
      baseline: tab.conflict?.baseline ?? tab.savedText,
    }
  }
  return {
    openPaths,
    activePath: activeTab?.path,
    drafts,
  }
}
