import { parseJsonFromAiText } from '../../ai/parse-json-response.ts'
import { buildThinkingRequestExtras } from '../../ai/ai-thinking.ts'
import type { AiUsageContext } from '../../ai/ai-usage-context.ts'
import { recordOpenAiCompletionUsage } from '../../ai/openai-usage.ts'
import { mergeOpenAiConfig } from '../../ai/openai-config.ts'
import { getOpenAiClient } from '../../ai/openai-client.ts'
import {
  formatCalendarYearLabel,
  parseEditionDateKey,
  toAstronomicalYear,
  type CalendarInstant,
  weekdayIndexForInstant,
} from '../../os/calendar-instant.ts'
import { formatChineseDynastySuffix } from '../../os/chinese-dynasty-label.ts'
import { findSolarTermOnDay } from '../../os/solar-terms.ts'
import { createEventId, saveDayDigest } from './calendar-storage.ts'
import type { CalendarDayDigest, CalendarMajorEvent } from './calendar-types.ts'

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

function seasonLabel(month: number): string {
  if (month >= 3 && month <= 5) return '春季'
  if (month >= 6 && month <= 8) return '夏季'
  if (month >= 9 && month <= 11) return '秋季'
  return '冬季'
}

function historicalFrameHint(instant: CalendarInstant): string {
  const year = toAstronomicalYear(instant.era, instant.year)
  if (year <= -1000) {
    return '上古/远古：用史志、邦国、农牧、星象与口述传闻口吻；勿出现近现代器物。'
  }
  if (year <= 0) {
    return '先秦至秦汉前夜：可用诸侯、战事、农桑、朝廷诏令等；勿出现手机、汽车、互联网。'
  }
  if (year < 618) {
    return '汉至南北朝：用史书、邸抄、民间传闻风格；勿出现近现代工业与数字科技。'
  }
  if (year < 960) {
    return '隋唐：可用驿传、边塞、市井与科举前后社会图景。'
  }
  if (year < 1368) {
    return '宋元：可用邸报、商路、边情与学宫议论。'
  }
  if (year < 1912) {
    return '明清至清末：可用京报、告示与商埠传闻；洋务以降可谨慎出现近代事物。'
  }
  if (year < 1949) {
    return '民国：可用报纸、电讯口吻；勿写成 21 世纪日常科技。'
  }
  if (year < 1990) {
    return '新中国至改革开放中前期：可有广播电视；勿默认智能手机与短视频。'
  }
  if (year < 2010) {
    return '1990–2009：可有个人电脑与早期互联网；勿写成全面自媒体时代。'
  }
  if (year <= 2025) {
    return '当代：可用今日语汇；仍须以目标日期为「今天」。'
  }
  return '近未来：可适度前瞻，但日期表述仍以目标日期为「今天」。'
}

function describeDayForPrompt(dayKey: string): string {
  const instant = parseEditionDateKey(dayKey)
  const weekday = WEEKDAY_LABELS[weekdayIndexForInstant(instant)] ?? '周一'
  const readable = `${formatCalendarYearLabel(instant)}${instant.month}月${instant.day}日 ${weekday}`
  const dynasty = formatChineseDynastySuffix(instant)
  const term = findSolarTermOnDay(instant)
  return [
    `日期编码：${dayKey}`,
    `人类可读：${readable}${dynasty ? ` ${dynasty}` : ''}`,
    `季节：${seasonLabel(instant.month)}`,
    term ? `当日节气：${term.name}（${term.blurb}）——可作氛围，勿把节气本身再写成一条「重大事件」` : '当日非二十四节气交节日',
    `时代约束：${historicalFrameHint(instant)}`,
  ].join('\n')
}

const EVENTS_PROMPT = `你是 Instant OS 日历应用的「当日大事」撰稿人。

任务：为用户给出的公历日期，生成 3～5 条中文「重大事件 / 要闻提要」。内容可虚构，但必须读起来像**那一天**可能发生、流传或被记录的大事，有自洽世界观。

## 日期（最高优先级）
- 用户消息中的日期就是这一天的「今天」
- 题材、器物、制度、传播方式必须贴合该日所处历史阶段（见时代约束）
- **严禁**把用户真实世界「当下」热点硬塞进来；也**严禁**把现代生活硬套到古代日期
- **不要预设或照抄任何固定事件库**；每次按日期与时代即兴生成
- 若历史上该日确有广为人知的大事，可作锚点再合理补全细节；想不起时宁可写契合季节与时代的虚构要闻，也不要写成另一个世纪的事
- 节气若已在上下文给出，可作物候背景，但不要单独把「交节」再列为一条重大事件

## 输出格式
必须只返回 JSON 数组，不要 markdown，不要解释。每个元素：
{
  "title": "12～28 字标题",
  "summary": "40～90 字摘要，像当日简讯",
  "category": "从 政治/军事/民生/天象/文化/邦交/灾异/建设 中选一，若时代不宜用近现代词可换成同义古风称呼写入该字段"
}

要求：条目彼此独立、不重复；中文；口气是当日见闻而非后世史评（少用「据史料」「多年后」）。`

type RawEvent = {
  title?: unknown
  summary?: unknown
  category?: unknown
}

async function completeJson<T>(
  system: string,
  user: string,
  usageContext: AiUsageContext,
): Promise<T> {
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

  const text = response.choices[0]?.message?.content ?? ''
  if (!text.trim()) {
    throw new Error('AI 未返回任何内容')
  }

  recordOpenAiCompletionUsage(response, usageContext, {
    model: config.defaultModel,
    thinkingEnabled: config.thinkingEnabled,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  })
  return parseJsonFromAiText<T>(text)
}

function normalizeEvents(raw: unknown): CalendarMajorEvent[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return (raw as RawEvent[])
    .map((item): CalendarMajorEvent | undefined => {
      if (!item || typeof item !== 'object') {
        return undefined
      }
      const title = typeof item.title === 'string' ? item.title.trim() : ''
      const summary = typeof item.summary === 'string' ? item.summary.trim() : ''
      const category = typeof item.category === 'string' ? item.category.trim() : '要闻'
      if (!title || !summary) {
        return undefined
      }
      return {
        id: createEventId(),
        title,
        summary,
        category: category || '要闻',
      }
    })
    .filter((item): item is CalendarMajorEvent => item !== undefined)
    .slice(0, 5)
}

export async function generateDayMajorEvents(
  dayKey: string,
  options?: { persist?: boolean },
): Promise<CalendarDayDigest> {
  const context = describeDayForPrompt(dayKey)
  const raw = await completeJson<unknown>(
    EVENTS_PROMPT,
    `${context}\n\n请为该日生成 3～5 条重大事件。`,
    { actor: 'calendar', behavior: 'day-events', behaviorLabel: '生成当日大事' },
  )
  const events = normalizeEvents(raw)
  if (events.length === 0) {
    throw new Error('未能解析出有效的重大事件')
  }
  const digest: CalendarDayDigest = {
    dayKey,
    generatedAt: Date.now(),
    events,
  }
  if (options?.persist !== false) {
    saveDayDigest(digest)
  }
  return digest
}
