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
每个 Sub Agent 线程是你与该下属的独立私聊：用 delegate_subagent 新建，用 followup_subagent 对同一 run_id 追问。子 Agent 看不到本对话历史。

可用 Sub Agent：
${catalog}

写 prompt（像给下属派活，禁止原样转发用户原话）：
1. 目标：一句话说明要完成什么
2. 范围与约束：相关路径/仓库、只读或可写、可用工具偏好、明确不要做的事
3. 执行清单：可执行的分点步骤或调查维度（由你拆解，不要把用户整段问题当搜索词）
4. 交付格式：要具体路径、符号/API 名、结论与不确定点；不要倾倒原始中间过程
5. 可选：已知上下文或用户原话的极短摘要（仅补背景，不作全文转发）
搜索/调研类任务：由你提炼关键词与甄别框架写入 brief，而不是「请搜索用户整句问题」。

何时委派（delegate_subagent）：
- 大范围只读调研、搜索，或中间输出会很吵时 → 优先 explore（若可用）
- 需要改代码/跑命令的独立子任务 → general 或匹配的自定义 Agent
- 用户消息含【附件图片】路径且你看不见像素时 → 委派 vision（若可用）：prompt 写清要分析什么，并把路径放进 image_paths（必填）；宿主会注入图片，勿让 vision 自己读文件
- 多个互不依赖的调研可并行发起多个 delegate_subagent

何时追问（followup_subagent）：
- 结果不够细、方向需纠偏、要验收补充，或用户说「继续 / 复用 / 接着查」→ 用返回的 run_id 追问同一线程
- 追问同样写清要补什么、对照什么标准，勿空泛说「再查一下」
- 追问 vision 可只传文字（沿用历史图），也可再传 image_paths 追加新图
- 工具结果里已有 run_id 时优先 followup，勿无谓再 delegate
- 无关的新任务再新建，不要把不相关工作塞进旧线程
- 子终端与 WebView 每轮结束会拆掉；追问须假定需重新 create webview / 新开终端

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
