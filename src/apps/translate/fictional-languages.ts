export type FictionalLanguageId =
  | 'haqiululu'
  | 'bojiwala'
  | 'gechicha'
  | 'dulubala'
  | 'guangdang'
  | 'hajiki'

export type FictionalLanguage = {
  id: FictionalLanguageId
  name: string
  nativeName: string
  emoji: string
  description: string
  /** 供 AI 把握语种气质的简短风格提示 */
  styleHint: string
  /** 哈基语：译文只能由空耳字表拼出 */
  hajikiOnly?: boolean
}

/** 《哈基米南北绿豆》等空耳梗中允许出现的字与词块 */
export const HAJIKI_EMPTYEAR_LEXICON = [
  '哈',
  '基',
  '米',
  '啊',
  '南',
  '北',
  '绿',
  '豆',
  '呀',
  '库',
  '奶',
  '露',
  '吉',
  '嘎',
  '西',
  '椰',
  '打',
  '耶',
  '哦',
  '嘛',
  '自',
  '立',
  '曼',
  '波',
  '了',
  '噶',
  '路',
  '多',
  '鲁',
  '哈基米',
  '哈基米啊',
  '南北绿豆',
  '南北路多',
  '南北鲁多',
  '哈呀库',
  '奶露',
  '哈呀库奶露',
  '哈吉嘎西',
  '椰打耶',
  '椰打耶南北绿豆',
  '哦嘛自立',
  '曼波',
  '曼波哈基米',
  '南北绿了豆',
  '啊西噶',
  '啊西噶南北绿豆',
  '耶打',
  '啊西噶南北绿豆耶打',
  '哦嘛自立曼波哈吉',
] as const

export const HAJIKI_ALLOWED_CHARACTERS = Array.from(
  new Set(HAJIKI_EMPTYEAR_LEXICON.join('').split('')),
).join('')

export const FICTIONAL_LANGUAGES: readonly FictionalLanguage[] = [
  {
    id: 'haqiululu',
    name: '哈啾噜噜语',
    nativeName: '哈啾·噜噜',
    emoji: '💫',
    description: '说话像一串自己绊到自己的啾噜声。',
    styleHint: '杂乱可爱、重复啾噜；音节随便叠，别太工整。',
  },
  {
    id: 'bojiwala',
    name: '波叽哇啦语',
    nativeName: '波叽·哇啦',
    emoji: '🫧',
    description: '像泡泡炸开时瞎嘀咕。',
    styleHint: '波、叽、哇、啦乱窜；长短不一，带点滑稽感。',
  },
  {
    id: 'gechicha',
    name: '咯哧哧啪语',
    nativeName: '咯哧·哧啪',
    emoji: '🥁',
    description: '咯哧一下又啪一下，节奏很碎。',
    styleHint: '拟声词感；咯、哧、啪、嗒乱入，可夹杂奇怪符号。',
  },
  {
    id: 'dulubala',
    name: '嘟噜巴拉语',
    nativeName: '嘟噜·巴拉',
    emoji: '🎺',
    description: '嘟噜拖着走，巴拉突然拐弯。',
    styleHint: '圆润尾音 + 突然截断；嘟噜、巴拉、吧嗒随机混。',
  },
  {
    id: 'guangdang',
    name: '咣当咕唧语',
    nativeName: '咣当·咕唧',
    emoji: '🔔',
    description: '像铁皮桶滚下山坡。',
    styleHint: '咣、当、咕、唧、哐啷；闷响与尖音交替。',
  },
  {
    id: 'hajiki',
    name: '哈基语',
    nativeName: '哈基米南北鲁多',
    emoji: '🧇',
    description:
      '来自遥远哈基米星球的语言。哈基米究竟是什么，宇宙间尚无定论——只知那里的不明生物，会在星空下哼唱南北鲁多之歌。',
    styleHint: '严格空耳复读机；只能使用哈基米歌曲空耳字词，可重复、可断句，禁止任何列表外文字。',
    hajikiOnly: true,
  },
]

export const FICTIONAL_LANGUAGE_BY_ID: Record<FictionalLanguageId, FictionalLanguage> = Object.fromEntries(
  FICTIONAL_LANGUAGES.map((language) => [language.id, language]),
) as Record<FictionalLanguageId, FictionalLanguage>
