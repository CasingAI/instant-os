/**
 * 版本树 → 嵌套页文档（桌面 / 治理预览共用入口）。
 * iCode 预览不走这里：它直接用内存里的草稿文件调 buildSiteDocument（纯函数）。
 *
 * 第四期分叉：工程树（有 main.tsx / 清单入口）→ 桌面只加载该号 Dist 里的单文件产物，
 * 缺产物给明确失败态（不现编源码、不假装成功）；静态树 → 仍按第一期网站根加载。
 */
import { EMPTY_SITE_DOCUMENT, buildSiteDocument } from './generated-app-site-html.ts'
import {
  SITE_ENTRY_FILE,
  listVersionTreeFiles,
  readVersionFileText,
  readVersionManifest,
  readVersionTreeResources,
} from '../../os/generated-app-versions-layout.ts'
import {
  buildMissingProductDocument,
  detectProjectEntry,
  PROJECT_DIST_PRODUCT,
} from '../icode/icode-project-build.ts'

export async function loadVersionSiteDocument(
  appId: string,
  version: number | 'Draft',
): Promise<{ html: string; entryFound: boolean }> {
  const manifest = await readVersionManifest(appId, version)
  const treeFiles = await listVersionTreeFiles(appId, version)
  const entry = detectProjectEntry(
    manifest?.entry,
    (path) => treeFiles.some((file) => file.path === path),
  )

  if (entry !== undefined) {
    // 工程树：桌面只跑该号里那份单文件产物；不现编源码来代替产物
    const product = await readVersionFileText(appId, version, PROJECT_DIST_PRODUCT)
    if (product !== undefined) {
      return { html: product, entryFound: true }
    }
    return { html: buildMissingProductDocument(manifest?.name ?? appId), entryFound: true }
  }

  const resources = await readVersionTreeResources(appId, version)
  const entryPath = manifest?.entry ?? SITE_ENTRY_FILE
  const html = buildSiteDocument({ entryPath, resources })
  return { html: html ?? EMPTY_SITE_DOCUMENT, entryFound: html !== undefined }
}
