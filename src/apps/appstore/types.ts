import type { AppCapabilityTag } from './app-capability-tags.ts'

export type StoreListing = {
  slug: string
  name: string
  description: string
  category: string
  iconEmoji: string
  themeColor: string
  tags: AppCapabilityTag[]
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
  tags?: AppCapabilityTag[]
  html: string
  version?: string
  pendingUpdate?: boolean
  versions?: GeneratedAppVersionSnapshot[]
  /** 由 iCode 管理时，对应内部项目 ID（如 icode-1738…） */
  icodeProjectId?: string
  /**
   * 版本文件夹布局（iCode 管理）：本体存于包内 `Versions/{整数正式版}` + `Draft`，
   * `html`/`versions` 快照栈不再是这份应用的真相；桌面只跑当前最大正式号那棵树。
   */
  versionsLayout?: boolean
  /** 版本文件夹布局下当前最大正式号；0 表示尚无正式版（桌面为占位/空态） */
  activeVersion?: number
}

export type PendingInstall = {
  id: `gen:${string}`
  listing: StoreListing
  progress: number
  textLength: number
  phase: 'waiting' | 'thinking' | 'generating'
  isUpdate?: boolean
}

export type FailedInstall = {
  id: `gen:${string}`
  listing: StoreListing
  error: string
  isUpdate?: boolean
  failedAt: number
}

export type CompletedInstall = {
  id: `gen:${string}`
  listing: StoreListing
  isUpdate?: boolean
  completedAt: number
}
