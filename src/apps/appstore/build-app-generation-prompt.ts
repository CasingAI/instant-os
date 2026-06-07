import type { StoreListing, StoreListingDetail, StoreReview } from './types.ts'
import { normalizeAppVersion } from './app-version.ts'

export type AppGenerationContext = {
  detail?: Partial<StoreListingDetail>
  reviews?: StoreReview[]
  update?: {
    existingHtml: string
    currentVersion: string
    targetVersion: string
    userFeedback: StoreReview[]
  }
}

function appendDetailLines(lines: string[], detail: Partial<StoreListingDetail>) {
  const detailLines: string[] = []
  const tagline = detail.tagline?.trim()
  const longDescription = detail.longDescription?.trim()
  const developer = detail.developer?.trim()
  const compatibility = detail.compatibility?.trim()
  const language = detail.language?.trim()

  if (tagline) {
    detailLines.push(`副标题：${tagline}`)
  }
  if (longDescription) {
    detailLines.push(`详细介绍：${longDescription}`)
  }
  if (developer) {
    detailLines.push(`开发者：${developer}`)
  }
  if (compatibility) {
    detailLines.push(`兼容性：${compatibility}`)
  }
  if (language) {
    detailLines.push(`语言：${language}`)
  }

  if (detailLines.length > 0) {
    lines.push('', '【应用商店详情页信息】', ...detailLines)
  }
}

function appendReviewLines(lines: string[], reviews: StoreReview[]) {
  if (reviews.length === 0) {
    return
  }

  lines.push('', '【应用商店用户评论】')
  for (const review of reviews) {
    const stars = '★'.repeat(Math.max(1, Math.min(5, review.rating)))
    if (review.isUser) {
      const version = normalizeAppVersion(review.version)
      lines.push(`- ${review.author}（针对 ${version}，${stars}）：${review.body.trim()}`)
    } else {
      lines.push(`- ${review.author}（${stars}）：${review.body.trim()}`)
    }
  }
}

function appendUpdateLines(
  lines: string[],
  update: NonNullable<AppGenerationContext['update']>,
) {
  const currentVersion = normalizeAppVersion(update.currentVersion)
  const targetVersion = normalizeAppVersion(update.targetVersion)

  lines.push(
    '',
    `【版本更新任务：${currentVersion} → ${targetVersion}】`,
    '请在保留现有应用核心功能与整体风格的前提下，根据用户反馈改进应用。',
  )

  if (update.userFeedback.length > 0) {
    lines.push('', '【本轮待处理的用户反馈】')
    for (const review of update.userFeedback) {
      const version = normalizeAppVersion(review.version)
      lines.push(`- （针对 ${version}）${review.body.trim()}`)
    }
  }

  lines.push('', '【当前版本完整 HTML 源码】', update.existingHtml.trim())
}

export function buildAppGenerationPrompt(
  listing: StoreListing,
  context: AppGenerationContext = {},
): string {
  const lines = [
    `应用名称：${listing.name}`,
    `一句话描述：${listing.description}`,
    `分类：${listing.category}`,
    `主题色：${listing.themeColor}`,
  ]

  if (context.detail) {
    appendDetailLines(lines, context.detail)
  }

  if (context.reviews && context.reviews.length > 0) {
    appendReviewLines(lines, context.reviews)
  }

  if (context.update) {
    appendUpdateLines(lines, context.update)
    lines.push(
      '',
      `请输出 ${normalizeAppVersion(context.update.targetVersion)} 的完整 HTML 应用，贴边铺满窗口内容区，不要做成带外圈留白的桌面小组件样式。`,
    )
    return lines.join('\n')
  }

  lines.push(
    '请根据以上信息生成贴边铺满窗口内容区的完整 HTML 应用，不要做成带外圈留白的桌面小组件样式。',
  )
  return lines.join('\n')
}
