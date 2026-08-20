import { extractAbcSource } from './midi-demo-abc.ts'

export const MIDI_DEMO_USAGE = {
  actor: 'midi-demo',
  behavior: 'compose',
  behaviorLabel: '生成乐谱',
} as const

export const MIDI_DEMO_EXAMPLES = [
  'C 大调八小节抒情钢琴小品，双手，中等速度',
  '简单的 C 大调练习曲，四分音符为主，单手旋律',
  '欢乐颂前两句，钢琴双手',
] as const

export const COMPOSER_SYSTEM_PROMPT = `你是钢琴作曲引擎。只输出合法 ABC 记谱，不要解释，不要 Markdown 代码块，不要前后缀。

硬性约束：
1. 第一行必须是 X:1，随后写 T:、M:、L:、Q:、K:。
2. 只为钢琴写作。禁止鼓组、禁止 MIDI Program Change、禁止打击乐记谱。
3. 可用 V:1（高音谱）和 V:2（低音谱）表示双手，两声部都是钢琴。
4. 优先 8 小节以内；拍号用 4/4 或 3/4。
5. 只使用这个子集：音名 CDEFGABc 与 , ' 八度、时值数字与斜杠（如 2、/2、3/2）、休止 z、和弦 [CEG]、小节线 |、升降 ^ _ =、三连音 (3。
6. 每一小节的时值必须刚好填满拍号，不要多拍或少拍。
7. L: 建议 1/8；速度写成 Q:1/4=96 这种形式。
8. 不要歌词、不要吉他和弦标记、不要装饰音。

输出从 X:1 开始，到最后一个音符结束。`

export type ComposeAbcOptions = {
  prompt: string
  onChunk: (accumulated: string) => void
  signal?: AbortSignal
}

export async function composeAbcScore(options: ComposeAbcOptions): Promise<string> {
  const prompt = options.prompt.trim()
  if (!prompt) {
    throw new Error('请先描述想要的曲子')
  }
  const { streamChatCompletion } = await import('../../ai/stream-chat.ts')
  const text = await streamChatCompletion({
    system: COMPOSER_SYSTEM_PROMPT,
    user: [
      '请按系统约束写出一首钢琴曲的 ABC 乐谱。',
      `用户描述：${prompt}`,
    ].join('\n'),
    usageContext: MIDI_DEMO_USAGE,
    temperature: 0.7,
    onChunk: (_delta, accumulated) => {
      options.onChunk(accumulated)
    },
    signal: options.signal,
  })
  return extractAbcSource(text)
}
