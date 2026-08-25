/**
 * iCode 管理应用服务层（第一期）。
 *
 * iCode 不再自带平行「内部项目」数据库：一个 iCode 程序 = 系统里的一个生成应用包
 * （Versions 整数正式版 + Draft 草稿 + Developer 开发附属）。本模块负责：
 * 创建包、打开时确保草稿、读/写草稿快照、聊天持久化（版本树之外）、旧内部项目一次性
 * 迁移、从商店应用复制出新身份、整包导入导出。
 *
 * 桌面身份只认最大正式版清单；用户数据（注册表键值 + Data）跨版本共用，不在本模块
 * 管辖内（沿用现有 generated-app-data-storage / files-app-data-*）。
 */
import { osNowMs } from './os-clock.ts'
import type { GeneratedAppId } from './types.ts'
import type { GeneratedAppRecord } from '../apps/appstore/types.ts'
import type { AppCapabilityTag } from '../apps/appstore/app-capability-tags.ts'
import type { ICodeChatMessage } from '../apps/icode/icode-types.ts'
import {
  ensureDraftTree,
  appChatFilePath,
  getMaxFormalVersionNumber,
  hasVersionsLayout,
  listFormalVersionNumbers,
  listVersionTreeFiles,
  publishDraftToNewFormalVersion,
  readDeveloperTextFile,
  readVersionFileBytes,
  readVersionFileText,
  readVersionManifest,
  readVersionTreeResources,
  readVersionsPackageIndex,
  removeDraftPath,
  writeDeveloperTextFile,
  writeDraftManifest,
  writeDraftTextFile,
  writeVersionBinaryFile,
  writeVersionTextFile,
  writeVersionsPackageIndex,
  type GeneratedAppVersionManifest,
} from './generated-app-versions-layout.ts'
export const ICODE_APP_ENTRY_FILE = 'index.html'

const TEXT_FILE_EXTENSIONS = new Set([
  'html', 'htm', 'css', 'js', 'mjs', 'json', 'svg', 'md', 'txt', 'xml', 'csv',
  'ts', 'tsx', 'jsx', 'less', 'map', 'webmanifest',
])

export function isIcodeTextFilePath(path: string): boolean {
  const dot = path.lastIndexOf('.')
  const ext = dot < 0 ? '' : path.slice(dot + 1).toLowerCase()
  return TEXT_FILE_EXTENSIONS.has(ext)
}

export type IcodeAppIdentity = {
  name: string
  description: string
  category: string
  iconEmoji: string
  themeColor: string
  tags: AppCapabilityTag[]
}

export function icodeVersionManifestFromIdentity(
  identity: IcodeAppIdentity,
): GeneratedAppVersionManifest {
  return {
    format: 'instant-os-generated-app-version',
    name: identity.name,
    description: identity.description,
    category: identity.category,
    iconEmoji: identity.iconEmoji,
    themeColor: identity.themeColor,
    tags: identity.tags,
    savedAt: osNowMs(),
  }
}

/** 静态网站默认骨架（第一期；第四期新应用默认换成 TSX 工程骨架） */
export function buildIcodeHtmlTemplateFiles(identity: IcodeAppIdentity): Array<{ path: string; text: string }> {
  const escaped = identity.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return [
    {
      path: ICODE_APP_ENTRY_FILE,
      text: `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escaped}</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<main class="app">
  <h1>${escaped}</h1>
  <p>在 iCode 对话中描述你想要的应用，AI 会在这里生成。</p>
</main>
<script src="app.js"></script>
</body>
</html>
`,
    },
    {
      path: 'styles.css',
      text: `:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, "PingFang SC", sans-serif;
  display: flex;
  min-height: 100vh;
  align-items: center;
  justify-content: center;
  background: #f5f5f7;
  color: #1d1d1f;
}
.app {
  text-align: center;
  padding: 32px;
}
h1 { font-size: 24px; }
`,
    },
    {
      path: 'app.js',
      text: `console.log('${escaped} ready')\n`,
    },
  ]
}

/** 新 iCode 应用的 appId（时间戳保证唯一；冲突时由调用方命名检查兜底） */
export function newIcodeAppId(): GeneratedAppId {
  return `gen:icode-${osNowMs()}`
}

/**
 * 创建一个 iCode 管理的生成应用包：包级占位索引 + 模板草稿。
 * 没有正式版；桌面打开是占位/空态，跑的不是草稿。
 */
export async function createIcodeManagedAppPackage(input: {
  appId: GeneratedAppId
  identity: IcodeAppIdentity
  icodeProjectId?: string
  templateFiles?: Array<{ path: string; text: string }>
}): Promise<void> {
  if (await hasVersionsLayout(input.appId)) {
    throw new Error('应用包已存在')
  }

  await writeVersionsPackageIndex(input.appId, {
    format: 'instant-os-generated-app',
    id: input.appId,
    layout: 'versions',
    icodeProjectId: input.icodeProjectId,
    placeholder: {
      name: input.identity.name,
      description: input.identity.description,
      category: input.identity.category,
      iconEmoji: input.identity.iconEmoji,
      themeColor: input.identity.themeColor,
      createdAt: osNowMs(),
    },
  })

  const files = input.templateFiles ?? buildIcodeHtmlTemplateFiles(input.identity)
  await writeDraftManifest(input.appId, icodeVersionManifestFromIdentity(input.identity))
  for (const file of files) {
    await writeDraftTextFile({ appId: input.appId, relativePath: file.path, text: file.text })
  }
}

// ---- 草稿快照 ----

export type IcodeDraftFile = {
  path: string
  text: string
}

export type IcodeDraftSnapshot = {
  appId: GeneratedAppId
  manifest: GeneratedAppVersionManifest
  /** 可编辑文本文件（编辑面） */
  files: IcodeDraftFile[]
  /** 树内其余（二进制）文件的路径与大小，编辑器按只读资源展示 */
  binaryFiles: Array<{ path: string; byteSize: number }>
  /** 来源：existed=已有草稿；copied=从最大正式版拷出；created=从模板新建 */
  origin: 'existed' | 'copied' | 'created'
}

/**
 * 打开 iCode 应用：必须有一棵可写草稿。没有则从当前最大正式版拷一棵；
 * 没有正式版则从空模板起一棵（仍不把它变成正式号）。
 */
export async function ensureIcodeDraftSnapshot(
  appId: GeneratedAppId,
): Promise<IcodeDraftSnapshot> {
  const origin = await ensureDraftTree(appId, async () => {
    const index = await readVersionsPackageIndex(appId)
    const placeholder = index?.placeholder
    const identity: IcodeAppIdentity = {
      name: placeholder?.name ?? '未命名应用',
      description: placeholder?.description ?? '',
      category: placeholder?.category ?? '内部开发',
      iconEmoji: placeholder?.iconEmoji ?? '🛠️',
      themeColor: placeholder?.themeColor ?? '#5856d6',
      tags: [],
    }
    return {
      manifest: icodeVersionManifestFromIdentity(identity),
      files: buildIcodeHtmlTemplateFiles(identity),
    }
  })

  const manifest = await readVersionManifest(appId, 'Draft')
  if (!manifest) {
    throw new Error('草稿清单缺失')
  }

  const files: IcodeDraftFile[] = []
  const binaryFiles: Array<{ path: string; byteSize: number }> = []
  for (const file of await listVersionTreeFiles(appId, 'Draft')) {
    if (file.path === 'app.json') continue
    if (isIcodeTextFilePath(file.path)) {
      const text = await readVersionFileText(appId, 'Draft', file.path)
      if (text !== undefined) {
        files.push({ path: file.path, text })
      }
    } else {
      binaryFiles.push({ path: file.path, byteSize: file.node.byteSize })
    }
  }

  return { appId, manifest, files, binaryFiles, origin }
}

/** 保存草稿：写清单与文本文件；快照里没有的旧文本文件从草稿移除。 */
export async function saveIcodeDraftSnapshot(
  appId: GeneratedAppId,
  snapshot: { manifest: GeneratedAppVersionManifest; files: IcodeDraftFile[] },
): Promise<void> {
  await writeDraftManifest(appId, snapshot.manifest)
  const keep = new Set(snapshot.files.map((file) => file.path))
  const existing = await listVersionTreeFiles(appId, 'Draft')
  for (const file of existing) {
    if (file.path === 'app.json') continue
    if (isIcodeTextFilePath(file.path) && !keep.has(file.path)) {
      await removeDraftPath(appId, file.path)
    }
  }
  for (const file of snapshot.files) {
    await writeDraftTextFile({ appId, relativePath: file.path, text: file.text })
  }
}

/** 发布：草稿升格为新最大号并只读，立刻再拷新草稿。返回新正式号。 */
export function publishIcodeAppDraft(appId: GeneratedAppId): Promise<number> {
  return publishDraftToNewFormalVersion(appId)
}

// ---- 聊天（版本树之外，绑在应用上） ----

export async function loadIcodeChat(appId: GeneratedAppId): Promise<ICodeChatMessage[]> {
  const raw = await readDeveloperTextFile(appId, 'chat.json')
  if (raw === undefined) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is ICodeChatMessage =>
        typeof item === 'object' &&
        item !== undefined &&
        typeof (item as { id?: unknown }).id === 'string' &&
        typeof (item as { role?: unknown }).role === 'string' &&
        typeof (item as { content?: unknown }).content === 'string',
    )
  } catch {
    return []
  }
}

export async function saveIcodeChat(
  appId: GeneratedAppId,
  chat: ICodeChatMessage[],
): Promise<void> {
  await writeDeveloperTextFile({
    appId,
    relativePath: 'chat.json',
    text: `${JSON.stringify(chat, null, 2)}\n`,
  })
}

export function icodeChatPath(appId: GeneratedAppId): string {
  return appChatFilePath(appId)
}

// ---- 桌面记录刷新 ----

/** 发布 / 治理后由存储层重建运行时记录（读最大正式版清单）并更新内存缓存。 */
export async function rebuildVersionsLayoutRecordInCache(
  appId: GeneratedAppId,
): Promise<GeneratedAppRecord | undefined> {
  const { rebuildVersionsLayoutRecord } = await import('./generated-apps-store.ts')
  return rebuildVersionsLayoutRecord(appId)
}

// ---- 版本枚举（第二期治理入口） ----

export function listIcodeFormalVersions(appId: GeneratedAppId): Promise<number[]> {
  return listFormalVersionNumbers(appId)
}

export function getIcodeMaxFormalVersion(appId: GeneratedAppId): Promise<number | undefined> {
  return getMaxFormalVersionNumber(appId)
}

// ---- 整包导入导出 ----

export type IcodePackageBundleFile =
  | { path: string; text: string }
  | { path: string; bytesBase64: string }

export type IcodePackageBundleVersion = {
  number: number
  manifest: GeneratedAppVersionManifest
  files: IcodePackageBundleFile[]
}

export type IcodePackageBundle = {
  format: 'instant-os-icode-package'
  version: 1
  exportedAt: number
  appId: string
  index: {
    icodeProjectId?: string
    placeholder?: {
      name: string
      description: string
      category: string
      iconEmoji: string
      themeColor: string
      createdAt: number
    }
  }
  versions: IcodePackageBundleVersion[]
  draft: { manifest: GeneratedAppVersionManifest; files: IcodePackageBundleFile[] } | null
  chat: ICodeChatMessage[]
  appData: Record<string, string>
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function collectVersionForBundle(
  appId: GeneratedAppId,
  selector: number | 'Draft',
): Promise<IcodePackageBundleVersion | { manifest: GeneratedAppVersionManifest; files: IcodePackageBundleFile[] }> {
  const manifest = await readVersionManifest(appId, selector)
  if (!manifest) throw new Error(`版本 ${String(selector)} 清单缺失`)
  const files: IcodePackageBundleFile[] = []
  for (const file of await listVersionTreeFiles(appId, selector)) {
    if (file.path === 'app.json') continue
    if (isIcodeTextFilePath(file.path)) {
      const text = await readVersionFileText(appId, selector, file.path)
      if (text !== undefined) files.push({ path: file.path, text })
    } else {
      const bytes = await readVersionFileBytes(appId, selector, file.path)
      if (bytes !== undefined) files.push({ path: file.path, bytesBase64: bytesToBase64(bytes) })
    }
  }
  if (typeof selector === 'number') {
    return { number: selector, manifest, files }
  }
  return { manifest, files }
}

/** 导出端快照：全部正式版 + 当时若存在的草稿 + 聊天 + 用户数据 + 每版本清单 */
export async function buildIcodePackageBundle(input: {
  appId: GeneratedAppId
  chat: ICodeChatMessage[]
  appData: Record<string, string>
}): Promise<IcodePackageBundle> {
  const appId = input.appId
  const index = await readVersionsPackageIndex(appId)
  if (!(await hasVersionsLayout(appId))) {
    throw new Error('应用包不是版本文件夹布局')
  }

  const versions: IcodePackageBundleVersion[] = []
  for (const number of await listFormalVersionNumbers(appId)) {
    versions.push((await collectVersionForBundle(appId, number)) as IcodePackageBundleVersion)
  }

  const draftManifest = await readVersionManifest(appId, 'Draft')
  const draft = draftManifest
    ? ((await collectVersionForBundle(appId, 'Draft')) as {
        manifest: GeneratedAppVersionManifest
        files: IcodePackageBundleFile[]
      })
    : null

  return {
    format: 'instant-os-icode-package',
    version: 1,
    exportedAt: osNowMs(),
    appId,
    index: {
      icodeProjectId: index?.icodeProjectId,
      placeholder: index?.placeholder,
    },
    versions,
    draft,
    chat: input.chat,
    appData: input.appData,
  }
}

async function writeVersionFromBundle(
  appId: GeneratedAppId,
  dirName: string,
  bundled: { manifest: GeneratedAppVersionManifest; files: IcodePackageBundleFile[] },
): Promise<void> {
  await writeVersionTextFile({
    appId,
    dirName,
    relativePath: 'app.json',
    text: `${JSON.stringify(bundled.manifest, null, 2)}\n`,
    mimeType: 'application/json',
    writable: dirName === 'Draft',
  })
  for (const file of bundled.files) {
    if ('text' in file) {
      await writeVersionTextFile({ appId, dirName, relativePath: file.path, text: file.text, writable: dirName === 'Draft' })
    } else {
      await writeVersionBinaryFile({
        appId,
        dirName,
        relativePath: file.path,
        bytes: base64ToBytes(file.bytesBase64),
        writable: dirName === 'Draft',
      })
    }
  }
}

/**
 * 导入整包：以新身份落一个包。同名/同应用冲突由调用方先解析出副本名；
 * renameTo 应用于最大正式版与草稿清单（桌面与 iCode 立即显示副本名）。
 */
export async function importIcodePackageBundle(input: {
  bundle: IcodePackageBundle
  newAppId: GeneratedAppId
  renameTo?: string
}): Promise<void> {
  const { bundle, newAppId, renameTo } = input
  const versions = [...bundle.versions].sort((a, b) => a.number - b.number)

  const placeholder = bundle.index.placeholder
  await writeVersionsPackageIndex(newAppId, {
    format: 'instant-os-generated-app',
    id: newAppId,
    layout: 'versions',
    icodeProjectId: undefined,
    placeholder: placeholder
      ? renameTo
        ? { ...placeholder, name: renameTo }
        : placeholder
      : undefined,
  })

  let maxNumber = 0
  for (const version of versions) {
    const manifest = renameTo ? { ...version.manifest, name: renameTo } : version.manifest
    await writeVersionFromBundle(newAppId, String(version.number), { manifest, files: version.files })
    maxNumber = Math.max(maxNumber, version.number)
  }

  if (bundle.draft) {
    const manifest = renameTo
      ? { ...bundle.draft.manifest, name: renameTo }
      : bundle.draft.manifest
    await writeVersionFromBundle(newAppId, 'Draft', { manifest, files: bundle.draft.files })
  }

  if (bundle.chat.length > 0) {
    await saveIcodeChat(newAppId, bundle.chat)
  }
  void maxNumber
}

/** 从商店/已安装应用复制出新身份的 iCode 应用（4.8）：只带当前正在跑的那一版 */
export async function copyInstalledAppToIcodePackage(input: {
  record: GeneratedAppRecord
  newAppId: GeneratedAppId
}): Promise<void> {
  const identity: IcodeAppIdentity = {
    name: input.record.name,
    description: input.record.description,
    category: input.record.category,
    iconEmoji: input.record.iconEmoji,
    themeColor: input.record.themeColor,
    tags: input.record.tags ?? [],
  }

  await writeVersionsPackageIndex(input.newAppId, {
    format: 'instant-os-generated-app',
    id: input.newAppId,
    layout: 'versions',
    placeholder: {
      name: identity.name,
      description: identity.description,
      category: identity.category,
      iconEmoji: identity.iconEmoji,
      themeColor: identity.themeColor,
      createdAt: osNowMs(),
    },
  })

  // 当前正在跑的那一版当种子，写成新包的正式版 1（新图标立刻能跑拷来的内容）
  const html = input.record.html || ''
  if (html) {
    await writeVersionFromBundle(input.newAppId, '1', {
      manifest: icodeVersionManifestFromIdentity(identity),
      files: [{ path: ICODE_APP_ENTRY_FILE, text: html }],
    })
  }
}

// ---- 旧内部项目一次性迁移（第一期 §6） ----

export async function migrateLegacyIcodeProject(input: {
  project: {
    id: string
    name: string
    description: string
    category: string
    iconEmoji: string
    themeColor: string
    tags?: AppCapabilityTag[]
    html: string
    chat: ICodeChatMessage[]
    linkedAppId?: string
    createdAt: number
    appData: Record<string, string>
  }
  installedRecord: GeneratedAppRecord | undefined
  appId: GeneratedAppId
}): Promise<void> {
  const { project, installedRecord, appId } = input
  if (await hasVersionsLayout(appId)) {
    return // 幂等：已迁移
  }

  const identity: IcodeAppIdentity = {
    name: project.name,
    description: project.description,
    category: project.category,
    iconEmoji: project.iconEmoji,
    themeColor: project.themeColor,
    tags: project.tags ?? [],
  }

  await writeVersionsPackageIndex(appId, {
    format: 'instant-os-generated-app',
    id: appId,
    layout: 'versions',
    icodeProjectId: project.id,
    placeholder: {
      name: identity.name,
      description: identity.description,
      category: identity.category,
      iconEmoji: identity.iconEmoji,
      themeColor: identity.themeColor,
      createdAt: project.createdAt,
    },
  })

  // 已发布历史 → 正式版 1..N（按原顺序，当前桌面在用的那份成为最大号）
  const snapshots = installedRecord?.versions?.filter((snapshot) => snapshot.html) ?? []
  const publishedHtmls = snapshots.length > 0
    ? snapshots.map((snapshot) => snapshot.html)
    : installedRecord?.html
      ? [installedRecord.html]
      : []

  let lastFormalHtml: string | undefined
  for (let index = 0; index < publishedHtmls.length; index += 1) {
    const html = publishedHtmls[index]!
    await writeVersionFromBundle(appId, String(index + 1), {
      manifest: { ...icodeVersionManifestFromIdentity(identity), savedAt: osNowMs() },
      files: [{ path: ICODE_APP_ENTRY_FILE, text: html }],
    })
    lastFormalHtml = html
  }

  // 尚未发布的源码 → 草稿（与最大正式版相同则不写，第一次打开再拷）
  if (project.html && project.html !== lastFormalHtml) {
    await writeVersionFromBundle(appId, 'Draft', {
      manifest: icodeVersionManifestFromIdentity(identity),
      files: [{ path: ICODE_APP_ENTRY_FILE, text: project.html }],
    })
  }

  // 聊天 → 包内开发目录，不进版本树
  if (project.chat.length > 0) {
    await saveIcodeChat(appId, project.chat)
  }
}

/**
 * 旧内部项目一次性迁移（幂等）：
 * 每个项目 → 版本布局包（已有 linkedAppId 的用原应用身份，桌面图标不分裂）。
 * 运行时键值以桌面那份注册表为准；桌面为空且内部快照非空时才补写，不覆盖正在用的数据。
 * 迁完删除注册表里的项目列表字段。记录重建与安装列表注册由调用方（context）完成。
 */
export async function migrateLegacyIcodeInternalProjectsOnce(input: {
  getInstalledApps: () => GeneratedAppRecord[]
}): Promise<{ changed: boolean; appIds: GeneratedAppId[]; failed: string[] }> {
  const { loadLegacyInternalProjects, clearLegacyInternalProjects, isLegacyInternalProjectsMigrated } =
    await import('../apps/icode/icode-storage.ts')
  const { loadGeneratedAppData, saveGeneratedAppDataAsync } = await import(
    './generated-app-data-storage.ts'
  )

  if (isLegacyInternalProjectsMigrated()) {
    return { changed: false, appIds: [], failed: [] }
  }

  const projects = await loadLegacyInternalProjects()
  if (projects.length === 0) {
    await clearLegacyInternalProjects()
    return { changed: false, appIds: [], failed: [] }
  }

  const appIds: GeneratedAppId[] = []
  const failed: string[] = []
  for (const project of projects) {
    const appId = (project.linkedAppId ?? `gen:${project.id}`) as GeneratedAppId
    try {
      const installedRecord = input.getInstalledApps().find((app) => app.id === appId)
      await migrateLegacyIcodeProject({
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          category: project.category,
          iconEmoji: project.iconEmoji,
          themeColor: project.themeColor,
          tags: project.tags ?? [],
          html: project.html,
          chat: project.chat ?? [],
          linkedAppId: project.linkedAppId,
          createdAt: project.createdAt,
          appData: project.appData ?? {},
        },
        installedRecord,
        appId,
      })
      if (installedRecord || (await hasVersionsLayout(appId))) {
        const existingData = loadGeneratedAppData(appId)
        if (
          Object.keys(existingData).length === 0 &&
          Object.keys(project.appData ?? {}).length > 0
        ) {
          await saveGeneratedAppDataAsync(appId, project.appData ?? {})
        }
        appIds.push(appId)
      }
    } catch (error) {
      console.error(`[icode-migration] 项目 ${project.name} 迁移失败`, error)
      failed.push(project.id)
    }
  }

  if (failed.length === 0) {
    await clearLegacyInternalProjects()
  }
  return { changed: appIds.length > 0, appIds, failed }
}

/** 迁移用：读取版本树资源（供运行时加载与记录重建） */
export function readIcodeVersionResources(
  appId: GeneratedAppId,
  selector: number | 'Draft',
): Promise<Map<string, Uint8Array>> {
  return readVersionTreeResources(appId, selector)
}
