/** 超过此长度走 Worker 索引（约 200KB） */
export const JSONL_INDEX_WORKER_BYTES = 200_000

/** Worker 每处理约这么多字符汇报一次进度 */
export const JSONL_INDEX_PROGRESS_CHARS = 256_000

/** 超过此长度不自动进入内联预览（约 8MB） */
export const JSONL_AUTO_PREVIEW_MAX_BYTES = 8_000_000

/** 单行超过此长度用紧凑 JSON.stringify，避免 pretty-print 卡死 */
export const JSONL_PRETTY_MAX_BYTES = 100_000

/** 左侧导航预览最大字符数 */
export const JSONL_NAV_PREVIEW_MAX = 120

/** 侧边预览对 text 的尾随防抖 */
export const JSONL_SIDE_PREVIEW_DEBOUNCE_MS = 300

/** 共享解析缓存：相对活动行的保留窗口 */
export const JSONL_PARSE_CACHE_WINDOW = 80
