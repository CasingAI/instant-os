import { buildThinkingRequestExtras } from '../../ai/ai-thinking.ts'
import { mergeOpenAiConfig } from '../../ai/openai-config.ts'
import { getOpenAiClient } from '../../ai/openai-client.ts'
import {
  FICTIONAL_LANGUAGE_BY_ID,
  HAJIKI_ALLOWED_CHARACTERS,
  HAJIKI_EMPTYEAR_LEXICON,
  type FictionalLanguageId,
} from './fictional-languages.ts'

const ZH_TO_FICTIONAL_PROMPT = `你是 Instant OS 翻译应用的宇宙语言生成器。
用户输入中文，请将其「翻译」为一种宇宙中某处使用的、地球上不存在的语言文字。

要求：
- 输出必须像一种可信但纯属编造的语言，不要保留可读的中文
- 大胆混用奇怪符号与变音字母，例如 ø、ë、á、î、ŵ、◆、※、⟨⟩、⁂、̃、̊、͡、╬、⋈、ゞ、※、⸮、⟡、⊹ 等；可穿插少量希腊或西里尔字母装饰
- 每次生成都应不同，富有随机性与创意；可分 1~3 行
- 长度与原文大致相当或略长
- 只输出翻译结果纯文本，不要解释、不要 markdown、不要引号包裹`

const ZH_TO_HAJIKI_PROMPT = `你是 Instant OS 翻译应用的「哈基语」生成器。
哈基语源自网络梗《哈基米南北绿豆》（又称南北路多/南北鲁多）的空耳歌词。

【硬性规则】输出只能由下列空耳字词拼成，禁止出现任何列表外的汉字、字母、数字、标点或符号：
允许的单字：${HAJIKI_ALLOWED_CHARACTERS}
允许直接复用的词块（可整段重复）：${HAJIKI_EMPTYEAR_LEXICON.join('、')}

要求：
- 全文必须由以上字词组合、重复、断句而成，读起来像空耳歌曲复读
- 每次生成排列不同，可多用「哈基米」「南北绿豆」「曼波」「哈呀库奶露」等经典片段
- 可用空格或换行分段，不要用句号逗号等标点
- 长度与原文大致相当或略长
- 只输出哈基语纯文本，不要解释、不要 markdown、不要引号包裹`

const FICTIONAL_TO_ZH_PROMPT = `你是 Instant OS 翻译应用的宇宙语言「反译」生成器。
用户输入的是某宇宙语言文本（可能是乱码或任意字符）。
无论用户输入什么，你都要随机编造一条中文句子——与原文在语义上完全无关。

要求：
- 每次生成不同的生活化中文短句（12~32 字），像日常提醒、闲聊或吐槽
- 与输入文本无任何对应关系；不要尝试解读或翻译原文
- 只输出一条中文句子，不要解释、不要 markdown、不要引号包裹`

async function completeText(system: string, user: string): Promise<string> {
  const config = mergeOpenAiConfig()
  const client = getOpenAiClient(config)
  const response = await client.chat.completions.create({
    model: config.defaultModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    ...buildThinkingRequestExtras(config.providerId, config.thinkingEnabled),
  })

  const text = response.choices[0]?.message?.content?.trim() ?? ''
  if (!text) {
    throw new Error('AI 未返回任何内容')
  }

  return text.replace(/^["「『]|["」』]$/g, '').trim()
}

export async function generateChineseToFictional(
  chineseText: string,
  languageId: FictionalLanguageId,
): Promise<string> {
  const trimmed = chineseText.trim()
  if (!trimmed) {
    return ''
  }

  const language = FICTIONAL_LANGUAGE_BY_ID[languageId]
  const system = language.hajikiOnly ? ZH_TO_HAJIKI_PROMPT : ZH_TO_FICTIONAL_PROMPT
  const user = language.hajikiOnly
    ? `中文原文：\n${trimmed}\n请生成哈基语翻译。`
    : [
        `目标语言：${language.name}（${language.nativeName}）`,
        `风格：${language.styleHint}`,
        `中文原文：\n${trimmed}`,
        '请生成宇宙语言翻译。',
      ].join('\n')

  return completeText(system, user)
}

export async function generateFictionalToChinese(fictionalText: string): Promise<string> {
  const trimmed = fictionalText.trim()
  if (!trimmed) {
    return ''
  }

  const user = `宇宙语言文本（请忽略其含义，随机返回一条无关中文）：\n${trimmed}`
  return completeText(FICTIONAL_TO_ZH_PROMPT, user)
}
