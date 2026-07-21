import { loadGithubCredentials } from '../../os/github-credentials-storage.ts'

const GITHUB_API = 'https://api.github.com'

export class GithubApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'GithubApiError'
    this.status = status
  }
}

export type GithubUser = {
  login: string
  name: string | undefined
  avatarUrl: string | undefined
}

export type GithubRepoSummary = {
  id: number
  name: string
  fullName: string
  owner: string
  private: boolean
  defaultBranch: string
  description: string | undefined
  updatedAt: string
}

export type GithubBranch = {
  name: string
  commitSha: string
  protected: boolean
}

export type GithubCompareFile = {
  filename: string
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged'
  previousFilename: string | undefined
  sha: string | undefined
}

export type GithubCompareResult = {
  status: string
  aheadBy: number
  behindBy: number
  totalCommits: number
  files: GithubCompareFile[]
  mergeBaseCommitSha: string | undefined
  headCommitSha: string
}

function getToken(): string {
  const token = loadGithubCredentials().token.trim()
  if (!token) {
    throw new GithubApiError(401, '未配置 GitHub Personal Access Token，请先在钥匙串中设置')
  }
  return token
}

async function githubFetch(
  path: string,
  init?: RequestInit & { raw?: boolean },
): Promise<Response> {
  const token = getToken()
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${token}`)
  headers.set('Accept', 'application/vnd.github+json')
  headers.set('X-GitHub-Api-Version', '2022-11-28')
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers,
  })

  if (!response.ok) {
    let detail = response.statusText
    try {
      const body = (await response.json()) as { message?: string }
      if (body.message) detail = body.message
    } catch {
      // ignore
    }
    if (response.status === 401) {
      throw new GithubApiError(401, 'GitHub 认证失败，请检查 Personal Access Token')
    }
    if (response.status === 403) {
      throw new GithubApiError(403, `GitHub API 拒绝访问：${detail}`)
    }
    throw new GithubApiError(response.status, `GitHub API 错误（${response.status}）：${detail}`)
  }

  return response
}

async function githubJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await githubFetch(path, init)
  return (await response.json()) as T
}

export async function githubGetAuthenticatedUser(): Promise<GithubUser> {
  const data = await githubJson<{
    login: string
    name?: string | null
    avatar_url?: string
  }>('/user')
  return {
    login: data.login,
    name: data.name ?? undefined,
    avatarUrl: data.avatar_url,
  }
}

export async function githubListUserRepos(options?: {
  perPage?: number
  page?: number
}): Promise<GithubRepoSummary[]> {
  const perPage = options?.perPage ?? 50
  const page = options?.page ?? 1
  const data = await githubJson<
    Array<{
      id: number
      name: string
      full_name: string
      private: boolean
      default_branch: string
      description?: string | null
      updated_at: string
      owner: { login: string }
    }>
  >(`/user/repos?sort=updated&per_page=${perPage}&page=${page}&affiliation=owner,collaborator,organization_member`)

  return data.map((item) => ({
    id: item.id,
    name: item.name,
    fullName: item.full_name,
    owner: item.owner.login,
    private: item.private,
    defaultBranch: item.default_branch,
    description: item.description ?? undefined,
    updatedAt: item.updated_at,
  }))
}

export async function githubGetRepo(
  owner: string,
  repo: string,
): Promise<GithubRepoSummary> {
  const data = await githubJson<{
    id: number
    name: string
    full_name: string
    private: boolean
    default_branch: string
    description?: string | null
    updated_at: string
    owner: { login: string }
  }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`)

  return {
    id: data.id,
    name: data.name,
    fullName: data.full_name,
    owner: data.owner.login,
    private: data.private,
    defaultBranch: data.default_branch,
    description: data.description ?? undefined,
    updatedAt: data.updated_at,
  }
}

export async function githubListBranches(
  owner: string,
  repo: string,
): Promise<GithubBranch[]> {
  const data = await githubJson<
    Array<{
      name: string
      commit: { sha: string }
      protected: boolean
    }>
  >(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`)

  return data.map((item) => ({
    name: item.name,
    commitSha: item.commit.sha,
    protected: item.protected,
  }))
}

export async function githubGetBranchTip(
  owner: string,
  repo: string,
  branch: string,
): Promise<string> {
  const data = await githubJson<{
    object: { sha: string }
  }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`,
  )
  return data.object.sha
}

export async function githubDownloadZipball(
  owner: string,
  repo: string,
  ref: string,
): Promise<ArrayBuffer> {
  const response = await githubFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zipball/${encodeURIComponent(ref)}`,
  )
  return response.arrayBuffer()
}

export async function githubCompare(
  owner: string,
  repo: string,
  base: string,
  head: string,
): Promise<GithubCompareResult> {
  const data = await githubJson<{
    status: string
    ahead_by: number
    behind_by: number
    total_commits: number
    files?: Array<{
      filename: string
      status: GithubCompareFile['status']
      previous_filename?: string
      sha?: string
    }>
    merge_base_commit?: { sha: string }
    commits?: Array<{ sha: string }>
  }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
  )

  const headCommitSha =
    data.commits && data.commits.length > 0
      ? (data.commits[data.commits.length - 1]?.sha ?? head)
      : head

  return {
    status: data.status,
    aheadBy: data.ahead_by,
    behindBy: data.behind_by,
    totalCommits: data.total_commits,
    files: (data.files ?? []).map((file) => ({
      filename: file.filename,
      status: file.status,
      previousFilename: file.previous_filename,
      sha: file.sha,
    })),
    mergeBaseCommitSha: data.merge_base_commit?.sha,
    headCommitSha,
  }
}

export async function githubGetFileContent(
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<Uint8Array> {
  const response = await githubFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}?ref=${encodeURIComponent(ref)}`,
    {
      headers: {
        Accept: 'application/vnd.github.raw',
      },
    },
  )
  return new Uint8Array(await response.arrayBuffer())
}

export async function githubCreateBlob(
  owner: string,
  repo: string,
  content: Uint8Array,
  encoding: 'utf-8' | 'base64' = 'base64',
): Promise<string> {
  let bodyContent: string
  if (encoding === 'base64') {
    let binary = ''
    for (let i = 0; i < content.length; i += 1) {
      binary += String.fromCharCode(content[i]!)
    }
    bodyContent = btoa(binary)
  } else {
    bodyContent = new TextDecoder().decode(content)
  }

  const data = await githubJson<{ sha: string }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs`,
    {
      method: 'POST',
      body: JSON.stringify({ content: bodyContent, encoding }),
    },
  )
  return data.sha
}

export async function githubGetCommitTreeSha(
  owner: string,
  repo: string,
  commitSha: string,
): Promise<string> {
  const data = await githubJson<{ tree: { sha: string } }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${encodeURIComponent(commitSha)}`,
  )
  return data.tree.sha
}

export async function githubCreateTree(
  owner: string,
  repo: string,
  baseTreeSha: string,
  entries: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string } | { path: string; mode: '100644'; type: 'blob'; sha: null }>,
): Promise<string> {
  const data = await githubJson<{ sha: string }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees`,
    {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: entries,
      }),
    },
  )
  return data.sha
}

export async function githubCreateCommit(
  owner: string,
  repo: string,
  params: {
    message: string
    treeSha: string
    parentSha: string
  },
): Promise<string> {
  const data = await githubJson<{ sha: string }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits`,
    {
      method: 'POST',
      body: JSON.stringify({
        message: params.message,
        tree: params.treeSha,
        parents: [params.parentSha],
      }),
    },
  )
  return data.sha
}

export async function githubUpdateBranchRef(
  owner: string,
  repo: string,
  branch: string,
  commitSha: string,
  force = false,
): Promise<void> {
  await githubJson(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeURIComponent(branch)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ sha: commitSha, force }),
    },
  )
}
