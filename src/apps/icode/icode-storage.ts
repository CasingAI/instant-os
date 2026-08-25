/**
 * 旧「iCode 内部项目」注册表存储 —— 第一期迁移源（只读）。
 *
 * 第一期之后 iCode 不再自带平行项目数据库：一个 iCode 程序就是系统里的一个生成应用包
 * （Versions 整数正式版 + Draft 草稿 + Developer 开发附属）。旧注册表字段 `projects`
 * 仅作为一次性迁移（os/icode-managed-apps.ts）的输入存在；迁移完成后字段被删除。
 */
import { createAppRegistry } from '../../os/app-registry.ts'
import { createRegistryStore } from '../../os/registry-store.ts'
import type { GeneratedAppDataStore } from '../../os/generated-app-data-storage.ts'
import type { ICodeInternalProject } from './icode-types.ts'

const LEGACY_MIGRATED_FLAG = 'instant-os-icode-legacy-projects-migrated'

// 保留原有注册表读取机制（含更早的 'store' 单键迁移），但只作为迁移输入。
const registryStore = createRegistryStore<ICodeInternalProject[]>({
  appId: 'icode',
  defaultValue: () => [],
  // 实际线上数据在旧版迁移后落在 'store' 键下，因此以 'store' 作为遗留单键。
  legacyKey: 'store',
  fields: [
    {
      key: 'projects',
      valueType: 'json',
      read: (projects) => projects,
      write: (value) => value,
      normalize: (raw) => {
        if (!Array.isArray(raw)) {
          return []
        }
        return raw.filter(isInternalProject)
      },
    },
  ],
})

void registryStore.hydrate()

function isStringRecord(value: unknown): value is GeneratedAppDataStore {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }

  return Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'string')
}

function isInternalProject(value: unknown): value is ICodeInternalProject {
  if (typeof value !== 'object' || value === undefined) return false
  const project = value as Record<string, unknown>
  if (
    typeof project.id !== 'string' ||
    typeof project.name !== 'string' ||
    typeof project.description !== 'string' ||
    typeof project.category !== 'string' ||
    typeof project.iconEmoji !== 'string' ||
    typeof project.themeColor !== 'string' ||
    typeof project.html !== 'string' ||
    typeof project.createdAt !== 'number' ||
    typeof project.updatedAt !== 'number'
  ) {
    return false
  }
  if (project.linkedAppId !== undefined && !String(project.linkedAppId).startsWith('gen:')) {
    return false
  }
  if (project.appData !== undefined && !isStringRecord(project.appData)) {
    return false
  }
  if (project.chat !== undefined && !Array.isArray(project.chat)) {
    return false
  }
  return true
}

/** 读取旧内部项目列表（迁移输入）；键不存在或已清空时为空数组 */
export async function loadLegacyInternalProjects(): Promise<ICodeInternalProject[]> {
  await registryStore.hydrate()
  return (await registryStore.read()) ?? []
}

/** 同步读取（未 hydrate 时为空） */
export function loadLegacyInternalProjectsSync(): ICodeInternalProject[] {
  return registryStore.readSync() ?? []
}

/** 旧内部项目是否已经迁移完成（一次性标记） */
export function isLegacyInternalProjectsMigrated(): boolean {
  try {
    return localStorage.getItem(LEGACY_MIGRATED_FLAG) === '1'
  } catch {
    return false
  }
}

/** 迁移完成后：删除注册表字段并落一次性标记 */
export async function clearLegacyInternalProjects(): Promise<void> {
  const registry = createAppRegistry('icode')
  await registry.removeItem('projects')
  await registry.removeItem('store')
  try {
    localStorage.setItem(LEGACY_MIGRATED_FLAG, '1')
  } catch {
    // 标记写失败不致命：字段已删，下次读到空列表同样视为已迁移
  }
}
