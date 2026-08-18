import { parseJsonFromAiText } from '../../ai/parse-json-response.ts'
import { buildThinkingRequestExtras } from '../../ai/ai-thinking.ts'
import { finishAiEventLogSession, startAiEventLogSession } from '../../ai/ai-event-log.ts'
import type { AiUsageContext } from '../../ai/ai-usage-context.ts'
import { recordOpenAiCompletionUsage } from '../../ai/openai-usage.ts'
import { mergeOpenAiConfig } from '../../ai/openai-config.ts'
import { getOpenAiClient } from '../../ai/openai-client.ts'
import {
  formatCalendarYearLabel,
  formatEditionDateKey,
  getDaysInMonth,
  normalizeCalendarInstant,
  toAstronomicalYear,
  type CalendarEra,
  type CalendarInstant,
} from '../../os/calendar-instant.ts'
import { formatChineseDynastySuffix } from '../../os/chinese-dynasty-label.ts'
import {
  createMarkerId,
  formatMonthKey,
  saveMonthDigest,
} from './calendar-storage.ts'
import type {
  CalendarDayMarker,
  CalendarMarkerKind,
  CalendarMonthDigest,
} from './calendar-types.ts'

type EraMode = 'ancient' | 'imperial' | 'republican' | 'modern' | 'nearFuture' | 'farFuture'

type FixedHoliday = {
  month: number
  day: number
  name: string
  note: string
}

/** 公历固定节日：当代月历必须落盘，不可被即兴改名取代。 */
const FIXED_GREGORIAN_HOLIDAYS: readonly FixedHoliday[] = [
  { month: 1, day: 1, name: '元旦', note: '元旦，新年第一天。' },
  { month: 3, day: 8, name: '妇女节', note: '国际劳动妇女节。' },
  { month: 5, day: 1, name: '劳动节', note: '国际劳动节。' },
  { month: 5, day: 4, name: '青年节', note: '五四青年节。' },
  { month: 6, day: 1, name: '儿童节', note: '国际儿童节。' },
  { month: 7, day: 1, name: '建党节', note: '中国共产党成立纪念日。' },
  { month: 8, day: 1, name: '建军节', note: '中国人民解放军建军节。' },
  { month: 9, day: 10, name: '教师节', note: '教师节。' },
  { month: 10, day: 1, name: '国庆节', note: '中华人民共和国国庆节。' },
]

function realWorldAstroYear(): number {
  return new Date().getFullYear()
}

function resolveEraMode(instant: CalendarInstant): EraMode {
  const year = toAstronomicalYear(instant.era, instant.year)
  const realYear = realWorldAstroYear()
  if (year <= -1000) return 'ancient'
  if (year < 1912) return 'imperial'
  if (year < 1949) return 'republican'
  if (year <= realYear + 5) return 'modern'
  if (year <= realYear + 80) return 'nearFuture'
  return 'farFuture'
}

function eraModeLabel(mode: EraMode): string {
  switch (mode) {
    case 'ancient':
      return '远古时期'
    case 'imperial':
      return '帝制时期'
    case 'republican':
      return '民国时期'
    case 'modern':
      return '当代'
    case 'nearFuture':
      return '近未来'
    case 'farFuture':
      return '远未来'
  }
}

function eraModeGuidance(mode: EraMode): string {
  switch (mode) {
    case 'ancient':
      return [
        '本月按远古/上古氛围加载节日。',
        '用语贴近祭祀、星象、农牧、氏族集会；节日可如「歇役观星」「春狩日」「社火夜」。',
        '不要出现帝国官僚节假、近现代国家纪念日、科技与互联网语汇。',
        '整月稀疏补若干贴合氛围的节日即可。',
      ].join('\n')
    case 'imperial':
      return [
        '本月按帝制中国氛围加载节日（先秦至清末）。',
        '以朝廷祀典、农桑休市，以及上元、寒食、端午、中秋、重阳等传统节令为主；其余空日可再补少量同气质节日。',
        '不要出现国庆、劳动节、互联网梗；不要把当代法定假日硬套回去。',
      ].join('\n')
    case 'republican':
      return [
        '本月按民国氛围加载节日。',
        '可用双十、五四一类纪念氛围，以及学堂假、商埠节庆。',
        '可有轻微近代器物，但不要写成 21 世纪互联网迷因，也不要提前套用共和国法定假日体系。',
        '在已知纪念节之外，可于空日再补少量同气质节日。',
      ].join('\n')
    case 'modern':
      return [
        '本月按当代氛围加载节日（新中国成立后至贴近当下的年份）。',
        '固定公历节日必须按真实常用名落点，不可改名（例如 10 月 1 日必须是「国庆节」）。',
        '传统节日（春节、元宵、清明、端午、中秋、重阳等）若该月大致会落到，请按常识补上真实称呼。',
        '在上述固定/传统节日之外，再从没有节日的日期里挑若干天，补上适量贴切的节日（kind=holiday），口吻像大家会认的节庆短名。',
        '二十四节气由系统本地计算，不要输出 solar-term 条目。',
        '天气物候短签可偶尔点缀，但不要抢占真实节日日期的主名称。',
      ].join('\n')
    case 'nearFuture':
      return [
        '本月按近未来氛围加载节日（数十年内）。',
        '若仍能辨认今天的法定节日（如国庆、劳动节、元旦），请保留真实名称。',
        '在这些固定节日之外，于空日再补若干带轻度时代演进色彩的节日（如城市静音日、轨道补给假）。',
        '世界仍应可辨认，不要写成完全陌生的外星历法。',
      ].join('\n')
    case 'farFuture':
      return [
        '本月按远未来氛围加载节日（约一个世纪及更远）。',
        '节日文化可以换代：轨道节、生态休眠、深空驿站歇航、合成季节观礼等均可。',
        '不必保留 21 世纪国家纪念日体系；口吻要像「对当时的人来说这就是现在」。',
        '仍用公历月日骨架，稀疏覆盖若干日期即可。',
      ].join('\n')
  }
}

function fixedHolidaysForMonth(month: number, daysInMonth: number): FixedHoliday[] {
  return FIXED_GREGORIAN_HOLIDAYS.filter(
    (item) => item.month === month && item.day >= 1 && item.day <= daysInMonth,
  )
}

function describeMonthForPrompt(view: {
  era: CalendarEra
  year: number
  month: number
}): {
  monthKey: string
  userBlock: string
  daysInMonth: number
  mode: EraMode
} {
  const monthKey = formatMonthKey(view)
  const daysInMonth = getDaysInMonth(view.era, view.year, view.month)
  const anchor = normalizeCalendarInstant({
    era: view.era,
    year: view.year,
    month: view.month,
    day: 1,
  })
  const mode = resolveEraMode(anchor)
  const dynasty = formatChineseDynastySuffix(anchor)
  const readable = `${formatCalendarYearLabel(view)}${view.month}月`
  const lines = [
    `月份编码：${monthKey}`,
    `人类可读：${readable}${dynasty ? ` ${dynasty}` : ''}`,
    `本月天数：${daysInMonth}`,
    `日号范围：1～${daysInMonth}`,
    `时代模式：${eraModeLabel(mode)}`,
    `时代指引：`,
    eraModeGuidance(mode),
  ]

  if (mode === 'modern' || mode === 'nearFuture') {
    const fixed = fixedHolidaysForMonth(view.month, daysInMonth)
    if (fixed.length > 0) {
      lines.push('本月必须包含的固定公历节日（kind=holiday，name 必须一字不差）：')
      for (const item of fixed) {
        lines.push(`- ${item.day}日「${item.name}」—— ${item.note}`)
      }
      lines.push(
        '除此以外，请再从没有上述固定节日的日期中另选若干天，补上适量节日（kind=holiday），不要占用固定节日日期改名。',
      )
    } else {
      lines.push('本月无固定公历节日清单项；请稀疏补上若干贴合时代的节日（kind=holiday）。')
    }
  }

  return { monthKey, userBlock: lines.join('\n'), daysInMonth, mode }
}

function markersSystemPrompt(mode: EraMode): string {
  const shared = `你是 Instant OS「月历」应用的月度特殊日期标记员。

## 共同规则
- 该月就是「现在」：题材必须服从下方时代模式，不要串台
- 主要产出假期/节日短名；可少量天气物候短签（如「初雪」「黄梅」）
- 禁止写成当日重大新闻或局势盘点
- 不要输出二十四节气（kind=solar-term）：系统已本地算定
- 整月稀疏：大约 8～16 条，覆盖不同日期，不要几乎天天有标记
- 固定节日日期必须保留真实节日名；其余空日可再补节日

## 输出格式
必须只返回 JSON 数组，不要 markdown，不要解释。每个元素：
{
  "day": 本月日号（整数）,
  "kind": "holiday" | "weather" | "special",
  "name": "2～8 字短名，适合印在月历格子上",
  "note": "可选，12～40 字一句说明（假期最好写清是什么假）"
}

要求：中文；name 短而清楚。`

  const modeExtra =
    mode === 'modern'
      ? `\n\n## 当代特别强调\n先落实国定/常见固定节日，再在没有这些节日的日期里补若干适宜节日；绝不可改写固定节日名。补充节日也应读起来像节日短名，而不是新闻标题。`
      : mode === 'ancient' || mode === 'farFuture'
        ? `\n\n## 时代特别强调\n以贴合该时代氛围的节日为主；自洽即可，不要回填用户当下现实热点梗。`
        : `\n\n## 年代特别强调\n该时代广为人知的节令优先用常见称呼；其余空日可再补少量同气质节日。`

  return shared + modeExtra
}

type RawMarker = {
  day?: unknown
  kind?: unknown
  name?: unknown
  note?: unknown
}

async function completeJson<T>(
  system: string,
  user: string,
  usageContext: AiUsageContext,
): Promise<T> {
  const config = mergeOpenAiConfig()
  const client = getOpenAiClient(config)
  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ]
  const logSession = startAiEventLogSession(usageContext, {
    model: config.defaultModel,
    thinkingEnabled: config.thinkingEnabled,
    messages,
  })
  try {
    const response = await client.chat.completions.create({
      model: config.defaultModel,
      messages,
      ...buildThinkingRequestExtras(config.providerId, config.thinkingEnabled, config.defaultModel),
    })

    const text = response.choices[0]?.message?.content ?? ''
    if (!text.trim()) {
      throw new Error('AI 未返回任何内容')
    }

    recordOpenAiCompletionUsage(response, usageContext, {
      model: config.defaultModel,
      thinkingEnabled: config.thinkingEnabled,
      messages,
      session: logSession,
    })
    return parseJsonFromAiText<T>(text)
  } catch (error) {
    const snapshot = logSession.snapshot()
    if (snapshot) {
      finishAiEventLogSession(logSession, usageContext, {
        response: snapshot.response,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'AI 请求失败',
      })
    }
    throw error
  }
}

function normalizeKind(raw: unknown): CalendarMarkerKind {
  if (raw === 'holiday' || raw === 'solar-term' || raw === 'weather' || raw === 'special') {
    return raw
  }
  if (typeof raw === 'string') {
    if (raw.includes('假') || raw.includes('节')) return 'holiday'
    if (raw.includes('气') || raw.includes('节令')) return 'solar-term'
    if (raw.includes('天') || raw.includes('雨') || raw.includes('雪')) return 'weather'
  }
  return 'special'
}

function ensureFixedHolidays(
  markers: CalendarDayMarker[],
  view: { era: CalendarEra; year: number; month: number },
  daysInMonth: number,
  mode: EraMode,
): CalendarDayMarker[] {
  if (mode !== 'modern' && mode !== 'nearFuture') {
    return markers
  }

  const required = fixedHolidaysForMonth(view.month, daysInMonth)
  if (required.length === 0) {
    return markers
  }

  const byDay = new Map<number, CalendarDayMarker[]>()
  for (const marker of markers) {
    const list = byDay.get(marker.day) ?? []
    list.push(marker)
    byDay.set(marker.day, list)
  }

  const next = [...markers]
  for (const holiday of required) {
    const dayMarkers = byDay.get(holiday.day) ?? []
    const already = dayMarkers.some(
      (item) => item.kind === 'holiday' && item.name === holiday.name,
    )
    if (already) {
      continue
    }

    // 若该日已有被改名的假期，改回真实名；否则追加一条。
    const renamed = dayMarkers.find((item) => item.kind === 'holiday')
    if (renamed) {
      renamed.name = holiday.name
      renamed.note = holiday.note
      continue
    }

    const dayKey = formatEditionDateKey(
      normalizeCalendarInstant({
        era: view.era,
        year: view.year,
        month: view.month,
        day: holiday.day,
      }),
    )
    next.push({
      id: createMarkerId(),
      day: holiday.day,
      dayKey,
      kind: 'holiday',
      name: holiday.name,
      note: holiday.note,
    })
  }

  return next.slice(0, 24)
}

function normalizeMarkers(
  raw: unknown,
  view: { era: CalendarEra; year: number; month: number },
  daysInMonth: number,
): CalendarDayMarker[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const seen = new Set<string>()
  return (raw as RawMarker[])
    .map((item): CalendarDayMarker | undefined => {
      if (!item || typeof item !== 'object') {
        return undefined
      }
      const day = typeof item.day === 'number' ? Math.floor(item.day) : Number(item.day)
      if (!Number.isFinite(day) || day < 1 || day > daysInMonth) {
        return undefined
      }
      const name = typeof item.name === 'string' ? item.name.trim() : ''
      if (!name) {
        return undefined
      }
      const shortName = name.slice(0, 10)
      const note =
        typeof item.note === 'string' && item.note.trim()
          ? item.note.trim().slice(0, 80)
          : undefined
      const kind = normalizeKind(item.kind)
      // 节气由本地算法负责，丢弃模型输出的节气条目
      if (kind === 'solar-term') {
        return undefined
      }
      const dayKey = formatEditionDateKey(
        normalizeCalendarInstant({
          era: view.era,
          year: view.year,
          month: view.month,
          day,
        }),
      )
      const dedupe = `${day}|${kind}|${shortName}`
      if (seen.has(dedupe)) {
        return undefined
      }
      seen.add(dedupe)
      return {
        id: createMarkerId(),
        day,
        dayKey,
        kind,
        name: shortName,
        note,
      }
    })
    .filter((item): item is CalendarDayMarker => item !== undefined)
    .slice(0, 20)
}

export async function generateMonthMarkers(
  view: { era: CalendarEra; year: number; month: number },
  options?: { persist?: boolean },
): Promise<CalendarMonthDigest> {
  const { monthKey, userBlock, daysInMonth, mode } = describeMonthForPrompt(view)
  const raw = await completeJson<unknown>(
    markersSystemPrompt(mode),
    `${userBlock}\n\n请为本月加载特殊日期标记。`,
    { actor: 'calendar', behavior: 'month-markers', behaviorLabel: '加载月度特殊日期' },
  )
  const markers = ensureFixedHolidays(
    normalizeMarkers(raw, view, daysInMonth),
    view,
    daysInMonth,
    mode,
  )
  if (markers.length === 0) {
    throw new Error('未能解析出有效的特殊日期标记')
  }
  const digest: CalendarMonthDigest = {
    monthKey,
    generatedAt: Date.now(),
    markers,
  }
  if (options?.persist !== false) {
    await saveMonthDigest(digest)
  }
  return digest
}
