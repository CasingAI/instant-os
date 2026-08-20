/** QuickJS 宿主配额常量（无副作用，可供单测直接 import）。 */

import { DATA_CAPACITY_BYTES } from '../os/device-data-storage.ts'

/** InstantREPL / Virtual JS 等长驻实例默认堆上限（上限非预分配）。 */
export const QUICKJS_DEFAULT_MEMORY_LIMIT_BYTES = 128 * 1024 * 1024

/** Guest fs 单文件读写硬拒绝上限（与数据空间硬上限对齐）。
 * 实际可读写体积仍受 `QUICKJS_DEFAULT_MEMORY_LIMIT_BYTES`（堆）约束；
 * 超大文件会先 OOM/超时，而非写满本上限。
 */
export const QUICKJS_DEFAULT_MAX_FILE_BYTES = DATA_CAPACITY_BYTES

/** 长驻实例 console 环形缓冲：最多保留的行数（终端面板与此对齐）。 */
export const QUICKJS_MAX_CONSOLE_LINES = 2000

/** 单条 console 文本硬上限（字符）；超出截断并加省略标记。 */
export const QUICKJS_MAX_CONSOLE_LINE_CHARS = 16_000
