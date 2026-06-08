import {
  APP_CAPABILITY_TAG_3D,
  filterAppCapabilityTags,
  mergeAppCapabilityTags,
  type AppCapabilityTag,
} from './app-capability-tags.ts'
import { inferTagsFromAppContext, type GeneratedAppTagContext } from '../generated/generated-app-tags.ts'

function categoryFallbackTag(category: string): AppCapabilityTag | undefined {
  if (/娱乐|游戏/.test(category)) {
    return 'game'
  }
  if (/工具|效率/.test(category)) {
    return 'utility'
  }
  if (/创意|生活/.test(category)) {
    return 'creative'
  }
  return undefined
}

export function ensureListingTags(
  listing: {
    name: string
    description: string
    category: string
    tags?: unknown
  },
  searchQuery?: string,
): AppCapabilityTag[] {
  const fromListing = inferTagsFromAppContext({
    name: listing.name,
    description: listing.description,
    category: listing.category,
  })

  const trimmedQuery = searchQuery?.trim()
  const fromSearch = trimmedQuery
    ? inferTagsFromAppContext({ name: trimmedQuery, description: trimmedQuery })
    : []

  const categoryTag = categoryFallbackTag(listing.category)
  const merged = mergeAppCapabilityTags(
    listing.tags,
    fromListing,
    fromSearch,
    categoryTag ? [categoryTag] : [],
    ['interactive'],
  )

  if (merged.length >= 2) {
    return merged
  }

  if (merged.length === 1) {
    return mergeAppCapabilityTags(merged, ['utility'])
  }

  return ['utility', 'interactive']
}

export function listingSuggests3d(listing: {
  name: string
  description: string
  category: string
  tags?: string[]
}): boolean {
  return mergeAppCapabilityTags(listing.tags, inferTagsFromAppContext(listing)).includes(
    APP_CAPABILITY_TAG_3D,
  )
}

export function formatListingTagsForPrompt(tags: readonly string[]): string {
  return filterAppCapabilityTags(tags).join(', ')
}

export function buildListingTagContext(listing: {
  name: string
  description: string
  category: string
  tags?: string[]
}): GeneratedAppTagContext & { tags: AppCapabilityTag[] } {
  return {
    name: listing.name,
    description: listing.description,
    category: listing.category,
    tags: ensureListingTags(listing),
  }
}
