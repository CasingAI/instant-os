/**
 * SRML Demo 自拟任务场景。
 *
 * 核心是「Fork」——一次请求里塞多个 <|begin_of_prompt_N|> 块（不同任务、可带不同思考强度），
 * 模型必须在一次回复里为每个 prompt 输出一个 task，thinking 打包在 DSL 里。
 * 工具类场景演示 expect 契约的两条路径：写 <|begin_of_expect|> 预判（乐观一次完成）与
 * 不写 expect（输出 tool_call 后等 <|begin_of_tool_result|> 回填）。
 */
import type { SrmlPromptBlock } from './srml-dsl.ts'

export type SrmlScenario = {
  id: string
  title: string
  description: string
  prompts: SrmlPromptBlock[]
}

function prompt(id: number, content: string, thoughtEffort?: string): SrmlPromptBlock {
  const block: SrmlPromptBlock = { kind: 'prompt', id, content }
  if (thoughtEffort) block.thoughtEffort = thoughtEffort
  return block
}

export const SRML_SCENARIOS: SrmlScenario[] = [
  {
    id: 'fork-title-greeting',
    title: 'Fork · 标题 + 打招呼',
    description:
      '一次请求同时发两个 prompt（任务 1 生成标题，任务 2 打招呼且指定 low 思考强度），模型输出两个 task，每个 task 都打包思考',
    prompts: [
      prompt(1, '为当前会话生成标题并包裹在<title></title>标签中。'),
      prompt(2, '你好', 'low'),
    ],
  },
  {
    id: 'single-math',
    title: '单任务 · 1+1 为什么等于 2',
    description: '单个 prompt，指定 max 思考强度，观察模型在 <begin_of_thought> 里写完整推理',
    prompts: [prompt(1, '你知道1+1为什么等于2吗？', 'max')],
  },
  {
    id: 'fork-dual-language',
    title: 'Fork · 中英双语文案',
    description: '一次请求同时要中英两段欢迎文案（任务 1 不指定强度，任务 2 指定 medium），验证多 task 并行输出',
    prompts: [
      prompt(1, '用中文写一句欢迎语，不超过 20 个字。'),
      prompt(2, '用英文写一句欢迎语，不超过 20 个词。', 'medium'),
    ],
  },
  {
    id: 'predictable-vs-plain-report',
    title: 'expect 预判 vs 等回填 · 生成周报',
    description:
      'Fork 两个任务：任务 1 串联 calculate + write_file，每个 tool_call 写 <|begin_of_expect|> 预判后假设成功继续，一次请求完成；' +
      '任务 2 调用 download_file + read_file，不写 expect，必须等引擎回填结果后再继续。同一请求对比两条路径',
    prompts: [
      prompt(
        1,
        '生成一份本周销售周报：先用 calculate 计算 (128+256+64)*1.08 得到总价，' +
          '再用 write_file 把计算结果与一句总结写入 srml-demo-workspace/report.md。' +
          '两个工具调用都要在块内 JSON 之后写 <|begin_of_expect|> 预判：' +
          'calculate 预判总价约为 483.84（写成 {"result": 483.84}），write_file 预判写入成功（写成 {"status": "written"}）。' +
          '写预判后不要停止等待，直接假设成功继续，最后以 <begin_of_response> 给出最终回复（说明文件路径与计算结果）。',
      ),
      prompt(
        2,
        '用 download_file 下载 https://example.com/release-notes.txt 保存为 srml-demo-workspace/release-notes.txt，' +
          '再用 read_file 读取它并告诉我内容要点。' +
          '这两个工具调用都不写 <|begin_of_expect|>：输出 tool_call 后必须停止，等引擎回填 <|begin_of_tool_result|> 后再继续。',
      ),
    ],
  },
  {
    id: 'predictable-batch-write',
    title: 'expect 预判 · 批量写 3 个文件',
    description:
      '单任务连续调用 write_file 三次（README / 说明 / 待办），每次带 <|begin_of_expect|>{"status":"written"}<|end_of_expect|> 预判并假设成功继续，' +
      '最后一次输出里给出统一回复。整轮仅一次请求，引擎事后核对三次预判是否全部成立',
    prompts: [
      prompt(
        1,
        '连续调用 write_file 创建 3 个文件，内容随意但要有意义：' +
          'srml-demo-workspace/README.md（项目简介）、srml-demo-workspace/notes.md（使用说明）、' +
          'srml-demo-workspace/todo.md（三件待办事项）。' +
          '每次 write_file 都在块内 JSON 之后写 <|begin_of_expect|>{"status": "written"}<|end_of_expect|> 预判，' +
          '然后不要停止等待，直接假设成功继续，最后统一给出最终回复。',
      ),
    ],
  },
]
