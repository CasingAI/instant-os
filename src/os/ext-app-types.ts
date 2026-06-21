import type { ExtAppId } from './types.ts'

export const EXT_APP_MANIFEST_FORMAT = 'instant-os-ext-app-manifest' as const
export const EXT_APP_MANIFEST_SCHEMA_VERSION = 1 as const
export const EXT_APP_ENTER_MESSAGE_TYPE = 'instant-os-ext-app-enter' as const

export type ExtAppManifest = {
  format: typeof EXT_APP_MANIFEST_FORMAT
  schemaVersion: typeof EXT_APP_MANIFEST_SCHEMA_VERSION
  id: ExtAppId
  name: string
  description: string
  version: string
  entry: string
  icon: string
  splash: {
    light: string
    dark: string
  }
  themeColor: string
  tags: string[]
}

export type ExtAppEnterMessage = {
  type: typeof EXT_APP_ENTER_MESSAGE_TYPE
  manifest: ExtAppManifest
}

export type ExtAppRecord = {
  id: ExtAppId
  manifest: ExtAppManifest
  devUrl: string
  entryUrl: string
  iconUrl: string
  addedAt: number
}

export function isExtAppEnterMessage(data: unknown): data is ExtAppEnterMessage {
  if (!data || typeof data !== 'object') {
    return false
  }

  const message = data as ExtAppEnterMessage
  return (
    message.type === EXT_APP_ENTER_MESSAGE_TYPE &&
    typeof message.manifest === 'object' &&
    message.manifest !== undefined &&
    message.manifest.format === EXT_APP_MANIFEST_FORMAT
  )
}

function isExtAppIdValue(value: unknown): value is ExtAppId {
  return typeof value === 'string' && value.startsWith('ext:')
}

export function normalizeExtAppManifest(raw: unknown): ExtAppManifest | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }

  const record = raw as Record<string, unknown>
  if (record.format !== EXT_APP_MANIFEST_FORMAT) {
    return undefined
  }

  if (record.schemaVersion !== EXT_APP_MANIFEST_SCHEMA_VERSION) {
    return undefined
  }

  if (!isExtAppIdValue(record.id)) {
    return undefined
  }

  if (typeof record.name !== 'string' || !record.name.trim()) {
    return undefined
  }

  if (typeof record.entry !== 'string' || !record.entry.trim()) {
    return undefined
  }

  if (typeof record.icon !== 'string' || !record.icon.trim()) {
    return undefined
  }

  const splash = record.splash
  if (!splash || typeof splash !== 'object') {
    return undefined
  }

  const splashRecord = splash as Record<string, unknown>
  if (typeof splashRecord.light !== 'string' || typeof splashRecord.dark !== 'string') {
    return undefined
  }

  return {
    format: EXT_APP_MANIFEST_FORMAT,
    schemaVersion: EXT_APP_MANIFEST_SCHEMA_VERSION,
    id: record.id,
    name: record.name.trim(),
    description: typeof record.description === 'string' ? record.description : '',
    version: typeof record.version === 'string' ? record.version : '0.0.0',
    entry: record.entry.trim(),
    icon: record.icon.trim(),
    splash: {
      light: splashRecord.light,
      dark: splashRecord.dark,
    },
    themeColor: typeof record.themeColor === 'string' ? record.themeColor : '#007aff',
    tags: Array.isArray(record.tags)
      ? record.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
  }
}
