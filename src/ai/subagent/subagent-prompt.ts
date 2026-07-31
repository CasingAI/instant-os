import type { EffectiveSubAgent } from './subagent-types.ts'

/** 拼进父 Agent system prompt：何时/如何委派与追问 Sub Agent */
export function buildSubAgentDelegationPromptSection(
  availableAgents: readonly EffectiveSubAgent[],
): string {
  if (availableAgents.length === 0) return ''

  const catalog = availableAgents
    .map((agent) => {
      const access = agent.access === 'readonly' ? '只读' : '可读写'
      return `- \`${agent.id}\`（${access}）：${agent.description}`
    })
    .join('\n')

  return `【Sub Agent 委派】
每个 Sub Agent 线程是你与该下属的独立私聊：用 delegate_subagent 新建，用 followup_subagent 对同一 run_id 追问。子 Agent 看不到本对话历史；新建时的 prompt 必须自包含（路径、约束、期望输出格式）。

可用 Sub Agent：
${catalog}

何时委派（delegate_subagent）：
- 大范围只读调研、搜索，或中间输出会很吵时 → 优先 explore（若可用）
- 需要改代码/跑命令的独立子任务 → general 或匹配的自定义 Agent
- 多个互不依赖的调研可并行发起多个 delegate_subagent

何时追问（followup_subagent）：
- 结果不够细、方向需纠偏、或要验收补充 → 用返回的 run_id 追问同一线程
- 无关的新任务再新建，不要把不相关工作塞进旧线程

何时不要委派：
- 简单单步（读一个已知文件、改几行）直接自己做
- 需要与用户频繁确认的交互留在主对话

规则：
- agent_id 必须是上表之一
- description 用 3–5 个词的短标题（供界面展示）
- 父级为只读（Ask/Plan）时，子 Agent 只会以只读权限运行
- 综合子 Agent 返回的摘要后再回答用户；不要原样倾倒冗长中间过程
- 工具结果里的 run_id 请保留，供后续 followup_subagent 使用`
}
