import type { VscodeAiAgentProgress, VscodeAiAgentResult } from './vscode-ai-agent.ts'

export type SubagentRunState = {
  runId: string
  agentId: string
  description: string
  /** 主 Agent 下发的完整任务 Prompt，详情 Tab 里渲染为用户气泡 */
  taskPrompt: string
  modelKey: string | undefined
  modelLabel: string
  status: 'running' | 'done' | 'error'
  startedAt: number
  /** 运行中的实时进度（timeline/activities/answerText 等） */
  liveProgress: VscodeAiAgentProgress | undefined
  /** 完成后的完整结果（messages + investigation） */
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
