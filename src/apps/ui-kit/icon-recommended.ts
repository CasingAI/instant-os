/** 「推荐」虚拟分类的哨兵分类名：只存在于 IconDemo 的分类状态里，不属于目录数据的规范类目，因此不能进 ICON_CATEGORY_CN。 */
export const ICON_RECOMMENDED = '__recommended__'

/**
 * iOS 6 主屏内置 App → Material Symbols 图标对照名单。
 * 「iOS 6 内置」是精选语义，目录生成物不认识（生成脚本已失传），只能手工维护；
 * 名单里每个名字都逐一核对过：三套字体族下均有字形（目录中无 unsupportedFamilies 标记）。
 */
export const ICON_RECOMMENDED_NAMES: readonly string[] = [
  'call', // 电话
  'mail', // 邮件
  'public', // Safari
  'photo_library', // 照片
  'photo_camera', // 相机
  'music_note', // 音乐（iPod）
  'movie', // 视频
  'smart_display', // YouTube
  'map', // 地图
  'partly_cloudy_day', // 天气
  'schedule', // 时钟
  'calculate', // 计算器
  'calendar_month', // 日历
  'edit_note', // 备忘录
  'checklist', // 提醒事项
  'contacts', // 通讯录
  'settings', // 设置
  'candlestick_chart', // 股票
  'explore', // 指南针
  'sports_esports', // Game Center
  'videocam', // FaceTime
  'mic', // 语音备忘录
  'menu_book', // iBooks
  'newspaper', // 报刊杂志（Newsstand）
  'wallet', // Passbook
  'library_music', // iTunes
  'apps', // App Store
  'school', // iTunes U
  'podcasts', // 播客
]
