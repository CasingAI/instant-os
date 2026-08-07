/** 曲库中的一首歌（元数据在 localStorage，音频体在 IndexedDB） */
export type MusicTrack = {
  id: string
  /** 展示标题（从文件名解析，去掉扩展名与「艺人 - 」前缀） */
  title: string
  /** 艺人（文件名形如「艺人 - 歌名.ext」时解析，否则缺省） */
  artist?: string
  fileName: string
  extension: string
  mimeType: string
  byteSize: number
  /** 导入时尽力读取的时长（秒），读取失败为 0，播放时再校准 */
  durationSec: number
  addedAt: number
  /** LRC 歌词原文（由「音乐」文件夹内同名 .lrc 读出） */
  lyricsLrc?: string
  /**
   * VFS 引用（节点 id 或绝对路径）：曲库歌曲与「文件」打开的单曲都有。
   * 播放器据此直接从虚拟文件系统读取音频，不再复制进数据空间。
   */
  vfsRef?: string
}
