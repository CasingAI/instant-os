/**
 * SRML LLM 接入：把「DSL 标签语言规范 + 示例」作为系统提示，让模型用标签 DSL 输出。
 * 所有 AI 请求都必须携带 usageContext（AI 用量统计为各调用点显式接入）。
 */
import { streamChatCompletion } from '../../ai/stream-chat.ts'

/** DSL 规范文本（标签含义 + 输出规则），同时用于系统提示词与侧栏「DSL 规范」面板 */
export function buildSrmlDslSpec(): string {
  return `## DSL 标签规范

用户会用一个请求同时发送多个 <|begin_of_prompt_N|> 块（N 为编号，类似 fork 一次做多个任务）。
你必须在一次回复里为每一个 prompt 输出一个对应的 <|begin_of_task_N|> 块。

### 用户侧标签（请求）

<|begin_of_prompt_N|> ... <|end_of_prompt|>
  一个请求块。编号只在 begin 标签写一次，end 标签不写编号。

<|begin_of_thought_effort|> ... <|end_of_thought_effort|>
  可选，写在某个 prompt 内部，指定该请求的思考强度：low / medium / high / max。

### 你侧标签（回复）

<|begin_of_task_N|> ... <|end_of_task|>
  一个任务块，编号 N 与对应 prompt 一致。编号只在 begin 标签写一次。

<begin_of_thought> ... <end_of_thought>
  你的推理过程（thinking），随输出一起打包在 DSL 里。

<begin_of_response> ... <end_of_response>
  该任务的最终回复。编号可省略：省略时表示当前任务（也可写 <begin_of_response_N> 显式指定）。

一个 task 内可以有多个 <begin_of_thought> / <begin_of_response> 交替。

## 输出规则

1. 严格按标签输出，不要输出标签以外的任何文字（不要「好的」「开始」之类的话，不要 markdown 代码块围栏）。
2. 每个 prompt 对应一个 task；task 编号不可重复。
3. <begin_of_thought> 内写推理过程，<begin_of_response> 内写最终回复。
4. 若某 prompt 指定了思考强度，请按 low / medium / high / max 控制你思考的详细程度。
5. 编号只在 begin 标签写一次，end 标签一律不写编号：<|end_of_task|> / <end_of_response>。
6. 闭合标签即使被省略也会被自动补全，但建议成对写以保持可读性。`
}

/** 完整系统提示词：开场白 + 规范 + 示例 */
export function buildSrmlSystemPrompt(): string {
  return `正在做一个 LLM 自定义 DSL 测试 Demo。我会给你一个例子，然后你在后续的回复中模仿这个例子输出。

${buildSrmlDslSpec()}

## 例子

[User]
<|begin_of_prompt_1|>
为当前会话生成标题并包裹在<title></title>标签中。
<|end_of_prompt|>

<|begin_of_prompt_2|>
<|begin_of_thought_effort|>
low
<|end_of_thought_effort|>
你好
<|end_of_prompt|>

[Assistant]
<|begin_of_task_1|>
<begin_of_thought>
我们根据对话内容生成一个标题。当前会话是用户打招呼，我回应。所以标题可以是「初次问候与热情欢迎」之类的。
<end_of_thought>
<begin_of_response>
<title>初次问候与热情欢迎</title>
<end_of_response>
<|end_of_task|>

<|begin_of_task_2|>
<begin_of_thought>
用户发来一句简单的「你好」，是基础的开场问候。希望得到友好热情的回应，建立良好开端。
<end_of_thought>
<begin_of_response>
你好！很高兴认识你。
<end_of_response>
<begin_of_thought>
可以再主动邀请用户提出具体需求，自然引导对话继续。
<end_of_thought>
<begin_of_response>
不管是闲聊还是正事都可以找我。你想聊些什么呢？
<end_of_response>
<|end_of_task|>`
}

export type SrmlAgentStreamOptions = {
  onStream?: (delta: string, accumulated: string) => void
  signal?: AbortSignal
  /** 会话历史（已提交的轮次，assistant 为模型原始输出） */
  followUp?: { role: 'user' | 'assistant'; content: string }[]
}

export class SrmlAgent {
  private readonly systemPrompt: string

  constructor() {
    this.systemPrompt = buildSrmlSystemPrompt()
  }

  /** 发送一次请求（含多个 prompt），返回模型原始输出 */
  async exchange(userText: string, streamOptions?: SrmlAgentStreamOptions): Promise<string> {
    return streamChatCompletion({
      system: this.systemPrompt,
      user: userText,
      followUp: streamOptions?.followUp,
      usageContext: {
        actor: 'srml-demo',
        behavior: 'dsl-exchange',
        behaviorLabel: 'SRML 标签 DSL 任务生成',
      },
      maxCompletionTokens: 8000,
      allowTruncation: true,
      // 强制关闭深度思考：thinking 以 <begin_of_thought> 文本块的形式打包在 DSL 输出里，
      // 打开原生思考会让推理走独立的 reasoning 流，破坏「一切都在 DSL 里」。
      thinkingEnabled: false,
      signal: streamOptions?.signal,
      onChunk: (delta, accumulated) => streamOptions?.onStream?.(delta, accumulated),
    })
  }
}
