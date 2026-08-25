/**
 * 旧「iCode 内部项目」注册表存储（迁移源，只读）单测。
 * 运行：node --experimental-strip-types src/apps/icode/icode-storage.test.ts
 *
 * 覆盖：默认空列表；从注册表 projects 字段读取；清空字段与一次性标记。
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'

// Node 无全局 localStorage：内存实现兜底（模块只在调用点读写一次性标记）
if (typeof (globalThis as { localStorage?: unknown }).localStorage === 'undefined') {
  const store = new Map<string, string>()
  ;(globalThis as { localStorage: Storage }).localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size
    },
  } as Storage
}

import { __resetRegistryCacheForTest, createAppRegistry } from '../../os/app-registry.ts'
import { resetRegistryDbForTests } from '../../os/app-registry-db.ts'
import {
  clearLegacyInternalProjects,
  isLegacyInternalProjectsMigrated,
  loadLegacyInternalProjects,
} from './icode-storage.ts'
import type { ICodeInternalProject } from './icode-types.ts'

async function resetState(): Promise<void> {
  // 先让模块加载时触发的后台 hydrate 落定，避免与删库竞态
  await new Promise((resolve) => setTimeout(resolve, 0))
  localStorage.removeItem('instant-os-icode-legacy-projects-migrated')
  __resetRegistryCacheForTest()
  await resetRegistryDbForTests()
}

async function seedProject(project: ICodeInternalProject): Promise<void> {
  const registry = createAppRegistry('icode')
  await registry.setJson('projects', [project])
}

const sampleProject: ICodeInternalProject = {
  id: 'icode-1',
  name: '我的应用',
  description: '描述',
  category: '内部开发',
  iconEmoji: '🛠️',
  themeColor: '#5856d6',
  tags: [],
  html: '<!doctype html><html><body>hi</body></html>',
  appData: {},
  chat: [],
  linkedAppId: 'gen:icode-1',
  createdAt: 1,
  updatedAt: 2,
}

async function testDefaultEmptyList(): Promise<void> {
  await resetState()
  assert.deepEqual(await loadLegacyInternalProjects(), [])
  assert.equal(isLegacyInternalProjectsMigrated(), false)
}

async function testReadsProjectsField(): Promise<void> {
  await resetState()
  await seedProject(sampleProject)
  const projects = await loadLegacyInternalProjects()
  assert.equal(projects.length, 1)
  assert.equal(projects[0]!.id, 'icode-1')
  assert.equal(projects[0]!.linkedAppId, 'gen:icode-1')
}

async function testClearRemovesFieldAndMarksMigrated(): Promise<void> {
  await resetState()
  await seedProject(sampleProject)
  await clearLegacyInternalProjects()
  assert.deepEqual(await loadLegacyInternalProjects(), [])
  assert.equal(isLegacyInternalProjectsMigrated(), true)
  const registry = createAppRegistry('icode')
  assert.equal(await registry.getText('projects'), undefined)
}

async function main(): Promise<void> {
  await testDefaultEmptyList()
  await testReadsProjectsField()
  await testClearRemovesFieldAndMarksMigrated()
  console.log('icode-storage.test: all passed')
}

void main()
