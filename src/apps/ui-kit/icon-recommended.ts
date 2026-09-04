/** 「推荐」虚拟分类的哨兵分类名：只存在于 IconDemo 的分类状态里，不属于目录数据的规范类目，因此不能进 ICON_CATEGORY_CN。 */
export const ICON_RECOMMENDED = '__recommended__'

/**
 * iOS 6 系统界面符号对照名单：导航栏/工具栏按钮（UIBarButtonItem 系统项）、媒体走带键、
 * 标签栏、状态栏里那套内置 glyph 的 Material Symbols 等价物——不是主屏 App 图标。
 * 「iOS 6 系统符号」是精选语义，目录生成物不认识（生成脚本已失传），只能手工维护；
 * 名单里每个名字都逐一核对过：三套字体族下均有字形（目录中无 unsupportedFamilies 标记）。
 */
export const ICON_RECOMMENDED_NAMES: readonly string[] = [
  // ── 导航栏/工具栏按钮（UIBarButtonItem 系统项）──
  'add', // 加号（Add）
  'remove', // 减号（Remove）
  'close', // 叉（取消/关闭）
  'check', // 对勾（完成 Done）
  'edit_square', // 撰写（Compose，方框铅笔）
  'ios_share', // 分享（Action，方框向上箭头）
  'create_new_folder', // 整理（Organize，带加号文件夹）
  'bookmarks', // 书签（Bookmarks，翻开的书）
  'bookmark', // 单个书签
  'search', // 搜索（放大镜）
  'refresh', // 刷新
  'reply', // 回复（弯箭头）
  'reply_all', // 全部回复
  'forward', // 转发
  'delete', // 删除（垃圾桶）
  'more_horiz', // 更多（…）
  'photo_camera', // 相机按钮
  'stop', // 停止
  // ── 媒体走带（音乐/视频播放器控制键）──
  'play_arrow', // 播放
  'pause', // 暂停
  'skip_next', // 下一曲
  'skip_previous', // 上一曲
  'fast_forward', // 快进（»）
  'fast_rewind', // 快退（«）
  'shuffle', // 随机播放
  'repeat', // 循环
  'airplay', // AirPlay
  'volume_up', // 音量
  'volume_off', // 静音
  // ── 导航尖角（iOS 风格返回/前进）──
  'arrow_back_ios_new', // 返回尖角
  'arrow_forward_ios', // 前进尖角
  // ── 标签栏（内置 App 底栏语义）──
  'star', // 收藏（Favorites）
  'history', // 最近（Recents）
  'person', // 通讯录/个人
  'download', // 下载（Downloads）
  // ── 状态栏/系统开关 ──
  'wifi', // WiFi
  'bluetooth', // 蓝牙
  'battery_full', // 电池
  'signal_cellular_4_bar', // 蜂窝信号
  'flight', // 飞行模式
  'lock', // 竖排方向锁定
  'navigation', // 定位箭头
  'schedule', // 时钟
]
