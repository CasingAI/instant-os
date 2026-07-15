import {
  calendarInstantToMs,
  parseEditionDateKey,
  toAstronomicalYear,
  type CalendarInstant,
} from './calendar-instant.ts'
import { REIGN_ERAS, type ReignEra } from './chinese-reign-eras.ts'

type DynastyRange = {
  name: string
  start: number
  end: number
}

/** 非重叠或可唯一判定的朝代区间（天文纪年，含起止年）。 */
const DYNASTY_RANGES: readonly DynastyRange[] = [
  { name: '夏', start: -2070, end: -1601 },
  { name: '商', start: -1600, end: -1046 },
  { name: '西周', start: -1046, end: -771 },
  { name: '东周', start: -770, end: -256 },
  { name: '秦', start: -221, end: -206 },
  { name: '西汉', start: -202, end: 8 },
  { name: '新', start: 9, end: 23 },
  { name: '东汉', start: 25, end: 220 },
  { name: '三国', start: 220, end: 280 },
  { name: '西晋', start: 281, end: 316 },
  { name: '东晋', start: 317, end: 420 },
  { name: '南北朝', start: 421, end: 580 },
  { name: '隋', start: 581, end: 617 },
  { name: '唐', start: 618, end: 907 },
  { name: '五代', start: 908, end: 959 },
  { name: '北宋', start: 960, end: 1126 },
  { name: '南宋', start: 1127, end: 1270 },
  { name: '元', start: 1271, end: 1367 },
  { name: '明', start: 1368, end: 1643 },
  { name: '清', start: 1644, end: 1911 },
  { name: '民国', start: 1912, end: 1949 },
] as const

const PRC_FOUNDING_MS = calendarInstantToMs(
  parseEditionDateKey('1949-10-01'),
)

const DIGIT_CHARS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const

function toChineseNumeral(value: number): string {
  if (value <= 0) {
    return String(value)
  }
  if (value < 10) {
    return DIGIT_CHARS[value] ?? String(value)
  }
  if (value === 10) {
    return '十'
  }
  if (value < 20) {
    return `十${DIGIT_CHARS[value - 10] ?? ''}`
  }
  if (value < 100) {
    const tens = Math.floor(value / 10)
    const ones = value % 10
    const tensPart = `${DIGIT_CHARS[tens] ?? ''}十`
    return ones === 0 ? tensPart : `${tensPart}${DIGIT_CHARS[ones] ?? ''}`
  }
  return String(value)
}

function formatReignYearLabel(eraYear: number): string {
  if (eraYear === 1) {
    return '元'
  }
  return toChineseNumeral(eraYear)
}

/** 同年多个年号时，取开始最晚者；开始年相同则取表中较后者。 */
function resolveReignEra(astronomicalYear: number): ReignEra | undefined {
  let best: ReignEra | undefined
  for (const era of REIGN_ERAS) {
    if (astronomicalYear < era.startYear || astronomicalYear > era.endYear) {
      continue
    }
    if (!best || era.startYear >= best.startYear) {
      best = era
    }
  }
  return best
}

function resolveDynastyName(astronomicalYear: number): string | undefined {
  const matches = DYNASTY_RANGES.filter(
    (range) => astronomicalYear >= range.start && astronomicalYear <= range.end,
  )
  if (matches.length !== 1) {
    return undefined
  }
  return matches[0]?.name
}

function isBeforePrcFounding(instant: CalendarInstant): boolean {
  return calendarInstantToMs(instant) < PRC_FOUNDING_MS
}

function formatDynastyYearClause(instant: CalendarInstant): string | undefined {
  const astronomicalYear = toAstronomicalYear(instant.era, instant.year)
  const reign = resolveReignEra(astronomicalYear)
  if (reign) {
    const eraYear = astronomicalYear - reign.startYear + 1
    return `${reign.name}${formatReignYearLabel(eraYear)}年`
  }

  // 夏商周无可靠逐年纪年，括号内只写朝代名。
  return resolveDynastyName(astronomicalYear)
}

/**
 * 新中国成立前可标注时，返回本土纪年，如「光绪十五年」或仅朝代名「商」；
 * 无法判定时 undefined。
 */
export function formatChineseDynastyYearLabel(instant: CalendarInstant): string | undefined {
  if (!isBeforePrcFounding(instant)) {
    return undefined
  }
  return formatDynastyYearClause(instant)
}

/**
 * 日历图标用：命中可判定朝代时红顶为朝代名；
 * 有年号时白底为「乾兴元年」一类纪年，无年号时由调用方回退月份。
 */
export function formatChineseDynastyCalendarIconParts(
  instant: CalendarInstant,
): { dynastyName: string; yearLabel?: string } | undefined {
  if (!isBeforePrcFounding(instant)) {
    return undefined
  }
  const astronomicalYear = toAstronomicalYear(instant.era, instant.year)
  const dynastyName = resolveDynastyName(astronomicalYear)
  if (!dynastyName) {
    return undefined
  }
  const reign = resolveReignEra(astronomicalYear)
  if (!reign) {
    return { dynastyName }
  }
  const eraYear = astronomicalYear - reign.startYear + 1
  return {
    dynastyName,
    yearLabel: `${reign.name}${formatReignYearLabel(eraYear)}年`,
  }
}

/** 新中国成立前可标注时，返回如「（光绪十五年）」；否则 undefined。 */
export function formatChineseDynastySuffix(instant: CalendarInstant): string | undefined {
  const clause = formatChineseDynastyYearLabel(instant)
  if (!clause) {
    return undefined
  }
  return `（${clause}）`
}

export function formatChineseDynastySuffixForEditionDate(editionDate: string): string | undefined {
  return formatChineseDynastySuffix(parseEditionDateKey(editionDate))
}
