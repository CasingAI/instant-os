import { buildThreejsCatalogPromptSection } from '../../assets/3d/asset-catalog.ts'
import {
  APP_STORE_3D_RUNTIME_SECTION,
  APP_STORE_3D_SCENE_REQUIREMENTS_SECTION,
  THREEJS_PHYSICS_REF,
} from '../../assets/3d/scene3d-prompt-sections.ts'
import { APP_CAPABILITY_TAG_3D, hasAppCapabilityTag } from './app-capability-tags.ts'
import type { StoreListing, StoreListingDetail } from './types.ts'

const PHYSICS_CONTEXT_PATTERN =
  /物理模拟|物理引擎|重力|掉落|堆叠|滚动|弹跳|碰撞|弹球|保龄|投球|刚体|marble|physics simulation|gravity|stack|collapse|ragdoll/i

const EXISTING_PHYSICS_HTML_MARKERS = [
  /RAPIER\.init/i,
  /new RAPIER\.World/i,
]

function existingHtmlSuggestsPhysics(html: string | undefined): boolean {
  const trimmed = html?.trim()
  if (!trimmed) {
    return false
  }

  return EXISTING_PHYSICS_HTML_MARKERS.some((pattern) => pattern.test(trimmed))
}

export type App3dGenerationContext = {
  name: string
  description: string
  category: string
  tagline?: string
  longDescription?: string
  tags?: string[]
}

export function appContextSuggestsPhysics(context: App3dGenerationContext): boolean {
  const text = [
    context.name,
    context.description,
    context.category,
    context.tagline,
    context.longDescription,
    ...(context.tags ?? []),
  ]
    .map((value) => value?.trim() ?? '')
    .filter((value) => value.length > 0)
    .join(' ')

  if (!text) {
    return false
  }

  return PHYSICS_CONTEXT_PATTERN.test(text)
}

export function resolveApp3dGenerationOptions(
  listing: StoreListing,
  detail?: Partial<StoreListingDetail>,
  existingHtml?: string,
): { is3d: boolean; physicsEnabled: boolean } {
  const is3d = hasAppCapabilityTag(listing.tags, APP_CAPABILITY_TAG_3D)
  if (!is3d) {
    return { is3d: false, physicsEnabled: false }
  }

  const physicsEnabled =
    existingHtmlSuggestsPhysics(existingHtml) ||
    appContextSuggestsPhysics({
      name: listing.name,
      description: listing.description,
      category: listing.category,
      tagline: detail?.tagline,
      longDescription: detail?.longDescription,
      tags: listing.tags,
    })

  return { is3d: true, physicsEnabled }
}

export function buildApp3dSystemPromptExtension(physicsEnabled = false): string {
  const sections = [APP_STORE_3D_RUNTIME_SECTION, APP_STORE_3D_SCENE_REQUIREMENTS_SECTION]
  if (physicsEnabled) {
    sections.push(THREEJS_PHYSICS_REF)
  }
  return sections.join('\n\n')
}

export function buildApp3dUserPromptSection(physicsEnabled: boolean): string {
  const physicsHint = physicsEnabled
    ? '- 需要物理：使用 Rapier（RAPIER.init、World、step，dynamic 刚体同步到 mesh）'
    : undefined

  return [
    '【3D 应用】',
    '根据上方应用描述生成完整可玩的 3D 微应用，禁止仅地面+单一方块的敷衍演示。',
    '- 从下方目录选取语义匹配的模型 url 搭建场景；须有真实交互（操控、点击、漫游、计分等）',
    '- 可选：head 中加 <meta name="instant-app-tags" content="3d">，标记为 3D 应用',
    physicsHint,
    '',
    buildThreejsCatalogPromptSection(),
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n')
}
