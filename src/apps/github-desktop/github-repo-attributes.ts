/**
 * 一次性修补已有 dev 卷节点属性：系统目录只读，工作区根可写。
 * 不覆盖工作区内部已有节点的自有属性。
 */
import { listChildNodes, updateNodeAttributes } from '../files/files-storage.ts'
import type { FilesNode, FilesNodeAttributes } from '../files/files-types.ts'
import { resolveNodeByAbsolutePath } from '../files/files-vfs.ts'
import { GITHUB_OBJECTS_ROOT, GITHUB_USER_ROOT } from './github-repo-paths.ts'

const SYSTEM_ATTRIBUTES: FilesNodeAttributes = { readable: true, writable: false }
const WORKSPACE_ATTRIBUTES: FilesNodeAttributes = { readable: true, writable: true }

let reconcilePromise: Promise<void> | undefined

function attributesMatch(a: FilesNodeAttributes, b: FilesNodeAttributes): boolean {
  return a.readable === b.readable && a.writable === b.writable
}

async function ensureNodeAttributes(
  node: FilesNode,
  attributes: FilesNodeAttributes,
): Promise<void> {
  if (attributesMatch(node.attributes, attributes)) return
  await updateNodeAttributes(node.id, attributes)
}

async function reconcileObjectsTree(folder: FilesNode): Promise<void> {
  await ensureNodeAttributes(folder, SYSTEM_ATTRIBUTES)
  const children = await listChildNodes('dev', folder.id)
  for (const child of children) {
    if (child.kind === 'folder') {
      await reconcileObjectsTree(child)
    } else {
      await ensureNodeAttributes(child, SYSTEM_ATTRIBUTES)
    }
  }
}

async function reconcileOnce(): Promise<void> {
  const githubRoot = await resolveNodeByAbsolutePath(GITHUB_USER_ROOT)
  if (!githubRoot || githubRoot.kind !== 'folder') return
  await ensureNodeAttributes(githubRoot, SYSTEM_ATTRIBUTES)

  const topChildren = await listChildNodes('dev', githubRoot.id)
  for (const child of topChildren) {
    if (child.kind !== 'folder') continue

    if (child.name === '.objects') {
      await reconcileObjectsTree(child)
      continue
    }

    // owner 层：只读
    await ensureNodeAttributes(child, SYSTEM_ATTRIBUTES)
    const repos = await listChildNodes('dev', child.id)
    for (const repoNode of repos) {
      if (repoNode.kind !== 'folder') continue
      // 工作区根：可写；内部节点不覆盖
      await ensureNodeAttributes(repoNode, WORKSPACE_ATTRIBUTES)
    }
  }

  const objectsRoot = await resolveNodeByAbsolutePath(GITHUB_OBJECTS_ROOT)
  if (objectsRoot?.kind === 'folder') {
    await reconcileObjectsTree(objectsRoot)
  }
}

/** 幂等修补 dev 卷 GitHub 相关文件夹属性；可在启动时调用 */
export function reconcileGithubRepoAttributes(): Promise<void> {
  if (!reconcilePromise) {
    reconcilePromise = reconcileOnce().catch((err) => {
      reconcilePromise = undefined
      throw err
    })
  }
  return reconcilePromise
}
