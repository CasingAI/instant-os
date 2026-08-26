/**
 * 解压布局规划（纯函数）：不碰 VFS / Worker，node 可直接加载测试。
 *
 * macOS 归档实用工具语义：
 * - 归档内只有单个顶层条目 → 直接解出该条目本身；
 * - 多个顶层条目（散装文件）→ 整体套进一个以压缩包命名的文件夹，避免摊满当前目录。
 */

/** 条目路径第一段（忽略空段）去重后的顶层名列表，按首见顺序。 */
export function topLevelNames(paths: Iterable<string>): string[] {
  const names = new Set<string>()
  for (const path of paths) {
    const top = path.split('/').filter(Boolean)[0]
    if (top) names.add(top)
  }
  return [...names]
}

/** 所有条目整体套进 folder：路径统一加 `${folder}/` 前缀，不改写原表。 */
export function wrapEntriesInFolder(
  entries: ReadonlyMap<string, Uint8Array>,
  folder: string,
): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>()
  const prefix = `${folder}/`
  for (const [path, bytes] of entries) {
    out.set(`${prefix}${path}`, bytes)
  }
  return out
}

/**
 * 是否为裸 gzip 单文件（.gz 但非 .tar.gz；.tgz 不以 .gz 结尾自然排除）。
 * 其魔数与 tar.gz 相同，只能按扩展名分流到单文件解压分支。
 */
export function isBareGzipFileName(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith('.gz') && !lower.endsWith('.tar.gz')
}
