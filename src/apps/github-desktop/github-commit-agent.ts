import { parseJsonFromAiText } from '../../ai/parse-json-response.ts'
import { buildThinkingRequestExtras } from '../../ai/ai-thinking.ts'
import { finishAiEventLogSession, startAiEventLogSession } from '../../ai/ai-event-log.ts'
import type { AiUsageContext } from '../../ai/ai-usage-context.ts'
import { recordOpenAiCompletionUsage } from '../../ai/openai-usage.ts'
import { hasOpenAiApiKey, mergeOpenAiConfig } from '../../ai/openai-config.ts'
import { getOpenAiClient } from '../../ai/openai-client.ts'
import { buildChangePreview, type GithubChange } from './github-changes.ts'
import type { GithubRepoSyncMeta } from './github-sync-meta.ts'

const COMMIT_AGENT_USAGE: AiUsageContext = {
  actor: 'github-desktop',
  behavior: 'generate-commit-message',
  actorLabel: 'GitHub Desktop',
  behaviorLabel: '生成提交说明',
}

const COMMIT_MESSAGE_PROMPT = `你是 Git 提交说明撰写助手。根据用户提供的文件变更，生成简洁、专业的中文提交说明。

必须只返回 JSON 对象，不要 markdown，不要解释。格式：
{
  "summary": "50 字以内的单行摘要（必填，祈使句，如「添加用户登录页」）",
  "description": "可选的详细说明；无则空字符串；多行用 \\n 分隔"
}

要求：
- summary 一行、简明扼要，概括本次变更的核心意图
- description 可补充背景、动机或要点列表；简单变更可留空
- 不要包含 Co-authored-by 等 trailer`

export type GeneratedGithubCommitMessage = {
  summary: string
  description: string
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n…（已截断）`
}

async function buildChangeContextForAi(
  meta: GithubRepoSyncMeta,
  changes: readonly GithubChange[],
): Promise<string> {
  const lines: string[] = []
  const maxCharsPerFile = 1500
  const maxTotalChars = 12_000

  for (const change of changes) {
    const preview = await buildChangePreview(meta, change)
    lines.push(`### ${change.kind}: ${change.path}`)
    if (preview.notice) {
      lines.push(preview.notice)
      continue
    }
    if (change.kind === 'added') {
      lines.push('--- 新文件内容（截断）---')
      lines.push(truncateText(preview.modified, maxCharsPerFile))
    } else if (change.kind === 'deleted') {
      lines.push('--- 已删除文件内容（截断）---')
      lines.push(truncateText(preview.original, maxCharsPerFile))
    } else {
      lines.push('--- 旧内容（截断）---')
      lines.push(truncateText(preview.original, maxCharsPerFile / 2))
      lines.push('--- 新内容（截断）---')
      lines.push(truncateText(preview.modified, maxCharsPerFile / 2))
    }
    lines.push('')
  }

  return truncateText(lines.join('\n').trim(), maxTotalChars)
}

function normalizeGeneratedMessage(raw: GeneratedGithubCommitMessage): GeneratedGithubCommitMessage {
  return {
    summary: raw.summary.trim(),
    description: raw.description.trim(),
  }
}

export async function generateGithubCommitMessage(params: {
  meta: GithubRepoSyncMeta
  changes: readonly GithubChange[]
}): Promise<GeneratedGithubCommitMessage> {
  if (!hasOpenAiApiKey()) {
    throw new Error('尚未配置 AI API Key。请先在设置中配置 OpenAI 兼容接口。')
  }
  if (params.changes.length === 0) {
    throw new Error('没有可分析的变更')
  }

  const changeContext = await buildChangeContextForAi(params.meta, params.changes)
  const user = [
    `仓库：${params.meta.owner}/${params.meta.repo}`,
    `分支：${params.meta.currentBranch}`,
  ].join('\n')
  const userContent = `${user}\n\n变更文件：\n${changeContext}`

  const config = mergeOpenAiConfig()
  const client = getOpenAiClient(config)
  const messages = [
    { role: 'system' as const, content: COMMIT_MESSAGE_PROMPT },
    { role: 'user' as const, content: userContent },
  ]
  const logSession = startAiEventLogSession(COMMIT_AGENT_USAGE, {
    model: config.defaultModel,
    thinkingEnabled: config.thinkingEnabled,
    messages,
  })

  try {
    const response = await client.chat.completions.create({
      model: config.defaultModel,
      messages,
      ...buildThinkingRequestExtras(config.providerId, config.thinkingEnabled),
    })

    const text = response.choices[0]?.message?.content ?? ''
    if (!text.trim()) {
      throw new Error('AI 未返回任何内容')
    }

    recordOpenAiCompletionUsage(response, COMMIT_AGENT_USAGE, {
      model: config.defaultModel,
      thinkingEnabled: config.thinkingEnabled,
      messages,
      session: logSession,
    })

    const parsed = normalizeGeneratedMessage(parseJsonFromAiText<GeneratedGithubCommitMessage>(text))
    if (!parsed.summary) {
      throw new Error('AI 未生成有效的提交摘要')
    }
    return parsed
  } catch (error) {
    const snapshot = logSession.snapshot()
    if (snapshot) {
      finishAiEventLogSession(logSession, COMMIT_AGENT_USAGE, {
        response: snapshot.response,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'AI 请求失败',
      })
    }
    throw error
  }
}
