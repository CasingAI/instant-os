import { filesStat } from '../files/files-api.ts'
import { filesLocationPathRoot, joinFilesAbsolutePath } from '../files/files-path.ts'
import {
  getGithubRepoMeta,
  type GithubRepoSyncMeta,
} from './github-sync-meta.ts'

export const GITHUB_REPO_HOST = 'github'

const DEV_FILES_ROOT = filesLocationPathRoot('dev')

/** GitHub 卷下用户可见的命名空间根 */
export const GITHUB_USER_ROOT = joinFilesAbsolutePath(DEV_FILES_ROOT, GITHUB_REPO_HOST)

/** 基线 blob 对象库（仅 GitHub Desktop 内部写入） */
export const GITHUB_OBJECTS_ROOT = joinFilesAbsolutePath(GITHUB_USER_ROOT, '.objects')

export function githubUserRootPath(...segments: string[]): string {
  return joinFilesAbsolutePath(GITHUB_USER_ROOT, ...segments)
}

export function githubRepoRootPath(owner: string, repo: string): string {
  return joinFilesAbsolutePath(DEV_FILES_ROOT, GITHUB_REPO_HOST, owner, repo)
}

export function githubRepoId(owner: string, repo: string): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}`
}

export function parseGithubRepoId(id: string): { owner: string; repo: string } | undefined {
  const parts = id.split('/')
  if (parts.length !== 2) return undefined
  const owner = parts[0]?.trim()
  const repo = parts[1]?.trim()
  if (!owner || !repo) return undefined
  return { owner, repo }
}

/**
 * 从绝对路径识别 `/dev/github/{owner}/{repo}` 及其子路径。
 * 不含 `.objects` 等内部目录。
 */
export function parseGithubRepoPath(
  absolutePath: string,
): { owner: string; repo: string; repoRoot: string } | undefined {
  const normalized = absolutePath.trim().replace(/\/+$/, '') || '/'
  const prefix = `${GITHUB_USER_ROOT}/`
  if (normalized !== GITHUB_USER_ROOT && !normalized.startsWith(prefix)) {
    return undefined
  }
  if (normalized === GITHUB_USER_ROOT) return undefined

  const rest = normalized.slice(prefix.length)
  const parts = rest.split('/').filter(Boolean)
  if (parts.length < 2) return undefined

  const owner = parts[0]?.trim()
  const repo = parts[1]?.trim()
  if (!owner || !repo) return undefined
  if (owner.startsWith('.')) return undefined

  const repoRoot = githubRepoRootPath(owner, repo)
  return { owner, repo, repoRoot }
}

/**
 * 从 cwd（或工作区路径）解析已同步的 GitHub 仓库 meta。
 * 路径须落在 `/dev/github/{owner}/{repo}` 下，且本地有 meta / 工作树。
 */
export async function resolveGithubRepoFromCwd(cwd: string): Promise<GithubRepoSyncMeta> {
  const parsed = parseGithubRepoPath(cwd)
  if (!parsed) {
    throw new Error(
      `当前路径不在 GitHub 工作树内（须为 ${GITHUB_USER_ROOT}/{owner}/{repo} 或其子路径）。可用 github_clone 克隆，或在 GitHub Desktop 中打开仓库。`,
    )
  }

  const meta = await getGithubRepoMeta(parsed.owner, parsed.repo)
  if (!meta || meta.missing) {
    throw new Error(
      `未找到本地同步记录：${parsed.owner}/${parsed.repo}。请先 github_clone 或在 GitHub Desktop 中克隆。`,
    )
  }

  const present = await filesStat(parsed.repoRoot)
  if (!present) {
    throw new Error(
      `工作树缺失：${parsed.repoRoot}。请重新克隆或在 GitHub Desktop 中恢复。`,
    )
  }

  return meta
}

/** 从 GitHub 仓库 URL 或 git@github.com SSH 地址解析 owner/repo */
export function parseGithubRepoUrl(input: string): { owner: string; repo: string } | undefined {
  const trimmed = input.trim()
  if (!trimmed) return undefined

  const sshMatch = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(trimmed)
  if (sshMatch) {
    const owner = sshMatch[1]?.trim()
    const repo = sshMatch[2]?.trim()
    if (owner && repo) return { owner, repo }
  }

  let urlStr = trimmed
  if (!/^[a-z]+:/i.test(trimmed)) {
    urlStr = `https://${trimmed}`
  }

  try {
    const url = new URL(urlStr)
    const host = url.hostname.toLowerCase()
    if (host !== 'github.com' && host !== 'www.github.com') return undefined

    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length < 2) return undefined

    const owner = parts[0]?.trim()
    let repo = parts[1]?.trim()
    if (!owner || !repo) return undefined

    if (repo.endsWith('.git')) {
      repo = repo.slice(0, -4)
    }

    return { owner, repo }
  } catch {
    return undefined
  }
}
