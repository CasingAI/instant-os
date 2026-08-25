/**
 * 运行 package.json scripts / npx bin（宿主编排 → QuickJS）。
 *
 * ## `/tmp` 与 session id（与终端 REPL 对齐）
 *
 * - Guest `os.tmpdir()` / `process.env.TMPDIR` 指向 session 级目录，不是卷根 `/tmp`。
 * - 若调用方传入 `terminalSessionId`（例如 VS Code Agent 终端仍存活），则共用
 *   `/tmp/Terminal/{terminalSessionId}/`，与 REPL 同一沙箱。
 * - 否则每次 run 生成 `npmRunId`，写入 `/tmp/Npm/{npmRunId}/`，避免无终端上下文时
 *   伪造 REPL session。
 * - `/tmp` 写入不进入 ChangeSet journal（长期缓存；撤销工作区改动不删 tmp）。
 * - `resolveHostPermissions` 会把 session tmpdir 并入 `fsWriteRoots`（即使本函数
 *   显式传入了项目写根）。
 */
import {
  filesLstat,
  filesReadText,
  filesReadlink,
  filesStat,
} from '../apps/files/files-api.ts'
import { createQuickJsInstance } from '../quickjs/quickjs-instance.ts'
import type {
  QuickJsEvalResult,
  QuickJsInstanceOptions,
} from '../quickjs/quickjs-instance-types.ts'
import { recordSystemDebugTimeline, shortenDebugPath } from '../os/system-debug-log.ts'
import { getPackageServiceConfig } from './package-service.ts'

/** npm run / npx guest 堆上限（高于 Virtual JS 默认，便于读 node_modules 大文件）。 */
export const NPM_SCRIPT_MEMORY_LIMIT_BYTES = 512 * 1024 * 1024
/**
 * 历史默认 script eval 超时（10 分钟）。现已改为默认无超时；
 * 调用方可显式传入 `timeoutMs`，或用本常量作为建议上限。
 * @deprecated 默认不再隐式套用；仅作显式 override 参考值。
 */
export const NPM_SCRIPT_TIMEOUT_MS = 10 * 60 * 1000
/** guest fs 不限制单文件体积（仍受堆与宿主 Files 约束）。 */
export const NPM_SCRIPT_MAX_FILE_BYTES = Number.POSITIVE_INFINITY

/** 仅当调用方显式传入时返回超时；否则 undefined → 实例默认无超时。 */
function resolveNpmScriptTimeoutMs(override: number | undefined): number | undefined {
  return override
}

function newNpmRunId(): string {
  return crypto.randomUUID()
}

/**
 * 解析本轮 npm guest 的 tmp 身份。
 * `terminalSessionId` 优先 → 与 Agent 终端共用 `/tmp/Terminal/{id}`；
 * 否则用传入的 `npmRunId` 或自建 → `/tmp/Npm/{id}`。
 */
export function resolveNpmTmpIdentity(options: {
  terminalSessionId?: string
  npmRunId?: string
}): { terminalSessionId?: string; npmRunId?: string } {
  const terminalSessionId = options.terminalSessionId?.trim()
  if (terminalSessionId) {
    return { terminalSessionId }
  }
  const npmRunId = options.npmRunId?.trim() || newNpmRunId()
  return { npmRunId }
}

function npmScriptGuestInstanceOptions(
  params: Pick<
    QuickJsInstanceOptions,
    | 'workspaceRoot'
    | 'cwd'
    | 'argv'
    | 'permissions'
    | 'env'
    | 'fsMode'
    | 'terminalSessionId'
    | 'npmRunId'
  > & { timeoutMs?: number },
): QuickJsInstanceOptions {
  const timeoutMs = resolveNpmScriptTimeoutMs(params.timeoutMs)
  return {
    workspaceRoot: params.workspaceRoot,
    cwd: params.cwd,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    memoryLimitBytes: NPM_SCRIPT_MEMORY_LIMIT_BYTES,
    maxFileBytes: NPM_SCRIPT_MAX_FILE_BYTES,
    argv: params.argv,
    permissions: params.permissions,
    env: params.env,
    fsMode: params.fsMode,
    // tmp：有 terminalSessionId 则挂靠终端；否则用 npmRunId（见文件头注释）
    terminalSessionId: params.terminalSessionId,
    npmRunId: params.npmRunId,
  }
}

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

/**
 * install lifecycle 建议超时参考值。
 * 默认已无超时；调用方可显式传入 `timeoutMs: LIFECYCLE_SCRIPT_TIMEOUT_MS`。
 * @deprecated 默认不再隐式套用。
 */
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
 * 判断文本是否为 npm/pnpm 风格的 `.bin` shell shim（非 node 入口）。
 * Instant 无真实 shell，需从中抽出 `exec node <file>` 的真实 JS 路径。
 */
export function looksLikeShellBinShim(source: string): boolean {
  const firstLine = source.split('\n', 1)[0] ?? ''
  if (/^#!/.test(firstLine)) {
    if (/\bnode(?:js)?\b/i.test(firstLine)) return false
    if (/\b(?:sh|bash|dash|zsh)\b/i.test(firstLine)) return true
    return true
  }
  return /exec\s+(?:"\$basedir\/node"|'\$basedir\/node'|\$basedir\/node|node)\s+/.test(
    source,
  )
}

/**
 * 从 npm/pnpm `.bin` shell shim 抽出 `exec node <path>` 的目标，并把 `$basedir` 展开为 `.bin` 目录。
 * 找不到则返回 undefined。
 */
export function extractNodePathFromBinShim(
  source: string,
  basedir: string,
): string | undefined {
  const re =
    /exec\s+(?:"\$basedir\/node"|'\$basedir\/node'|\$basedir\/node|node)\s+("([^"]+)"|'([^']+)'|(\S+))/g
  let lastRaw: string | undefined
  for (let match = re.exec(source); match; match = re.exec(source)) {
    lastRaw = match[2] ?? match[3] ?? match[4]
  }
  if (!lastRaw) return undefined

  const expanded = lastRaw.replaceAll('$basedir', basedir)
  const absolute = expanded.startsWith('/')
    ? expanded
    : `${basedir}/${expanded}`
  return normalizeAbsolutePosix(absolute)
}

/** npm 占位包 `tsc`（basarat/tsc）的特征文案；命中则绝不是微软 TypeScript 编译器。 */
export function isDeprecatedNpmTscPlaceholderSource(source: string): boolean {
  return source.includes('This is not the tsc command you are looking for')
}

async function tryResolveTypescriptTscBin(
  projectRoot: string,
): Promise<string | undefined> {
  const candidate = normalizeAbsolutePosix(
    `${projectRoot}/node_modules/typescript/bin/tsc`,
  )
  const st = await filesStat(candidate)
  if (!st || st.kind === 'folder') return undefined
  return candidate
}

/**
 * 解析 node_modules/.bin 入口为真实文件路径。
 * 必须用 lstat：filesStat 会跟随链接，导致 filename 留在 .bin/，相对 require 基路径错误。
 * 若目标是 pnpm/npm 的 shell shim，则继续解析到真正的 node 入口脚本。
 *
 * 对 `tsc`：只要存在 `typescript` 包，就优先用其 bin，避开 npm 同名占位包 `tsc`。
 */
async function resolveBinEntryFile(
  projectRoot: string,
  binName: string,
): Promise<string> {
  if (binName === 'tsc') {
    const typescriptBin = await tryResolveTypescriptTscBin(projectRoot)
    if (typescriptBin !== undefined) {
      return typescriptBin
    }
  }

  const binDir = `${projectRoot}/node_modules/.bin`
  const binLink = `${binDir}/${binName}`
  const st = await filesLstat(binLink)
  if (!st) {
    throw new Error(`找不到 bin: ${binName}`)
  }
  let entryFile: string
  if (st.kind === 'symlink') {
    const target = await filesReadlink(binLink)
    entryFile = target.startsWith('/')
      ? target
      : normalizeAbsolutePosix(`${binDir}/${target}`)
  } else {
    entryFile = binLink
  }

  // 宿主 pnpm/npm 常把 `.bin/*` 写成 shell 包装；Instant 只跑 QuickJS，需抽出真实 JS。
  try {
    const source = await filesReadText(entryFile)
    if (looksLikeShellBinShim(source)) {
      const resolved = extractNodePathFromBinShim(source, binDir)
      if (!resolved) {
        throw new Error(
          `无法从 shell bin shim 解析 node 入口: ${binName} (${entryFile})`,
        )
      }
      entryFile = resolved
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('无法从 shell bin shim')) {
      throw error
    }
    // 读失败则仍返回已解析路径，让后续 eval 报更明确的错
  }

  if (binName === 'tsc') {
    try {
      const source = await filesReadText(entryFile)
      if (isDeprecatedNpmTscPlaceholderSource(source)) {
        throw new Error(
          'node_modules/.bin/tsc 指向了 npm 占位包「tsc」，不是 TypeScript 编译器。请安装 typescript（npm install -D typescript），不要安装名为 tsc 的包。',
        )
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('npm 占位包')) {
        throw error
      }
    }
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

/** 按 `&&` 拆成顺序子命令（忽略引号内的 `&&`）。 */
export function splitNpmScriptSegments(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!
    if (quote !== undefined) {
      current += ch
      if (ch === quote) quote = undefined
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === '&' && command[i + 1] === '&') {
      const trimmed = current.trim()
      if (trimmed.length > 0) segments.push(trimmed)
      current = ''
      i++
      continue
    }
    current += ch
  }

  const trimmed = current.trim()
  if (trimmed.length > 0) segments.push(trimmed)
  return segments
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

async function runParsedScriptCommand(params: {
  projectRoot: string
  packageRoot: string
  parsed: ReturnType<typeof parseScriptCommand>
  scriptName: string
  extraArgs?: string[]
  env?: Record<string, string>
  signal?: AbortSignal
  onConsole?: (level: string, text: string) => void
  timeoutMs?: number
  fsMode?: QuickJsInstanceOptions['fsMode']
  /**
   * 可选：绑定 Agent/用户终端 session，使 `os.tmpdir()` 指向
   * `/tmp/Terminal/{id}`。未传则本轮自建 `/tmp/Npm/{runId}`。
   */
  terminalSessionId?: string
  /** 无 terminalSessionId 时可选固定 npmRunId（避免宿主与 guest 各生成一次） */
  npmRunId?: string
}): Promise<QuickJsEvalResult> {
  const parsed = params.parsed
  if (parsed.kind === 'unsupported' || !parsed.target) {
    throw new Error('empty or unsupported script segment')
  }

  const args = [...parsed.args, ...(params.extraArgs ?? [])]
  let entryFile: string
  if (parsed.kind === 'node-file') {
    entryFile = parsed.target.startsWith('/')
      ? parsed.target
      : `${params.packageRoot}/${parsed.target.replace(/^\.\//, '')}`
  } else {
    entryFile = await resolveBinEntryFile(params.projectRoot, parsed.target)
  }

  const entryStat = await filesStat(entryFile)
  if (!entryStat || entryStat.kind === 'folder') {
    throw new Error(`script 入口不存在: ${entryFile}`)
  }
  entryFile = normalizeAbsolutePosix(entryFile)

  recordSystemDebugTimeline({
    layer: 'npm',
    op: 'script-start',
    detail: `${params.scriptName} → ${shortenDebugPath(entryFile)}`,
  })

  const source = await filesReadText(entryFile)
  const code = source.replace(/^#![^\n]*\n/, '')

  const timeoutMs = resolveNpmScriptTimeoutMs(params.timeoutMs)
  const tmpIdentity = resolveNpmTmpIdentity({
    terminalSessionId: params.terminalSessionId,
    npmRunId: params.npmRunId,
  })
  const instance = await createQuickJsInstance(
    npmScriptGuestInstanceOptions({
      workspaceRoot: params.projectRoot,
      cwd: params.packageRoot,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      argv: ['instant-node', entryFile, ...args],
      permissions: npmScriptGuestPermissions(params.projectRoot),
      fsMode: params.fsMode,
      terminalSessionId: tmpIdentity.terminalSessionId,
      npmRunId: tmpIdentity.npmRunId,
      env: {
        ...params.env,
        npm_lifecycle_event: params.scriptName,
        npm_package_json: `${params.packageRoot}/package.json`,
        INIT_CWD: params.env?.INIT_CWD ?? params.projectRoot,
        PATH: `${params.projectRoot}/node_modules/.bin:${params.env?.PATH ?? ''}`,
      },
    }),
  )

  try {
    params.signal?.throwIfAborted()
    const result = await instance.eval(code, {
      filename: entryFile,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    })
    for (const line of result.consoleLines) {
      params.onConsole?.(line.level, line.text)
    }
    recordSystemDebugTimeline({
      layer: 'npm',
      op: result.ok ? 'script-done' : 'script-fail',
      detail: `${params.scriptName} ${result.ok ? 'ok' : (result.error ?? 'error').slice(0, 200)}`,
    })
    return result
  } finally {
    instance.destroy()
  }
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
  /** 受控模式下记录 ChangeSet，结果附带 `changes` */
  fsMode?: QuickJsInstanceOptions['fsMode']
  /**
   * 可选：绑定终端 session，使本轮 `os.tmpdir()` 指向 `/tmp/Terminal/{id}`。
   * 未传则每段 script 自建 `/tmp/Npm/{runId}`（见文件头注释）。
   */
  terminalSessionId?: string
  /** 无 terminalSessionId 时可选固定 npmRunId */
  npmRunId?: string
}): Promise<QuickJsEvalResult & { scriptCommand?: string }> {
  const packageRoot = params.packageRoot ?? params.projectRoot
  const pkg = await readPackageJson(packageRoot)
  const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {}
  const command = scripts[params.scriptName]
  if (!command) {
    throw new Error(`缺少 script: ${params.scriptName}`)
  }

  const segments = splitNpmScriptSegments(command)
  if (segments.length === 0) {
    throw new Error(`不支持的 script 命令（仅支持 node <file> / *.js / .bin 名）: ${command}`)
  }

  recordSystemDebugTimeline({
    layer: 'npm',
    op: 'run-start',
    detail: `${params.scriptName} (${segments.length} segment${segments.length > 1 ? 's' : ''})`,
  })

  let lastResult: QuickJsEvalResult | undefined
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!
    recordSystemDebugTimeline({
      layer: 'npm',
      op: 'segment-start',
      detail: `${i + 1}/${segments.length} ${segment.slice(0, 120)}`,
    })
    const parsed = parseScriptCommand(segment)
    if (parsed.kind === 'unsupported' || !parsed.target) {
      throw new Error(
        `不支持的 script 命令（仅支持 node <file> / *.js / .bin 名）: ${segment}`,
      )
    }
    const extraArgs = i === segments.length - 1 ? params.extraArgs : undefined
    lastResult = await runParsedScriptCommand({
      projectRoot: params.projectRoot,
      packageRoot,
      parsed,
      scriptName: params.scriptName,
      extraArgs,
      env: params.env,
      signal: params.signal,
      onConsole: params.onConsole,
      timeoutMs: params.timeoutMs,
      fsMode: params.fsMode,
      terminalSessionId: params.terminalSessionId,
      npmRunId: params.npmRunId,
    })
    if (!lastResult.ok || lastResult.exitCode !== 0) {
      return { ...lastResult, scriptCommand: command }
    }
  }

  return { ...lastResult!, scriptCommand: command }
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
  const timeoutMs = params.timeoutMs

  for (const scriptName of params.scriptNames) {
    params.signal?.throwIfAborted()
    const command = scripts[scriptName]
    if (!command) continue

    const segments = splitNpmScriptSegments(command)
    const unsupported = segments.find((segment) => {
      const parsed = parseScriptCommand(segment)
      return parsed.kind === 'unsupported' || !parsed.target
    })
    if (unsupported !== undefined) {
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
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
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
  /** 覆盖实例默认超时 */
  timeoutMs?: number
  /** 受控模式下记录 ChangeSet，结果附带 `changes` */
  fsMode?: QuickJsInstanceOptions['fsMode']
  /** 若未安装则先 install */
  ensureInstalled?: (spec: string) => Promise<void>
  /**
   * 可选：绑定终端 session，使本轮 `os.tmpdir()` 指向 `/tmp/Terminal/{id}`。
   * 未传则自建 `/tmp/Npm/{runId}`（见文件头注释）。
   */
  terminalSessionId?: string
  /** 无 terminalSessionId 时可选固定 npmRunId */
  npmRunId?: string
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

  const timeoutMs = resolveNpmScriptTimeoutMs(params.timeoutMs)
  const tmpIdentity = resolveNpmTmpIdentity({
    terminalSessionId: params.terminalSessionId,
    npmRunId: params.npmRunId,
  })
  const instance = await createQuickJsInstance(
    npmScriptGuestInstanceOptions({
      workspaceRoot: params.projectRoot,
      cwd: pkgRoot,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      argv: ['instant-node', entryFile, ...(params.args ?? [])],
      permissions: npmScriptGuestPermissions(params.projectRoot),
      fsMode: params.fsMode,
      terminalSessionId: tmpIdentity.terminalSessionId,
      npmRunId: tmpIdentity.npmRunId,
      env: {
        ...params.env,
        PATH: `${params.projectRoot}/node_modules/.bin:${params.env?.PATH ?? ''}`,
      },
    }),
  )
  try {
    params.signal?.throwIfAborted()
    const result = await instance.eval(source, {
      filename: entryFile,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    })
    for (const line of result.consoleLines) {
      params.onConsole?.(line.level, line.text)
    }
    return result
  } finally {
    instance.destroy()
  }
}
