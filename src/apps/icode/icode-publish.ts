import { generatedAppIdToSlug, toGeneratedAppId } from '../appstore/store-agent.ts'
import { osNowMs } from '../../os/os-clock.ts'
import type { StoreListing } from '../appstore/types.ts'
import type { GeneratedAppRecord } from '../appstore/types.ts'
import type { GeneratedAppDataStore } from '../../os/generated-app-data-storage.ts'
import type { GeneratedAppId } from '../../os/types.ts'
import type { ICodeInternalProject } from './icode-types.ts'

export function listingSlugForInternalProject(project: ICodeInternalProject): string {
  if (project.linkedAppId) {
    return generatedAppIdToSlug(project.linkedAppId)
  }

  const fromId = project.id.replace(/^icode-/, 'icode-')
  if (/^[a-z0-9-]+$/.test(fromId)) {
    return fromId
  }

  return project.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'icode-app'
}

export function buildStoreListingFromProject(project: ICodeInternalProject): StoreListing {
  return {
    slug: listingSlugForInternalProject(project),
    name: project.name.trim() || '未命名应用',
    description: project.description.trim() || '由 iCode 开发的微应用',
    category: project.category.trim() || '开发者',
    iconEmoji: project.iconEmoji.trim() || '📱',
    themeColor: project.themeColor.trim() || '#007aff',
    tags: project.tags,
  }
}

export function resolvePublishAppId(project: ICodeInternalProject): GeneratedAppId {
  if (project.linkedAppId) {
    return project.linkedAppId
  }

  return toGeneratedAppId(listingSlugForInternalProject(project))
}

export function placeholderHtmlForIcodeApp(name: string): string {
  const title = name.trim() || '未命名应用'
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: linear-gradient(180deg, #f5f7fb 0%, #e8edf5 100%);
      color: #3c3c43;
    }
    main {
      text-align: center;
      padding: 24px;
      max-width: 320px;
    }
    h1 { font-size: 20px; margin: 0 0 8px; }
    p { margin: 0; font-size: 14px; line-height: 1.5; color: #636366; }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>应用开发中。请在 iCode 中编辑并发布，桌面入口才会更新。</p>
  </main>
</body>
</html>`
}

export function resolveDesktopHtml(project: Pick<ICodeInternalProject, 'html' | 'name'>): string {
  return project.html.trim() || placeholderHtmlForIcodeApp(project.name)
}

export type ProjectNameConflict =
  | { source: 'installed'; record: GeneratedAppRecord }
  | { source: 'internal'; project: ICodeInternalProject }

export function isIcodeManagedInstalledApp(
  app: GeneratedAppRecord,
  internalProjects: ICodeInternalProject[],
): boolean {
  return resolveIcodeProjectId(app, internalProjects) !== undefined
}

export function resolveIcodeProjectId(
  app: GeneratedAppRecord,
  internalProjects: readonly ICodeInternalProject[],
): string | undefined {
  if (app.icodeProjectId !== undefined) {
    return app.icodeProjectId
  }

  return internalProjects.find((project) => project.linkedAppId === app.id)?.id
}

export function findProjectNameConflict(
  installedApps: GeneratedAppRecord[],
  internalProjects: ICodeInternalProject[],
  name: string,
  options?: { excludeProjectId?: string; excludeAppId?: GeneratedAppId },
): ProjectNameConflict | undefined {
  const trimmed = name.trim()
  if (!trimmed) {
    return undefined
  }

  const installedConflict = installedApps.find(
    (app) => app.name.trim() === trimmed && app.id !== options?.excludeAppId,
  )
  if (installedConflict) {
    return { source: 'installed', record: installedConflict }
  }

  const internalConflict = internalProjects.find(
    (project) => project.name.trim() === trimmed && project.id !== options?.excludeProjectId,
  )
  if (internalConflict) {
    return { source: 'internal', project: internalConflict }
  }

  return undefined
}

export function formatProjectNameConflictMessage(conflict: ProjectNameConflict): string {
  const name =
    conflict.source === 'installed' ? conflict.record.name : conflict.project.name
  return `已有同名应用「${name}」，请换一个名称（例如加上「二」「三」等后缀）`
}

const COPY_NAME_SUFFIX_PATTERN = /（副本(?:[二三四五六七八九十百千万\d]+)?）$/

export function stripCopyNameSuffix(name: string): string {
  return name.trim().replace(COPY_NAME_SUFFIX_PATTERN, '')
}

const COPY_SUFFIX_NUMERALS = ['二', '三', '四', '五', '六', '七', '八', '九', '十'] as const

function copyNameSuffix(index: number): string {
  if (index === 0) {
    return '（副本）'
  }
  if (index <= COPY_SUFFIX_NUMERALS.length) {
    return `（副本${COPY_SUFFIX_NUMERALS[index - 1]}）`
  }
  return `（副本${index + 1}）`
}

export function resolveUniqueCopyName(
  sourceName: string,
  installedApps: GeneratedAppRecord[],
  internalProjects: ICodeInternalProject[],
): string {
  const baseName = stripCopyNameSuffix(sourceName)
  for (let index = 0; index < 100; index++) {
    const candidate = `${baseName}${copyNameSuffix(index)}`
    if (!findProjectNameConflict(installedApps, internalProjects, candidate)) {
      return candidate
    }
  }
  return `${baseName}（副本${osNowMs()}）`
}

export function buildIcodeSyncInput(project: ICodeInternalProject): {
  appId: GeneratedAppId
  icodeProjectId: string
  name: string
  description: string
  category: string
  iconEmoji: string
  themeColor: string
  tags: ICodeInternalProject['tags']
  html: string
  appData: GeneratedAppDataStore
} {
  return {
    appId: resolvePublishAppId(project),
    icodeProjectId: project.id,
    name: project.name.trim() || '未命名应用',
    description: project.description.trim() || '在 iCode 中开发的内部微应用',
    category: project.category.trim() || '开发者',
    iconEmoji: project.iconEmoji.trim() || '📱',
    themeColor: project.themeColor.trim() || '#007aff',
    tags: project.tags,
    html: resolveDesktopHtml(project),
    appData: project.appData,
  }
}

export function buildIcodePlaceholderSyncInput(
  project: ICodeInternalProject,
): ReturnType<typeof buildIcodeSyncInput> {
  return {
    ...buildIcodeSyncInput({ ...project, html: '', appData: {} }),
    html: placeholderHtmlForIcodeApp(project.name),
    appData: {},
  }
}

export type IcodePublishInput = {
  project: ICodeInternalProject
  html: string
  appData: GeneratedAppDataStore
}

/** @deprecated 使用 findProjectNameConflict */
export function findPublishNameConflict(
  installedApps: GeneratedAppRecord[],
  name: string,
  publishAppId: GeneratedAppId,
): GeneratedAppRecord | undefined {
  const trimmed = name.trim()
  if (!trimmed) {
    return undefined
  }

  return installedApps.find((app) => app.name.trim() === trimmed && app.id !== publishAppId)
}
