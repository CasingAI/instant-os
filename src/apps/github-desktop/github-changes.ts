import { filesReadText } from '../files/files-api.ts'
import { joinFilesAbsolutePath } from '../files/files-path.ts'
import { githubRepoRootPath } from './github-repo-paths.ts'
import { hashBytes, type GithubRepoSyncMeta } from './github-sync-meta.ts'
import {
  collectWorkingTreeFiles,
  isProbablyTextBytes,
  readWorkingTreeBytes,
} from './github-working-tree.ts'

export type GithubChangeKind = 'added' | 'modified' | 'deleted'

export type GithubChange = {
  path: string
  kind: GithubChangeKind
  absolutePath: string
}

export { collectWorkingTreeFiles, readWorkingTreeBytes }

export async function detectGithubChanges(
  meta: GithubRepoSyncMeta,
): Promise<GithubChange[]> {
  const root = githubRepoRootPath(meta.owner, meta.repo)
  const working = await collectWorkingTreeFiles(meta.owner, meta.repo)
  const changes: GithubChange[] = []

  for (const [path, bytes] of working) {
    const absolutePath = joinFilesAbsolutePath(root, ...path.split('/'))
    const previous = meta.fileIndex[path]
    const hash = await hashBytes(bytes)
    if (!previous) {
      changes.push({ path, kind: 'added', absolutePath })
    } else if (previous.hash !== hash) {
      changes.push({ path, kind: 'modified', absolutePath })
    }
  }

  for (const path of Object.keys(meta.fileIndex)) {
    if (!working.has(path)) {
      changes.push({
        path,
        kind: 'deleted',
        absolutePath: joinFilesAbsolutePath(root, ...path.split('/')),
      })
    }
  }

  changes.sort((a, b) => a.path.localeCompare(b.path))
  return changes
}

async function readPathAsText(absolutePath: string): Promise<string> {
  try {
    return await filesReadText(absolutePath)
  } catch {
    const bytes = await readWorkingTreeBytes(absolutePath)
    if (!isProbablyTextBytes(bytes)) {
      return `（二进制文件，${bytes.byteLength} 字节）\n`
    }
    return new TextDecoder().decode(bytes)
  }
}

/** 变更预览：无旧版正文缓存时展示当前内容或删除说明 */
export async function buildChangePreview(
  _meta: GithubRepoSyncMeta,
  change: GithubChange,
): Promise<string> {
  if (change.kind === 'added') {
    const text = await readPathAsText(change.absolutePath)
    return `--- /dev/null\n+++ b/${change.path}\n${text
      .split('\n')
      .map((line) => `+${line}`)
      .join('\n')}\n`
  }
  if (change.kind === 'deleted') {
    return `--- a/${change.path}\n+++ /dev/null\n（文件已删除；上次同步正文未本地缓存，无法展示旧内容）\n`
  }
  const text = await readPathAsText(change.absolutePath)
  return `--- a/${change.path}\n+++ b/${change.path}\n@@ 本地修改（无旧版正文缓存，显示当前内容） @@\n${text
    .split('\n')
    .map((line) => ` ${line}`)
    .join('\n')}\n`
}
