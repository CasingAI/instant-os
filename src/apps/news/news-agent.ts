import { parseJsonFromAiText } from '../../ai/parse-json-response.ts'
import {
  calendarInstantFromDate,
  formatCalendarYearLabel,
  parseEditionDateKey,
  toAstronomicalYear,
  type CalendarInstant,
} from '../../os/calendar-instant.ts'
import { isOsClockAtLeastYearsAwayFromReal } from '../../os/os-clock.ts'
import { createNdjsonLineFeed, parseNdjsonLine } from '../../ai/parse-streaming-json.ts'
import { streamChatCompletion } from '../../ai/stream-chat.ts'
import { mergeOpenAiConfig } from '../../ai/openai-config.ts'
import {
  estimatePromptTokensAsync,
  buildLiveTokenUsageAsync,
  prepareTokenEstimation,
} from '../browser/estimate-token-usage.ts'
import { recordNewsTokenUsage } from './news-token-usage.ts'
import { buildNearbyTitlesContext, createArticleId, readNewsStore } from './news-storage.ts'
import type { GeneratedArticleDraft, NewsArticle } from './news-types.ts'

const ARTICLE_LINE_EXAMPLE = JSON.stringify({
  title: '示例标题（须贴合目标日期的时代与季节）',
  category: '社会',
  lead: '导语示例：把「今日」理解为目标日期当天，勿写成用户真实世界的当代新闻。',
  body: '正文示例第一段。\\n\\n正文示例第二段。',
  source: '虚构时报',
})

/** 版面日期相对真实墙钟：过去 / 贴近当下 / 未来 */
export type EditionTemporalMode = 'past' | 'present' | 'future'

function seasonLabel(month: number): string {
  if (month >= 3 && month <= 5) return '春季'
  if (month >= 6 && month <= 8) return '夏季'
  if (month >= 9 && month <= 11) return '秋季'
  return '冬季'
}

function realWorldInstant(): CalendarInstant {
  return calendarInstantFromDate(new Date())
}

export function editionTemporalMode(editionDate: string): EditionTemporalMode {
  const edition = parseEditionDateKey(editionDate)
  const real = realWorldInstant()
  const editionYear = toAstronomicalYear(edition.era, edition.year)
  const realYear = toAstronomicalYear(real.era, real.year)
  if (editionYear < realYear) return 'past'
  if (editionYear > realYear) return 'future'
  // 同年：按月日再分；同日视为 present
  if (edition.month < real.month) return 'past'
  if (edition.month > real.month) return 'future'
  if (edition.day < real.day) return 'past'
  if (edition.day > real.day) return 'future'
  return 'present'
}

function historicalFrameHint(instant: CalendarInstant, mode: EditionTemporalMode): string {
  const year = toAstronomicalYear(instant.era, instant.year)
  const real = realWorldInstant()
  const realYear = toAstronomicalYear(real.era, real.year)

  if (year <= -1000) {
    return '上古/远古时期：用史志、邦国、农牧、星象、礼乐与口述传闻口吻；勿出现互联网、电力、现代国家机构或当代品牌。'
  }
  if (year <= 0) {
    return '先秦至秦汉前夜：可用诸侯、战事、农桑、市井、朝廷诏令等叙事；科技与传播方式须符合青铜/铁器农耕社会，勿出现手机、汽车、股票、AI。'
  }
  if (year < 618) {
    return '汉至南北朝：用史书、邸抄、民间传闻风格；勿出现近现代工业与数字科技。'
  }
  if (year < 960) {
    return '隋唐时期：可用驿传、邸报、边塞、市井与科举前后社会图景；勿出现近现代器物与制度。'
  }
  if (year < 1368) {
    return '宋元时期：可用邸报、市井笔记、商路、边情与学宫议论；勿出现电力、内燃机与互联网。'
  }
  if (year < 1912) {
    return '明清至清末：可用邸抄、京报、地方告示与商埠传闻；对洋务以降可谨慎出现近代事物，但勿写成 21 世纪生活方式。'
  }
  if (year < 1949) {
    return '民国时期：可用报纸、电讯、杂志口吻；用语与器物应符合 20 世纪上半叶，勿写成改革开放后的日常科技。'
  }
  if (year < 1990) {
    return '新中国至改革开放前期/中期：可有广播电视与报纸；勿默认智能手机、短视频、互联网舆论场为日常。'
  }
  if (year < 2010) {
    return '1990–2009：可有个人电脑与早期互联网，但勿写成全面智能手机与自媒体时代。'
  }
  if (mode === 'past' || mode === 'present') {
    if (year <= realYear) {
      return '当代（相对真实世界为过去或当下）：可用今日媒体语汇；但仍须以版面日期为「今天」，勿擅自写成别的年份。'
    }
  }

  // 未来版面
  const yearsAhead = year - realYear
  return [
    `近未来/未来（版面公历约 ${year} 年，相对真实世界大约超前 ${yearsAhead} 年）：`,
    '可虚构该年已普及的技术、制度与生活方式，但全文必须像「那天正在发行的报纸」。',
    `版面年份 ${year} 就是绝对「今天」：凡小于 ${year} 的年份都是往事/背景，只能用完成时、回顾、纪念日、复盘、十年回望等过去视角；`,
    `严禁把 ${year} 年之前的年份写成「即将签署」「将于××年生效」「××年起配套」「规划到××年」这类未发生口吻。`,
    `若写展望，只允许展望 ${year} 年之后的日子；不要把真实世界里常见的 2030/2035/2045/2060 等政策口号时间线当成本版「前瞻」。`,
  ].join('')
}

function temporalOrientationHint(instant: CalendarInstant, mode: EditionTemporalMode): string {
  const yearLabel = formatCalendarYearLabel(instant)
  const realLabel = formatCalendarYearLabel(realWorldInstant())
  if (mode === 'past') {
    return `时间取向：此版相对真实世界为「过去」。整版以 ${yearLabel} 为今天；不要用后世回望口吻，也不要把真实世界 ${realLabel} 之后才有的事物写进当日新闻。`
  }
  if (mode === 'future') {
    const y = toAstronomicalYear(instant.era, instant.year)
    return [
      `时间取向：此版相对真实世界为「未来」。整版以 ${yearLabel} 为今天。`,
      `已发生：一切早于 ${y} 年的事件、条约、建设、政策节点——写作时当作历史背景或纪念回顾，绝不能再写成「未来将要」。`,
      `正在发生：仅限版面日期当天及前后数日的事态。`,
      `尚未发生：仅限 ${y} 年之后；且不要机械套用真实世界熟悉的远期规划年份。`,
    ].join('')
  }
  return `时间取向：此版贴近真实世界「当下」。仍以版面日期为今天，勿错写成前后别的年份。`
}

export function describeEditionDateForPrompt(editionDate: string): string {
  const instant = parseEditionDateKey(editionDate)
  const mode = editionTemporalMode(editionDate)
  const readable = `${formatCalendarYearLabel(instant)}${instant.month}月${instant.day}日`
  const season = seasonLabel(instant.month)
  const frame = historicalFrameHint(instant, mode)
  const orientation = temporalOrientationHint(instant, mode)
  return [
    `版面日期编码：${editionDate}`,
    `人类可读日期：${readable}（${season}）`,
    `相对真实世界：${mode === 'past' ? '过去' : mode === 'future' ? '未来' : '当下'}`,
    orientation,
    `时代与传播约束：${frame}`,
  ].join('\n')
}

const OUTPUT_AND_DIVERSITY_RULES = `
必须采用 NDJSON 格式：每行一个完整 JSON 对象，不要数组包裹，不要 markdown，不要解释。
每行格式：${ARTICLE_LINE_EXAMPLE}

每条新闻对象字段：
- title：新闻标题（吸引人，准确，15-28字；语气与时代匹配）
- category：分类（国内、国际、财经、科技、体育、娱乐、社会、汽车、房产中的一个）
- lead：导语/摘要，40-90字
- body：正文，3-5个自然段，合计280-520字，使用\\n表示段落
- source：虚构但**符合该时代传播形态**的媒体名（古今报纸、邸报、京报、电台、网站、自媒体号等须合理）

要求：
- 生成 4 到 6 篇新闻，逐行输出；生成完一篇就立刻输出一行，不要等全部完成再输出
- **每批次至少 1 篇 category 为「国际」的稿件**（可 1 篇或多篇；须写域外邦国、外事、跨境商路、海外使节、邻邦战事等，题材与时代自洽）
- 题材与主题必须尽可能多样化：优先覆盖不同 category，同一批次内不要扎堆同一领域或同一类型事件
- 主动拉开选题差异：可混合宏观政策、行业动态、民生消费、文化娱乐、科技创新、体育赛事、区域社会新闻、国际见闻等；角度、地域、人物与叙事风格也要尽量各不相同——但以上均须落在该历史阶段的可想象范围内
- 标题与导语避免同质化表述，不要多篇都写成「发布会」「同比增长」「引发关注」等同质套路
- 【逆天保底】每批次至少 1 篇必须是「标题党 / 逆天奇闻」风格，与其余正经稿件形成反差。这类稿件要：
  · 标题夸张抓眼：善用悬念、反转、数字冲击、情绪词；可略野，但仍是完整新闻标题，且离谱点要建立在**该时代的技术与社会常识**上
  · 内容离谱却自洽：乌龙反转、奇葩民生、逆天巧合、社死现场等；用符合时代的采访/街谈/读者来信等方式写实
  · 正文照样写满 3~5 段；source 可用八卦号、地方小报、坊间传闻类媒体名（须时代自洽）
  · 逆天稿仍需虚构世界观；勿涉及与时代无关的真实名人/真实机构造谣，勿越安全红线
- 如果附近标题提供了连贯线索，可在 1~2 篇稿件中合理跟进或呼应，其余篇目仍应保持独立、新鲜的选题
- 严禁政治敏感、暴力血腥、违法内容；逆天稿可以荒诞搞笑，但不要阴暗血腥或恶意人身攻击`

const DATE_ANCHOR_SHARED = `## 版面日期（极其重要，最高优先级）
- 用户消息中的「人类可读日期」与「版面日期编码」就是这一版新闻的「今天」
- 全文把该日当作绝对现在：可用「今日」「本周」「近日」「今晨」等，但所指必须落在该版面日期
- **题材、器物、制度、媒体形态、口头禅、季节物候、国际格局，全部必须贴合该日期所处的历史阶段**（见用户消息里的时代约束与时间取向）
- **严禁**默认写成用户真实世界的「当下」新闻；若版面是古代/近代，禁止出现不符时代的手机、短视频、新能源汽车、AI 大模型、当代明星梗等
- **严禁**把与版面日期无关的真实世界年份、用户阅读时的近几天热点硬塞进来；版权年、赛事赛季、高考/财报周期、节气农事等也要与**版面**年份和季节一致
- 上面的 JSON 示例**只示范字段结构**，不要模仿示例里的当代措辞与选题
- 若目标日期远离当代，category 仍从给定列表中选，但具体事件要翻译成该时代可理解的「国内/国际/财经/科技/体育/娱乐/社会」等价物（例如古代「科技」可为农器、历法、工匠新制，「娱乐」可为优伶、词曲、百戏）`

const GENERATE_PROMPT_PAST = `你是新闻编辑 AI。

任务：为用户给出的「版面日期」生成一批原创中文新闻稿件。内容可虚构，但必须读起来像**那一天**发行的报纸/资讯，有自洽世界观。此版相对真实世界偏「过去」。

${DATE_ANCHOR_SHARED}

## 当日重大史实（高优先级选题锚点）
- 生成前先自问：版面日期**当天及前后数日**（同公历年，约前后一周内），历史上是否有广为人知的大事、战事、条约、政令、灾难、重大发现、重要人物活动、节庆里程碑等
- **若有**：须至少用 1～3 篇写成「当天刚发生/正在发酵」的新闻报道（可正面消息、后续进展、侧面反应、国际回响、民生观感等不同角度）；口吻是彼时报馆在报今日要闻，不是后世历史课本回顾，不要写「据史料记载」「多年以后」一类事后视角
- 史实可作锚点，细节、引语、场面与次要人物可合理虚构补全，但**时间、地点、核心事实方向**不要明显离谱；一时想不起细节点时，宁可写相关领域的当日氛围稿，也不要硬编成另一个世纪的事件
- **若无明显大事**：再按多样化规则自由虚构区域民生、行业动态等日常稿；不要为了「必须有大事」而生造离谱的伪史
- 同一重大事件不要整版重复堆砌；其余篇目仍应保持独立选题，并继续满足「国际」与「逆天」保底

输入上下文：
- 版面日期及其时代约束（用户消息）
- 附近日期已发布的新闻标题（供叙事连贯；勿照抄；若与本日期时代冲突，以本日期为准）
${OUTPUT_AND_DIVERSITY_RULES}
- **优先落实「当日重大史实」锚点**（有大事则先保证相关报道入版），再补足其余多样化稿件
- 若附近标题已在跟进同一史实，可自然续报`

const GENERATE_PROMPT_FUTURE = `你是新闻编辑 AI。

任务：为用户给出的「版面日期」生成一批原创中文新闻稿件。内容可虚构，但必须读起来像**那一天**发行的报纸/资讯，有自洽的近未来/未来世界观。此版相对真实世界偏「未来」。

${DATE_ANCHOR_SHARED}

## 未来时间自洽（最高优先级，易错点）
- 把版面公历年份记为 Y。凡 **早于 Y 的年份**（例如 Y=2050 时的 2030、2040、2045）在本版里都是**过去**：只能写「已签署」「已生效」「建成已久」「十年前启动」等回顾口径
- **严禁**出现类似：「将于 2045 年签署新合同」「2045 年生效」「自 2030 年起配套新住宅」——当 Y≥这些年份时，这种说法在时间线上是自相矛盾的胡说
- **严禁**把真实世界常见的政策/规划口号年份（如 2030、2035、2045、2050、2060 碳中和类时间表）当作「尚未到来的未来」往版面里塞；若确需提及那些年份，必须按它们相对 Y 的位置写对时态
- 展望只能展望 **Y 年之后**；即便展望，也要像当日媒体的短期/中期预期，不要大段复读真实世界里耳熟能详的远期规划草案
- 不要去「回忆」真实历史上尚不存在的未来史实；此版应以虚构但内洽的**当日事态**为主（生活、产业、科技、外事、文体），辅以对近年（相对 Y）已发生变化的顺带交代
- 技术与社会细节可以比真实世界超前，但不要穿帮成「读者自己的 2020 年代日常」；口吻是 Y 年当地人习以为常的新闻，不是科幻说明书

## 选题策略（未来版，勿套用「重大史实」）
- **不要**按真实历史去检索「这一天发生过什么」——未来日期没有可对照的史实库；硬套只会把真实世界的旧热点或远期规划误写成今日新闻
- 写「今天刚发生/正在发酵」的虚构要闻：政策落地、产业事故或突破、民生纠纷、外事动态、文体赛事、社会奇闻等
- 同一事件不要整版重复；保持「国际」与「逆天」保底

输入上下文：
- 版面日期、时间取向与时代约束（用户消息）
- 附近日期已发布的新闻标题（供叙事连贯；勿照抄；若与本日期时代冲突，以本日期为准）
${OUTPUT_AND_DIVERSITY_RULES}
- 先保证时间线自洽与多样化当日稿，再考虑附近标题的连贯跟进`

const GENERATE_PROMPT_PRESENT = `你是新闻编辑 AI。

任务：为用户给出的「版面日期」生成一批原创中文新闻稿件。内容可虚构，但必须读起来像**那一天**发行的报纸/资讯。此版贴近真实世界「当下」。

${DATE_ANCHOR_SHARED}

## 贴近当下的选题
- 可写符合该日季节与社会气氛的民生、财经、科技、文体、国际等虚构要闻；口吻是当日报纸，不是事后回顾
- 不要把明显属于过去年份的「将于××年实现」规划稿当成今日主线；也不要无故跳跃到遥远未来年份
- 若该日前后确有广为人知的真实大事，可作锚点写成「当日报道」；想不起则自由虚构日常稿，勿生造离谱伪史

输入上下文：
- 版面日期及其时代约束（用户消息）
- 附近日期已发布的新闻标题（供叙事连贯；勿照抄）
${OUTPUT_AND_DIVERSITY_RULES}`

function generatePromptForMode(mode: EditionTemporalMode): string {
  if (mode === 'future') return GENERATE_PROMPT_FUTURE
  if (mode === 'past') return GENERATE_PROMPT_PAST
  return GENERATE_PROMPT_PRESENT
}

function userMessageForMode(
  mode: EditionTemporalMode,
  dateContext: string,
  nearbyContext: string,
  dayContext?: string,
): string {
  const nearby = [
    '附近日期新闻标题上下文（供连贯性参考；与本日期时代冲突时，以本日期为准）：',
    nearbyContext || '（暂无历史记录）',
  ].join('\n')

  const calendarBlock = dayContext?.trim()
    ? [
        '',
        '当日日历标记（可供选题参考：节令、假日、民俗等；可作当日新闻锚点，勿写成广告清单或机械罗列）：',
        dayContext.trim(),
      ]
    : []

  if (mode === 'future') {
    return [
      '【版面日期 — 请把这一天当作绝对「今天」；此版为相对真实世界的「未来」】',
      dateContext,
      ...calendarBlock,
      '',
      nearby,
      '',
      '请生成该版面日期当天的一批新闻稿件。不要检索真实史实，也不要把早于版面年份的年份写成「即将发生」。选题须像那一天正在发生的事；本批次须至少包含 1 篇 category 为「国际」的稿件。',
    ].join('\n')
  }

  if (mode === 'past') {
    return [
      '【版面日期 — 请把这一天当作绝对「今天」；此版为相对真实世界的「过去」】',
      dateContext,
      ...calendarBlock,
      '',
      nearby,
      '',
      '请生成该版面日期当天的一批新闻稿件。先回想该日前后约一周内是否有广为人知的重大史实；若有，须用 1～3 篇写成「当日报道」并可作为版面主线，其余再多样化补足。选题、季节、器物、制度与媒体口吻必须完全贴合上述日期与时代约束；本批次须至少包含 1 篇 category 为「国际」的稿件。',
    ].join('\n')
  }

  return [
    '【版面日期 — 请把这一天当作绝对「今天」；此版贴近真实世界当下】',
    dateContext,
    ...calendarBlock,
    '',
    nearby,
    '',
    '请生成该版面日期当天的一批新闻稿件。选题、季节与媒体口吻须贴合版面日期；本批次须至少包含 1 篇 category 为「国际」的稿件。',
  ].join('\n')
}

function normalizeDraft(raw: GeneratedArticleDraft, targetDate: string): NewsArticle {
  return {
    id: createArticleId(),
    editionDate: targetDate,
    title: raw.title?.trim() || '未命名新闻',
    category: raw.category?.trim() || '社会',
    lead: raw.lead?.trim() || '',
    body: (raw.body || '').trim().replace(/\\n/g, '\n'),
    source: raw.source?.trim() || '即时新闻',
  }
}

function emitUniqueArticles(
  drafts: GeneratedArticleDraft[],
  targetDate: string,
  seenTitles: Set<string>,
  articles: NewsArticle[],
  onArticle: (article: NewsArticle) => void,
): void {
  for (const raw of drafts) {
    const article = normalizeDraft(raw, targetDate)
    if (seenTitles.has(article.title)) {
      continue
    }
    seenTitles.add(article.title)
    articles.push(article)
    onArticle(article)
  }
}

export type GenerateArticlesStreamingOptions = {
  dayContext?: string
  onReasoning?: (reasoningText: string) => void
}

export async function generateArticlesForDateStreaming(
  targetDate: string,
  onArticle: (article: NewsArticle) => void,
  options: GenerateArticlesStreamingOptions = {},
): Promise<NewsArticle[]> {
  const store = await readNewsStore()
  const nearbyContext = buildNearbyTitlesContext(store, targetDate, 10)
  const mode = editionTemporalMode(targetDate)
  const systemPrompt = generatePromptForMode(mode)
  const dateContext = describeEditionDateForPrompt(targetDate)
  const userMessage = userMessageForMode(mode, dateContext, nearbyContext, options.dayContext)

  const articles: NewsArticle[] = []
  const seenTitles = new Set<string>()
  const feed = createNdjsonLineFeed((line) => {
    try {
      const raw = parseNdjsonLine<GeneratedArticleDraft>(line)
      const article = normalizeDraft(raw, targetDate)
      if (seenTitles.has(article.title)) {
        return
      }
      seenTitles.add(article.title)
      articles.push(article)
      onArticle(article)
    } catch {
      // 忽略尚未完整的行
    }
  })

  try {
    const model = mergeOpenAiConfig().defaultModel
    await prepareTokenEstimation(model)
    const text = await streamChatCompletion({
      system: systemPrompt,
      user: userMessage,
      usageContext: { actor: 'news', behavior: 'article-gen', behaviorLabel: '生成新闻' },
      // 版面或系统时钟相对真实世界偏一年以上时强制开思考，便于贴合时代/未来时间线
      thinkingEnabled:
        mode !== 'present' || isOsClockAtLeastYearsAwayFromReal(1) ? true : undefined,
      onReasoningChunk: options.onReasoning
        ? (_delta, accumulated) => {
            options.onReasoning?.(accumulated)
          }
        : undefined,
      onChunk: (delta) => {
        feed.push(delta)
      },
    })
    feed.flush()

    if (articles.length === 0) {
      const drafts = parseJsonFromAiText<GeneratedArticleDraft[]>(text)
      if (!Array.isArray(drafts) || drafts.length === 0) {
        throw new Error('AI 返回的新闻列表为空')
      }
      emitUniqueArticles(drafts.slice(0, 6), targetDate, seenTitles, articles, onArticle)
    }

    if (articles.length === 0) {
      throw new Error('AI 未生成任何新闻')
    }

    const promptTokens = await estimatePromptTokensAsync(systemPrompt, userMessage, model)
    const usage = await buildLiveTokenUsageAsync(promptTokens, text, true, model)
    recordNewsTokenUsage('article', {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
    })

    return articles
  } catch (error) {
    if (articles.length > 0) {
      const fallbackModel = mergeOpenAiConfig().defaultModel
      await prepareTokenEstimation(fallbackModel)
      const promptTokens = await estimatePromptTokensAsync(systemPrompt, userMessage, fallbackModel)
      const usage = await buildLiveTokenUsageAsync(promptTokens, '', true, fallbackModel)
      recordNewsTokenUsage('article', {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
      })
      return articles
    }
    throw error
  }
}

export async function generateArticlesForDate(targetDate: string): Promise<NewsArticle[]> {
  return generateArticlesForDateStreaming(targetDate, () => {})
}
