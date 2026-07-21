import { joinFilesAbsolutePath } from '../files/files-path.ts'

export const GITHUB_REPO_HOST = 'github'

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
