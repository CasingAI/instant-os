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
}

export type MusicLibraryStore = {
  /** 按加入时间倒序 */
  tracks: MusicTrack[]
}
