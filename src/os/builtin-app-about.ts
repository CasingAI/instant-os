import { FinderIcon, InstantLogoIcon } from '../icons/app-icons.tsx'
import type { AboutAppContent } from './about-app-dialog.tsx'

export type BuiltinAppAbout = Pick<AboutAppContent, 'version' | 'paragraphs' | 'list'>

export const FINDER_ABOUT: AboutAppContent = {
  title: '访达',
  version: 'macOS 风格桌面',
  icon: FinderIcon,
  paragraphs: ['访达是 Instant OS 的桌面入口，帮助你浏览和管理整个系统。快速上手：'],
  list: [
    '点击桌面图标或底部 Dock 栏中的图标，打开内置应用',
    '在 App Store 浏览、搜索并安装 AI 生成的微应用，安装完成后会出现在桌面',
    '拖动窗口标题栏移动位置，拖拽边缘调整大小；双击标题栏可最大化',
    '顶部菜单栏会随当前激活的应用切换；无窗口时显示访达菜单',
    '点击左上角 Instant 图标，可查看平台介绍',
  ],
}

export const INSTANT_ABOUT: AboutAppContent = {
  title: 'Instant OS',
  version: '版本 1.0',
  icon: InstantLogoIcon,
  paragraphs: [
    'Instant OS 是一个在浏览器中运行的 AI 桌面操作系统。它复刻经典 macOS / iOS 的视觉与交互，让你无需安装即可体验完整的「桌面 + 应用」环境。',
    '平台定位：以 AI 实时生成为核心——网络浏览器可还原任意网页，App Store 可现场创作并安装微应用，一切即开即用、即时可用。',
  ],
}

export const BUILTIN_APP_ABOUT: Record<string, BuiltinAppAbout> = {
  appstore: {
    version: 'AI 微应用商店',
    paragraphs: [
      'App Store 让你发现、搜索并安装由 AI 即时生成的微应用。浏览推荐与分类，查看详情后即可一键安装到桌面。',
      '安装完成后，应用会出现在桌面与 Dock，像原生应用一样在独立窗口中运行。',
    ],
  },
  browser: {
    version: 'AI 网页浏览器',
    paragraphs: [
      '网络浏览器是 Instant OS 内置浏览器。输入任意网址或搜索词，AI 会实时生成对应页面，在标签页中浏览。',
      '支持多标签、历史记录、前进后退与重新加载，体验接近真实浏览器。',
    ],
  },
  mail: {
    version: '智能邮件客户端',
    paragraphs: [
      '邮件应用提供收件箱与已发送邮箱，支持撰写新邮件与线程式回复。',
      '内置 AI 助手可帮你生成回复内容，所有邮件数据保存在本地。',
    ],
  },
  photos: {
    version: '即将推出',
    paragraphs: ['照片应用正在开发中，未来将用于浏览与管理 Instant OS 中的图片与媒体文件。'],
  },
  settings: {
    version: '系统管理',
    paragraphs: [
      '系统设置用于查看存储用量、管理已安装应用，以及调整网络浏览器缓存与 AI 用量等系统选项。',
    ],
  },
}
