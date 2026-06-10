import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { GeneratedAppRecord } from '../appstore/types.ts'
import type { GeneratedAppDataStore } from '../../os/generated-app-data-storage.ts'
import { loadGeneratedAppData } from '../../os/generated-app-data-storage.ts'
import type { GeneratedAppId } from '../../os/types.ts'
import {
  ICODE_BUNDLE_FORMAT,
  ICODE_BUNDLE_VERSION,
  type ICodeExportBundle,
  type ICodeInternalProject,
  type ICodeProjectKind,
} from './icode-types.ts'

const MANIFEST_NAME = 'manifest.json'

function sanitizeFilename(name: string): string {
  const trimmed = name.trim() || 'icode-project'
  return trimmed.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)
}

function parseBundle(raw: string): ICodeExportBundle | undefined {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === undefined) {
      return undefined
    }

    const bundle = parsed as Record<string, unknown>
    if (
      bundle.format !== ICODE_BUNDLE_FORMAT ||
      bundle.version !== ICODE_BUNDLE_VERSION ||
      (bundle.kind !== 'internal' && bundle.kind !== 'formal') ||
      typeof bundle.exportedAt !== 'number' ||
      typeof bundle.project !== 'object' ||
      bundle.project === undefined ||
      typeof bundle.appData !== 'object' ||
      bundle.appData === undefined
    ) {
      return undefined
    }

    return bundle as ICodeExportBundle
  } catch {
    return undefined
  }
}

function isStringRecord(value: unknown): value is GeneratedAppDataStore {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }

  return Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'string')
}

export function buildExportBundleFromInternal(project: ICodeInternalProject): ICodeExportBundle {
  return {
    format: ICODE_BUNDLE_FORMAT,
    version: ICODE_BUNDLE_VERSION,
    kind: 'internal',
    exportedAt: Date.now(),
    project,
    appData: project.appData,
  }
}

export function buildExportBundleFromFormal(
  record: GeneratedAppRecord,
  appData: GeneratedAppDataStore,
): ICodeExportBundle {
  return {
    format: ICODE_BUNDLE_FORMAT,
    version: ICODE_BUNDLE_VERSION,
    kind: 'formal',
    exportedAt: Date.now(),
    project: {
      appId: record.id,
      name: record.name,
      description: record.description,
      category: record.category,
      iconEmoji: record.iconEmoji,
      themeColor: record.themeColor,
      tags: record.tags,
      html: record.html,
      version: record.version,
    },
    appData,
  }
}

export function exportBundleToZip(bundle: ICodeExportBundle): Blob {
  const manifest = JSON.stringify(bundle, undefined, 2)
  const zipped = zipSync({
    [MANIFEST_NAME]: strToU8(manifest),
  })
  return new Blob([zipped], { type: 'application/zip' })
}

export function downloadBundleZip(bundle: ICodeExportBundle): void {
  const blob = exportBundleToZip(bundle)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const kindLabel = bundle.kind === 'internal' ? 'internal' : 'formal'
  const projectName =
    bundle.kind === 'internal'
      ? bundle.project.name
      : (bundle.project as { name: string }).name
  anchor.href = url
  anchor.download = `${sanitizeFilename(projectName)}-${kindLabel}-icode.zip`
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function readBundleFromZipFile(file: File): Promise<ICodeExportBundle> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const unzipped = unzipSync(bytes)
  const manifestBytes = unzipped[MANIFEST_NAME]
  if (!manifestBytes) {
    throw new Error('程序包中未找到 manifest.json')
  }

  const bundle = parseBundle(strFromU8(manifestBytes))
  if (!bundle) {
    throw new Error('无效的 iCode 项目程序包')
  }

  if (!isStringRecord(bundle.appData)) {
    throw new Error('程序包中的存储数据格式无效')
  }

  return bundle
}

export function bundleKindLabel(kind: ICodeProjectKind): string {
  return kind === 'internal' ? '内部应用' : '正式应用'
}

export function loadFormalAppData(appId: GeneratedAppId): GeneratedAppDataStore {
  return loadGeneratedAppData(appId)
}
