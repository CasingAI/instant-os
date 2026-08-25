/**
 * iCode 应用命名与冲突检查（第一期改版）。
 * iCode 首页只列「带 iCode 管理标记（版本文件夹布局）的生成应用」；不再有内部项目清单。
 */
import type { GeneratedAppRecord } from '../appstore/types.ts'

/** 该已安装应用是否由 iCode 管理（版本文件夹布局） */
export function isIcodeManagedApp(app: GeneratedAppRecord): boolean {
  return app.versionsLayout === true
}

export type AppNameConflict = { source: 'installed'; record: GeneratedAppRecord }

export function findAppNameConflict(
  installedApps: GeneratedAppRecord[],
  name: string,
  options?: { excludeAppId?: string },
): AppNameConflict | undefined {
  const trimmed = name.trim()
  if (!trimmed) return undefined
  const record = installedApps.find(
    (app) => app.id !== options?.excludeAppId && app.name.trim().toLowerCase() === trimmed.toLowerCase(),
  )
  return record ? { source: 'installed', record } : undefined
}

export function formatAppNameConflictMessage(conflict: AppNameConflict): string {
  if (conflict.source === 'installed') {
    return `已有同名应用「${conflict.record.name}」，请换一个名字。`
  }
  return '存在同名应用，请换一个名字。'
}

/** 「副本」命名规则：同名时依次尝试「名 2」「名 3」… */
export function resolveUniqueCopyName(
  desired: string,
  installedApps: GeneratedAppRecord[],
): string {
  const names = new Set(installedApps.map((app) => app.name.trim().toLowerCase()))
  const base = desired.trim() || '未命名应用'
  if (!names.has(base.toLowerCase())) return base
  let suffix = 2
  while (names.has(`${base} ${suffix}`.toLowerCase())) {
    suffix += 1
  }
  return `${base} ${suffix}`
}
