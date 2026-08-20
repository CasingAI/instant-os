/**
 * Plan Markdown 校验 / 进度 / 路径断言单测。
 * 运行：node --experimental-strip-types --test src/apps/vscode/vscode-ai-plan.test.ts
 */
import assert from 'node:assert/strict'
import { fnv1a32Hex } from '../files/files-tmp.ts'
import {
  assertVscodePlanPath,
  isVscodePlanWriteToolName,
  parsePlanTodoProgress,
  resolvePlanPathFromWriteTool,
  resolveVscodePlansDir,
  validatePlanMarkdown,
  WRITE_PLAN_RESULT_PATH_RE,
} from './vscode-ai-plan.ts'

const workspace = '/user/projects/demo'
const plansDir = resolveVscodePlansDir(workspace)
const hash = fnv1a32Hex(workspace)

assert.equal(plansDir, `/tmp/Workspace/${hash}/vscode/plans`)

const goodPlan = `# 标题

## Overview
做某事。

## 实现要点
- 改 a.ts

## Todos
- [ ] 第一步
- [x] 第二步
- [ ] 第三步
`

validatePlanMarkdown(goodPlan)
assert.deepEqual(parsePlanTodoProgress(goodPlan), { done: 1, total: 3 })

assert.deepEqual(parsePlanTodoProgress(''), { done: 0, total: 0 })
assert.deepEqual(parsePlanTodoProgress('- 普通列表\n1. 编号'), { done: 0, total: 0 })
assert.deepEqual(parsePlanTodoProgress('  - [X] 大写勾选'), { done: 1, total: 1 })

assert.throws(() => validatePlanMarkdown(''), /为空/)
assert.throws(
  () => validatePlanMarkdown('# 标题\n\n## Todos\n- 没有复选框\n1. 编号项'),
  /GFM 任务列表/,
)

const planPath = `${plansDir}/demo-abc123.md`
assert.equal(assertVscodePlanPath(planPath, workspace), planPath)
assert.equal(assertVscodePlanPath(`${planPath}/`, workspace), planPath)

assert.throws(() => assertVscodePlanPath('/user/foo.md', workspace), /不合法/)
assert.throws(
  () => assertVscodePlanPath(`/tmp/Workspace/${hash}/vscode/plans/nested/a.md`, workspace),
  /单层/,
)
assert.throws(
  () => assertVscodePlanPath(`/tmp/Workspace/${hash}/vscode/other/a.md`, workspace),
  /plans 目录/,
)
assert.throws(
  () => assertVscodePlanPath(`/tmp/Workspace/${hash}/vscode/plans/a.txt`, workspace),
  /\.md/,
)

assert.equal(
  WRITE_PLAN_RESULT_PATH_RE.exec('已写入计划并打开：/tmp/Workspace/abc/vscode/plans/x.md')?.[1],
  '/tmp/Workspace/abc/vscode/plans/x.md',
)
assert.equal(
  resolvePlanPathFromWriteTool('update_plan', {
    result: '已更新计划：/tmp/Workspace/abc/vscode/plans/x.md',
  }),
  '/tmp/Workspace/abc/vscode/plans/x.md',
)
assert.equal(
  resolvePlanPathFromWriteTool('update_plan', {
    title: '/tmp/Workspace/abc/vscode/plans/x.md',
  }),
  '/tmp/Workspace/abc/vscode/plans/x.md',
)
assert.equal(isVscodePlanWriteToolName('write_plan'), true)
assert.equal(isVscodePlanWriteToolName('run_in_terminal'), false)

console.log('vscode-ai-plan.test.ts: ok')
