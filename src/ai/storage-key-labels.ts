import {
  DEVICE_STORAGE_KEYS,
  GENERATED_APP_DATA_KEY_PREFIX,
} from '../os/device-storage.ts'

/** 禁止返回正文的 localStorage 键（含 API Key 等） */
const BLOCKED_VALUE_KEYS = new Set<string>([DEVICE_STORAGE_KEYS.accountSettings])

const KEY_LABELS: Record<string, string> = {
  [DEVICE_STORAGE_KEYS.generatedApps]: '已安装微应用列表',
  [DEVICE_STORAGE_KEYS.listingDetails]: '应用集市详情',
  [DEVICE_STORAGE_KEYS.listingReviews]: '应用集市评论',
  [DEVICE_STORAGE_KEYS.storeListings]: '应用集市列表',
  [DEVICE_STORAGE_KEYS.safariHistory]: '网页浏览器历史',
  [DEVICE_STORAGE_KEYS.safariBookmarks]: '网页浏览器书签',
  [DEVICE_STORAGE_KEYS.safariTokenUsage]: '网页浏览器 AI 用量',
  [DEVICE_STORAGE_KEYS.safariSettings]: '网页浏览器设置',
  [DEVICE_STORAGE_KEYS.chromoBookmarks]: 'Chromo 书签',
  [DEVICE_STORAGE_KEYS.chromoSettings]: 'Chromo 设置',
  [DEVICE_STORAGE_KEYS.chromoHistory]: 'Chromo 历史',
  [DEVICE_STORAGE_KEYS.chromoSession]: 'Chromo 会话',
  [DEVICE_STORAGE_KEYS.chromoDownloads]: 'Chromo 下载记录',
  [DEVICE_STORAGE_KEYS.mail]: '邮件数据',
  [DEVICE_STORAGE_KEYS.news]: '新闻数据',
  [DEVICE_STORAGE_KEYS.newsTokenUsage]: '新闻 AI 用量',
  [DEVICE_STORAGE_KEYS.windowSizes]: '窗口尺寸记忆',
  [DEVICE_STORAGE_KEYS.accountSettings]: '账户与 API Key（敏感，不可读内容）',
  [DEVICE_STORAGE_KEYS.displaySettings]: '显示设置',
  [DEVICE_STORAGE_KEYS.dateTimeSettings]: '日期与时间设置',
  [DEVICE_STORAGE_KEYS.dockSettings]: '程序坞和桌面设置',
  [DEVICE_STORAGE_KEYS.wallpaperSettings]: '壁纸设置',
  [DEVICE_STORAGE_KEYS.experimentalSettings]: '开发者选项',
  [DEVICE_STORAGE_KEYS.scene3dLabArchives]: '3D 实验室档案',
  [DEVICE_STORAGE_KEYS.scene3dLabPrefs]: '3D 实验室偏好',
  [DEVICE_STORAGE_KEYS.notificationCenterWidgets]: '通知中心小组件',
  [DEVICE_STORAGE_KEYS.notificationCenterSettings]: '通知中心设置',
  [DEVICE_STORAGE_KEYS.weather]: '天气数据',
  [DEVICE_STORAGE_KEYS.calendar]: '月历数据',
  [DEVICE_STORAGE_KEYS.stocks]: '股票数据',
  [DEVICE_STORAGE_KEYS.catgpt]: 'CatGPT 对话',
  [DEVICE_STORAGE_KEYS.produde]: 'ProDude 对话',
  [DEVICE_STORAGE_KEYS.gomoku]: '五子棋数据',
  [DEVICE_STORAGE_KEYS.launcherLayout]: '桌面布局',
  [DEVICE_STORAGE_KEYS.books]: '书架索引',
  [DEVICE_STORAGE_KEYS.icodeInternalProjects]: 'iCode 工程',
  [DEVICE_STORAGE_KEYS.icodeProjects]: 'iCode 工程（旧键）',
  [DEVICE_STORAGE_KEYS.musicLyricOffsets]: '音乐歌词同步偏移',
  [DEVICE_STORAGE_KEYS.musicVolume]: '音乐音量',
  'instant-os-external-bridge-consents': '外链 AI 授权记录',
}

export function getLocalStorageKeyLabel(key: string): string {
  const known = KEY_LABELS[key]
  if (known) {
    return known
  }
  if (key.startsWith(GENERATED_APP_DATA_KEY_PREFIX)) {
    const appId = key.slice(GENERATED_APP_DATA_KEY_PREFIX.length)
    return `微应用数据（${appId || '未知'}）`
  }
  if (key.startsWith('frimousse/data/')) {
    return 'Emoji 键盘缓存'
  }
  return '未标注的本地键'
}

export function localStorageBlockedReason(key: string): string | undefined {
  if (BLOCKED_VALUE_KEYS.has(key)) {
    return '含账户与 API Key，禁止读取内容；仅可查看键名与占用体积'
  }
  return undefined
}

/** 禁止经终端/检查工具直接读写正文的 localStorage 键（含 API Key） */
export function isLocalStorageValueBlocked(key: string): boolean {
  return BLOCKED_VALUE_KEYS.has(key)
}
