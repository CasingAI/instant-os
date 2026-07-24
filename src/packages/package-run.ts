/**
 * 运行 package.json scripts / npx bin（宿主编排 → QuickJS）。
 */
import {
  filesLstat,
  filesReadText,
  filesReadlink,
  filesStat,
} from '../apps/files/files-api.ts'
import { createQuickJsInstance } from '../quickjs/quickjs-instance.ts'
import type { QuickJsEvalResult } from '../quickjs/quickjs-instance-types.ts'
import { getPackageServiceConfig } from './package-service.ts'

/** npm run / npx：可读全局 store，可写项目源码，不可改 node_modules 与 store。 */
export function npmScriptGuestPermissions(projectRoot: string): {
  fsReadRoots: string[]
  fsWriteRoots: string[]
  fsWriteDenyRoots: string[]
} {
  const storeRoot = getPackageServiceConfig().storeRoot
  return {
    fsReadRoots: [projectRoot, storeRoot],
    fsWriteRoots: [projectRoot],
    fsWriteDenyRoots: [`${projectRoot}/node_modules`],
  }
}

/** install lifecycle 默认超时（高于普通 eval 的 5s） */
export const LIFECYCLE_SCRIPT_TIMEOUT_MS = 60_000

function parseBinField(
  name: string,
  bin: unknown,
): Record<string, string> {
  if (typeof bin === 'string') {
    const short = name.includes('/') ? name.split('/').pop()! : name
    return { [short]: bin }
  }
  if (bin && typeof bin === 'object') {
    return bin as Record<string, string>
  }
  return {}
}

/** 规范化绝对 POSIX 路径（展开 . / ..），供 .bin 相对链接解析。 */
function normalizeAbsolutePosix(path: string): string {
  const parts = path.split('/').filter(Boolean)
  const out: string[] = []
  for (const part of parts) {
    if (part === '.') continue
    if (part === '..') {
      out.pop()
      continue
    }
    out.push(part)
  }
  return `/${out.join('/')}`
}

/**
 * 解析 node_modules/.bin 入口为真实文件路径。
 * 必须用 lstat：filesStat 会跟随链接，导致 filename 留在 .bin/，相对 require 基路径错误。
 */
async function resolveBinEntryFile(
  projectRoot: string,
  binName: string,
): Promise<string> {
  const binLink = `${projectRoot}/node_modules/.bin/${binName}`
  const st = await filesLstat(binLink)
  if (!st) {
    throw new Error(`找不到 bin: ${binName}`)
  }
  let entryFile: string
  if (st.kind === 'symlink') {
    const target = await filesReadlink(binLink)
    entryFile = target.startsWith('/')
      ? target
      : normalizeAbsolutePosix(`${projectRoot}/node_modules/.bin/${target}`)
  } else {
    entryFile = binLink
  }
  return entryFile
}

async function readPackageJson(packageRoot: string): Promise<Record<string, unknown>> {
  return JSON.parse(await filesReadText(`${packageRoot}/package.json`)) as Record<string, unknown>
}

/** 无 package.json 时返回 undefined（lifecycle 静默跳过，不抛「文件不存在」） */
async function tryReadPackageJson(
  packageRoot: string,
): Promise<Record<string, unknown> | undefined> {
  const path = `${packageRoot}/package.json`
  const st = await filesStat(path)
  if (!st || st.kind === 'folder') return undefined
  try {
    return JSON.parse(await filesReadText(path)) as Record<string, unknown>
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`无法读取 ${path}: ${message}`)
  }
}

/** 将 npm script 命令粗解析为可在 QuickJS 中执行的入口（仅支持 `node <file>` / 直接 `.js` / `.bin` 名） */
export function parseScriptCommand(command: string): {
  kind: 'node-file' | 'bin' | 'unsupported'
  target: string
  args: string[]
} {
  const parts = command.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
    return { kind: 'unsupported', target: '', args: [] }
  }
  if (parts[0] === 'node' || parts[0] === 'nodejs') {
    return {
      kind: 'node-file',
      target: parts[1] ?? '',
      args: parts.slice(2),
    }
  }
  if (parts[0]!.endsWith('.js') || parts[0]!.endsWith('.mjs') || parts[0]!.endsWith('.cjs')) {
    return { kind: 'node-file', target: parts[0]!, args: parts.slice(1) }
  }
  // 假定为 .bin 命令名
  return { kind: 'bin', target: parts[0]!, args: parts.slice(1) }
}

export async function runNpmScript(params: {
  projectRoot: string
  /**
   * 读 scripts / 相对入口 / process.cwd 的包根。
   * 默认等于 projectRoot（根项目 `npm run`）。
   */
  packageRoot?: string
  scriptName: string
  extraArgs?: string[]
  env?: Record<string, string>
  signal?: AbortSignal
  onConsole?: (level: string, text: string) => void
  /** 覆盖实例默认超时 */
  timeoutMs?: number
}): Promise<QuickJsEvalResult & { scriptCommand?: string }> {
  const packageRoot = params.packageRoot ?? params.projectRoot
  const pkg = await readPackageJson(packageRoot)
  const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {}
  const command = scripts[params.scriptName]
  if (!command) {
    throw new Error(`缺少 script: ${params.scriptName}`)
  }
  const parsed = parseScriptCommand(command)
  if (parsed.kind === 'unsupported' || !parsed.target) {
    throw new Error(
      `不支持的 script 命令（仅支持 node <file> / *.js / .bin 名）: ${command}`,
    )
  }

  const args = [...parsed.args, ...(params.extraArgs ?? [])]
  let entryFile: string
  if (parsed.kind === 'node-file') {
    entryFile = parsed.target.startsWith('/')
      ? parsed.target
      : `${packageRoot}/${parsed.target.replace(/^\.\//, '')}`
  } else {
    entryFile = await resolveBinEntryFile(params.projectRoot, parsed.target)
  }

  // 跟随到真实文件（读内容 / 校验存在）
  const entryStat = await filesStat(entryFile)
  if (!entryStat || entryStat.kind === 'folder') {
    throw new Error(`script 入口不存在: ${entryFile}`)
  }
  // eval filename / argv 用规范化真实路径，保证相对 require 相对包内入口
  entryFile = normalizeAbsolutePosix(entryFile)

  const source = await filesReadText(entryFile)
  // 去掉 shebang
  const code = source.replace(/^#![^\n]*\n/, '')

  const instance = await createQuickJsInstance({
    workspaceRoot: params.projectRoot,
    cwd: packageRoot,
    timeoutMs: params.timeoutMs,
    argv: ['instant-node', entryFile, ...args],
    permissions: npmScriptGuestPermissions(params.projectRoot),
    env: {
      ...params.env,
      npm_lifecycle_event: params.scriptName,
      npm_package_json: `${packageRoot}/package.json`,
      INIT_CWD: params.env?.INIT_CWD ?? params.projectRoot,
      PATH: `${params.projectRoot}/node_modules/.bin:${params.env?.PATH ?? ''}`,
    },
  })

  try {
    params.signal?.throwIfAborted()
    const result = await instance.eval(code, {
      filename: entryFile,
      timeoutMs: params.timeoutMs,
    })
    for (const line of result.consoleLines) {
      params.onConsole?.(line.level, line.text)
    }
    return { ...result, scriptCommand: command }
  } finally {
    instance.destroy()
  }
}

/**
 * 按顺序跑若干 lifecycle 脚本。
 * 缺脚本静默跳过；命令形态不支持则 onSkip；可跑但失败则抛错。
 */
export async function runLifecycleScripts(params: {
  projectRoot: string
  packageRoot: string
  scriptNames: readonly string[]
  env?: Record<string, string>
  signal?: AbortSignal
  timeoutMs?: number
  onConsole?: (level: string, text: string) => void
  onSkip?: (scriptName: string, command: string, reason: string) => void
  onRun?: (scriptName: string, command: string) => void
}): Promise<void> {
  const pkg = await tryReadPackageJson(params.packageRoot)
  if (!pkg) return
  const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {}
  const timeoutMs = params.timeoutMs ?? LIFECYCLE_SCRIPT_TIMEOUT_MS

  for (const scriptName of params.scriptNames) {
    params.signal?.throwIfAborted()
    const command = scripts[scriptName]
    if (!command) continue

    const parsed = parseScriptCommand(command)
    if (parsed.kind === 'unsupported' || !parsed.target) {
      params.onSkip?.(
        scriptName,
        command,
        '不支持的命令形态（仅 node <file> / *.js / .bin）',
      )
      continue
    }

    params.onRun?.(scriptName, command)
    try {
      const result = await runNpmScript({
        projectRoot: params.projectRoot,
        packageRoot: params.packageRoot,
        scriptName,
        env: params.env,
        signal: params.signal,
        onConsole: params.onConsole,
        timeoutMs,
      })
      if (!result.ok) {
        throw new Error(
          `lifecycle ${scriptName} 失败（${params.packageRoot}）: ${result.error}`,
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`lifecycle ${scriptName} 失败（${params.packageRoot}）: ${message}`)
    }
  }
}

export async function runNpx(params: {
  projectRoot: string
  packageSpec: string
  args?: string[]
  env?: Record<string, string>
  signal?: AbortSignal
  onConsole?: (level: string, text: string) => void
  /** 若未安装则先 install */
  ensureInstalled?: (spec: string) => Promise<void>
}): Promise<QuickJsEvalResult> {
  const { packageName } = (() => {
    const spec = params.packageSpec
    if (spec.startsWith('@')) {
      const at = spec.indexOf('@', 1)
      const name = at === -1 ? spec : spec.slice(0, at)
      return { packageName: name }
    }
    const at = spec.indexOf('@')
    return { packageName: at === -1 ? spec : spec.slice(0, at) }
  })()

  let pkgPath = `${params.projectRoot}/node_modules/${packageName}`
  let st = await filesStat(pkgPath)
  if (!st && params.ensureInstalled) {
    await params.ensureInstalled(params.packageSpec)
    st = await filesStat(pkgPath)
  }
  if (!st) {
    throw new Error(`npx: 未找到包 ${packageName}（请先 npm install 或允许自动拉取）`)
  }

  const pkgRoot = `${params.projectRoot}/node_modules/${packageName}`
  const manifest = JSON.parse(await filesReadText(`${pkgRoot}/package.json`)) as {
    name: string
    bin?: unknown
  }
  const bins = parseBinField(manifest.name, manifest.bin)
  const binNames = Object.keys(bins)
  if (binNames.length === 0) {
    throw new Error(`npx: 包 ${packageName} 没有 bin`)
  }
  const binName = binNames[0]!
  const rel = bins[binName]!
  let entryFile = normalizeAbsolutePosix(`${pkgRoot}/${rel.replace(/^\.\//, '')}`)
  const source = (await filesReadText(entryFile)).replace(/^#![^\n]*\n/, '')

  const instance = await createQuickJsInstance({
    workspaceRoot: params.projectRoot,
    cwd: pkgRoot,
    argv: ['instant-node', entryFile, ...(params.args ?? [])],
    permissions: npmScriptGuestPermissions(params.projectRoot),
    env: {
      ...params.env,
      PATH: `${params.projectRoot}/node_modules/.bin:${params.env?.PATH ?? ''}`,
    },
  })
  try {
    params.signal?.throwIfAborted()
    const result = await instance.eval(source, { filename: entryFile })
    for (const line of result.consoleLines) {
      params.onConsole?.(line.level, line.text)
    }
    return result
  } finally {
    instance.destroy()
  }
}
