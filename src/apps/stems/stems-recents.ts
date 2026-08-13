/**
 * 最近打开的项目历史：记录在音乐实验室打开过的源文件（含持久路径的），
 * 持久化到 localStorage，供空态「最近打开」一键重开（自动载入已保存分轨/歌词）。
 */

export type RecentStemsProject = {
  /** 源文件绝对路径 */
  path: string
  /** 源文件名（展示用） */
  name: string
  /** 打开时刻（epoch ms） */
  openedAt: number
}

export const RECENT_PROJECTS_STORAGE_KEY = 'stems-recent-projects'
export const RECENT_PROJECTS_LIMIT = 6

/** 校验单条形状；不合法返回 undefined（按缺失处理）。 */
function normalizeProject(raw: unknown): RecentStemsProject | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const item = raw as { path?: unknown; name?: unknown; openedAt?: unknown }
  if (typeof item.path !== 'string' || item.path.length === 0) return undefined
  if (typeof item.name !== 'string' || item.name.length === 0) return undefined
  if (typeof item.openedAt !== 'number' || !Number.isFinite(item.openedAt)) return undefined
  return { path: item.path, name: item.name, openedAt: item.openedAt }
}

/** 读最近打开列表；localStorage 不可用 / JSON 损坏 / 形状不合法时返回空数组。 */
export function loadRecentProjects(): RecentStemsProject[] {
  try {
    const raw = localStorage.getItem(RECENT_PROJECTS_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const projects: RecentStemsProject[] = []
    for (const item of parsed) {
      const project = normalizeProject(item)
      if (project) projects.push(project)
    }
    return projects.slice(0, RECENT_PROJECTS_LIMIT)
  } catch {
    return []
  }
}

/** 写入最近打开列表（localStorage 不可用时静默忽略，仅会话内生效）。 */
export function saveRecentProjects(projects: RecentStemsProject[]): void {
  try {
    localStorage.setItem(RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(projects))
  } catch {
    // localStorage 不可用时仅会话内生效
  }
}

/**
 * 把一次打开插入列表：按 path 去重、置顶、按 openedAt 降序、截断到上限。
 * 纯函数：不修改入参数组。
 */
export function pushRecentProject(
  projects: RecentStemsProject[],
  project: RecentStemsProject,
): RecentStemsProject[] {
  const rest = projects.filter((item) => item.path !== project.path)
  return [project, ...rest]
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, RECENT_PROJECTS_LIMIT)
}

/** 从列表移除一条（纯函数）。 */
export function removeRecentProject(
  projects: RecentStemsProject[],
  path: string,
): RecentStemsProject[] {
  return projects.filter((item) => item.path !== path)
}

/**
 * 相对时间文案：刚刚 / N 分钟前 / N 小时前 / N 天前；超过 7 天显示日期。
 */
export function formatRecentTime(openedAt: number, now: number = Date.now()): string {
  const diffMs = Math.max(0, now - openedAt)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diffMs < minute) return '刚刚'
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} 分钟前`
  if (diffMs < day) return `${Math.floor(diffMs / hour)} 小时前`
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)} 天前`
  const date = new Date(openedAt)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dayNum = String(date.getUTCDate()).padStart(2, '0')
  return `${date.getUTCFullYear()}/${month}/${dayNum}`
}
