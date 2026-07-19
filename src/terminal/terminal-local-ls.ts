import { filesList, type FilesApiEntry } from '../apps/files/files-api.ts'
import { formatFilesByteSize } from '../apps/files/files-path.ts'
import { resolveTerminalPath } from './terminal-path.ts'

function parseLsTarget(rest: string): string {
  const tokens = rest.split(/\s+/).filter(Boolean)
  const paths = tokens.filter((token) => !token.startsWith('-'))
  return paths[0] ?? '.'
}

function formatLsMarkdown(entries: FilesApiEntry[]): string {
  if (entries.length === 0) {
    return '_(空目录)_'
  }

  const rows = entries.map((entry) => {
    const kind = entry.kind === 'folder' ? 'dir' : 'file'
    const mode = entry.writable ? 'rw' : 'ro'
    const size = entry.kind === 'folder' ? '—' : formatFilesByteSize(entry.byteSize)
    const name = entry.name.replace(/\|/g, '\\|')
    return `| ${kind} | ${mode} | ${size} | ${name} |`
  })

  return ['| 类型 | 权限 | 大小 | 名称 |', '| --- | --- | ---: | --- |', ...rows].join('\n')
}

/** 本地 ls：不经 AI，直接列目录 */
export async function runTerminalLocalLs(
  cwd: string,
  rest: string,
): Promise<{ text: string; format: 'markdown' } | { error: string }> {
  const target = parseLsTarget(rest)
  try {
    const absolute = resolveTerminalPath(cwd, target)
    const entries = await filesList(absolute)
    return {
      text: formatLsMarkdown(entries),
      format: 'markdown',
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
