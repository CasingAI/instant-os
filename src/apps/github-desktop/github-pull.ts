import { osNowMs } from '../../os/os-clock.ts'
import {
  githubCompare,
  githubDownloadZipball,
  githubGetBranchTip,
  githubGetFileContent,
} from './github-api.ts'
import { joinFilesAbsolutePath } from '../files/files-path.ts'
import { githubRepoRootPath } from './github-repo-paths.ts'
import {
  buildFileIndex,
  saveGithubRepoMeta,
  type GithubRepoSyncMeta,
} from './github-sync-meta.ts'
import { collectWorkingTreeFiles, detectGithubChanges } from './github-changes.ts'
import {
  materializeFilesToRepo,
  removeWorkingTreePath,
  unzipGithubZipball,
  writeWorkingTreeFile,
  type GithubProgress,
} from './github-working-tree.ts'

/** 变更文件数超过此阈值时回退整包 zip */
const INCREMENTAL_FILE_LIMIT = 80

export async function pullGithubRepository(params: {
  meta: GithubRepoSyncMeta
  onProgress?: GithubProgress
}): Promise<GithubRepoSyncMeta> {
  const { meta, onProgress } = params
  const localChanges = await detectGithubChanges(meta)
  if (localChanges.length > 0) {
    throw new Error('本地有未提交变更，请先提交或丢弃后再拉取')
  }

  onProgress?.('检查远端分支…')
  const remoteSha = await githubGetBranchTip(meta.owner, meta.repo, meta.currentBranch)
  if (remoteSha === meta.headSha) {
    onProgress?.('已是最新')
    return meta
  }

  onProgress?.('比较本地与远端差异…')
  const compare = await githubCompare(meta.owner, meta.repo, meta.headSha, remoteSha)

  if (compare.files.length > INCREMENTAL_FILE_LIMIT) {
    onProgress?.(`变更文件较多（${compare.files.length}），改用完整压缩包…`)
    return rematerializeFromZip({
      meta,
      ref: meta.currentBranch,
      headSha: remoteSha,
      onProgress,
    })
  }

  const root = githubRepoRootPath(meta.owner, meta.repo)
  let applied = 0
  for (const file of compare.files) {
    const absolute = joinFilesAbsolutePath(root, ...file.filename.split('/'))
    if (file.status === 'removed') {
      await removeWorkingTreePath(absolute)
    } else {
      const bytes = await githubGetFileContent(
        meta.owner,
        meta.repo,
        file.filename,
        remoteSha,
      )
      await writeWorkingTreeFile(absolute, bytes)
    }
    applied += 1
    if (applied % 10 === 0) {
      onProgress?.(`应用变更 ${applied}/${compare.files.length}…`)
    }
  }

  onProgress?.('更新同步快照…')
  const working = await collectWorkingTreeFiles(meta.owner, meta.repo)
  const fileIndex = await buildFileIndex(working)
  const next: GithubRepoSyncMeta = {
    ...meta,
    headSha: remoteSha,
    fileIndex,
    updatedAt: osNowMs(),
  }
  await saveGithubRepoMeta(next)
  return next
}

async function rematerializeFromZip(params: {
  meta: GithubRepoSyncMeta
  ref: string
  headSha: string
  onProgress?: GithubProgress
}): Promise<GithubRepoSyncMeta> {
  const { meta, onProgress } = params
  onProgress?.('下载压缩包…')
  const zip = await githubDownloadZipball(meta.owner, meta.repo, params.ref)
  const files = await unzipGithubZipball(zip)
  await materializeFilesToRepo(meta.owner, meta.repo, files, onProgress)
  const working = await collectWorkingTreeFiles(meta.owner, meta.repo)
  const fileIndex = await buildFileIndex(working)
  const next: GithubRepoSyncMeta = {
    ...meta,
    headSha: params.headSha,
    fileIndex,
    updatedAt: osNowMs(),
  }
  await saveGithubRepoMeta(next)
  return next
}

export async function switchGithubBranch(params: {
  meta: GithubRepoSyncMeta
  branch: string
  onProgress?: GithubProgress
}): Promise<GithubRepoSyncMeta> {
  const branch = params.branch.trim()
  if (!branch) throw new Error('分支名无效')
  if (branch === params.meta.currentBranch) return params.meta

  const localChanges = await detectGithubChanges(params.meta)
  if (localChanges.length > 0) {
    throw new Error('本地有未提交变更，请先提交或丢弃后再切换分支')
  }

  params.onProgress?.(`切换到 ${branch}…`)
  const headSha = await githubGetBranchTip(params.meta.owner, params.meta.repo, branch)
  return rematerializeFromZip({
    meta: {
      ...params.meta,
      currentBranch: branch,
    },
    ref: branch,
    headSha,
    onProgress: params.onProgress,
  })
}
