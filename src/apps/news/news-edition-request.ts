export type NewsEditionRequest = {
  editionDate: string
  /** 当日日历节日/节气等，注入新闻生成提示 */
  dayContext?: string
  /** 即使已有列表也触发生成（日历跳转时使用） */
  forceGenerate?: boolean
}

const NEWS_EDITION_REQUEST_EVENT = 'instant-news-edition-request'

let pendingRequest: NewsEditionRequest | undefined

/** 打开新闻或已打开时，请求跳到指定版面日期。 */
export function requestNewsEdition(request: NewsEditionRequest) {
  pendingRequest = request
  window.dispatchEvent(
    new CustomEvent(NEWS_EDITION_REQUEST_EVENT, { detail: request }),
  )
}

export function takePendingNewsEdition(): NewsEditionRequest | undefined {
  const next = pendingRequest
  pendingRequest = undefined
  return next
}

export function subscribeNewsEditionRequest(
  handler: (request: NewsEditionRequest) => void,
): () => void {
  const onEvent = (event: Event) => {
    const detail = (event as CustomEvent<NewsEditionRequest>).detail
    if (!detail?.editionDate) {
      return
    }
    pendingRequest = undefined
    handler(detail)
  }
  window.addEventListener(NEWS_EDITION_REQUEST_EVENT, onEvent)
  return () => window.removeEventListener(NEWS_EDITION_REQUEST_EVENT, onEvent)
}
