import type { TerminalUpsertBlockOptions } from './terminal-types.ts'

export type TerminalDemoSink = {
  write: (text: string, format?: 'plain' | 'markdown') => void
  upsertBlock: (options: TerminalUpsertBlockOptions) => void
  removeBlock: (key: string) => void
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'))
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function progressBar(percent: number, width = 24): string {
  const clamped = Math.max(0, Math.min(100, percent))
  const filled = Math.round((clamped / 100) * width)
  const empty = width - filled
  return `\`${'█'.repeat(filled)}${'░'.repeat(empty)}\` **${clamped}%**`
}

const DEMO_STEPS = [
  '扫描 /user…',
  '读取目录元数据…',
  '汇总文件大小…',
  '生成报告表格…',
] as const

/**
 * 内置演示：同一 blockKey 原地刷新进度，再输出 Markdown 表格。
 * 不经 AI，用于展示 Live Markdown 能力。
 */
export async function runTerminalLiveDemo(
  sink: TerminalDemoSink,
  signal?: AbortSignal,
): Promise<void> {
  sink.write(
    [
      '## Live Markdown 演示',
      '',
      '本命令展示**可替换输出块**：同一 `key` 多次写入会**原地更新**，适合进度条与动态表格。',
      '',
      '试试输入 `demo` 即可复现。',
    ].join('\n'),
    'markdown',
  )

  await sleep(350, signal)

  for (let i = 0; i <= 100; i += 4) {
    const stepIndex = Math.min(
      DEMO_STEPS.length - 1,
      Math.floor((i / 100) * DEMO_STEPS.length),
    )
    sink.upsertBlock({
      key: 'demo-progress',
      format: 'markdown',
      kind: 'output',
      streaming: i < 100,
      text: [
        '### 任务进度',
        '',
        progressBar(i),
        '',
        DEMO_STEPS[stepIndex],
      ].join('\n'),
    })
    await sleep(45, signal)
  }

  sink.upsertBlock({
    key: 'demo-progress',
    format: 'markdown',
    kind: 'output',
    streaming: false,
    text: ['### 任务进度', '', progressBar(100), '', '完成。'].join('\n'),
  })

  await sleep(200, signal)

  sink.removeBlock('demo-progress')

  sink.upsertBlock({
    key: 'demo-table',
    format: 'markdown',
    kind: 'output',
    text: [
      '### 示例结果表',
      '',
      '| 路径 | 类型 | 大小 |',
      '| --- | --- | ---: |',
      '| `/user/notes.txt` | file | 1.2 KB |',
      '| `/user/projects` | dir | — |',
      '| `/user/draft.md` | file | 8.4 KB |',
      '',
      '_进度块结束后会 remove；表格用另一 key 保留。_',
    ].join('\n'),
  })

  sink.write('演示结束。真实任务里可由 AI 调用 upsert / remove_output_block 达到同样效果。', 'plain')
}
