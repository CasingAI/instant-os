/**
 * 工作区目录创建 + 写入链路回归测试（对齐轮 ensureAlignSession / writeAlignMaterials 的调用序）。
 * 覆盖「父文件夹不存在」类问题：目录链必须可自愈创建、重复写入必须可覆写。
 * 运行：node --experimental-strip-types src/apps/stems/phoneme-workspace-ensure.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { filesReadText, filesStat } from '../files/files-api.ts'
import { resetFilesDbForTests } from '../files/files-storage.ts'
import { ensureTmpFolder } from '../files/files-tmp.ts'
import { invalidateFilesVfsPathCaches } from '../files/files-vfs.ts'

/** 与 phoneme-app.tsx writeTextOrCreate 完全一致 */
async function writeTextOrCreate(path: string, text: string): Promise<void> {
  const existing = await filesStat(path)
  if (existing === undefined) {
    await filesCreateText(path, text)
    return
  }
  if (existing.kind !== 'file') {
    throw new Error(`路径冲突：${path} 不是文件`)
  }
  await filesWriteText(path, text)
}

import { filesCreateText, filesWriteText } from '../files/files-api.ts'

/** 复刻 ensureAlignSession：先 ensure 目录，再创建 aligned.lrc */
async function ensureSessionWorkspace(workspaceDir: string): Promise<void> {
  await ensureTmpFolder(workspaceDir)
  await writeTextOrCreate(`${workspaceDir}/aligned.lrc`, '')
}

async function testWorkspaceChain(): Promise<void> {
  await resetFilesDbForTests()
  invalidateFilesVfsPathCaches()

  // 全新会话：/tmp/Terminal 不存在 → 递归创建 → aligned.lrc 可写
  const workspaceDir = '/tmp/Terminal/vsterm-workspace-1/phoneme-align'
  await ensureSessionWorkspace(workspaceDir)
  assert.equal((await filesStat(`${workspaceDir}/aligned.lrc`))?.kind, 'file')

  // writeAlignMaterials：素材文件创建
  await writeTextOrCreate(`${workspaceDir}/lyrics.txt`, '第一行\n第二行')
  await writeTextOrCreate(`${workspaceDir}/phones.tsv`, '0.10\t0.24\ttɕ\ttɕ')
  assert.equal((await filesReadText(`${workspaceDir}/lyrics.txt`)).includes('第一行'), true)

  // 再次对齐：目录已存在 → 覆写 aligned.lrc 与素材
  await writeTextOrCreate(`${workspaceDir}/aligned.lrc`, '[00:01.00]<00:01.00>字')
  await writeTextOrCreate(`${workspaceDir}/lyrics.txt`, '新歌词')
  assert.equal(await filesReadText(`${workspaceDir}/aligned.lrc`), '[00:01.00]<00:01.00>字')
  assert.equal(await filesReadText(`${workspaceDir}/lyrics.txt`), '新歌词')
}

async function runAll(): Promise<void> {
  await testWorkspaceChain()
  console.log('phoneme-workspace-ensure: 全部通过')
}

runAll().catch((error) => {
  console.error(error)
  process.exit(1)
})
