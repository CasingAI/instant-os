/**
 * pinyin-pro 精简类型声明（vendor 自包含 ESM，无外部依赖）。
 * 仅声明本项目用到的 API；完整类型见官方包 types/。
 */

export type ToneType = 'symbol' | 'num' | 'none'
export type InitialPattern = 'initial' | 'first' | 'no' | 'head'

export interface PinyinOptions {
  /** 声调格式：symbol=符号(nǐ) / num=数字(ni3) / none=无调(ni) */
  toneType?: ToneType
  /** 输出格式：string=空格分隔 / array=数组 / all=含细节对象数组 */
  type?: 'string' | 'array' | 'all'
  /** 是否返回多音字全部读音 */
  heteronym?: boolean
  /** 分词模式（多音字上下文消歧） */
  segment?: boolean
  /** ü 是否写作 v */
  v?: boolean
  /** 是否去除空白字符 */
  removeNonZh?: boolean
  /** 非汉字字符的保留策略 */
  nonZh?: 'spaced' | 'consecutive' | 'removed'
  /** 姓氏模式 */
  surname?: 'single' | 'all' | 'polyphonic' | true | false
  /** 分词算法 */
  algorithm?: 'reverseMaxMatch' | 'minTokenization' | 'maxProbability'
}

/** 单个字/词的结果（type:'all' 时） */
export interface SingleWordResult {
  origin: string
  pinyin: string
  initial: string
  final: string
  isZh: boolean
  polyphonic?: string[]
  num?: number
}

export function pinyin(
  word: string,
  options?: PinyinOptions & { type?: 'string' },
): string
export function pinyin(
  word: string,
  options: PinyinOptions & { type: 'array' },
): string[]
export function pinyin(
  word: string,
  options: PinyinOptions & { type: 'all' },
): SingleWordResult[]

/** 自定义拼音字典（测试/纠错用） */
export function customPinyin(dict: Record<string, string>, options?: { origin?: boolean }): void
export function clearCustomDict(): void

/** 带调拼音 → { initial, final }，如 nǐ → { initial: 'n', final: 'i' } */
export function getInitialAndFinal(
  pinyin: string,
  initialPattern?: InitialPattern,
): { final: string; initial: string }

/** 韵母 → 韵头/韵腹/韵尾，如 ian → { head: 'i', body: 'a', tail: 'n' } */
export function getFinalParts(pinyin: string): { head: string; body: string; tail: string }

/** 带调拼音 → 带调数字，如 nǐ → ni3 */
export function getNumOfTone(pinyin: string): string
