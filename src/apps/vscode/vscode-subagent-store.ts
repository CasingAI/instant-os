import type { VscodeAiAgentProgress, VscodeAiAgentResult } from './vscode-ai-agent.ts'
import type { VscodeAiContextUsage } from './vscode-ai-context-usage.ts'

/** 子 Agent 线程中每一轮「主 Agent → 子」用户侧发言（含可选图片路径） */
export type SubagentUserTurn = {
  prompt: string
  imagePaths?: string[]
}

export type SubagentRunState = {
  runId: string
  agentId: string
  description: string
  /** 主聊天 sessionId；持久化与终端 parent 归属 */
  parentChatId: string | undefined
  /** 主 Agent 下发的首轮任务 Prompt，详情 Tab 里渲染为第一条用户气泡 */
  taskPrompt: string
  /** 最近一次追问文案（resume 时设置；首轮为空） */
  lastFollowUpPrompt: string | undefined
  /**
   * 各轮用户侧发言元数据（含 image_paths）。
   * 详情 UI 用路径渲染图片预览；不存 blob。
   */
  userTurns: SubagentUserTurn[]
  /** vision 首轮注入的图片路径（详情 UI 兜底） */
  firstImagePaths?: string[]
  modelKey: string | undefined
  modelLabel: string
  status: 'running' | 'done' | 'error'
  startedAt: number
  /** 运行中的实时进度（timeline/activities/answerText 等） */
  liveProgress: VscodeAiAgentProgress | undefined
  /** 完成后的完整结果（messages + investigation）；resume 期间保留上一轮直至 complete */
  result: VscodeAiAgentResult | undefined
  /** 最近一次上下文占用（运行中随 progress 更新；完成后保留供 Footer 展示） */
  contextUsage: VscodeAiContextUsage | undefined
  error: string | undefined
}

export type SubagentStoreListener = () => void

const runs = new Map<string, SubagentRunState>()
const listeners = new Set<SubagentStoreListener>()

function notify() {
  for (const listener of listeners) {
    listener()
  }
}

function normalizeImagePaths(
  paths: readonly string[] | undefined,
): string[] | undefined {
  if (!paths || paths.length === 0) return undefined
  const out: string[] = []
  const seen = new Set<string>()
  for (const path of paths) {
    const trimmed = path.trim()
    if (!trimmed.startsWith('/') || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out.length > 0 ? out : undefined
}

export function startRun(
  runId: string,
  agentId: string,
  description: string,
  taskPrompt: string,
  modelKey: string | undefined,
  modelLabel: string,
  parentChatId?: string,
  imagePaths?: readonly string[],
): void {
  const paths = normalizeImagePaths(imagePaths)
  runs.set(runId, {
    runId,
    agentId,
    description,
    parentChatId,
    taskPrompt,
    lastFollowUpPrompt: undefined,
    userTurns: [
      {
        prompt: taskPrompt,
        ...(paths ? { imagePaths: paths } : {}),
      },
    ],
    ...(paths ? { firstImagePaths: paths } : {}),
    modelKey,
    modelLabel,
    status: 'running',
    startedAt: Date.now(),
    liveProgress: undefined,
    result: undefined,
    contextUsage: undefined,
    error: undefined,
  })
  notify()
}

/**
 * 同一 runId 进入下一轮追问：保留既有 result 供详情展示历史，
 * status → running，清 error / liveProgress。
 */
export function resumeRun(
  runId: string,
  followUpMessage: string,
  imagePaths?: readonly string[],
): boolean {
  const run = runs.get(runId)
  if (!run) return false
  run.status = 'running'
  run.lastFollowUpPrompt = followUpMessage
  const paths = normalizeImagePaths(imagePaths)
  run.userTurns = [
    ...run.userTurns,
    {
      prompt: followUpMessage,
      ...(paths ? { imagePaths: paths } : {}),
    },
  ]
  run.error = undefined
  run.liveProgress = undefined
  run.startedAt = Date.now()
  notify()
  return true
}

export function updateProgress(
  runId: string,
  progress: VscodeAiAgentProgress,
): void {
  const run = runs.get(runId)
  if (!run) return
  run.liveProgress = progress
  if (progress.contextUsage) {
    run.contextUsage = progress.contextUsage
  }
  notify()
}

export function completeRun(runId: string, result: VscodeAiAgentResult): void {
  const run = runs.get(runId)
  if (!run) return
  run.status = 'done'
  run.result = result
  run.liveProgress = undefined
  notify()
}

export function failRun(runId: string, error: string): void {
  const run = runs.get(runId)
  if (!run) return
  run.status = 'error'
  run.error = error
  notify()
}

export function patchLatestTurnImagePaths(
  runId: string,
  imagePaths?: readonly string[],
): boolean {
  const run = runs.get(runId)
  if (!run) return false
  const paths = normalizeImagePaths(imagePaths)
  if (!paths) return false
  if (run.userTurns.length === 0) {
    run.userTurns = [{ prompt: run.taskPrompt || run.description, imagePaths: paths }]
    if (!run.firstImagePaths?.length) {
      run.firstImagePaths = paths
    }
    notify()
    return true
  }
  const last = run.userTurns[run.userTurns.length - 1]
  if (last.imagePaths && last.imagePaths.length > 0) return false
  run.userTurns = [
    ...run.userTurns.slice(0, -1),
    { ...last, imagePaths: paths },
  ]
  if (!run.firstImagePaths?.length) {
    run.firstImagePaths = paths
  }
  notify()
  return true
}

export function getRun(runId: string): SubagentRunState | undefined {
  return runs.get(runId)
}

export function listRuns(): SubagentRunState[] {
  return [...runs.values()]
}

/** 用持久化快照覆盖内存（同 runId 已存在则跳过，避免冲掉正在跑的） */
export function hydrateRuns(snapshots: readonly SubagentRunState[]): void {
  let changed = false
  for (const snap of snapshots) {
    if (runs.has(snap.runId)) continue
    const status =
      snap.status === 'running'
        ? ('error' as const)
        : snap.status
    runs.set(snap.runId, {
      ...snap,
      userTurns: Array.isArray(snap.userTurns) ? snap.userTurns : [],
      status,
      liveProgress: undefined,
      error:
        snap.status === 'running'
          ? snap.error ?? '上次运行中断（页面刷新或崩溃），可 followup_subagent 续聊'
          : snap.error,
    })
    changed = true
  }
  if (changed) notify()
}

export function removeRun(runId: string): void {
  runs.delete(runId)
  notify()
}

export function subscribe(listener: SubagentStoreListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 清空内存中的 Sub Agent 会话（关窗 teardown / 测试） */
export function clearSubagentStore(): void {
  runs.clear()
  notify()
}

/** @deprecated 使用 clearSubagentStore */
export function resetSubagentStoreForTests(): void {
  clearSubagentStore()
}
