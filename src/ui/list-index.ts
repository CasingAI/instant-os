/**
 * List 索引条的纯逻辑侧：条上索引标签派生（拼音首字母）与按字母分组排序。
 *
 * 与 List/ListSection 的分工：组件是哑展示层——只按 DOM 顺序收集节、等比映射
 * 跳转，绝不排序、不重排；「启用 indexBar 即数据已按标签升序排好」这条契约的
 * 落地手段就是本模块的 groupByIndexLetter。纯逻辑模块，可 node
 * --experimental-strip-types 单测。
 */

import { pinyin } from '../vendor/pinyin-pro/index.mjs'

/** 索引标签：单个大写字母或 '#'（数字/符号等不可归字母的开头，iOS 惯例沉底）。 */
export type IndexLabel = string

export type IndexSortOptions = {
  /**
   * 姓氏模式：人名列表传 true，首字按姓氏读音消歧（曾 zēng/仇 qiú/单 shàn，
   * 默认词典会读成 céng/chóu/dān）。只该用于人名——普通词会被误伤
   * （曾经沧海 → zengjing…），短语词典词条不受影响（重庆 → chongqing）。
   */
  surname?: boolean
}

type PinyinPart = { origin: string; pinyin: string; isZh: boolean }

/** 拼音转换结果缓存：文本重复出现（列表重渲染）时不再走词典。 */
const sortKeyCache = new Map<string, string>()

function buildIndexSortKey(text: string, surname: boolean): string {
  let parts: PinyinPart[]
  try {
    parts = pinyin(text, {
      toneType: 'none',
      type: 'all',
      v: true,
      nonZh: 'consecutive',
      ...(surname ? { surname: 'all' } : {}),
    }) as unknown as PinyinPart[]
  } catch {
    return ''
  }
  let key = ''
  for (const part of parts) {
    // zh 音节连写；非 zh 段保留原字符（小写），保证 "iPhone" 排在 "ipad" 一类的
    // ASCII 混排也能比出确定顺序
    key += part.isZh && part.pinyin ? part.pinyin.replace(/\s+/g, '') : part.origin.toLowerCase()
  }
  return key
}

/**
 * 排序键：文本的全拼连写（zh 音节 + 非 zh 原字符小写），如 重庆→chongqing、
 * "3M 耳机"→"3m erji"。组内排序用它而不是 localeCompare('zh')——后者依赖
 * 运行环境的 ICU 数据，跨平台不稳定；本键是纯 ASCII 字典序，任何环境一致。
 * 标签与排序键同源（标签 = 键首字符的字母化），分组与显示永不互相矛盾。
 */
export function indexSortKey(text: string, options?: IndexSortOptions): string {
  const trimmed = text.trim()
  const surname = options?.surname ?? false
  if (!trimmed) return ''
  const cacheKey = `${surname ? 'S' : 'D'}\u0000${trimmed}`
  const cached = sortKeyCache.get(cacheKey)
  if (cached !== undefined) return cached
  const key = buildIndexSortKey(trimmed, surname)
  sortKeyCache.set(cacheKey, key)
  return key
}

/**
 * 条上索引标签：取文本首个「可归组字符」的拼音/字母首字母，大写输出。
 *   '阿福'→'A'   'Olivia'→'O'   '重庆'→'C'   '3M'→'#'   ''→'#'
 * options.surname 用于人名节标题的显示层派生（曾小明→Z 而非 C）。
 *
 * 多音字边界：靠 pinyin-pro 的短语词典 + 分词消歧，属「合理默认」而非真理——
 * 冷僻姓氏/词典外词可能归错。两级兜底：显示层用 ListSection 的 indexLabel
 * 显式覆盖；数据层分组用 indexSortKey(…, { surname }) 或完全自行分组。
 */
export function deriveIndexLabel(text: string, options?: IndexSortOptions): IndexLabel {
  const key = indexSortKey(text, options)
  const first = key[0]
  return first !== undefined && first >= 'a' && first <= 'z' ? first.toUpperCase() : '#'
}

/**
 * 首字标签（节少档显示用）：取文本首个码点原样输出，字母转大写，不做 # 归并。
 *   '水果类'→'水'   '蔬菜类'→'蔬'   'snacks'→'S'   '0元购'→'0'   ''→''
 * 与 deriveIndexLabel 的区别：不查拼音、不归并 #——首字档展示的是「分类真实的
 * 第一个字」，信息量大于字母；纯英文标题两档输出天然一致（首字母）。空串返回
 * 空由调用方回退（ListSection 回退到 deriveIndexLabel）。
 */
export function deriveIndexChar(text: string): string {
  const first = [...text.trim()][0]
  if (first === undefined) return ''
  return first >= 'a' && first <= 'z' ? first.toUpperCase() : first
}

/** 标签 → 排序秩：'A'-'Z' → 1-26，'#' → 27（沉底）；其余 null（不可比）。 */
function indexLabelRank(label: string): number | null {
  if (label.length !== 1) return null
  if (label === '#') return 27
  if (label >= 'A' && label <= 'Z') return label.charCodeAt(0) - 64
  return null
}

/**
 * 相邻两个条上标签的顺序校验：非降序返回 ≤0，逆序返回 >0；任一标签不是
 * /[A-Z#]/ 单字符（显式自定义标签）则返回 null 表示不判定——防误报。
 */
export function compareIndexLabelRank(a: string, b: string): number | null {
  const ra = indexLabelRank(a)
  const rb = indexLabelRank(b)
  return ra !== null && rb !== null ? ra - rb : null
}

export type IndexLetterGroup<T> = {
  label: IndexLabel
  items: T[]
}

/**
 * 把平铺列表按索引标签分组并排序——groupByIndexLetter 的输出保证：
 *   组标签 'A'-'Z' 升序、'#' 沉底；
 *   组内按 indexSortKey 升序，键相同保留原相对顺序（稳定排序）；
 *   空文本项归 '#'。
 * 输出直接映射为 ListSection（id=title=label）即可满足 indexBar 的排序契约。
 */
export function groupByIndexLetter<T>(
  items: readonly T[],
  getText: (item: T) => string,
  options?: IndexSortOptions,
): Array<IndexLetterGroup<T>> {
  const decorated = items.map((item) => {
    const key = indexSortKey(getText(item), options)
    const first = key[0]
    const label = first !== undefined && first >= 'a' && first <= 'z' ? first.toUpperCase() : '#'
    // 派生标签必为单字符，秩在此必然可算（区别于 compareIndexLabelRank 的可空判定）
    return { item, key, label, rank: label === '#' ? 27 : label.charCodeAt(0) - 64 }
  })
  decorated.sort((a, b) => a.rank - b.rank || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const groups: Array<IndexLetterGroup<T>> = []
  for (const { item, label } of decorated) {
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}
