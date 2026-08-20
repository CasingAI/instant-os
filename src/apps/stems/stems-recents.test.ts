/**
 * 最近打开历史单测：去重置顶截断、移除、损坏数据兜底、相对时间格式化。
 * 运行：node --experimental-strip-types src/apps/stems/stems-recents.test.ts
 */
import assert from 'node:assert/strict'
import {
  RECENT_PROJECTS_LIMIT,
  formatRecentTime,
  pushRecentProject,
  removeRecentProject,
} from './stems-recents.ts'
import type { RecentStemsProject } from './stems-recents.ts'

const now = 1_800_000_000_000

function make(path: string, openedAt: number): RecentStemsProject {
  return { path, name: path.slice(path.lastIndexOf('/') + 1), openedAt }
}

assert.equal(RECENT_PROJECTS_LIMIT, 6)

// push：置顶 + 按时间排序 + 去重
{
  const a = make('/Music/a.mp3', now - 100)
  const b = make('/Music/b.wav', now - 50)
  const next = pushRecentProject([a, b], make('/Music/c.m4a', now))
  assert.deepEqual(
    next.map((p) => p.path),
    ['/Music/c.m4a', '/Music/b.wav', '/Music/a.mp3'],
  )
}

// push：重复 path 去重，新记录置顶，原位置移除
{
  const a = make('/Music/a.mp3', now - 100)
  const next = pushRecentProject([a], make('/Music/a.mp3', now))
  assert.deepEqual(next, [make('/Music/a.mp3', now)])
  assert.equal(next.length, 1)
}

// push：截断到上限
{
  const list = Array.from({ length: RECENT_PROJECTS_LIMIT }, (_, i) =>
    make(`/Music/song${i}.mp3`, now - i),
  )
  const next = pushRecentProject(list, make('/Music/new.wav', now))
  assert.equal(next.length, RECENT_PROJECTS_LIMIT)
  assert.equal(next[0].path, '/Music/new.wav')
  // 最旧的被挤出
  assert.ok(!next.some((p) => p.path === `/Music/song${RECENT_PROJECTS_LIMIT - 1}.mp3`))
}

// push：不修改原数组
{
  const a = make('/Music/a.mp3', now)
  const original = [a]
  const next = pushRecentProject(original, make('/Music/b.wav', now - 1))
  assert.equal(original.length, 1)
  assert.equal(next.length, 2)
}

// remove：移除指定 path，不修改原数组
{
  const a = make('/Music/a.mp3', now)
  const b = make('/Music/b.wav', now - 1)
  const next = removeRecentProject([a, b], '/Music/a.mp3')
  assert.deepEqual(
    next.map((p) => p.path),
    ['/Music/b.wav'],
  )
  assert.equal(removeRecentProject([], '/Music/nope.mp3').length, 0)
}

// formatRecentTime 各档位
{
  assert.equal(formatRecentTime(now, now), '刚刚')
  assert.equal(formatRecentTime(now - 5_000, now), '刚刚')
  assert.equal(formatRecentTime(now - 30_000, now), '刚刚')
  assert.equal(formatRecentTime(now - 60_000, now), '1 分钟前')
  assert.equal(formatRecentTime(now - 90_000, now), '1 分钟前')
  assert.equal(formatRecentTime(now - 2 * 60_000, now), '2 分钟前')
  assert.equal(formatRecentTime(now - 59 * 60_000, now), '59 分钟前')
  assert.equal(formatRecentTime(now - 60 * 60_000, now), '1 小时前')
  assert.equal(formatRecentTime(now - 3 * 60 * 60_000, now), '3 小时前')
  assert.equal(formatRecentTime(now - 24 * 60 * 60_000, now), '1 天前')
  assert.equal(formatRecentTime(now - 6 * 24 * 60 * 60_000, now), '6 天前')
  // 超过 7 天显示日期（now = 2027-01-15T08:00Z，8 天前 = 2027-01-07）
  assert.equal(formatRecentTime(now - 8 * 24 * 60 * 60_000, now), '2027/01/07')
}

// 未来时刻（时钟偏差）按「刚刚」处理
{
  assert.equal(formatRecentTime(now + 10_000, now), '刚刚')
}

console.log('stems-recents tests passed')
