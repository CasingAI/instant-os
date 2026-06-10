import { useEffect, useMemo, useState } from 'preact/hooks'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { SettingsDisclosureIcon } from './settings-disclosure-icon.tsx'
import { formatTokenCount } from '../browser/format-token-count.ts'
import {
  clearAllCommentThreads,
  deleteArticle,
  deleteArticlesForDate,
  deleteCommentThread,
  formatEditionDateLabel,
  getAllEditionDates,
  getArticlesForDate,
  getCommentCountForArticle,
  getNewsCommentStats,
  getNewsStorageBytes,
  readNewsStore,
  writeNewsStore,
} from '../news/news-storage.ts'
import { clearNewsTokenUsage, loadNewsTokenUsage } from '../news/news-token-usage.ts'
import type { NewsArticle, NewsStore } from '../news/news-types.ts'
import { formatStorageSize } from './format-storage-size.ts'

type NewsManagementViewProps = {
  onBack: () => void
  onDataChange?: () => void
}

export function NewsManagementView({ onBack, onDataChange }: NewsManagementViewProps) {
  const [store, setStore] = useState<NewsStore>(() => readNewsStore())
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [tokenUsage, setTokenUsage] = useState(() => loadNewsTokenUsage())

  const dates = useMemo(() => getAllEditionDates(store), [store])
  const commentStats = useMemo(() => getNewsCommentStats(store), [store])
  const storageBytes = useMemo(() => getNewsStorageBytes(), [store, tokenUsage])

  useEffect(() => {
    const onChanged = () => {
      const next = readNewsStore()
      setStore(next)
      setTokenUsage(loadNewsTokenUsage())
      onDataChange?.()
    }
    window.addEventListener('instant-os:news-store-changed', onChanged)
    return () => {
      window.removeEventListener('instant-os:news-store-changed', onChanged)
    }
  }, [onDataChange])

  const toggleExpand = (date: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(date)) {
        next.delete(date)
      } else {
        next.add(date)
      }
      return next
    })
  }

  const handleDeleteDay = (date: string) => {
    const next = deleteArticlesForDate(store, date)
    writeNewsStore(next)
    setStore(next)
    setExpanded((prev) => {
      const n = new Set(prev)
      n.delete(date)
      return n
    })
    onDataChange?.()
  }

  const handleDeleteArticle = (date: string, article: NewsArticle) => {
    const next = deleteArticle(store, article.id)
    writeNewsStore(next)
    setStore(next)
    onDataChange?.()
    const remaining = getArticlesForDate(next, date)
    if (remaining.length === 0) {
      setExpanded((prev) => {
        const n = new Set(prev)
        n.delete(date)
        return n
      })
    }
  }

  const handleDeleteComments = (articleId: string) => {
    const next = deleteCommentThread(store, articleId)
    writeNewsStore(next)
    setStore(next)
    onDataChange?.()
  }

  const handleClearAllComments = () => {
    const next = clearAllCommentThreads(store)
    writeNewsStore(next)
    setStore(next)
    onDataChange?.()
  }

  const handleClearTokenUsage = () => {
    clearNewsTokenUsage()
    setTokenUsage(loadNewsTokenUsage())
    onDataChange?.()
  }

  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="显示全部" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">新闻数据概览</h2>
          <div class="settings__box">
            <dl class="settings__form-row">
              <dt>本地占用</dt>
              <dd>{formatStorageSize(storageBytes)}</dd>
            </dl>
            <dl class="settings__form-row">
              <dt>报道篇数</dt>
              <dd>{store.articles.length.toLocaleString('zh-CN')} 篇</dd>
            </dl>
            <dl class="settings__form-row">
              <dt>评论区</dt>
              <dd>
                {commentStats.threadCount} 篇已开评 · {commentStats.totalComments} 条评论
              </dd>
            </dl>
            <dl class="settings__form-row">
              <dt>你的发言</dt>
              <dd>{commentStats.userComments.toLocaleString('zh-CN')} 条</dd>
            </dl>
            <dl class="settings__form-row">
              <dt>已举报删除</dt>
              <dd>{commentStats.reportedCount.toLocaleString('zh-CN')} 条</dd>
            </dl>
            <dl class="settings__form-row">
              <dt>累计点赞/点踩</dt>
              <dd>
                {commentStats.totalLikes.toLocaleString('zh-CN')} /{' '}
                {commentStats.totalDislikes.toLocaleString('zh-CN')}
              </dd>
            </dl>
          </div>
        </section>

        <section class="settings__section">
          <h2 class="settings__section-title">AI 用量统计</h2>
          <div class="settings__box">
            <dl class="settings__form-row">
              <dt>累计 Tokens</dt>
              <dd>{formatTokenCount(tokenUsage.totalTokens)}</dd>
            </dl>
            <dl class="settings__form-row">
              <dt>输入 Tokens</dt>
              <dd>{formatTokenCount(tokenUsage.totalPromptTokens)}</dd>
            </dl>
            <dl class="settings__form-row">
              <dt>输出 Tokens</dt>
              <dd>{formatTokenCount(tokenUsage.totalCompletionTokens)}</dd>
            </dl>
            <dl class="settings__form-row">
              <dt>新闻生成</dt>
              <dd>{tokenUsage.articleGenCount.toLocaleString('zh-CN')} 次</dd>
            </dl>
            <dl class="settings__form-row">
              <dt>评论区生成</dt>
              <dd>{tokenUsage.commentGenCount.toLocaleString('zh-CN')} 次</dd>
            </dl>
            <dl class="settings__form-row">
              <dt>回复生成</dt>
              <dd>{tokenUsage.replyGenCount.toLocaleString('zh-CN')} 次</dd>
            </dl>
          </div>
          <div class="news-mgmt__toolbar">
            <button type="button" class="settings__btn" onClick={handleClearTokenUsage}>
              清零用量统计
            </button>
            <p class="news-mgmt__toolbar-note">仅清除统计数字，不影响已保存的新闻与评论。</p>
          </div>
        </section>

        <section class="settings__section news-mgmt__archive">
          <h2 class="settings__section-title">新闻存档</h2>
          <p class="settings__section-footnote news-mgmt__archive-intro">
            所有新闻与评论均为 AI 即时生成并本地保存。可精确删除单篇报道、整日版面或仅清除评论区。
          </p>

          {commentStats.threadCount > 0 && (
            <div class="news-mgmt__toolbar">
              <button type="button" class="settings__btn settings__btn--danger" onClick={handleClearAllComments}>
                清除全部评论区
              </button>
              <p class="news-mgmt__toolbar-note">删除所有报道下的评论数据，报道正文保留。</p>
            </div>
          )}

          {dates.length === 0 ? (
            <div class="settings__box settings__empty">暂无已生成的新闻</div>
          ) : (
            <div class="settings__list news-mgmt__list">
              <div class="settings__list-head settings__list-head--nav">
                <span>日期版面</span>
                <span>篇数</span>
                <span />
              </div>
              <div class="settings__list-body settings__list-body--apps">
                {dates.map((date) => {
                  const arts = getArticlesForDate(store, date)
                  const isOpen = expanded.has(date)
                  return (
                    <div key={date} class="news-mgmt__day">
                      <button
                        type="button"
                        class="settings__row settings__row--button settings__row--nav"
                        onClick={() => toggleExpand(date)}
                      >
                        <span class="settings__row-name">{formatEditionDateLabel(date)}</span>
                        <span class="settings__row-size">{arts.length} 篇</span>
                        <SettingsDisclosureIcon expanded={isOpen} />
                      </button>

                      <div class="news-mgmt__day-actions">
                        <button
                          type="button"
                          class="settings__btn settings__btn--small"
                          onClick={() => handleDeleteDay(date)}
                        >
                          删除整日
                        </button>
                      </div>

                      {isOpen && (
                        <div class="news-mgmt__articles">
                          {arts.map((art) => {
                            const commentCount = getCommentCountForArticle(store, art.id)
                            return (
                              <div key={art.id} class="news-mgmt__article-row">
                                <div class="news-mgmt__article-info">
                                  <span class="news-mgmt__cat">{art.category}</span>
                                  <span class="news-mgmt__title">{art.title}</span>
                                  {commentCount > 0 && (
                                    <span class="news-mgmt__comment-badge">{commentCount} 评</span>
                                  )}
                                </div>
                                <div class="news-mgmt__article-actions">
                                  {commentCount > 0 && (
                                    <button
                                      type="button"
                                      class="settings__btn settings__btn--small"
                                      onClick={() => handleDeleteComments(art.id)}
                                    >
                                      清评论
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    class="settings__btn settings__btn--small settings__btn--danger"
                                    onClick={() => handleDeleteArticle(date, art)}
                                  >
                                    删除
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
