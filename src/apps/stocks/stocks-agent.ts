import { parseJsonFromAiText } from '../../ai/parse-json-response.ts'
import { buildThinkingRequestExtras } from '../../ai/ai-thinking.ts'
import { mergeOpenAiConfig } from '../../ai/openai-config.ts'
import { getOpenAiClient } from '../../ai/openai-client.ts'
import type { NotificationStockSnapshot } from '../../os/notification-center-widget-types.ts'
import type { StockBoard, StockDetail, StockSearchSuggestion } from './stocks-types.ts'

const STOCK_PROMPT = `你是 Instant OS 通知中心的股市小组件生成器。
请虚构一套看起来像 A 股/港股行情快照的数据（公司名、代码、价格、涨跌均可编造，不要引用真实行情）。

必须只返回 JSON 对象，不要 markdown，不要解释。格式：
{
  "marketName": "虚构市场名称，如 Instant 综合指数",
  "headline": "一句 12~20 字的 fictional 市场短评",
  "items": [
    {
      "symbol": "INST",
      "name": "虚构公司简称",
      "price": 128.5,
      "change": 2.3,
      "changePercent": 1.82
    }
  ]
}

要求：items 恰好 4 条；change 与 changePercent 符号一致；价格与涨跌合理；中文公司名；每次生成应略有变化。`

const STOCK_BOARD_PROMPT = `你是 Instant OS 股票应用的虚构行情生成器。
请编造一套完整的 fictional 市场看板（不要引用真实行情）。

必须只返回 JSON 对象，不要 markdown，不要解释。格式：
{
  "marketName": "虚构市场名称",
  "headline": "12~20 字市场短评",
  "indices": [
    { "name": "Instant 综指", "value": 3842.6, "change": 18.4, "changePercent": 0.48 }
  ],
  "items": [
    {
      "symbol": "INST",
      "name": "虚构公司简称",
      "price": 128.5,
      "change": 2.3,
      "changePercent": 1.82
    }
  ]
}

要求：indices 恰好 3 条；items 恰好 10 条；change 与 changePercent 符号一致；中文公司名。`

const STOCK_DETAIL_PROMPT = `你是 Instant OS 股票应用的虚构个股详情生成器。
用户会提供股票代码或公司名搜索词，请据此编造中文个股行情（不要引用真实数据）。

【重要】先判断搜索词性质，再选择风格：
- 若像真实公司、行业、股票代码、现实商业概念：编造像 A 股/港股一样的常规行情数据。
- 若像科幻、奇幻、太空、星云、异世界、游戏/动漫 IP、明显非现实商业概念：禁止返回正经的地球上市公司风格。应编造与题材匹配的虚构标的，例如星云矿业、曲率引擎、灵石能源、跨星系物流等；exchange 可用虚构交易所（如 猎户座主板、第七位面柜台）；summary 要有幻想或科幻色彩。

必须只返回 JSON 对象，不要 markdown，不要解释。格式：
{
  "symbol": "代码，大写",
  "name": "公司简称",
  "exchange": "交易所名称",
  "price": 128.5,
  "change": 2.3,
  "changePercent": 1.82,
  "open": 126.0,
  "high": 129.8,
  "low": 125.2,
  "prevClose": 126.2,
  "volume": "328.6 万手",
  "marketCap": "842 亿",
  "summary": "30~50 字短评，风格与题材一致"
}

要求：change 与 changePercent 符号一致；open/high/low/prevClose 与 price 合理；中文表述；题材与搜索词一致。`

const STOCK_SEARCH_PROMPT = `你是 Instant OS 股票应用的搜索 AI。
用户输入关键词，请虚构 6~8 个与之相关的 fictional 股票/公司结果（不要引用真实行情）。

【重要】先判断搜索词性质，再选择风格：
- 若像真实公司、行业、股票代码、现实商业概念：返回看起来像常规 A 股/港股的虚构公司，exchange 用虚构但偏现实的交易所名。
- 若像科幻、奇幻、太空、星云、异世界、游戏/动漫 IP、明显非现实商业概念：禁止返回正经的地球上市公司。应返回同题材的虚构标的，例如星云拓殖、反物质贸易、龙鳞期货、位面港口控股等；exchange/subtitle 要有幻想或科幻色彩。

必须只返回 JSON 数组，不要 markdown，不要解释。每个元素格式：
{
  "symbol": "代码，大写",
  "name": "公司简称",
  "exchange": "交易所名称",
  "subtitle": "8~16 字描述，风格与题材一致"
}

要求：symbol 互不重复；与用户搜索词相关且题材一致；中文公司名。`

function normalizeStockSnapshot(raw: NotificationStockSnapshot): NotificationStockSnapshot {
  const items = raw.items.slice(0, 4).map((item) => ({
    symbol: item.symbol.trim().toUpperCase(),
    name: item.name.trim(),
    price: Number(item.price),
    change: Number(item.change),
    changePercent: Number(item.changePercent),
  }))

  return {
    marketName: raw.marketName.trim(),
    headline: raw.headline.trim(),
    items,
  }
}

function normalizeStockBoard(raw: StockBoard): StockBoard {
  const base = normalizeStockSnapshot(raw)
  return {
    ...base,
    indices: raw.indices.slice(0, 3).map((item) => ({
      name: item.name.trim(),
      value: Number(item.value),
      change: Number(item.change),
      changePercent: Number(item.changePercent),
    })),
    items: raw.items.slice(0, 10).map((item) => ({
      symbol: item.symbol.trim().toUpperCase(),
      name: item.name.trim(),
      price: Number(item.price),
      change: Number(item.change),
      changePercent: Number(item.changePercent),
    })),
  }
}

function normalizeStockDetail(raw: StockDetail): StockDetail {
  return {
    symbol: raw.symbol.trim().toUpperCase(),
    name: raw.name.trim(),
    exchange: raw.exchange.trim(),
    price: Number(raw.price),
    change: Number(raw.change),
    changePercent: Number(raw.changePercent),
    open: Number(raw.open),
    high: Number(raw.high),
    low: Number(raw.low),
    prevClose: Number(raw.prevClose),
    volume: raw.volume.trim(),
    marketCap: raw.marketCap.trim(),
    summary: raw.summary.trim(),
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

export async function generateFakeStockSnapshot(): Promise<NotificationStockSnapshot> {
  const raw = await completeJson<NotificationStockSnapshot>(STOCK_PROMPT, '请生成一组虚构的股市快照。')
  return normalizeStockSnapshot(raw)
}

export async function generateStockBoard(): Promise<StockBoard> {
  const raw = await completeJson<StockBoard>(STOCK_BOARD_PROMPT, '请生成一组虚构的完整股市看板。')
  return normalizeStockBoard(raw)
}

export async function generateStockDetail(query: string): Promise<StockDetail> {
  const trimmed = query.trim()
  const raw = await completeJson<StockDetail>(
    STOCK_DETAIL_PROMPT,
    trimmed
      ? `搜索词：「${trimmed}」。请先判断这是现实商业概念还是幻想/科幻概念，再生成风格一致的虚构个股详情。`
      : '请生成一条虚构个股详情。',
  )
  return normalizeStockDetail(raw)
}

function normalizeStockSuggestions(raw: StockSearchSuggestion[]): StockSearchSuggestion[] {
  const seen = new Set<string>()
  return raw
    .map((item) => ({
      symbol: item.symbol.trim().toUpperCase(),
      name: item.name.trim(),
      exchange: item.exchange.trim(),
      subtitle: item.subtitle.trim(),
    }))
    .filter((item) => {
      if (!item.symbol || seen.has(item.symbol)) {
        return false
      }
      seen.add(item.symbol)
      return true
    })
    .slice(0, 8)
}

export async function generateStockSearchSuggestions(query: string): Promise<StockSearchSuggestion[]> {
  const trimmed = query.trim()
  if (!trimmed) {
    return []
  }
  const raw = await completeJson<StockSearchSuggestion[]>(
    STOCK_SEARCH_PROMPT,
    `搜索词：「${trimmed}」。请先判断这是现实商业概念还是幻想/科幻概念，再生成 6~8 个风格一致的建议。`,
  )
  if (!Array.isArray(raw)) {
    return []
  }
  return normalizeStockSuggestions(raw)
}
