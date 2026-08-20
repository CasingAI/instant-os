/**
 * news 存储（字段级注册表化后）单测。
 * 运行：node --experimental-strip-types src/apps/news/news-storage.test.ts
 *
 * 覆盖：字段 key 独立读写；旧 store 单键迁移为 articles / commentThreads 两个字段 key；
 * 评论线程用户点赞状态保留。
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { __resetRegistryCacheForTest } from '../../os/app-registry.ts'
import { registryDbPut, registryDbListKeys, resetRegistryDbForTests } from '../../os/app-registry-db.ts'
import {
  addArticles,
  appendComments,
  deleteArticle,
  readNewsStore,
  saveCommentThread,
  setUserReaction,
  writeNewsStore,
} from './news-storage.ts'
import type { NewsStore } from './news-types.ts'

async function resetState(): Promise<void> {
  __resetRegistryCacheForTest()
  await resetRegistryDbForTests()
}

async function testEmptyStoreDefaults(): Promise<void> {
  await resetState()
  assert.deepEqual(await readNewsStore(), { articles: [], commentThreads: {} })
}

async function testWriteReadRoundTrip(): Promise<void> {
  await resetState()
  const store: NewsStore = {
    articles: [
      { id: 'news-1', editionDate: '2026-08-16', title: '标题', category: '本地', lead: '', body: '' },
    ],
    commentThreads: {},
  }
  await writeNewsStore(store)
  assert.deepEqual(await readNewsStore(), store)

  // 字段 key 独立存在
  assert.deepEqual((await registryDbListKeys('news')).sort(), ['articles', 'commentThreads'].sort())
}

async function testMigratesLegacyStoreToFieldKeys(): Promise<void> {
  await resetState()
  await registryDbPut('news', 'store', JSON.stringify({ articles: [], commentThreads: {} }))
  __resetRegistryCacheForTest()

  const store = await readNewsStore()
  assert.deepEqual(store, { articles: [], commentThreads: {} })
  // 迁移后旧 store 清除
  assert.deepEqual((await registryDbListKeys('news')).sort(), ['articles', 'commentThreads'].sort())
}

async function testCommentReactionPersists(): Promise<void> {
  await resetState()
  const articleId = 'news-1'
  const thread = {
    articleId,
    generatedAt: 1,
    comments: [{ id: 'c1', author: '甲', body: '好', createdAt: 1, likes: 0, dislikes: 0 }],
    userReactions: {},
  }
  await saveCommentThread(await readNewsStore(), thread)

  let store = await readNewsStore()
  store = await setUserReaction(store, articleId, 'c1', 'like')
  assert.equal(store.commentThreads[articleId]?.userReactions['c1'], 'like')

  // 重新读（清缓存走 DB）后点赞状态仍在
  __resetRegistryCacheForTest()
  store = await readNewsStore()
  assert.equal(store.commentThreads[articleId]?.userReactions['c1'], 'like')
}

async function testAppendAndDeleteArticle(): Promise<void> {
  await resetState()
  const article = { id: 'news-2', editionDate: '2026-08-16', title: 't', category: 'c', lead: '', body: '' }
  let store = await readNewsStore()
  store = await addArticles(store, [article]).then(() => readNewsStore())
  assert.equal(store.articles.length, 1)
  store = await deleteArticle(store, 'news-2').then(() => readNewsStore())
  assert.equal(store.articles.length, 0)
}

async function main(): Promise<void> {
  const cases = [
    testEmptyStoreDefaults,
    testWriteReadRoundTrip,
    testMigratesLegacyStoreToFieldKeys,
    testCommentReactionPersists,
    testAppendAndDeleteArticle,
  ]
  for (const test of cases) {
    await test()
    console.log(`ok: ${test.name}`)
  }
  console.log('news-storage: all passed')
}

await main()
