/**
 * iCode 程序包导入导出（第一期 §4.9 之后的整包形态）。
 *
 * 新格式（instant-os-icode-package）：能带的都带——全部正式版、当时若存在的草稿、
 * 聊天、用户数据、每版本清单。导入到另一台设备后打开 iCode 看到与导出端相同的东西；
 * 目标机已有同一应用或同名应用 → 做成副本（新身份、新名字）。
 *
 * 旧格式（instant-os-icode-bundle，SEARCH/REPLACE 时代的 internal/formal 包）仍可读入：
 * 读入后转成版本布局包再注册。
 */
import { zipSync, strFromU8, strToU8, unzipSync } from 'fflate'
import type { GeneratedAppId } from '../../os/types.ts'
import { osNowMs } from '../../os/os-clock.ts'
import { loadGeneratedAppData } from '../../os/generated-app-data-storage.ts'
import type { ICodeExportBundle, ICodeInternalProject } from './icode-types.ts'
import {
  buildIcodePackageBundle,
  importIcodePackageBundle,
  loadIcodeChat,
  newIcodeAppId,
  type IcodePackageBundle,
} from '../../os/icode-managed-apps.ts'

const PACKAGE_MANIFEST_ENTRY = 'manifest.json'

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === undefined || value === null) return false
  return Object.values(value).every((entry) => typeof entry === 'string')
}

// ---- 新格式：版本布局整包 ----

export async function exportIcodePackageToZip(appId: GeneratedAppId): Promise<Blob> {
  const chat = await loadIcodeChat(appId)
  const appData = loadGeneratedAppData(appId)
  const bundle = await buildIcodePackageBundle({ appId, chat, appData })
  const data = strToU8(JSON.stringify(bundle, null, 2))
  return new Blob([data as BlobPart], { type: 'application/zip' })
}

export function downloadIcodePackageZip(blob: Blob, appName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${appName.replace(/[\\/:*?"<>|]/g, '_') || 'icode-app'}-icode-package.zip`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export async function readPackageBundleFromZipFile(file: File): Promise<IcodePackageBundle> {
  const buffer = await file.arrayBuffer()
  const entries = unzipSync(new Uint8Array(buffer))
  const manifest = entries[PACKAGE_MANIFEST_ENTRY]
  if (!manifest) {
    throw new Error('程序包缺少 manifest.json')
  }
  const parsed: unknown = JSON.parse(strFromU8(manifest))
  if (!isIcodePackageBundle(parsed)) {
    throw new Error('不是有效的 iCode 程序包')
  }
  return parsed
}

export function isIcodePackageBundle(value: unknown): value is IcodePackageBundle {
  if (typeof value !== 'object' || value === undefined) return false
  const bundle = value as Record<string, unknown>
  return (
    bundle.format === 'instant-os-icode-package' &&
    bundle.version === 1 &&
    Array.isArray(bundle.versions)
  )
}

/** 导入整包（新格式）：返回新 appId；renameTo 用于副本名。 */
export async function importIcodePackageFromBundle(input: {
  bundle: IcodePackageBundle
  renameTo?: string
}): Promise<GeneratedAppId> {
  const newAppId = newIcodeAppId()
  await importIcodePackageBundle({ bundle: input.bundle, newAppId, renameTo: input.renameTo })
  return newAppId
}

// ---- 旧格式兼容（读入后转版本布局包） ----

function isLegacyBundle(value: unknown): value is ICodeExportBundle {
  if (typeof value !== 'object' || value === undefined) return false
  const bundle = value as Record<string, unknown>
  return (
    bundle.format === 'instant-os-icode-bundle' &&
    bundle.version === 1 &&
    (bundle.kind === 'internal' || bundle.kind === 'formal')
  )
}

export async function readLegacyBundleFromZipFile(file: File): Promise<ICodeExportBundle> {
  const buffer = await file.arrayBuffer()
  const entries = unzipSync(new Uint8Array(buffer))
  const manifest = entries[PACKAGE_MANIFEST_ENTRY]
  if (!manifest) {
    throw new Error('程序包缺少 manifest.json')
  }
  const parsed: unknown = JSON.parse(strFromU8(manifest))
  if (!isLegacyBundle(parsed)) {
    throw new Error('不是有效的 iCode 程序包')
  }
  if (parsed.appData !== undefined && !isStringRecord(parsed.appData)) {
    throw new Error('程序包数据格式无效')
  }
  return parsed
}

/** 旧包 → 版本布局整包（供统一导入路径） */
export function legacyBundleToPackageBundle(bundle: ICodeExportBundle): IcodePackageBundle {
  const project = bundle.project as Partial<ICodeInternalProject> & {
    appId?: GeneratedAppId
    name: string
    description: string
    category: string
    iconEmoji: string
    themeColor: string
    tags?: ICodeInternalProject['tags']
    html: string
  }

  const identity = {
    name: project.name,
    description: project.description,
    category: project.category,
    iconEmoji: project.iconEmoji,
    themeColor: project.themeColor,
    createdAt: osNowMs(),
  }

  return {
    format: 'instant-os-icode-package',
    version: 1,
    exportedAt: osNowMs(),
    appId: project.appId ?? 'gen:legacy',
    index: { placeholder: identity },
    versions: project.html
      ? [
          {
            number: 1,
            manifest: {
              format: 'instant-os-generated-app-version',
              name: project.name,
              description: project.description,
              category: project.category,
              iconEmoji: project.iconEmoji,
              themeColor: project.themeColor,
              tags: project.tags ?? [],
            },
            files: [{ path: 'index.html', text: project.html }],
          },
        ]
      : [],
    draft: null,
    chat: bundle.kind === 'internal' ? (project.chat ?? []) : [],
    appData: bundle.appData ?? {},
  }
}

// ---- 供测试 ----

export function packageBundleToZipBytes(bundle: IcodePackageBundle): Uint8Array {
  return zipSync({
    [PACKAGE_MANIFEST_ENTRY]: strToU8(JSON.stringify(bundle, null, 2)),
  })
}

export function legacyLoadFormalAppData(appId: GeneratedAppId): Promise<Record<string, string>> {
  return Promise.resolve(loadGeneratedAppData(appId))
}
