/**
 * @gcu/iso9660 v0.1.0 的手写类型声明。
 * vendor 源码为无类型纯 JS（同目录 index.js），本文件只描述公共 API；
 * 升级 vendor 时需同步核对。完整能力边界见仓库根 todo/archive-wasm-support.md。
 */

export declare class ISOReader {
  constructor(arrayBuffer: ArrayBufferLike)
  /** PVD 卷标识（ASCII，已去尾空格） */
  get volumeId(): string
  get publisher(): string
  get preparer(): string
  get application(): string
  /** 是否找到 Joliet 补充卷描述符 */
  get joliet(): boolean
  /** 列出全部文件；stat 为 true 时附带大小 / 日期；目录只用于遍历不产出条目 */
  list(opts?: { stat?: false; joliet?: boolean }): string[]
  list(opts: { stat: true; joliet?: boolean }): IsoListedEntry[]
  /** 读文件内容；返回底层缓冲的零拷贝视图 */
  read(path: string, opts?: { joliet?: boolean }): Uint8Array
  readText(path: string, opts?: { joliet?: boolean }): string
  readdir(
    path: string,
    opts?: { joliet?: boolean },
  ): { name: string; size: number; date: Date; isDir: boolean }[]
}

export type IsoListedEntry = {
  /** 以 / 开头的完整路径 */
  path: string
  size: number
  date: Date
  isDir: false
}

export declare class ISOWriter {
  constructor(opts?: {
    volumeId?: string
    publisher?: string
    preparer?: string
    application?: string
    /** 是否同时写 Joliet 树（默认开启） */
    joliet?: boolean
    /** 系统区尾部问候语（默认开启） */
    greeting?: boolean
  })
  /** path 用 / 分隔且不带前导斜杠；重复路径抛错 */
  add(path: string, data: Uint8Array | ArrayBuffer): void
  toUint8Array(): Uint8Array
  toBlob(): Blob
  download(filename?: string): void
}
