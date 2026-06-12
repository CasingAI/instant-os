import type { AppCapabilityTag } from '../appstore/app-capability-tags.ts'
import { loadGeneratedAppData } from '../../os/generated-app-data-storage.ts'
import type { GeneratedAppId } from '../../os/types.ts'
import type { GeneratedAppRecord } from '../appstore/types.ts'
import type { ICodeInternalProject } from './icode-types.ts'

export type ICodePublishedSnapshot = {
  html: string
  appData: Record<string, string>
  name: string
  description: string
  category: string
  iconEmoji: string
  themeColor: string
  tags: AppCapabilityTag[]
}

export type ICodeDraftComparable = {
  html: string
  appData: Record<string, string>
  name: string
  description: string
  category: string
  iconEmoji: string
  themeColor: string
  tags: AppCapabilityTag[]
}

function sortedAppDataKeys(data: Record<string, string>): string[] {
  return Object.keys(data).sort()
}

function appDataEqual(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = sortedAppDataKeys(left)
  const rightKeys = sortedAppDataKeys(right)
  if (leftKeys.length !== rightKeys.length) {
    return false
  }

  return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key])
}

function tagsEqual(left: AppCapabilityTag[], right: AppCapabilityTag[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  return left.every((tag, index) => tag === right[index])
}

export function draftSnapshotsEqual(left: ICodeDraftComparable, right: ICodeDraftComparable): boolean {
  return (
    left.html === right.html &&
    left.name === right.name &&
    left.description === right.description &&
    left.category === right.category &&
    left.iconEmoji === right.iconEmoji &&
    left.themeColor === right.themeColor &&
    tagsEqual(left.tags, right.tags) &&
    appDataEqual(left.appData, right.appData)
  )
}

export function loadPublishedSnapshot(
  appId: GeneratedAppId | undefined,
  installedApps: GeneratedAppRecord[],
  fallback: Pick<
    ICodeInternalProject,
    'name' | 'description' | 'category' | 'iconEmoji' | 'themeColor' | 'tags'
  >,
): ICodePublishedSnapshot {
  const record = appId ? installedApps.find((app) => app.id === appId) : undefined
  if (!record) {
    return {
      html: '',
      appData: {},
      name: fallback.name,
      description: fallback.description,
      category: fallback.category,
      iconEmoji: fallback.iconEmoji,
      themeColor: fallback.themeColor,
      tags: [...fallback.tags],
    }
  }

  return {
    html: record.html,
    appData: loadGeneratedAppData(record.id),
    name: record.name,
    description: record.description,
    category: record.category,
    iconEmoji: record.iconEmoji,
    themeColor: record.themeColor,
    tags: record.tags ?? [],
  }
}

export function resolvePreviewBootstrapData(
  session: Pick<ICodeInternalProject, 'appData' | 'linkedAppId'>,
  draftAppData: Record<string, string>,
  dataDirty: boolean,
): Record<string, string> {
  const sessionData = dataDirty ? draftAppData : session.appData

  if (session.linkedAppId) {
    return { ...loadGeneratedAppData(session.linkedAppId), ...sessionData }
  }

  return { ...sessionData }
}

export function draftFromInternalProject(project: ICodeInternalProject): ICodeDraftComparable {
  return {
    html: project.html,
    appData: { ...project.appData },
    name: project.name,
    description: project.description,
    category: project.category,
    iconEmoji: project.iconEmoji,
    themeColor: project.themeColor,
    tags: [...project.tags],
  }
}

export function draftFromSession(
  session: ICodeDraftComparable & { appData: Record<string, string> },
  draftHtml: string,
  codeDirty: boolean,
): ICodeDraftComparable {
  return {
    html: codeDirty ? draftHtml : session.html,
    appData: { ...session.appData },
    name: session.name,
    description: session.description,
    category: session.category,
    iconEmoji: session.iconEmoji,
    themeColor: session.themeColor,
    tags: [...session.tags],
  }
}

export function isPublishDirty(
  draft: ICodeDraftComparable,
  published: ICodePublishedSnapshot,
): boolean {
  return !draftSnapshotsEqual(draft, published)
}

export type ICodePublishDiff = {
  html: boolean
  appData: boolean
  meta: boolean
}

export function describePublishDiff(
  draft: ICodeDraftComparable,
  published: ICodePublishedSnapshot,
): ICodePublishDiff {
  return {
    html: draft.html !== published.html,
    appData: !appDataEqual(draft.appData, published.appData),
    meta:
      draft.name !== published.name ||
      draft.description !== published.description ||
      draft.category !== published.category ||
      draft.iconEmoji !== published.iconEmoji ||
      draft.themeColor !== published.themeColor ||
      !tagsEqual(draft.tags, published.tags),
  }
}

export function describePublishDiffMessage(diff: ICodePublishDiff): string {
  if (diff.appData && !diff.html && !diff.meta) {
    return '编辑区运行数据与桌面正式版不同（如分数、进度）。点击「发布」同步到桌面。'
  }

  const changed: string[] = []
  if (diff.html) {
    changed.push('源码')
  }
  if (diff.meta) {
    changed.push('配置')
  }
  if (diff.appData) {
    changed.push('运行数据')
  }

  if (changed.length === 0) {
    return '编辑区与桌面正式版不同，点击「发布」同步到桌面。'
  }

  return `编辑区${changed.join('、')}与桌面正式版不同。点击「发布」同步到桌面。`
}
