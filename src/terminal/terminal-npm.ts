/**
 * 终端本地命令：npm / npx → PackageService + QuickJS scripts。
 */
import {
  cancelPackageTask,
  installPackages,
  listInstalled,
  outdatedPackages,
  resolvePackageProjectRoot,
  uninstallPackages,
  subscribePackageEvents,
} from '../packages/package-public.ts'
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
  npm install [pkg…]
  npm uninstall <pkg…>
  npm update [pkg…]
  npm ls
  npm outdated
  npm run <script> [-- args…]
  npm bin
  npx <pkg> [args…]`
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
      const unsub = subscribePackageEvents((event) => {
        if (event.type === 'log') {
          io.upsertBlock({
            key: logKey,
            text: `**npm install**\n\n\`\`\`\n${event.line.message}\n\`\`\``,
            format: 'markdown',
          })
        }
      })
      try {
        const task = await installPackages({
          projectRoot,
          packages: args.length > 0 ? args : undefined,
          signal,
        })
        io.removeBlock(logKey)
        for (const line of task.logs) {
          io.write(`[${line.level}] ${line.message}`)
        }
        if (task.status === 'failed') {
          io.write(task.error ?? 'install failed')
        } else if (task.status === 'cancelled') {
          io.write('^C')
        } else {
          io.write(`ok (${task.status})`)
        }
      } finally {
        unsub()
        io.removeBlock(logKey)
      }
      return
    }

    if (sub === 'uninstall' || sub === 'remove' || sub === 'rm' || sub === 'un') {
      if (args.length === 0) {
        io.write('npm uninstall 需要包名')
        return
      }
      const task = await uninstallPackages({ projectRoot, packages: args })
      for (const line of task.logs) {
        io.write(`[${line.level}] ${line.message}`)
      }
      return
    }

    if (sub === 'update' || sub === 'upgrade') {
      const installed = await listInstalled(projectRoot)
      const names =
        args.length > 0 ? args : installed.map((p) => `${p.name}@latest`)
      const task = await installPackages({
        projectRoot,
        packages: names,
        signal,
        preferLock: false,
      })
      for (const line of task.logs) {
        io.write(`[${line.level}] ${line.message}`)
      }
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
  // 列出并取消 running
  void import('../packages/package-public.ts').then(({ listPackageTasks }) => {
    for (const task of listPackageTasks()) {
      if (task.status === 'running' || task.status === 'pending') {
        cancelPackageTask(task.id)
      }
    }
  })
}
