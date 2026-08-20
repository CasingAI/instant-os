/**
 * SRML LLM 接入：把「DSL 标签语言规范 + 示例」作为系统提示，让模型用标签 DSL 输出。
 * 所有 AI 请求都必须携带 usageContext（AI 用量统计为各调用点显式接入）。
 */
import { streamChatCompletion } from '../../ai/stream-chat.ts'
import { buildSrmlToolList } from './srml-tools.ts'

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

<|begin_of_tool_call|> ... <|end_of_tool_call|>
  工具调用。需要外部信息（时间、计算、文件等）时输出，内容为一行 JSON：
  {"name": "工具名", "arguments": {"参数名": "值"}}
  引擎会执行它，并把 <|begin_of_tool_result|> 以新的用户消息回填给你（你不需要输出结果块）。
  若想跳过等待、乐观继续，可在 JSON 之后追加 <|begin_of_expect|>预判值<|end_of_expect|>（可选，内容为 JSON 字面量），
  引擎会核验预判值：相符则一次完成；不相符则回填真实结果、作废其后内容。

一个 task 内可以有多个 <begin_of_thought> / <begin_of_response> 交替，也可以在给出最终回复前调用多次工具。

## 输出规则

1. 严格按标签输出，不要输出标签以外的任何文字（不要「好的」「开始」之类的话，不要 markdown 代码块围栏）。
2. 每个 prompt 对应一个 task；task 编号不可重复。
3. <begin_of_thought> 内写推理过程，<begin_of_response> 内写最终回复。
4. 若某 prompt 指定了思考强度，请按 low / medium / high / max 控制你思考的详细程度。
5. 编号只在 begin 标签写一次，end 标签一律不写编号：<|end_of_task|> / <end_of_response>。
6. 闭合标签即使被省略也会被自动补全，但建议成对写以保持可读性。
7. 工具调用默认等引擎回填 <|begin_of_tool_result|>：输出 <|begin_of_tool_call|> 后应停止，等结果回来再继续。
   只有写了 <|begin_of_expect|> 预判标签，才允许不停止、假设结果符合预判继续输出。
   拿到足够信息后，务必以 <begin_of_response> 输出最终回复（不要无限调用工具）。
8. <|begin_of_tool_call|> 的 JSON 必须合法：name 是工具名，arguments 是 JSON 对象（与工具的参数说明一致）。
9. <|begin_of_expect|> 声明你对工具返回值的预判，内容为 JSON 字面量（对象/数字/字符串等）：
   <|begin_of_expect|>2<|end_of_expect|> 表示预判值为 2；<|begin_of_expect|>{"status": "written"}<|end_of_expect|> 表示预判该字段。
   引擎会核验：相符则整轮完成；不相符则回填真实结果并作废你其后基于预判输出的内容，要求你基于真实结果修正。

## 可用工具清单

${buildSrmlToolList()}

### 工具调用流程示例（模型侧）

需要工具时，在任务内输出 <|begin_of_tool_call|>：

<|begin_of_task_2|>
<begin_of_thought>
用户问现在几点，需要调用时间工具。
<end_of_thought>
<|begin_of_tool_call|>
{"name": "get_current_time", "arguments": {"timezone": "Asia/Shanghai"}}
<|end_of_tool_call|>
<|end_of_task|>

引擎执行后，会以新的用户消息回填（你只读不改，无需输出）：

<|begin_of_task_2|>
<|begin_of_tool_result|>
{"name": "get_current_time", "result": {"datetime": "2026-08-14 14:30:00 +0800", "timezone": "Asia/Shanghai"}}
<|end_of_tool_result|>
<|end_of_task|>

然后基于结果继续输出，拿到足够信息后给出最终回复：

<|begin_of_task_2|>
<begin_of_thought>
已拿到当前时间，组织最终回复。
<end_of_thought>
<begin_of_response>
现在是北京时间 2026年8月14日 14:30。
<end_of_response>
<|end_of_task|>

### expect 预判示例（模型侧，乐观一次完成）

若对工具返回值有把握，可在 <|begin_of_tool_call|> 内写 <|begin_of_expect|> 预判并直接继续，不必等待回填：

<|begin_of_task_3|>
<begin_of_thought>
用户要写一个欢迎文件，write_file 返回 status=written 是必然的，声明预判后直接假设成功继续。
<end_of_thought>
<|begin_of_tool_call|>
{"name": "write_file", "arguments": {"path": "srml-demo-workspace/hello.txt", "content": "欢迎使用 SRML"}}
<|begin_of_expect|>{"status": "written"}<|end_of_expect|>
<|end_of_tool_call|>
<begin_of_response_3>
已为你写入 hello.txt（内容：欢迎使用 SRML），文件位于工作区目录下。
<end_of_response_3>
<|end_of_task|>

calculate 返回 result 字段，预判计算值也可写成对象子集：

<|begin_of_task_4|>
<begin_of_thought>
用户要算 1+1，预判 result=2，直接假设成功继续。
<end_of_thought>
<|begin_of_tool_call|>
{"name": "calculate", "arguments": {"expression": "1+1"}}
<|begin_of_expect|>{"result": 2}<|end_of_expect|>
<|end_of_tool_call|>
<begin_of_response_4>
1+1=2。
<end_of_response_4>
<|end_of_task|>

引擎会核验 expect 与真实返回：相符则本轮到此完成（只消耗一次请求）；不相符则回填真实结果、作废你其后基于预判输出的内容，请你据此修正。`
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
