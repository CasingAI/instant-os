import { joinFilesAbsolutePath } from '../files/files-path.ts'

export const GITHUB_REPO_HOST = 'github'

/** GitHub 卷下用户可见的命名空间根 */
export const GITHUB_USER_ROOT = '/repo/github'

/** 基线 blob 对象库（仅 GitHub Desktop 内部写入） */
export const GITHUB_OBJECTS_ROOT = '/repo/github/.objects'

export function githubUserRootPath(...segments: string[]): string {
  return joinFilesAbsolutePath(GITHUB_USER_ROOT, ...segments)
}

export function githubRepoRootPath(owner: string, repo: string): string {
  return joinFilesAbsolutePath('/repo', GITHUB_REPO_HOST, owner, repo)
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
