/** QuickJS 宿主配额常量（无副作用，可供单测直接 import）。 */

import { getDataCapacityBytes } from '../os/device-data-storage.ts'

/** InstantREPL / Virtual JS 等长驻实例默认堆上限（上限非预分配）。 */
export const QUICKJS_DEFAULT_MEMORY_LIMIT_BYTES = 128 * 1024 * 1024

/** Guest fs 单文件读写硬拒绝上限（与数据空间上限对齐）。 */
export function getQuickJsDefaultMaxFileBytes(): number {
  return getDataCapacityBytes()
}

/** @deprecated 请使用 getQuickJsDefaultMaxFileBytes()；保留供旧引用，值为模块加载时的上限。 */
export const QUICKJS_DEFAULT_MAX_FILE_BYTES = getDataCapacityBytes()

/** 长驻实例 console 环形缓冲：最多保留的行数（终端面板与此对齐）。 */
export const QUICKJS_MAX_CONSOLE_LINES = 2000

/** 单条 console 文本硬上限（字符）；超出截断并加省略标记。 */
export const QUICKJS_MAX_CONSOLE_LINE_CHARS = 16_000
