/**
 * 磁盘镜像占用：同一路径同一时刻只能被「文件 App 挂载」或「虚拟机硬盘」一方解释。
 * 不是通用文件锁；复制、当普通文件打开不走这里。
 */

export type DiskImageOccupantKind = 'files-mount' | 'vm'

export type DiskImageOccupant = {
  kind: DiskImageOccupantKind
  /** 挂载卷 id，或虚拟机 id */
  id: string
}

const occupants = new Map<string, DiskImageOccupant>()

export function normalizeDiskImagePath(path: string): string {
  const trimmed = path.trim()
  if (trimmed.length > 1 && trimmed.endsWith('/')) {
    return trimmed.replace(/\/+$/, '')
  }
  return trimmed
}

export function getDiskImageOccupant(path: string): DiskImageOccupant | undefined {
  const normalized = normalizeDiskImagePath(path)
  if (!normalized) return undefined
  return occupants.get(normalized)
}

export function diskImageOccupiedByVmError(path: string): string {
  return `无法挂载 ${path}：虚拟机正在把这份镜像当硬盘使用。请先关机或从虚拟机里去掉这块盘。`
}

export function diskImageOccupiedByFilesMountError(path: string): string {
  return `无法打开 ${path}：这份镜像已在文件里挂载。请先卸载后再交给虚拟机。`
}

/** 文件操作（删除/改名/移动等）命中占用声明时的文案；action 如「删除」「重命名」 */
export function diskImageOccupiedForFileOpError(
  path: string,
  occupant: DiskImageOccupant,
  action: string,
): string {
  return occupant.kind === 'vm'
    ? `无法${action} ${path}：虚拟机正在使用这份磁盘镜像。请先关机或从虚拟机里去掉这块盘再${action}。`
    : `无法${action} ${path}：这份磁盘镜像正在文件里挂载使用。请先推出镜像卷再${action}。`
}

/**
 * 返回等于该路径或位于其下的占用声明（如删除 /user/Disks 时命中 /user/Disks/x.img）。
 * 占用声明数量极少，直接遍历即可，无需枚举子树。
 */
export function findOccupiedDiskImagePathUnder(
  path: string,
): { path: string; occupant: DiskImageOccupant } | undefined {
  const normalized = normalizeDiskImagePath(path)
  if (!normalized) return undefined
  const prefix = normalized.endsWith('/') ? normalized : `${normalized}/`
  for (const [claimed, occupant] of occupants) {
    if (claimed === normalized || claimed.startsWith(prefix)) {
      return { path: claimed, occupant }
    }
  }
  return undefined
}

export function claimDiskImagePath(path: string, occupant: DiskImageOccupant): void {
  const normalized = normalizeDiskImagePath(path)
  if (!normalized) {
    throw new Error('镜像路径无效')
  }
  const existing = occupants.get(normalized)
  if (existing && (existing.kind !== occupant.kind || existing.id !== occupant.id)) {
    if (existing.kind === 'vm') {
      throw new Error(diskImageOccupiedByVmError(normalized))
    }
    throw new Error(diskImageOccupiedByFilesMountError(normalized))
  }
  occupants.set(normalized, occupant)
}

export function releaseDiskImagePath(path: string, occupant: DiskImageOccupant): void {
  const normalized = normalizeDiskImagePath(path)
  const existing = occupants.get(normalized)
  if (!existing) return
  if (existing.kind !== occupant.kind || existing.id !== occupant.id) return
  occupants.delete(normalized)
}

export function releaseDiskImagePathsForOccupant(occupant: DiskImageOccupant): void {
  for (const [path, current] of occupants) {
    if (current.kind === occupant.kind && current.id === occupant.id) {
      occupants.delete(path)
    }
  }
}

/** 仅测试用 */
export function resetDiskImageOccupancyForTests(): void {
  occupants.clear()
}
