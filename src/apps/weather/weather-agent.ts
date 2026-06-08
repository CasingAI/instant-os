import { parseJsonFromAiText } from '../../ai/parse-json-response.ts'
import { buildThinkingRequestExtras } from '../../ai/ai-thinking.ts'
import { mergeOpenAiConfig } from '../../ai/openai-config.ts'
import { getOpenAiClient } from '../../ai/openai-client.ts'
import type { NotificationWeather } from '../../os/notification-center-widget-types.ts'
import type { WeatherCitySuggestion, WeatherDetail } from './weather-types.ts'

const WEATHER_PROMPT = `你是 Instant OS 通知中心的天气小组件生成器。
请虚构一套看起来像真实天气预报的数据（城市、气温、湿度、风力等均可编造，不要引用真实 API）。

必须只返回 JSON 对象，不要 markdown，不要解释。格式：
{
  "city": "虚构中国城市名",
  "condition": "天气状况，如 多云转晴",
  "temperatureC": 24,
  "highC": 28,
  "lowC": 19,
  "humidity": 62,
  "wind": "东南风 3 级",
  "emoji": "一个与天气匹配的 emoji",
  "summary": "15~25 字的生活化短评，如 午后偏暖，傍晚可能有微风"
}

要求：数值彼此合理；中文表述；每次生成应略有变化。`

const WEATHER_DETAIL_PROMPT = `你是 Instant OS 天气应用的虚构天气预报生成器。
用户会提供一个城市名或搜索词，请据此编造完整的中文天气详情（不要引用真实 API 或真实城市实况）。

【重要】先判断搜索词性质，再选择风格：
- 若像真实地球上的城市、区县、国家、地区：编造常规气象数据（气温、湿度、风力、空气质量等），风格像正常天气预报。
- 若像科幻、奇幻、太空、星云、异世界、游戏地图、神话地名等明显非地球地点：禁止返回正经的地球城市天气。应编造与题材匹配的虚构环境，例如离子风暴、恒星风、辐射尘霾、双月当空、以太潮汐、灵能雾等；city 用该幻想地点名；condition/wind/summary 要有幻想或科幻色彩；数值可象征性填写，并在 summary 里点明这是虚构异界环境。

必须只返回 JSON 对象，不要 markdown，不要解释。格式：
{
  "city": "与用户搜索相关的地点名",
  "condition": "当前天气/环境状况",
  "temperatureC": 24,
  "highC": 28,
  "lowC": 19,
  "humidity": 62,
  "wind": "风力或环境描述",
  "emoji": "与状况匹配的 emoji",
  "summary": "20~35 字短评，风格与地点题材一致",
  "feelsLikeC": 26,
  "uvIndex": 5,
  "airQuality": "优/良/轻度污染 等，或虚构指标如 辐射中等",
  "visibilityKm": 12,
  "hourly": [
    { "time": "14:00", "tempC": 25, "emoji": "⛅" }
  ],
  "daily": [
    { "day": "周二", "highC": 28, "lowC": 19, "condition": "多云", "emoji": "⛅" }
  ]
}

要求：hourly 恰好 8 条、时间从当前时段起；daily 恰好 5 条；数值彼此合理；中文表述；题材与搜索词一致。`

const CITY_SEARCH_PROMPT = `你是 Instant OS 天气应用的城市搜索 AI。
用户输入关键词，请虚构 3~4 个与之相关的地点结果（不要引用真实 API）。

【重要】先判断搜索词性质，再选择风格：
- 若像真实地球上的城市、区县、国家、地区：返回看起来像真实中国城市/地区的结果，region 写省/直辖市/自治区，subtitle 偏生活化地理描述。
- 若像科幻、奇幻、太空、星云、异世界、游戏地图、神话地名等明显非地球地点：禁止返回正经的地球城市名。应返回与用户搜索词同题材的虚构地点，例如星云观测站、轨道殖民地、异次元门廊、浮空城等；region 可写虚构星区/位面/文明圈；subtitle 要有幻想或科幻色彩。

必须只返回 JSON 数组，不要 markdown，不要解释。每个元素格式：
{
  "name": "地点名",
  "region": "所属区域（地球行政区或虚构星区/位面）",
  "subtitle": "8~16 字描述，风格与题材一致"
}

要求：name 互不重复；与用户搜索词相关且题材一致；中文表述。`

function normalizeWeather(raw: NotificationWeather): NotificationWeather {
  return {
    city: raw.city.trim(),
    condition: raw.condition.trim(),
    temperatureC: Math.round(Number(raw.temperatureC)),
    highC: Math.round(Number(raw.highC)),
    lowC: Math.round(Number(raw.lowC)),
    humidity: Math.max(0, Math.min(100, Math.round(Number(raw.humidity)))),
    wind: raw.wind.trim(),
    emoji: raw.emoji.trim(),
    summary: raw.summary.trim(),
  }
}

function normalizeWeatherDetail(raw: WeatherDetail): WeatherDetail {
  const base = normalizeWeather(raw)
  return {
    ...base,
    feelsLikeC: Math.round(Number(raw.feelsLikeC)),
    uvIndex: Math.max(0, Math.min(11, Math.round(Number(raw.uvIndex)))),
    airQuality: raw.airQuality.trim(),
    visibilityKm: Math.max(0, Math.round(Number(raw.visibilityKm))),
    hourly: raw.hourly.slice(0, 8).map((item) => ({
      time: item.time.trim(),
      tempC: Math.round(Number(item.tempC)),
      emoji: item.emoji.trim(),
    })),
    daily: raw.daily.slice(0, 5).map((item) => ({
      day: item.day.trim(),
      highC: Math.round(Number(item.highC)),
      lowC: Math.round(Number(item.lowC)),
      condition: item.condition.trim(),
      emoji: item.emoji.trim(),
    })),
  }
}

async function completeJson<T>(system: string, user: string): Promise<T> {
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

  return parseJsonFromAiText<T>(text)
}

export async function generateFakeWeather(): Promise<NotificationWeather> {
  const raw = await completeJson<NotificationWeather>(WEATHER_PROMPT, '请生成一条虚构的今日天气。')
  return normalizeWeather(raw)
}

export async function generateWeatherDetail(cityQuery: string): Promise<WeatherDetail> {
  const query = cityQuery.trim()
  const raw = await completeJson<WeatherDetail>(
    WEATHER_DETAIL_PROMPT,
    query
      ? `搜索词：「${query}」。请先判断这是地球地点还是幻想/科幻地点，再生成风格一致的虚构天气详情。`
      : '请生成一条虚构城市的完整天气详情。',
  )
  return normalizeWeatherDetail(raw)
}

function normalizeCitySuggestions(raw: WeatherCitySuggestion[]): WeatherCitySuggestion[] {
  const seen = new Set<string>()
  return raw
    .map((item) => ({
      name: item.name.trim(),
      region: item.region.trim(),
      subtitle: item.subtitle.trim(),
    }))
    .filter((item) => {
      if (!item.name || seen.has(item.name)) {
        return false
      }
      seen.add(item.name)
      return true
    })
    .slice(0, 4)
}

export async function generateCitySearchSuggestions(query: string): Promise<WeatherCitySuggestion[]> {
  const trimmed = query.trim()
  if (!trimmed) {
    return []
  }
  const raw = await completeJson<WeatherCitySuggestion[]>(
    CITY_SEARCH_PROMPT,
    `搜索词：「${trimmed}」。请先判断这是地球地点还是幻想/科幻地点，再生成 3~4 个风格一致的建议。`,
  )
  if (!Array.isArray(raw)) {
    return []
  }
  return normalizeCitySuggestions(raw)
}
