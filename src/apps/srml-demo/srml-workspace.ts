/**
 * SRML 工具的工作区与沙盒路径层。
 *
 * - normalizePath / isTraversal / isWithinSandbox：纯函数，可独立测试。
 * - 文件读写双环境：Node 真实 fs；浏览器内存虚拟文件系统（localStorage 持久化）。
 */
export const SANDBOX_DIR = 'srml-demo-workspace'

/** 把相对路径规整为无 . 的相对形式；前导 .. 保留（表示越出根），便于 isTraversal 判定 */
export function normalizePath(path: string): string {
  const segments = path.split(/[\\/]+/).filter((segment) => segment && segment !== '.')
  const out: string[] = []
  for (const segment of segments) {
    if (segment === '..') {
      // 已解析到根仍向上 → 保留 .. 标记越界
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
      else out.push('..')
    } else {
      out.push(segment)
    }
  }
  return out.join('/')
}

/** 是否越出工作区根（normalized 以 .. 开头才可能越界） */
export function isTraversal(normalized: string): boolean {
  return normalized === '..' || normalized.startsWith('../')
}

/** 是否落在沙盒目录内 */
export function isWithinSandbox(normalized: string): boolean {
  return normalized === SANDBOX_DIR || normalized.startsWith(`${SANDBOX_DIR}/`)
}

type NodeLikeProcess = { cwd?: () => string; versions?: { node?: string } }

function getNodeProcess(): NodeLikeProcess | undefined {
  return (globalThis as { process?: NodeLikeProcess }).process
}

function isNode(): boolean {
  return Boolean(getNodeProcess()?.versions?.node)
}

function workspaceRoot(): string {
  const nodeProcess = getNodeProcess()
  return typeof nodeProcess?.cwd === 'function' ? nodeProcess.cwd() : '/'
}

/** 运行时只用到的最小 fs/promises 接口（避免 tsc 依赖 node types） */
type NodeFsPromises = {
  readdir: (path: string, options: { withFileTypes: true }) => Promise<{ name: string; isDirectory: () => boolean }[]>
  readFile: (path: string, encoding: 'utf8') => Promise<string>
  mkdir: (path: string, options: { recursive: true }) => Promise<unknown>
  writeFile: (path: string, data: string, encoding: 'utf8') => Promise<void>
}

let nodeFsPromises: NodeFsPromises | null = null

async function getNodeFs(): Promise<NodeFsPromises | null> {
  if (!isNode()) return null
  if (nodeFsPromises === null) {
    try {
      // 动态 import：变量 specifier 让 tsc 跳过 node: 模块解析（浏览器构建由 @vite-ignore 跳过打包）
      const moduleName = 'node:fs/promises'
      const mod: unknown = await import(/* @vite-ignore */ moduleName)
      nodeFsPromises = mod as NodeFsPromises
    } catch {
      nodeFsPromises = null
    }
  }
  return nodeFsPromises
}

// ---- 浏览器虚拟文件系统（内存 + localStorage） ----

const VFS_KEY = 'srml-virtual-fs'
const virtualFs = new Map<string, string>()

function persistVfs(): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return
  try {
    window.localStorage.setItem(VFS_KEY, JSON.stringify(Object.fromEntries(virtualFs)))
  } catch {
    // localStorage 不可用（隐私模式/空间满），仅保留内存副本
  }
}

function loadVfs(): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return
  try {
    const raw = window.localStorage.getItem(VFS_KEY)
    if (raw) {
      const data = JSON.parse(raw) as Record<string, string>
      for (const [key, value] of Object.entries(data)) virtualFs.set(key, value)
    }
  } catch {
    // 忽略损坏的持久化数据
  }
}
loadVfs()

export type WorkspaceEntry = { name: string; type: 'dir' | 'file' }

function virtualListDir(dir: string): WorkspaceEntry[] {
  const prefix = dir ? `${dir}/` : ''
  const seen = new Map<string, 'dir' | 'file'>()
  for (const key of virtualFs.keys()) {
    if (!key.startsWith(prefix)) continue
    const rest = key.slice(prefix.length)
    if (!rest) continue
    const first = rest.split('/')[0]
    if (!seen.has(first)) seen.set(first, rest.includes('/') ? 'dir' : 'file')
  }
  return [...seen.entries()].map(([name, type]) => ({ name, type }))
}

// ---- 文件操作 ----

export async function listDir(dir: string): Promise<WorkspaceEntry[]> {
  const nodeFs = await getNodeFs()
  if (!nodeFs) return virtualListDir(dir)
  const target = `${workspaceRoot()}/${dir}`
  try {
    const entries = await nodeFs.readdir(target, { withFileTypes: true })
    return entries
      .filter((entry) => !entry.name.startsWith('.'))
      .map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'dir' : 'file' }))
  } catch {
    return []
  }
}

export async function readFile(path: string): Promise<string | null> {
  const nodeFs = await getNodeFs()
  if (!nodeFs) return virtualFs.get(path) ?? null
  try {
    return await nodeFs.readFile(`${workspaceRoot()}/${path}`, 'utf8')
  } catch {
    return null
  }
}

export async function writeFile(path: string, content: string): Promise<void> {
  const normalized = normalizePath(path)
  if (!isWithinSandbox(normalized)) {
    throw new Error(`写入仅限沙盒目录 ${SANDBOX_DIR}/ 内`)
  }
  const nodeFs = await getNodeFs()
  if (!nodeFs) {
    virtualFs.set(normalized, content)
    persistVfs()
    return
  }
  const full = `${workspaceRoot()}/${normalized}`
  const parent = full.slice(0, full.lastIndexOf('/'))
  await nodeFs.mkdir(parent, { recursive: true })
  await nodeFs.writeFile(full, content, 'utf8')
}
