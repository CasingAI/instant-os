/**
 * SRML Demo 自拟任务场景。
 *
 * 本轮定位：最简单版，不做 tool call。核心是「Fork」——
 * 一次请求里塞多个 <|begin_of_prompt_N|> 块（不同任务、可带不同思考强度），
 * 模型必须在一次回复里为每个 prompt 输出一个 task，thinking 打包在 DSL 里。
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
]
