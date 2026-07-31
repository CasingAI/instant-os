import type { VscodeAiAgentProgress, VscodeAiAgentResult } from './vscode-ai-agent.ts'

export type SubagentRunState = {
  runId: string
  agentId: string
  description: string
  /** 主 Agent 下发的首轮任务 Prompt，详情 Tab 里渲染为第一条用户气泡 */
  taskPrompt: string
  /** 最近一次追问文案（resume 时设置；首轮为空） */
  lastFollowUpPrompt: string | undefined
  modelKey: string | undefined
  modelLabel: string
  status: 'running' | 'done' | 'error'
  startedAt: number
  /** 运行中的实时进度（timeline/activities/answerText 等） */
  liveProgress: VscodeAiAgentProgress | undefined
  /** 完成后的完整结果（messages + investigation）；resume 期间保留上一轮直至 complete */
  result: VscodeAiAgentResult | undefined
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

export function startRun(
  runId: string,
  agentId: string,
  description: string,
  taskPrompt: string,
  modelKey: string | undefined,
  modelLabel: string,
): void {
  runs.set(runId, {
    runId,
    agentId,
    description,
    taskPrompt,
    lastFollowUpPrompt: undefined,
    modelKey,
    modelLabel,
    status: 'running',
    startedAt: Date.now(),
    liveProgress: undefined,
    result: undefined,
    error: undefined,
  })
  notify()
}

/**
 * 同一 runId 进入下一轮追问：保留既有 result 供详情展示历史，
 * status → running，清 error / liveProgress。
 */
export function resumeRun(runId: string, followUpMessage: string): boolean {
  const run = runs.get(runId)
  if (!run) return false
  run.status = 'running'
  run.lastFollowUpPrompt = followUpMessage
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

export function getRun(runId: string): SubagentRunState | undefined {
  return runs.get(runId)
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

/** 测试用：清空内存会话 */
export function resetSubagentStoreForTests(): void {
  runs.clear()
  notify()
}
