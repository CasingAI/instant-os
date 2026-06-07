import { parseJsonFromAiText } from '../../ai/parse-json-response.ts'
import { streamChatCompletion } from '../../ai/stream-chat.ts'
import {
  createMessageId,
  createThreadId,
  USER_ADDRESS,
} from './mail-storage.ts'
import type {
  InitialMailDraft,
  MailAddress,
  MailMessage,
  MailReplyDraft,
  MailThread,
} from './types.ts'

const INITIAL_MAILS_PROMPT = `你是 Instant OS 邮件应用的虚拟收件箱生成器。
Instant OS 是一个仿 iOS/macOS 风格的网页桌面操作系统，用户邮箱为 ${USER_ADDRESS.email}（显示名「我」）。

任务：为用户生成一批首次打开邮件 App 时看到的虚拟收件箱邮件，营造真实、有趣、日常的中文邮件环境。

必须只返回 JSON 数组，不要 markdown，不要解释。每个元素格式：
{
  "subject": "邮件主题",
  "fromName": "发件人姓名",
  "fromEmail": "发件人邮箱，小写，如 zhangwei@company.cn",
  "body": "邮件正文，80~220字，口语自然，可含换行\\n",
  "sentAtOffsetHours": 数字，表示多少小时前发送（1~168之间）
}

要求：
- 生成 3 封互不重复的邮件
- 发件人身份多样：同事、朋友、家人、电商、订阅、学校、快递等
- 邮箱地址合理可信，姓名与内容匹配
- 主题与正文一致，语气像真人写的
- 时间分布在过去一周内，sentAtOffsetHours 各不相同
- 不要出现用户自己的邮箱作为发件人`

const REPLY_PROMPT = `你是 Instant OS 邮件应用中的虚拟邮件联系人，正在以真实人类的口吻回复邮件。
Instant OS 是一个仿 macOS 风格的网页桌面操作系统。

规则：
- 完全代入指定发件人身份，保持人设、语气、关系一致
- 回复应自然、具体，像真人打字，可适当口语化
- 长度 40~180 字，可含换行
- 不要自称 AI，不要打破第四面墙
- 针对用户最新邮件的内容回应，可提问、确认、闲聊、办事
- 必须只返回 JSON：{"body": "回复正文"}`

const NEW_CONTACT_PROMPT = `你是 Instant OS 邮件应用中的虚拟邮件联系人。
用户刚给一个新邮箱地址发了邮件，你需要为该收件人构思一个可信的人设并回复。

规则：
- 根据收件人邮箱和姓名推断合理身份（公司、朋友、服务等）
- 语气自然，像真人，40~180 字
- 必须只返回 JSON：
{
  "replyName": "回复者显示名",
  "replyEmail": "与收件人邮箱一致",
  "body": "回复正文"
}`

function buildThreadFromDraft(draft: InitialMailDraft): MailThread {
  const from: MailAddress = {
    name: draft.fromName.trim(),
    email: draft.fromEmail.trim().toLowerCase(),
  }
  const sentAt = Date.now() - draft.sentAtOffsetHours * 60 * 60 * 1000
  const message: MailMessage = {
    id: createMessageId(),
    from,
    to: [USER_ADDRESS],
    body: draft.body.trim(),
    sentAt,
  }

  return {
    id: createThreadId(),
    subject: draft.subject.trim(),
    messages: [message],
    lastMessageAt: sentAt,
    unread: true,
  }
}

function normalizeInitialDraft(raw: InitialMailDraft): InitialMailDraft {
  return {
    subject: raw.subject.trim(),
    fromName: raw.fromName.trim(),
    fromEmail: raw.fromEmail.trim().toLowerCase(),
    body: raw.body.trim(),
    sentAtOffsetHours: Math.max(1, Math.min(168, Number(raw.sentAtOffsetHours) || 24)),
  }
}

export const SEED_INITIAL_MAILS: InitialMailDraft[] = [
  {
    subject: '周五团建地点确认一下？',
    fromName: '张薇',
    fromEmail: 'zhangwei@techflow.cn',
    body: '嗨，\n\n行政那边发了三个备选：望京那家韩式烤肉、奥森野餐、或者室内桌游馆。你更倾向哪个？我下午三点前得汇总人数。\n\n张薇',
    sentAtOffsetHours: 3,
  },
  {
    subject: '妈：这周末回来吃饭吗',
    fromName: '妈妈',
    fromEmail: 'mom@family.home',
    body: '儿子，你爸买了条鲈鱼，说要做清蒸的。周六中午能回来吗？不行的话周日晚上也行，给你留一碗汤。',
    sentAtOffsetHours: 18,
  },
  {
    subject: '您的订单已发货',
    fromName: '京东物流',
    fromEmail: 'notice@jd.com',
    body: '尊敬的客户，您购买的「机械键盘 KeyPro 87」已从北京亦庄仓发出，预计明日送达。运单号：JD9088123456。签收前请先验货。',
    sentAtOffsetHours: 26,
  },
]

export function seedInitialThreads(): MailThread[] {
  return SEED_INITIAL_MAILS.map(buildThreadFromDraft)
}

export async function generateInitialThreads(): Promise<MailThread[]> {
  try {
    const text = await streamChatCompletion({
      system: INITIAL_MAILS_PROMPT,
      user: '请生成首批虚拟收件箱邮件。',
      onChunk: () => {},
    })
    const drafts = parseJsonFromAiText<InitialMailDraft[]>(text)
    if (!Array.isArray(drafts) || drafts.length === 0) {
      throw new Error('无效邮件列表')
    }
    return drafts.map((draft) => buildThreadFromDraft(normalizeInitialDraft(draft)))
  } catch {
    return seedInitialThreads()
  }
}

type ReplyContext = {
  userAddress: MailAddress
  thread: MailThread
  contact: MailAddress
}

function formatAddressList(addresses: MailAddress[]): string {
  return addresses.map((address) => `${address.name} <${address.email}>`).join(', ')
}

function buildConversationTranscript(context: ReplyContext): string {
  const lines = context.thread.messages.map((message) => {
    const role = message.from.email === context.userAddress.email ? '用户' : '对方'
    return `[${role}] ${message.from.name} → ${formatAddressList(message.to)}\n主题上下文：${context.thread.subject}\n${message.body}`
  })
  return lines.join('\n\n---\n\n')
}

export async function generateThreadReply(context: ReplyContext): Promise<MailMessage> {
  const transcript = buildConversationTranscript(context)
  const contact = context.contact

  const text = await streamChatCompletion({
    system: REPLY_PROMPT,
    user: `你的身份：${contact.name} <${contact.email}>\n邮件主题：${context.thread.subject}\n\n对话记录：\n${transcript}\n\n请以 ${contact.name} 的身份回复用户最新一封邮件。`,
    onChunk: () => {},
  })

  const draft = parseJsonFromAiText<MailReplyDraft>(text)
  const body = draft.body?.trim()
  if (!body) {
    throw new Error('AI 未返回有效回复')
  }

  return {
    id: createMessageId(),
    from: contact,
    to: [context.userAddress],
    body,
    sentAt: Date.now(),
  }
}

type NewContactContext = {
  userAddress: MailAddress
  subject: string
  userBody: string
  recipient: MailAddress
}

export async function generateNewContactReply(
  context: NewContactContext,
): Promise<MailMessage> {
  const text = await streamChatCompletion({
    system: NEW_CONTACT_PROMPT,
    user: `收件人：${context.recipient.name} <${context.recipient.email}>\n主题：${context.subject}\n用户来信：\n${context.userBody}`,
    onChunk: () => {},
  })

  const draft = parseJsonFromAiText<{
    replyName: string
    replyEmail: string
    body: string
  }>(text)

  const from: MailAddress = {
    name: draft.replyName?.trim() || context.recipient.name,
    email: (draft.replyEmail?.trim() || context.recipient.email).toLowerCase(),
  }

  const body = draft.body?.trim()
  if (!body) {
    throw new Error('AI 未返回有效回复')
  }

  return {
    id: createMessageId(),
    from,
    to: [context.userAddress],
    body,
    sentAt: Date.now(),
  }
}
