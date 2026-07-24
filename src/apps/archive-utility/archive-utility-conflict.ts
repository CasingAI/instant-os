import { filesList } from '../files/files-api.ts'

/**
 * macOS 归档实用工具风格：冲突时在词干后加「 2」「 3」…
 * 有扩展名时插在扩展名之前（如 `readme 2.txt`）。
 */
export function uniqueSiblingName(existingNames: ReadonlySet<string>, desired: string): string {
  if (!existingNames.has(desired)) return desired

  const lastDot = desired.lastIndexOf('.')
  const hasExt =
    lastDot > 0 && lastDot < desired.length - 1 && !desired.slice(lastDot + 1).includes(' ')
  const stem = hasExt ? desired.slice(0, lastDot) : desired
  const ext = hasExt ? desired.slice(lastDot) : ''

  let n = 2
  while (existingNames.has(`${stem} ${n}${ext}`)) {
    n += 1
  }
  return `${stem} ${n}${ext}`
}

function topLevelName(relativePath: string): string | undefined {
  const parts = relativePath.split('/').filter(Boolean)
  return parts[0]
}

/**
 * 若解压后的顶层名已在目标目录存在，则整棵子树改用不冲突的新顶层名。
 * 不会覆盖已有文件/文件夹。
 */
export async function remapEntriesAwayFromExisting(
  destRoot: string,
  entries: ReadonlyMap<string, Uint8Array>,
): Promise<Map<string, Uint8Array>> {
  if (entries.size === 0) return new Map()

  const listing = await filesList(destRoot)
  const existingNames = new Set(listing.map((entry) => entry.name))

  const topLevels = new Set<string>()
  for (const path of entries.keys()) {
    const top = topLevelName(path)
    if (top) topLevels.add(top)
  }

  const rename = new Map<string, string>()
  for (const name of [...topLevels].sort()) {
    const next = uniqueSiblingName(existingNames, name)
    rename.set(name, next)
    existingNames.add(next)
  }

  const out = new Map<string, Uint8Array>()
  for (const [path, data] of entries) {
    const parts = path.split('/').filter(Boolean)
    if (parts.length === 0) continue
    const top = parts[0]!
    parts[0] = rename.get(top) ?? top
    out.set(parts.join('/'), data)
  }
  return out
}

/** 单文件解压目标名：若已存在则自动加「 2」等后缀。 */
export async function allocateUniqueFileName(
  destRoot: string,
  desiredName: string,
): Promise<string> {
  const listing = await filesList(destRoot)
  const existingNames = new Set(listing.map((entry) => entry.name))
  return uniqueSiblingName(existingNames, desiredName)
}
