import { generatedAppIdToSlug, toGeneratedAppId } from '../appstore/store-agent.ts'
import type { StoreListing } from '../appstore/types.ts'
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
    description: project.description.trim() || '由 iCode 发布的微应用',
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

export type IcodePublishInput = {
  project: ICodeInternalProject
  html: string
  appData: GeneratedAppDataStore
}
