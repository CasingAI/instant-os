/**
 * 将安装计数格式化为接近 pnpm 默认 reporter 的终端文案。
 * 信息不强求与官方一致，版式对齐：Packages 条、Progress 行、依赖 diff、Done in。
 */
import type {
  PackageInstallCounters,
  PackageInstallDepChange,
  PackageInstallReport,
  PackageLogLine,
  PackageTaskProgress,
} from './package-types.ts'

function plusBar(count: number, widthCap = 60): string {
  if (count <= 0) return ''
  return '+'.repeat(Math.min(count, widthCap))
}

function minusBar(count: number, widthCap = 60): string {
  if (count <= 0) return ''
  return '-'.repeat(Math.min(count, widthCap))
}

export function formatPackagesLine(added: number, removed = 0): string {
  const parts: string[] = []
  if (added > 0) parts.push(`+${added}`)
  if (removed > 0) parts.push(`-${removed}`)
  if (parts.length === 0) return 'Packages: +0'
  return `Packages: ${parts.join(' ')}`
}

export function formatProgressLine(
  counters: PackageInstallCounters,
  options?: { done?: boolean },
): string {
  const base = `Progress: resolved ${counters.resolved}, reused ${counters.reused}, downloaded ${counters.downloaded}, added ${counters.added}`
  return options?.done ? `${base}, done` : base
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 1000)}s`
}

function formatDepSection(changes: PackageInstallDepChange[]): string[] {
  const deps = changes.filter((c) => c.section === 'dependencies')
  const devDeps = changes.filter((c) => c.section === 'devDependencies')
  const lines: string[] = []
  if (deps.length > 0) {
    lines.push('dependencies:')
    for (const d of deps) {
      lines.push(`+ ${d.name} ${d.version}`)
    }
  }
  if (devDeps.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push('devDependencies:')
    for (const d of devDeps) {
      lines.push(`+ ${d.name} ${d.version}`)
    }
  }
  return lines
}

/** 安装中原地刷新的活块（plain） */
export function formatInstallLivePlain(progress: PackageTaskProgress): string {
  const lines: string[] = []
  const plus = progress.packagesPlus ?? 0
  const minus = progress.packagesMinus ?? 0
  if (plus > 0 || minus > 0 || progress.counters) {
    lines.push(formatPackagesLine(plus, minus))
    const bar = `${plusBar(plus)}${minusBar(minus)}`
    if (bar) lines.push(bar)
  }
  if (progress.counters) {
    lines.push(formatProgressLine(progress.counters, { done: progress.done }))
  } else if (progress.detail) {
    lines.push(progress.detail)
  }
  if (progress.fetchHint) {
    lines.push(progress.fetchHint)
  }
  return lines.join('\n')
}

/** 成功收尾：去掉活块后写入的最终摘要 */
export function formatInstallSuccessPlain(report: PackageInstallReport): string {
  const lines: string[] = []
  if (report.contextLine) {
    lines.push(report.contextLine)
  }
  if (report.alreadyUpToDate) {
    lines.push('Already up to date')
    lines.push(`Done in ${formatDuration(report.durationMs)}`)
    return lines.join('\n')
  }

  lines.push(formatPackagesLine(report.addedCount, report.removedCount))
  const bar = `${plusBar(report.addedCount)}${minusBar(report.removedCount)}`
  if (bar) lines.push(bar)
  lines.push(formatProgressLine(report.counters, { done: true }))

  const depLines = formatDepSection(report.depChanges)
  if (depLines.length > 0) {
    lines.push('')
    lines.push(...depLines)
  }

  lines.push('')
  lines.push(`Done in ${formatDuration(report.durationMs)}`)
  return lines.join('\n')
}

/** 失败 / 取消时仍可展示已累计进度，再跟错误行 */
export function formatInstallFailurePlain(options: {
  progress?: PackageTaskProgress
  report?: PackageInstallReport
  error?: string
  cancelled?: boolean
}): string {
  const lines: string[] = []
  if (options.report) {
    lines.push(formatPackagesLine(options.report.addedCount, options.report.removedCount))
    lines.push(formatProgressLine(options.report.counters))
  } else if (options.progress?.counters) {
    lines.push(
      formatPackagesLine(options.progress.packagesPlus ?? 0, options.progress.packagesMinus ?? 0),
    )
    lines.push(formatProgressLine(options.progress.counters))
  }
  if (options.cancelled) {
    lines.push('^C')
  } else if (options.error) {
    lines.push(options.error)
  }
  return lines.join('\n')
}

/** 仅透出 warn/error，避免把内部 info 流水账打进终端默认视图 */
export function formatInstallWarningLines(logs: PackageLogLine[]): string[] {
  return logs
    .filter((line) => line.level === 'warn' || line.level === 'error')
    .map((line) => {
      if (line.level === 'warn') return `WARN\t${line.message}`
      return `ERR!\t${line.message}`
    })
}

export function emptyCounters(): PackageInstallCounters {
  return { resolved: 0, reused: 0, downloaded: 0, added: 0 }
}
