import { loadGithubCredentials } from '../../os/github-credentials-storage.ts'
import {
  isProxyServerConnected,
  proxiedFetch,
  ProxyServerApiError,
} from '../../os/proxy-server-api.ts'
import { formatGithubByteSize } from './github-format-bytes.ts'
import type { GithubProgress } from './github-progress.ts'

const GITHUB_API = 'https://api.github.com'

/** zipball 经代理下载；未连接时代码与 UI 共用此文案 */
export const GITHUB_ZIPBALL_PROXY_REQUIRED_MESSAGE =
  '克隆/整包下载需要云服务。请先在「系统设置 → 云服务」中配置并连接'

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
  /** 账户主邮箱（来自 /user/emails）；无权限或未配置时为 undefined */
  email: string | undefined
  avatarUrl: string | undefined
}

export type GithubRepoVisibility = 'public' | 'private' | 'internal'

export type GithubRepoOwnerInfo = {
  login: string
  id: number
  avatarUrl?: string
  type?: string
}

export type GithubRepoLicenseInfo = {
  key: string
  name: string
  spdxId?: string
  url?: string
}

/** GitHub REST `repos` 资源中适合本地缓存的字段 */
export type GithubRepoSummary = {
  id: number
  name: string
  fullName: string
  owner: GithubRepoOwnerInfo
  private: boolean
  visibility: GithubRepoVisibility
  htmlUrl: string
  description?: string
  fork: boolean
  createdAt: string
  updatedAt: string
  pushedAt?: string
  homepage?: string
  size?: number
  stargazersCount: number
  watchersCount: number
  language?: string
  forksCount: number
  openIssuesCount: number
  defaultBranch: string
  topics: string[]
  archived: boolean
  disabled: boolean
  isTemplate: boolean
  hasIssues: boolean
  hasProjects: boolean
  hasWiki: boolean
  hasPages: boolean
  license?: GithubRepoLicenseInfo
}

export function githubRepoOwnerLogin(owner: GithubRepoOwnerInfo | string): string {
  return typeof owner === 'string' ? owner : owner.login
}

export function formatGithubRepoVisibilityLabel(
  info: Pick<GithubRepoSummary, 'private' | 'visibility'>,
): string {
  if (info.visibility === 'internal') return '内部'
  return info.private ? '私有' : '公开'
}

export function formatGithubRepoVisibilitySuffix(
  info: Pick<GithubRepoSummary, 'private' | 'visibility'>,
): string {
  if (info.visibility === 'public' && !info.private) return ''
  return `（${formatGithubRepoVisibilityLabel(info)}）`
}

type GithubRepoApiJson = {
  id: number
  name: string
  full_name: string
  private: boolean
  visibility?: string | null
  html_url: string
  description?: string | null
  fork: boolean
  created_at: string
  updated_at: string
  pushed_at?: string | null
  homepage?: string | null
  size?: number
  stargazers_count?: number
  watchers_count?: number
  language?: string | null
  forks_count?: number
  open_issues_count?: number
  default_branch: string
  topics?: string[]
  archived?: boolean
  disabled?: boolean
  is_template?: boolean
  has_issues?: boolean
  has_projects?: boolean
  has_wiki?: boolean
  has_pages?: boolean
  license?: {
    key: string
    name: string
    spdx_id?: string | null
    url?: string | null
  } | null
  owner: {
    login: string
    id: number
    avatar_url?: string
    type?: string
  }
}

function parseGithubRepoVisibility(
  data: Pick<GithubRepoApiJson, 'private' | 'visibility'>,
): GithubRepoVisibility {
  if (data.visibility === 'public' || data.visibility === 'private' || data.visibility === 'internal') {
    return data.visibility
  }
  return data.private ? 'private' : 'public'
}

function parseGithubRepoJson(data: GithubRepoApiJson): GithubRepoSummary {
  const license = data.license
    ? {
        key: data.license.key,
        name: data.license.name,
        spdxId: data.license.spdx_id ?? undefined,
        url: data.license.url ?? undefined,
      }
    : undefined

  return {
    id: data.id,
    name: data.name,
    fullName: data.full_name,
    owner: {
      login: data.owner.login,
      id: data.owner.id,
      avatarUrl: data.owner.avatar_url ?? undefined,
      type: data.owner.type ?? undefined,
    },
    private: data.private,
    visibility: parseGithubRepoVisibility(data),
    htmlUrl: data.html_url,
    description: data.description ?? undefined,
    fork: data.fork,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    pushedAt: data.pushed_at ?? undefined,
    homepage: data.homepage ?? undefined,
    size: data.size,
    stargazersCount: data.stargazers_count ?? 0,
    watchersCount: data.watchers_count ?? 0,
    language: data.language ?? undefined,
    forksCount: data.forks_count ?? 0,
    openIssuesCount: data.open_issues_count ?? 0,
    defaultBranch: data.default_branch,
    topics: data.topics ?? [],
    archived: data.archived ?? false,
    disabled: data.disabled ?? false,
    isTemplate: data.is_template ?? false,
    hasIssues: data.has_issues ?? true,
    hasProjects: data.has_projects ?? true,
    hasWiki: data.has_wiki ?? true,
    hasPages: data.has_pages ?? false,
    license,
  }
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
  const { raw, ...requestInit } = init ?? {}
  const headers = new Headers(requestInit.headers)
  headers.set('Authorization', `Bearer ${token}`)
  // 易错点：/contents/{path} 默认返回 Contents API 的 JSON 包装（name/path/sha/base64 content），
  // 不是文件正文。若把这份 JSON 写进工作区或 baseline，Diff 会拿 JSON 跟真实文件比，看起来「原文完全不对」。
  // 取正文必须用 raw:true（Accept: application/vnd.github.raw），且绝不能被下面的默认 JSON Accept 盖掉。
  if (raw) {
    headers.set('Accept', 'application/vnd.github.raw')
  } else if (!headers.has('Accept')) {
    headers.set('Accept', 'application/vnd.github+json')
  }
  headers.set('X-GitHub-Api-Version', '2022-11-28')
  if (requestInit.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${GITHUB_API}${path}`, {
    ...requestInit,
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
    email?: string | null
    avatar_url?: string
  }>('/user')
  const emailFromProfile =
    typeof data.email === 'string' && data.email.trim() ? data.email.trim() : undefined
  // /user.email 仅在公开可见时有值；完整列表需 user:email（classic）或 Email addresses 读权限
  const email = emailFromProfile ?? (await githubTryGetPrimaryEmail())
  return {
    login: data.login,
    name: data.name ?? undefined,
    email,
    avatarUrl: data.avatar_url,
  }
}

type GithubEmailEntry = {
  email: string
  primary: boolean
  verified: boolean
  visibility?: string | null
}

/** 选出更适合作为 commit author 的邮箱：主+已验证 > 主 > 已验证 > 第一条 */
export function pickGithubPrimaryEmail(emails: readonly GithubEmailEntry[]): string | undefined {
  const cleaned = emails
    .map((entry) => ({
      ...entry,
      email: entry.email.trim(),
    }))
    .filter((entry) => entry.email.length > 0)
  if (cleaned.length === 0) return undefined
  return (
    cleaned.find((entry) => entry.primary && entry.verified)?.email ??
    cleaned.find((entry) => entry.primary)?.email ??
    cleaned.find((entry) => entry.verified)?.email ??
    cleaned[0]?.email
  )
}

/** 无权限或失败时返回 undefined，不抛错（Token 常没有 user:email） */
export async function githubTryGetPrimaryEmail(): Promise<string | undefined> {
  try {
    const data = await githubJson<GithubEmailEntry[]>('/user/emails')
    return pickGithubPrimaryEmail(data)
  } catch {
    return undefined
  }
}

export async function githubListUserRepos(options?: {
  perPage?: number
  page?: number
}): Promise<GithubRepoSummary[]> {
  const perPage = options?.perPage ?? 50
  const page = options?.page ?? 1
  const data = await githubJson<GithubRepoApiJson[]>(
    `/user/repos?sort=updated&per_page=${perPage}&page=${page}&affiliation=owner,collaborator,organization_member`,
  )

  return data.map(parseGithubRepoJson)
}

export async function githubGetRepo(
  owner: string,
  repo: string,
): Promise<GithubRepoSummary> {
  const data = await githubJson<GithubRepoApiJson>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
  )

  return parseGithubRepoJson(data)
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

export type GithubCommitSummary = {
  sha: string
  message: string
  authorName: string
  authorDate: string
}

export type GithubCommitFileChange = {
  filename: string
  status: string
  patch?: string
}

export type GithubCommitDetail = {
  sha: string
  message: string
  authorName: string
  authorDate: string
  files: GithubCommitFileChange[]
}

export async function githubListCommits(
  owner: string,
  repo: string,
  sha: string,
  perPage = 50,
): Promise<GithubCommitSummary[]> {
  const data = await githubJson<
    Array<{
      sha: string
      commit: {
        message: string
        author?: { name?: string; date?: string }
      }
    }>
  >(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?sha=${encodeURIComponent(sha)}&per_page=${perPage}`,
  )

  return data.map((item) => ({
    sha: item.sha,
    message: item.commit.message,
    authorName: item.commit.author?.name?.trim() || 'unknown',
    authorDate: item.commit.author?.date ?? '',
  }))
}

export async function githubGetCommit(
  owner: string,
  repo: string,
  sha: string,
): Promise<GithubCommitDetail> {
  const data = await githubJson<{
    sha: string
    commit: {
      message: string
      author?: { name?: string; date?: string }
    }
    files?: Array<{
      filename: string
      status: string
      patch?: string
    }>
  }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sha)}`,
  )

  return {
    sha: data.sha,
    message: data.commit.message,
    authorName: data.commit.author?.name?.trim() || 'unknown',
    authorDate: data.commit.author?.date ?? '',
    files: (data.files ?? []).map((file) => ({
      filename: file.filename,
      status: file.status,
      patch: file.patch,
    })),
  }
}

/**
 * 流式读取响应体，并按块上报下载进度。
 */
async function readResponseBodyWithProgress(
  response: Response,
  onProgress?: GithubProgress,
): Promise<ArrayBuffer> {
  const body = response.body
  if (!body) {
    const buffer = await response.arrayBuffer()
    if (onProgress && buffer.byteLength > 0) {
      reportZipballDownloadProgress(onProgress, buffer.byteLength, buffer.byteLength)
    }
    return buffer
  }

  const contentLength = response.headers.get('content-length')
  const parsedTotal = contentLength ? Number(contentLength) : undefined
  const totalBytes =
    parsedTotal !== undefined && Number.isFinite(parsedTotal) && parsedTotal >= 0
      ? parsedTotal
      : undefined

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let downloaded = 0
  let lastReportAt = 0

  const maybeReport = (force = false) => {
    if (!onProgress) return
    const now = Date.now()
    if (!force && now - lastReportAt < 120) return
    lastReportAt = now
    reportZipballDownloadProgress(onProgress, downloaded, totalBytes)
  }

  maybeReport(true)

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      downloaded += value.byteLength
      maybeReport()
    }
  }

  maybeReport(true)

  const buffer = new Uint8Array(downloaded)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.byteLength
  }
  return buffer.buffer
}

function reportZipballDownloadProgress(
  onProgress: GithubProgress,
  downloadedBytes: number,
  totalBytes: number | undefined,
): void {
  const downloadedLabel = formatGithubByteSize(downloadedBytes)
  const message =
    totalBytes !== undefined
      ? `下载压缩包… ${downloadedLabel} / ${formatGithubByteSize(totalBytes)}`
      : `下载压缩包… ${downloadedLabel}`
  const fraction =
    totalBytes !== undefined && totalBytes > 0 ? downloadedBytes / totalBytes : undefined
  onProgress(message, { fraction, downloadedBytes, totalBytes })
}

/**
 * 经系统代理下载 zipball。
 * 直连会 302 到 codeload.github.com 并被浏览器 CORS 拦截。
 */
export async function githubDownloadZipball(
  owner: string,
  repo: string,
  ref: string,
  onProgress?: GithubProgress,
): Promise<ArrayBuffer> {
  if (!isProxyServerConnected()) {
    throw new GithubApiError(0, GITHUB_ZIPBALL_PROXY_REQUIRED_MESSAGE)
  }

  const token = getToken()
  const headers = new Headers()
  headers.set('Authorization', `Bearer ${token}`)
  headers.set('Accept', 'application/vnd.github+json')
  headers.set('X-GitHub-Api-Version', '2022-11-28')

  const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zipball/${encodeURIComponent(ref)}`

  let response: Response
  try {
    response = await proxiedFetch(url, { headers })
  } catch (error) {
    if (error instanceof ProxyServerApiError) {
      throw new GithubApiError(0, error.message)
    }
    throw error
  }

  if (!response.ok) {
    let detail = response.statusText
    try {
      const text = (await response.text()).trim()
      if (text) {
        // Worker 失败时可能返回 ERR… 短文本；GitHub 也可能回 JSON
        try {
          const body = JSON.parse(text) as { message?: string }
          detail = body.message?.trim() || text.slice(0, 200)
        } catch {
          detail = text.slice(0, 200)
        }
      }
    } catch {
      // ignore
    }
    if (response.status === 401) {
      throw new GithubApiError(401, 'GitHub 认证失败，请检查 Personal Access Token')
    }
    if (response.status === 403) {
      throw new GithubApiError(403, `GitHub API 拒绝访问：${detail}`)
    }
    throw new GithubApiError(
      response.status,
      `下载压缩包失败（${response.status}）：${detail}`,
    )
  }

  return readResponseBodyWithProgress(response, onProgress)
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

/**
 * 拉取某 ref 下文件的**原始字节**（不是 Contents JSON）。
 * 见 githubFetch 的 Accept/raw 注释：此处一旦拿错，会污染工作区与 baseline。
 * 校验用响应头，不猜正文——仓库里真实的 .json 文件完全可能长得像 Contents 包装。
 */
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
    { raw: true },
  )
  const mediaType = (response.headers.get('X-GitHub-Media-Type') ?? '').toLowerCase()
  // 只要到 raw 却仍是 format=json，说明 Accept 又被盖掉了。不根据正文形态判断（真 .json 文件会误杀）。
  if (mediaType.includes('format=json')) {
    throw new GithubApiError(
      500,
      `GitHub 未按 raw 返回文件正文（${owner}/${repo}:${path}@${ref}，X-GitHub-Media-Type=${mediaType}）。请检查 Accept/raw 请求头。`,
    )
  }
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
    author?: { name: string; email: string; date?: string }
  },
): Promise<string> {
  const body: Record<string, unknown> = {
    message: params.message,
    tree: params.treeSha,
    parents: [params.parentSha],
  }
  if (params.author) {
    const identity = {
      name: params.author.name,
      email: params.author.email,
      ...(params.author.date ? { date: params.author.date } : {}),
    }
    body.author = identity
    body.committer = identity
  }
  const data = await githubJson<{ sha: string }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits`,
    {
      method: 'POST',
      body: JSON.stringify(body),
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

/** 在远端创建新分支（sha 必须是 GitHub 上已有的 commit） */
export async function githubCreateBranchRef(
  owner: string,
  repo: string,
  branch: string,
  commitSha: string,
): Promise<void> {
  await githubJson(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({
      ref: `refs/heads/${branch}`,
      sha: commitSha,
    }),
  })
}
