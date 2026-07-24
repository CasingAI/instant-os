/**
 * 终端本地命令：npm / npx → PackageService + QuickJS scripts。
 * 安装默认输出对齐 pnpm reporter 版式（Packages / Progress / Done in）。
 */
import {
  cancelPackageTask,
  installPackages,
  listInstalled,
  outdatedPackages,
  resolvePackageProjectRoot,
  uninstallPackages,
  subscribePackageEvents,
  type PackageTaskProgress,
} from '../packages/package-public.ts'
import {
  formatInstallFailurePlain,
  formatInstallLivePlain,
  formatInstallSuccessPlain,
  formatInstallWarningLines,
  formatPackagesLine,
  formatDuration,
} from '../packages/package-install-report.ts'
import { runNpmScript, runNpx } from '../packages/package-run.ts'

export type TerminalNpmIo = {
  write: (text: string, format?: 'plain' | 'markdown') => void
  upsertBlock: (options: { key: string; text: string; format?: 'plain' | 'markdown' }) => void
  removeBlock: (key: string) => void
  getCwd: () => string
  getEnv: () => Record<string, string>
}

function usage(): string {
  return `用法:
  npm install [pkg…] [--scripts|--ignore-scripts]
  npm uninstall <pkg…>
  npm update [pkg…] [--scripts|--ignore-scripts]
  npm ls
  npm outdated
  npm run <script> [-- args…]
  npm bin
  npx <pkg> [args…]

说明:
  默认忽略 install lifecycle 脚本（设置 → NPM 可改）。
  --scripts 本次启用；--ignore-scripts 本次忽略。`
}

/** 从 install/update 参数中拆出包名与 scripts 覆盖旗标 */
function parseInstallCliArgs(args: string[]): {
  packages: string[]
  ignoreScripts?: boolean
} {
  let ignoreScripts: boolean | undefined
  const packages: string[] = []
  for (const arg of args) {
    if (arg === '--ignore-scripts') {
      ignoreScripts = true
      continue
    }
    if (arg === '--scripts' || arg === '--no-ignore-scripts') {
      ignoreScripts = false
      continue
    }
    if (arg.startsWith('-')) {
      continue
    }
    packages.push(arg)
  }
  return { packages, ignoreScripts }
}

function writeInstallWarnings(
  io: TerminalNpmIo,
  logs: { level: string; message: string; at: number }[],
): void {
  const lines = formatInstallWarningLines(
    logs.map((line) => ({
      at: line.at,
      level: line.level as 'info' | 'warn' | 'error',
      message: line.message,
    })),
  )
  for (const line of lines) {
    io.write(line)
  }
}

async function runInstallWithReporter(
  io: TerminalNpmIo,
  logKey: string,
  run: () => ReturnType<typeof installPackages>,
): Promise<void> {
  let lastProgress: PackageTaskProgress | undefined
  const unsub = subscribePackageEvents((event) => {
    if (event.type !== 'progress' || !event.progress) return
    lastProgress = event.progress
    io.upsertBlock({
      key: logKey,
      text: formatInstallLivePlain(event.progress),
      format: 'plain',
    })
  })
  try {
    const task = await run()
    io.removeBlock(logKey)
    writeInstallWarnings(io, task.logs)

    if (task.status === 'failed') {
      io.write(
        formatInstallFailurePlain({
          progress: lastProgress,
          report: task.installReport,
          error: task.error ?? 'install failed',
        }),
      )
      return
    }
    if (task.status === 'cancelled') {
      io.write(
        formatInstallFailurePlain({
          progress: lastProgress,
          report: task.installReport,
          cancelled: true,
        }),
      )
      return
    }
    if (task.installReport) {
      io.write(formatInstallSuccessPlain(task.installReport))
    } else {
      io.write('Done')
    }
  } finally {
    unsub()
    io.removeBlock(logKey)
  }
}

export async function runTerminalNpmOrNpx(
  head: string,
  restLine: string,
  io: TerminalNpmIo,
  signal: AbortSignal,
): Promise<void> {
  const rest = restLine.trim() ? restLine.trim().split(/\s+/) : []
  const cwd = io.getCwd()
  const projectRoot = await resolvePackageProjectRoot(cwd)
  if (projectRoot !== cwd) {
    io.write(`在 ${projectRoot}（由 cwd 向上定位 package.json）`)
  }
  const logKey = `npm-${Date.now()}`

  if (head === 'npm') {
    const sub = (rest[0] ?? 'help').toLowerCase()
    const args = rest.slice(1)

    if (sub === 'help' || sub === '--help' || sub === '-h') {
      io.write(usage())
      return
    }

    if (sub === 'i' || sub === 'install') {
      const { packages, ignoreScripts } = parseInstallCliArgs(args)
      await runInstallWithReporter(io, logKey, () =>
        installPackages({
          projectRoot,
          packages: packages.length > 0 ? packages : undefined,
          signal,
          ignoreScripts,
        }),
      )
      return
    }

    if (sub === 'uninstall' || sub === 'remove' || sub === 'rm' || sub === 'un') {
      if (args.length === 0) {
        io.write('npm uninstall 需要包名')
        return
      }
      const startedAt = Date.now()
      const task = await uninstallPackages({ projectRoot, packages: args })
      writeInstallWarnings(io, task.logs)
      if (task.status === 'failed') {
        io.write(task.error ?? 'uninstall failed')
        return
      }
      const removed = args.length
      io.write(
        [
          formatPackagesLine(0, removed),
          '-'.repeat(Math.min(removed, 60)),
          '',
          ...args.map((name) => `- ${name}`),
          '',
          `Done in ${formatDuration(Date.now() - startedAt)}`,
        ].join('\n'),
      )
      return
    }

    if (sub === 'update' || sub === 'upgrade') {
      const { packages: cliPackages, ignoreScripts } = parseInstallCliArgs(args)
      const installed = await listInstalled(projectRoot)
      const names =
        cliPackages.length > 0
          ? cliPackages
          : installed.map((p) => `${p.name}@latest`)
      await runInstallWithReporter(io, logKey, () =>
        installPackages({
          projectRoot,
          packages: names,
          signal,
          preferLock: false,
          ignoreScripts,
        }),
      )
      return
    }

    if (sub === 'ls' || sub === 'list') {
      const installed = await listInstalled(projectRoot)
      if (installed.length === 0) {
        io.write('(empty)')
        return
      }
      io.write(
        installed.map((p) => `${p.name}@${p.version}`).join('\n'),
      )
      return
    }

    if (sub === 'outdated') {
      const rows = await outdatedPackages(projectRoot)
      if (rows.length === 0) {
        io.write('(none)')
        return
      }
      io.write(
        rows.map((r) => `${r.name}: ${r.current} → ${r.latest}`).join('\n'),
      )
      return
    }

    if (sub === 'bin') {
      io.write(`${projectRoot}/node_modules/.bin`)
      return
    }

    if (sub === 'run' || sub === 'run-script') {
      const scriptName = args[0]
      if (!scriptName) {
        io.write('npm run 需要 script 名')
        return
      }
      const extraArgs =
        args.includes('--') ? args.slice(args.indexOf('--') + 1) : args.slice(1)
      const result = await runNpmScript({
        projectRoot,
        scriptName,
        extraArgs,
        env: io.getEnv(),
        signal,
        onConsole: (_level, text) => io.write(text),
      })
      if (!result.ok) {
        io.write(result.error)
      }
      return
    }

    io.write(`未知 npm 子命令: ${sub}\n${usage()}`)
    return
  }

  if (head === 'npx') {
    const spec = rest[0]
    if (!spec) {
      io.write('用法: npx <pkg> [args…]')
      return
    }
    const result = await runNpx({
      projectRoot,
      packageSpec: spec,
      args: rest.slice(1),
      env: io.getEnv(),
      signal,
      onConsole: (_level, text) => io.write(text),
      ensureInstalled: async (s) => {
        await installPackages({ projectRoot, packages: [s], signal })
      },
    })
    if (!result.ok) {
      io.write(result.error)
    }
    return
  }
}

/** abort 时取消仍在跑的安装任务（尽力） */
export function cancelActivePackageTasks(): void {
  void import('../packages/package-public.ts').then(({ listPackageTasks }) => {
    for (const task of listPackageTasks()) {
      if (task.status === 'running' || task.status === 'pending') {
        cancelPackageTask(task.id)
      }
    }
  })
}
