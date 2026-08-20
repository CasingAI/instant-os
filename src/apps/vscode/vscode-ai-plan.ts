/**
 * Plan 模式计划文件：路径约定、GFM 任务列表校验与进度解析。
 */
import { workspaceAppTmpDir } from '../files/files-tmp.ts'

/** GFM 任务行：`- [ ]` / `- [x]` / `- [X]`（允许行首空白） */
const PLAN_TODO_LINE_RE = /^[ \t]*-[ \t]+\[([ xX])\][ \t]+.+/

export const WRITE_PLAN_RESULT_PATH_RE = /已写入计划(?:并打开)?：(.+)$/
export const UPDATE_PLAN_RESULT_PATH_RE = /已更新计划：(.+)$/

export function isVscodePlanWriteToolName(toolName: string): boolean {
  return toolName === 'write_plan' || toolName === 'update_plan'
}

/** 从 write_plan / update_plan 工具结果或卡片 title 解析计划路径 */
export function resolvePlanPathFromWriteTool(
  toolName: string,
  options: { result?: string; title?: string },
): string | undefined {
  const result = options.result?.trim() ?? ''
  const title = options.title?.trim() ?? ''
  if (toolName === 'write_plan') {
    const fromResult = WRITE_PLAN_RESULT_PATH_RE.exec(result)?.[1]?.trim()
    if (fromResult) return fromResult
    if (title.includes('/') && title.endsWith('.md')) return title
    return undefined
  }
  if (toolName === 'update_plan') {
    const fromResult = UPDATE_PLAN_RESULT_PATH_RE.exec(result)?.[1]?.trim()
    if (fromResult) return fromResult
    if (title.includes('/') && title.endsWith('.md')) return title
    return undefined
  }
  return undefined
}

export type PlanTodoProgress = {
  done: number
  total: number
}

export function resolveVscodePlansDir(workspace: string): string {
  return `${workspaceAppTmpDir(workspace, 'vscode')}/plans`
}

/**
 * 断言 path 落在当前工作区的 `/tmp/Workspace/{hash}/vscode/plans/` 下。
 * 通过则返回规范化后的 path（去尾部斜杠）。
 */
export function assertVscodePlanPath(path: string, workspace: string): string {
  const clean = path.trim().replace(/\/+$/, '')
  if (!clean.startsWith('/tmp/Workspace/')) {
    throw new Error(`计划路径不合法：须位于 /tmp/Workspace/ 下（收到：${path}）`)
  }
  if (!clean.endsWith('.md')) {
    throw new Error(`计划路径须为 .md 文件（收到：${path}）`)
  }
  const plansDir = resolveVscodePlansDir(workspace).replace(/\/+$/, '')
  if (clean !== plansDir && !clean.startsWith(`${plansDir}/`)) {
    throw new Error(
      `计划路径须位于当前工作区 plans 目录 ${plansDir}/ 下（收到：${path}）`,
    )
  }
  const relative = clean.slice(plansDir.length + 1)
  if (!relative || relative.includes('/')) {
    throw new Error(`计划路径须为 plans 目录下的单层 .md 文件（收到：${path}）`)
  }
  return clean
}

/**
 * 至少 1 条合法 GFM 任务行，否则抛错（文案供模型重试）。
 */
export function validatePlanMarkdown(markdown: string): void {
  const text = markdown.trim()
  if (!text) {
    throw new Error('计划内容为空')
  }
  const progress = parsePlanTodoProgress(markdown)
  if (progress.total < 1) {
    throw new Error(
      '计划须含至少 1 条 GFM 任务列表项（`- [ ] 描述` 或 `- [x] 描述`）。' +
        '请在 ## Todos 下用复选框列表，不要用纯编号列表代替。',
    )
  }
}

export function parsePlanTodoProgress(markdown: string): PlanTodoProgress {
  let done = 0
  let total = 0
  for (const line of markdown.split(/\r?\n/)) {
    const match = PLAN_TODO_LINE_RE.exec(line)
    if (!match) continue
    total += 1
    const mark = match[1]
    if (mark === 'x' || mark === 'X') done += 1
  }
  return { done, total }
}

/** 写入计划时提示模型的骨架（工具描述 / 系统提示共用） */
export const VSCODE_AI_PLAN_MARKDOWN_SKELETON = `# 标题

## Overview
一两段说明目标与范围。

## 实现要点
- 关键路径与改动要点（普通列表即可）

## Todos
- [ ] 第一步具体可执行项
- [ ] 第二步具体可执行项
`

export const VSCODE_AI_PLAN_FORMAT_HINT =
  '正文须含 # 标题、## Overview、## 实现要点、## Todos；' +
  'Todos 下必须使用 GFM 复选框（`- [ ] 描述`），禁止用纯编号列表代替 Todos。'
