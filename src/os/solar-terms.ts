import {
  getDaysInMonth,
  normalizeCalendarInstant,
  toAstronomicalYear,
  type CalendarEra,
  type CalendarInstant,
} from './calendar-instant.ts'

export type SolarTermName =
  | '小寒'
  | '大寒'
  | '立春'
  | '雨水'
  | '惊蛰'
  | '春分'
  | '清明'
  | '谷雨'
  | '立夏'
  | '小满'
  | '芒种'
  | '夏至'
  | '小暑'
  | '大暑'
  | '立秋'
  | '处暑'
  | '白露'
  | '秋分'
  | '寒露'
  | '霜降'
  | '立冬'
  | '小雪'
  | '大雪'
  | '冬至'

export type SolarTermDefinition = {
  name: SolarTermName
  /** 黄经目标（度），春分 = 0 */
  longitude: number
  blurb: string
}

export type SolarTermOccurrence = {
  name: SolarTermName
  blurb: string
  era: CalendarEra
  year: number
  month: number
  day: number
}

/** 二十四节气：按黄经，从小寒起一圈。 */
export const SOLAR_TERM_DEFINITIONS: readonly SolarTermDefinition[] = [
  { name: '小寒', longitude: 285, blurb: '气温持续走低，天干气肃，宜养藏。' },
  { name: '大寒', longitude: 300, blurb: '一年中最冷时段，岁暮将尽。' },
  { name: '立春', longitude: 315, blurb: '春气始动，万物复苏之始。' },
  { name: '雨水', longitude: 330, blurb: '降水渐增，冰雪消融，农事将启。' },
  { name: '惊蛰', longitude: 345, blurb: '雷始发声，蛰虫惊而出。' },
  { name: '春分', longitude: 0, blurb: '昼夜平分，春意正盛。' },
  { name: '清明', longitude: 15, blurb: '气清景明，草木繁茂。' },
  { name: '谷雨', longitude: 30, blurb: '雨生百谷，播种得时。' },
  { name: '立夏', longitude: 45, blurb: '暑气初起，万物并秀。' },
  { name: '小满', longitude: 60, blurb: '麦类籽粒渐满，尚未成熟。' },
  { name: '芒种', longitude: 75, blurb: '有芒之谷可种，农忙正酣。' },
  { name: '夏至', longitude: 90, blurb: '白昼最长，阳气至极。' },
  { name: '小暑', longitude: 105, blurb: '暑热初盛，尚未至极。' },
  { name: '大暑', longitude: 120, blurb: '一年中最热时节，湿热交蒸。' },
  { name: '立秋', longitude: 135, blurb: '凉风渐至，秋意初现。' },
  { name: '处暑', longitude: 150, blurb: '暑气将歇，炎热渐退。' },
  { name: '白露', longitude: 165, blurb: '夜凉生露，天气转清。' },
  { name: '秋分', longitude: 180, blurb: '昼夜再次平分，秋色平分。' },
  { name: '寒露', longitude: 195, blurb: '露气转寒，深秋渐浓。' },
  { name: '霜降', longitude: 210, blurb: '天气渐冷，初霜将降。' },
  { name: '立冬', longitude: 225, blurb: '冬季开始，万物收藏。' },
  { name: '小雪', longitude: 240, blurb: '降雪伊始，地未大冻。' },
  { name: '大雪', longitude: 255, blurb: '雪势渐盛，闭塞成冬。' },
  { name: '冬至', longitude: 270, blurb: '白昼最短，阴极而阳生。' },
] as const

const termCache = new Map<number, SolarTermOccurrence[]>()

function gregorianToJdnNumber(astronomicalYear: number, month: number, day: number): number {
  const a = Math.floor((14 - month) / 12)
  const y = astronomicalYear + 4800 - a
  const m = month + 12 * a - 3
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  )
}

/** 近似太阳黄经（度），精度足以落点到日。 */
function approximateSolarLongitude(jdn: number): number {
  const t = (jdn - 2_451_545.0) / 36_525
  const mean = 280.46646 + 36_000.76983 * t + 0.0003032 * t * t
  const anomaly = 357.52911 + 35_999.05029 * t - 0.0001537 * t * t
  const anomalyRad = (anomaly * Math.PI) / 180
  const center =
    (1.914602 - 0.004817 * t - 0.000014 * t * t) * Math.sin(anomalyRad) +
    (0.019993 - 0.000101 * t) * Math.sin(2 * anomalyRad) +
    0.000289 * Math.sin(3 * anomalyRad)
  const longitude = mean + center
  return ((longitude % 360) + 360) % 360
}

function longitudeDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180
}

function crossedLongitude(prev: number, curr: number, target: number): boolean {
  return longitudeDelta(prev, target) > 0 && longitudeDelta(curr, target) <= 0
}

function eraYearFromAstro(astronomicalYear: number): { era: CalendarEra; year: number } {
  if (astronomicalYear <= 0) {
    return { era: 'BC', year: 1 - astronomicalYear }
  }
  return { era: 'AD', year: astronomicalYear }
}

function daysInAstroMonth(astroYear: number, month: number): number {
  const { era, year } = eraYearFromAstro(astroYear)
  return getDaysInMonth(era, year, month)
}

function noonLongitude(astroYear: number, month: number, day: number): number {
  return approximateSolarLongitude(gregorianToJdnNumber(astroYear, month, day))
}

/**
 * 计算某天文年内落点的二十四节气（以当地公历正午近似）。
 * 小寒、大寒在 1 月；其余按黄经顺序分布。
 */
export function listSolarTermsForAstroYear(astroYear: number): SolarTermOccurrence[] {
  const cached = termCache.get(astroYear)
  if (cached) {
    return cached
  }

  const found = new Map<SolarTermName, SolarTermOccurrence>()
  let prevLon = noonLongitude(astroYear - 1, 12, 31)

  for (let month = 1; month <= 12; month++) {
    const days = daysInAstroMonth(astroYear, month)
    for (let day = 1; day <= days; day++) {
      const lon = noonLongitude(astroYear, month, day)
      for (const term of SOLAR_TERM_DEFINITIONS) {
        if (found.has(term.name)) {
          continue
        }
        if (!crossedLongitude(prevLon, lon, term.longitude)) {
          continue
        }
        const { era, year } = eraYearFromAstro(astroYear)
        found.set(term.name, {
          name: term.name,
          blurb: term.blurb,
          era,
          year,
          month,
          day,
        })
      }
      prevLon = lon
    }
  }

  const result = SOLAR_TERM_DEFINITIONS.map((term) => {
    const hit = found.get(term.name)
    if (hit) {
      return hit
    }
    // 极端年份未扫到时回退到粗略估算日
    const { era, year } = eraYearFromAstro(astroYear)
    const fallbackDay = Math.min(5 + Math.floor(term.longitude / 15) % 2 === 0 ? 6 : 20, 28)
    const fallbackMonth = ((Math.floor(((term.longitude + 75) % 360) / 30) + 1 - 1) % 12) + 1
    return {
      name: term.name,
      blurb: term.blurb,
      era,
      year,
      month: fallbackMonth,
      day: fallbackDay,
    }
  })

  termCache.set(astroYear, result)
  return result
}

export function listSolarTermsForCalendarYear(
  era: CalendarEra,
  year: number,
): SolarTermOccurrence[] {
  return listSolarTermsForAstroYear(toAstronomicalYear(era, year))
}

export function listSolarTermsInMonth(
  era: CalendarEra,
  year: number,
  month: number,
): SolarTermOccurrence[] {
  return listSolarTermsForCalendarYear(era, year).filter(
    (term) => term.era === era && term.year === year && term.month === month,
  )
}

export function findSolarTermOnDay(
  instant: Pick<CalendarInstant, 'era' | 'year' | 'month' | 'day'>,
): SolarTermOccurrence | undefined {
  const normalized = normalizeCalendarInstant(instant)
  return listSolarTermsForCalendarYear(normalized.era, normalized.year).find(
    (term) =>
      term.era === normalized.era &&
      term.year === normalized.year &&
      term.month === normalized.month &&
      term.day === normalized.day,
  )
}
