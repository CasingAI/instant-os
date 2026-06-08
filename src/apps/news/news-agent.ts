import { parseJsonFromAiText } from '../../ai/parse-json-response.ts'
import { createNdjsonLineFeed, parseNdjsonLine } from '../../ai/parse-streaming-json.ts'
import { streamChatCompletion } from '../../ai/stream-chat.ts'
import { estimatePromptTokens, buildLiveTokenUsage } from '../browser/estimate-token-usage.ts'
import { recordNewsTokenUsage } from './news-token-usage.ts'
import { buildNearbyTitlesContext, createArticleId, readNewsStore } from './news-storage.ts'
import type { GeneratedArticleDraft, NewsArticle } from './news-types.ts'

const ARTICLE_LINE_EXAMPLE = JSON.stringify({
  title: '全国多地迎来入夏首轮高温天气 气象部门发布提醒',
  category: '国内',
  lead: '中央气象台今日继续发布高温黄色预警，华北、华东部分地区最高气温将突破37摄氏度，公众需注意防暑。',
  body: '据国家气象中心监测，未来三天北方大部地区气温将持续攀升。\n\n各地疾控部门提醒，老人、儿童及慢性病患者减少户外活动。',
  source: '人民日报',
})

const GENERATE_PROMPT = `你是 Instant OS 新闻应用的 AI 新闻编辑。
Instant OS 是一个复刻经典拟物风格的网页桌面系统，新闻 App 仿照 Apple News 的阅读体验，但视觉走复古 iOS 6 拟物质感。

任务：为给定的「新闻日期」生成一批原创中文新闻稿件。所有内容均为虚构，但要读起来真实、专业、有连贯的世界观。

输入上下文：
- 目标日期（editionDate，格式 YYYY-MM-DD）
- 附近日期已发布的新闻标题列表（可能包含前几天和后几天的标题，用于保持叙事连贯性）。标题仅供参考，不要直接复用或抄袭。

必须采用 NDJSON 格式：每行一个完整 JSON 对象，不要数组包裹，不要 markdown，不要解释。
每行格式：${ARTICLE_LINE_EXAMPLE}

每条新闻对象字段：
- title：新闻标题（吸引人，准确，15-28字）
- category：分类（国内、国际、财经、科技、体育、娱乐、社会、汽车、房产中的一个）
- lead：导语/摘要，40-90字
- body：正文，3-5个自然段，合计280-520字，使用\\n表示段落
- source：虚构但可信的媒体名

要求：
- 生成 4 到 6 篇新闻，逐行输出；生成完一篇就立刻输出一行，不要等全部完成再输出
- 题材与主题必须尽可能多样化：优先覆盖不同 category，同一批次内不要扎堆同一领域或同一类型事件
- 主动拉开选题差异：可混合宏观政策、行业动态、民生消费、文化娱乐、科技创新、体育赛事、区域社会新闻、国际见闻等；角度、地域、人物与叙事风格也要尽量各不相同
- 标题与导语避免同质化表述，不要多篇都写成「发布会」「同比增长」「引发关注」等同质套路
- 【逆天保底】每批次至少 1 篇必须是「标题党 / 逆天奇闻」风格，与其余正经稿件形成反差。这类稿件要：
  · 标题夸张抓眼：善用悬念、反转、数字冲击、情绪词（如「震惊」「离谱」「万万没想到」「网友炸了」），可略长、略野，但仍是完整新闻标题
  · 内容离谱却自洽：魔幻现实、乌龙反转、奇葩民生、离谱科研、逆天巧合、社死现场、民间鬼才操作等；读起来像短视频资讯爆款，让人忍不住点进去
  · 正文照样写满 3~5 段，用采访、网友评论、专家吐槽等手法把荒诞感写实；source 可用虚构的八卦号、本地论坛、民间爆料类媒体名
  · 逆天稿仍需虚构世界观，勿涉及真实名人/真实机构造谣，勿越安全红线
- 日期相关的时效性要自然融入（例如「今日」「本周」），但不要出现真实世界冲突事实
- 如果附近标题提供了连贯线索，可在 1~2 篇稿件中合理跟进或呼应，其余篇目仍应保持独立、新鲜的选题
- 严禁政治敏感、暴力血腥、违法内容；逆天稿可以荒诞搞笑，但不要阴暗血腥或恶意人身攻击`

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

function buildSeedArticles(targetDate: string): NewsArticle[] {
  const base: Array<Omit<NewsArticle, 'id' | 'editionDate'>> = [
    {
      title: '全国多地迎来入夏首轮高温天气 气象部门发布提醒',
      category: '国内',
      lead: '中央气象台今日继续发布高温黄色预警，华北、华东部分地区最高气温将突破37摄氏度，公众需注意防暑。',
      body: '据国家气象中心监测，未来三天北方大部地区气温将持续攀升，多地体感温度超过40摄氏度。\n\n各地疾控部门提醒，老人、儿童及慢性病患者减少户外活动，及时补充水分。\n\n农业部门同步发布田间管理建议，提醒灌溉和遮阳措施到位，避免作物受损。',
      source: '人民日报',
    },
    {
      title: '央行：二季度货币政策将保持稳健中性 重点支持实体经济',
      category: '财经',
      lead: '中国人民银行今日召开新闻发布会，强调下半年将综合运用多种工具，保持流动性合理充裕，加大对制造业和中小企业的支持力度。',
      body: '发布会指出，当前经济运行总体平稳，但外部环境仍存不确定性。\n\n下一步，结构性货币政策工具将进一步聚焦绿色转型、科技创新等领域。\n\n市场人士认为，此表态有助于稳定预期，提振企业信心。',
      source: '财经日报',
    },
    {
      title: '国产大模型再升级：多模态能力显著增强 支持长文本推理',
      category: '科技',
      lead: '某国内团队发布最新开源模型，在多项基准测试中刷新纪录，尤其在视频理解与复杂逻辑推理任务上表现突出。',
      body: '新模型参数规模适中，推理效率较上一代提升约40%。开发者社区已开始适配插件生态。\n\n行业观察者指出，这将加速垂直行业大模型落地。\n\n相关企业表示，未来将开放更多评测数据集，推动透明化发展。',
      source: '科技早报',
    },
    {
      title: '国足世预赛客场战平 球迷期待主场反弹',
      category: '体育',
      lead: '今晚进行的世预赛亚洲区比赛中，中国男足客场1比1战平对手，终结连败的同时也暴露进攻端效率问题。',
      body: '下半场替补登场的年轻前锋贡献关键助攻，帮助球队扳平比分。\n\n主教练赛后表示将针对定位球和转换进攻进行重点训练。\n\n主场球迷已开始期待下个月的强强对话。',
      source: '南方周末',
    },
    {
      title: '震惊！男子为省空调费把冰箱搬进卧室 醒来发现睡衣冻成冰雕',
      category: '社会',
      lead: '浙江一名小伙把闲置冰箱当「天然冷风机」搬进卧室，半夜被冻醒后发现睡衣硬邦邦贴在身上，网友：这操作比电费还离谱。',
      body: '当事人称，白天把冰箱门敞开对着床吹，觉得「又凉又省电」。凌晨三点他被冻醒，发现睡衣袖口已经结了一层薄霜，手机显示室温 11℃。\n\n物业上门查看后哭笑不得，提醒冰箱并非制冷设备，长时间开门还可能触发压缩机过热保护。\n\n评论区已沦陷：有人建议他直接睡冷冻层，有人认真算了算「冰箱除霜费可能比空调贵」。当地消防也借机科普：切勿用家电改装「降温神器」。',
      source: '离谱生活观察',
    },
  ]

  return base.map((item) => ({
    id: createArticleId(),
    editionDate: targetDate,
    ...item,
    source: item.source ?? '即时新闻',
  }))
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

export async function generateArticlesForDateStreaming(
  targetDate: string,
  onArticle: (article: NewsArticle) => void,
): Promise<NewsArticle[]> {
  const store = readNewsStore()
  const context = buildNearbyTitlesContext(store, targetDate, 10)
  const userMessage = `目标日期：${targetDate}\n\n附近日期新闻标题上下文（供连贯性参考）：\n${context || '（暂无历史记录）'}\n\n请为该日期生成一批新闻稿件。`

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
    const text = await streamChatCompletion({
      system: GENERATE_PROMPT,
      user: userMessage,
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

    const promptTokens = estimatePromptTokens(GENERATE_PROMPT, userMessage)
    const usage = buildLiveTokenUsage(promptTokens, text, true)
    recordNewsTokenUsage('article', {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
    })

    return articles
  } catch {
    const seeds = buildSeedArticles(targetDate)
    for (const article of seeds) {
      if (seenTitles.has(article.title)) {
        continue
      }
      seenTitles.add(article.title)
      articles.push(article)
      onArticle(article)
    }
    return articles
  }
}

export async function generateArticlesForDate(targetDate: string): Promise<NewsArticle[]> {
  return generateArticlesForDateStreaming(targetDate, () => {})
}

export function seedArticlesForDate(targetDate: string): NewsArticle[] {
  return buildSeedArticles(targetDate)
}
