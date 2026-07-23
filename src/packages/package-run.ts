/**
 * 运行 package.json scripts / npx bin（宿主编排 → QuickJS）。
 */
import {
  filesReadText,
  filesReadlink,
  filesStat,
} from '../apps/files/files-api.ts'
import { createQuickJsInstance } from '../quickjs/quickjs-instance.ts'
import type { QuickJsEvalResult } from '../quickjs/quickjs-instance-types.ts'

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

async function readPackageJson(projectRoot: string): Promise<Record<string, unknown>> {
  return JSON.parse(await filesReadText(`${projectRoot}/package.json`)) as Record<string, unknown>
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
  scriptName: string
  extraArgs?: string[]
  env?: Record<string, string>
  signal?: AbortSignal
  onConsole?: (level: string, text: string) => void
}): Promise<QuickJsEvalResult & { scriptCommand?: string }> {
  const pkg = await readPackageJson(params.projectRoot)
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
      : `${params.projectRoot}/${parsed.target.replace(/^\.\//, '')}`
  } else {
    const binLink = `${params.projectRoot}/node_modules/.bin/${parsed.target}`
    const st = await filesStat(binLink)
    if (!st) {
      throw new Error(`找不到 bin: ${parsed.target}`)
    }
    if (st.kind === 'symlink') {
      const target = await filesReadlink(binLink)
      entryFile = target.startsWith('/')
        ? target
        : `${params.projectRoot}/node_modules/.bin/${target}`
      // 规范化相对路径
      if (!entryFile.startsWith('/')) {
        entryFile = `${params.projectRoot}/${entryFile}`
      }
    } else {
      entryFile = binLink
    }
  }

  // 跟随到真实文件
  const entryStat = await filesStat(entryFile)
  if (!entryStat || entryStat.kind === 'folder') {
    // filesStat 跟随 symlink；若仍失败尝试读源码路径
    throw new Error(`script 入口不存在: ${entryFile}`)
  }

  const source = await filesReadText(entryFile)
  // 去掉 shebang
  const code = source.replace(/^#![^\n]*\n/, '')

  const instance = await createQuickJsInstance({
    workspaceRoot: params.projectRoot,
    argv: ['instant-node', entryFile, ...args],
    env: {
      ...params.env,
      npm_lifecycle_event: params.scriptName,
      npm_package_json: `${params.projectRoot}/package.json`,
      PATH: `${params.projectRoot}/node_modules/.bin:${params.env?.PATH ?? ''}`,
    },
  })

  try {
    params.signal?.throwIfAborted()
    const result = await instance.eval(code, { filename: entryFile })
    for (const line of result.consoleLines) {
      params.onConsole?.(line.level, line.text)
    }
    return { ...result, scriptCommand: command }
  } finally {
    instance.destroy()
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
  const entryFile = `${pkgRoot}/${rel.replace(/^\.\//, '')}`
  const source = (await filesReadText(entryFile)).replace(/^#![^\n]*\n/, '')

  const instance = await createQuickJsInstance({
    workspaceRoot: params.projectRoot,
    argv: ['instant-node', entryFile, ...(params.args ?? [])],
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
