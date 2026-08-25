/**
 * 版本树 → 嵌套页文档（桌面 / 治理预览共用入口）。
 * iCode 预览不走这里：它直接用内存里的草稿文件调 buildSiteDocument（纯函数）。
 */
import { EMPTY_SITE_DOCUMENT, buildSiteDocument } from './generated-app-site-html.ts'
import {
  SITE_ENTRY_FILE,
  readVersionManifest,
  readVersionTreeResources,
} from '../../os/generated-app-versions-layout.ts'

export async function loadVersionSiteDocument(
  appId: string,
  version: number | 'Draft',
): Promise<{ html: string; entryFound: boolean }> {
  const manifest = await readVersionManifest(appId, version)
  const entryPath = manifest?.entry ?? SITE_ENTRY_FILE
  const resources = await readVersionTreeResources(appId, version)
  const html = buildSiteDocument({ entryPath, resources })
  return { html: html ?? EMPTY_SITE_DOCUMENT, entryFound: html !== undefined }
}
