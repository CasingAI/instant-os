/**
 * 版本文件夹布局（Versions 整数正式版 + Draft）集成测试。
 * 运行：node --experimental-strip-types src/os/generated-app-versions-layout.test.ts
 *
 * 覆盖（对照第一期验收）：
 * - 建草稿 / 扫最大正式号（排除 Draft）
 * - 发布：草稿升格为 max+1 并只读、立刻再拷新草稿（可写）
 * - 每版本清单读写；树读写
 * - 二期：删非最大号旧档；基于旧档接新号
 * - 文件管理器视角：正式版只读、草稿可写（真实节点属性）
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { resetFilesDbForTests } from '../apps/files/files-storage.ts'
import {
  APP_DRAFT_DIR_NAME,
  ensureDraftTree,
  getMaxFormalVersionNumber,
  hasDraftTree,
  hasVersionsLayout,
  listFormalVersionNumbers,
  listVersionTreeFiles,
  createFormalVersionFrom,
  publishDraftToNewFormalVersion,
  readVersionFileText,
  readVersionManifest,
  removeDraftPath,
  removeFormalVersionTree,
  writeDraftManifest,
  writeDraftTextFile,
  writeVersionTextFile,
  type GeneratedAppVersionManifest,
} from './generated-app-versions-layout.ts'

const APP_ID = 'gen:icode-test-1' as `gen:${string}`

function sampleManifest(name: string): GeneratedAppVersionManifest {
  return {
    format: 'instant-os-generated-app-version',
    name,
    description: '描述',
    category: '内部开发',
    iconEmoji: '🛠️',
    themeColor: '#5856d6',
    tags: [],
  }
}

async function resetState(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await resetFilesDbForTests()
}

async function seedDraftTree(): Promise<void> {
  await writeDraftManifest(APP_ID, sampleManifest('测试应用'))
  await writeDraftTextFile({ appId: APP_ID, relativePath: 'index.html', text: '<html>v1</html>' })
  await writeDraftTextFile({ appId: APP_ID, relativePath: 'js/app.js', text: 'console.log(1)' })
}

async function testEnsureDraftFromTemplate(): Promise<void> {
  await resetState()
  const result = await ensureDraftTree(APP_ID, async () => ({
    manifest: sampleManifest('模板应用'),
    files: [{ path: 'index.html', text: '<html>tpl</html>' }],
  }))
  assert.equal(result, 'created')
  assert.equal(await hasDraftTree(APP_ID), true)
  assert.equal(await hasVersionsLayout(APP_ID), true)
  assert.equal(await getMaxFormalVersionNumber(APP_ID), undefined)
  assert.equal((await readVersionFileText(APP_ID, 'Draft', 'index.html'))!.includes('tpl'), true)
  // 幂等：已存在时不再新建
  assert.equal(
    await ensureDraftTree(APP_ID, async () => {
      throw new Error('不应再建模板')
    }),
    'existed',
  )
}

async function testPublishPromotesDraft(): Promise<void> {
  await resetState()
  await seedDraftTree()
  const v1 = await publishDraftToNewFormalVersion(APP_ID)
  assert.equal(v1, 1)
  assert.deepEqual(await listFormalVersionNumbers(APP_ID), [1])
  assert.equal((await readVersionFileText(APP_ID, 1, 'index.html'))!.includes('v1'), true)
  // 正式版只读属性
  const files = await listVersionTreeFiles(APP_ID, 1)
  assert.ok(files.every((file) => file.node.attributes.writable === false))
  // 发布后立刻再拷一棵可写草稿
  assert.equal(await hasDraftTree(APP_ID), true)
  const draftFiles = await listVersionTreeFiles(APP_ID, APP_DRAFT_DIR_NAME)
  assert.ok(draftFiles.every((file) => file.node.attributes.writable === true))
  // 草稿再改不影响正式版
  await writeDraftTextFile({ appId: APP_ID, relativePath: 'index.html', text: '<html>v2</html>' })
  assert.equal((await readVersionFileText(APP_ID, 1, 'index.html'))!.includes('v1'), true)

  const v2 = await publishDraftToNewFormalVersion(APP_ID)
  assert.equal(v2, 2)
  assert.deepEqual(await listFormalVersionNumbers(APP_ID), [1, 2])
  assert.equal((await readVersionFileText(APP_ID, 2, 'index.html'))!.includes('v2'), true)
}

async function testDraftScanExcludesDraftName(): Promise<void> {
  await resetState()
  await seedDraftTree()
  assert.deepEqual(await listFormalVersionNumbers(APP_ID), [])
  assert.equal(await getMaxFormalVersionNumber(APP_ID), undefined)
}

async function testFormalManifestPerVersion(): Promise<void> {
  await resetState()
  await seedDraftTree()
  await publishDraftToNewFormalVersion(APP_ID)
  await writeDraftManifest(APP_ID, sampleManifest('改名后'))
  await publishDraftToNewFormalVersion(APP_ID)
  assert.equal((await readVersionManifest(APP_ID, 1))!.name, '测试应用')
  assert.equal((await readVersionManifest(APP_ID, 2))!.name, '改名后')
}

async function testRemoveDraftPath(): Promise<void> {
  await resetState()
  await seedDraftTree()
  await removeDraftPath(APP_ID, 'js/app.js')
  const files = await listVersionTreeFiles(APP_ID, APP_DRAFT_DIR_NAME)
  assert.equal(files.some((file) => file.path === 'js/app.js'), false)
}

async function testGovernance(): Promise<void> {
  await resetState()
  await seedDraftTree()
  await publishDraftToNewFormalVersion(APP_ID)
  await writeDraftTextFile({ appId: APP_ID, relativePath: 'index.html', text: '<html>v2</html>' })
  await publishDraftToNewFormalVersion(APP_ID)
  await writeDraftTextFile({ appId: APP_ID, relativePath: 'index.html', text: '<html>v3</html>' })
  await publishDraftToNewFormalVersion(APP_ID)
  assert.deepEqual(await listFormalVersionNumbers(APP_ID), [1, 2, 3])

  // 不能删当前最大号
  await assert.rejects(() => removeFormalVersionTree(APP_ID, 3))
  // 删非最大号旧档：只删那一棵树
  await removeFormalVersionTree(APP_ID, 2)
  assert.deepEqual(await listFormalVersionNumbers(APP_ID), [1, 3])
  assert.equal(await readVersionFileText(APP_ID, 3, 'index.html'), '<html>v3</html>')
  // 草稿不受影响
  assert.equal(await hasDraftTree(APP_ID), true)

  // 基于旧档 1 接出新的最大号 4：内容与清单与 1 一致
  const v4 = await createFormalVersionFrom(APP_ID, 1)
  assert.equal(v4, 4)
  assert.equal(await readVersionFileText(APP_ID, 4, 'index.html'), '<html>v1</html>')
  assert.deepEqual(await listFormalVersionNumbers(APP_ID), [1, 3, 4])
  // 草稿是 4 的可写拷贝
  assert.equal(await readVersionFileText(APP_ID, APP_DRAFT_DIR_NAME, 'index.html'), '<html>v1</html>')
}

async function testWriteVersionTextFileFormalReadonly(): Promise<void> {
  await resetState()
  await writeVersionTextFile({ appId: APP_ID, dirName: '7', relativePath: 'index.html', text: 'x' })
  const files = await listVersionTreeFiles(APP_ID, 7)
  assert.equal(files[0]!.node.attributes.writable, false)
}

async function main(): Promise<void> {
  await testEnsureDraftFromTemplate()
  await testPublishPromotesDraft()
  await testDraftScanExcludesDraftName()
  await testFormalManifestPerVersion()
  await testRemoveDraftPath()
  await testGovernance()
  await testWriteVersionTextFileFormalReadonly()
  console.log('generated-app-versions-layout.test: all passed')
}

void main()
