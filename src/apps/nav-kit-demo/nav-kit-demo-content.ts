// 「导航组件演示」的演示内容：书架 → 书 → 卷 → 章 → 节，逐级下钻。
// 内容为程序化生成的虚构手册数据，仅供展示页面栈导航。

export interface NavKitSection {
  title: string
  paragraphs: string[]
  bullets: string[]
}

export interface NavKitChapter {
  title: string
  sections: NavKitSection[]
}

export interface NavKitVolume {
  title: string
  chapters: NavKitChapter[]
}

export interface NavKitBook {
  id: string
  title: string
  author: string
  intro: string
  cover: string
  volumes: NavKitVolume[] | null
  chapters: NavKitChapter[]
}

interface BookSeed {
  id: string
  title: string
  author: string
  intro: string
  cover: string
  volumes: { title: string; chapters: string[] }[] | null
  chapterTitles: string[]
}

/** 每章三节的标题，按章序交替，避免千篇一律。 */
const SECTION_TITLE_SETS: [string[], string[]] = [
  ['原理与要点', '常见误区', '实操示例'],
  ['准备工作', '步骤详解', '进阶技巧'],
]

const SENTENCE_BANK = [
  '这一步是整个流程的基础，做得扎实，后面的环节都会顺畅很多。',
  '初次尝试时不必追求一步到位，先把动作做完整，再慢慢提速。',
  '选材与工具的准备往往比操作本身更影响最终结果。',
  '如果发现效果与预期不符，先回到上一步检查，而不是急着返工。',
  '保持环境整洁和光线充足，能明显减少操作中的失误。',
  '记录每次尝试的参数变化，积累的数据就是最好的老师。',
  '手感需要时间和重复来养成，完成一件成品后的复盘同样重要。',
  '遇到拿不准的情况，宁可放慢速度，也不要硬着头皮继续。',
  '成品的细节之处，最能体现制作者对前面每一步的用心。',
  '多观察、多比较，别人的成品里藏着许多值得借鉴的思路。',
  '收尾工作看似简单，却是决定整体观感的关键环节。',
  '把常用的动作固定成自己的习惯，效率会在一段时间后明显提升。',
]

/** 个别章节的第三节用长标题，用于观察标题省略。 */
const LONG_SECTION_OVERRIDES: Record<string, string> = {
  '划线、凿卯与开榫': '进阶练习：在边角料上反复练习，直到腕部发力稳定',
}

function pickSentence(b: number, v: number | null, c: number, s: number, i: number): string {
  const vv = v === null ? -1 : v
  const idx = (b * 3 + (vv + 1) * 2 + c * 5 + s * 7 + i * 5) % SENTENCE_BANK.length
  return SENTENCE_BANK[idx] ?? ''
}

function buildSections(b: number, v: number | null, c: number, chapterTitle: string): NavKitSection[] {
  const set = SECTION_TITLE_SETS[c % SECTION_TITLE_SETS.length]
  return set.map((title, s) => {
    const override = s === 2 ? LONG_SECTION_OVERRIDES[chapterTitle] : undefined
    return {
      title: override ?? title,
      paragraphs: Array.from({ length: 6 }, (_, i) => pickSentence(b, v, c, s, i)),
      bullets: Array.from({ length: 4 }, (_, i) => pickSentence(b, v, c, s, i + 6)),
    }
  })
}

function buildChapters(b: number, v: number | null, titles: string[]): NavKitChapter[] {
  return titles.map((title, c) => ({ title, sections: buildSections(b, v, c, title) }))
}

const BOOK_SEEDS: BookSeed[] = [
  {
    id: 'cooking',
    title: '云岭烹饪笔记',
    author: '林晚',
    intro: '一本从灶台到餐桌的随手笔记：火候、调味与面点的日常练习，按卷逐章往下翻。',
    cover: '#b3522e',
    volumes: [
      {
        title: '卷一 火候',
        chapters: ['灶火的层次', '油温的判断', '焯水与过油'],
      },
      {
        title: '卷二 调味',
        chapters: ['盐的时机', '酱油与酱料的搭配', '复合味型的平衡'],
      },
      {
        title: '卷三 面点',
        chapters: ['和面的比例', '发酵的温度与时间', '擀皮与包制的细节'],
      },
    ],
    chapterTitles: [],
  },
  {
    id: 'stars',
    title: '星图漫录',
    author: '沈砚',
    intro: '写给城市观星者的四季星空指南，从裸眼识星到深空漫游。',
    cover: '#2f5373',
    volumes: [
      {
        title: '卷一 观星入门',
        chapters: ['选择观测点', '裸眼识星', '双筒望远镜的使用'],
      },
      {
        title: '卷二 四季星空',
        chapters: ['春夜的大三角', '夏季银河与天鹅座', '秋夜的飞马座', '冬夜的猎户座'],
      },
      {
        title: '卷三 深空漫游',
        chapters: ['星云与星团的区别', '行星观测的时机', '光害滤镜与月相'],
      },
    ],
    chapterTitles: [],
  },
  {
    id: 'woodwork',
    title: '手作木器入门',
    author: '老周木作',
    intro: '从一块木头到一件器物，无卷直章：认识木材、掌握工具，亲手做完一张小板凳。',
    cover: '#7c5c2a',
    volumes: null,
    chapterTitles: [
      '认识木材与纹理方向',
      '基本工具的挑选与保养',
      '划线、凿卯与开榫',
      '刨平、打磨与木蜡油的表面处理',
      '一件小板凳的完整制作',
    ],
  },
]

export const NAV_KIT_DEMO_BOOKS: NavKitBook[] = BOOK_SEEDS.map((seed, b) => {
  const volumes = seed.volumes
    ? seed.volumes.map((v, vi) => ({ title: v.title, chapters: buildChapters(b, vi, v.chapters) }))
    : null
  const chapters = volumes
    ? volumes.flatMap((v) => v.chapters)
    : buildChapters(b, null, seed.chapterTitles)
  return {
    id: seed.id,
    title: seed.title,
    author: seed.author,
    intro: seed.intro,
    cover: seed.cover,
    volumes,
    chapters,
  }
})

export function totalChapters(book: NavKitBook): number {
  return book.chapters.length
}

export function totalSections(book: NavKitBook): number {
  return book.chapters.reduce((sum, ch) => sum + ch.sections.length, 0)
}