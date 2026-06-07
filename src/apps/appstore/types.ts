export type StoreListing = {
  slug: string
  name: string
  description: string
  category: string
  iconEmoji: string
  themeColor: string
}

export type StoreListingDetail = {
  tagline: string
  longDescription: string
  developer: string
  compatibility: string
  language: string
}

export type StoreReview = {
  id: string
  author: string
  rating: number
  body: string
  version: string
  isUser?: boolean
  createdAt: number
}

export type GeneratedAppVersionSnapshot = {
  version: string
  html: string
  savedAt: number
}

export type GeneratedAppRecord = {
  id: `gen:${string}`
  name: string
  description: string
  category: string
  iconEmoji: string
  themeColor: string
  html: string
  version?: string
  pendingUpdate?: boolean
  versions?: GeneratedAppVersionSnapshot[]
}

export type PendingInstall = {
  id: `gen:${string}`
  listing: StoreListing
  progress: number
  textLength: number
  phase: 'waiting' | 'generating'
}
