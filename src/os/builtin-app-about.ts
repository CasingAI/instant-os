import { InstantLogoIcon } from '../icons/app-icons.tsx'
import type { AboutAppContent } from './about-app-dialog.tsx'
import { collectDeviceInfo } from './collect-device-info.ts'

export type BuiltinAppAbout = Pick<AboutAppContent, 'version' | 'paragraphs' | 'list'>

export async function getThisDeviceAbout(): Promise<AboutAppContent> {
  const specs = await collectDeviceInfo()
  const osSpec = specs.find((s) => s.label === '操作系统')
  const browserSpec = specs.find((s) => s.label === '浏览器')
  const cpuSpec = specs.find((s) => s.label === '处理器')
  const memSpec = specs.find((s) => s.label === '内存')
  const displaySpec = specs.find((s) => s.label === '显示器')

  const deviceSpecs = [
    osSpec && { label: '操作系统', value: osSpec.value },
    browserSpec && { label: '浏览器', value: browserSpec.value },
    cpuSpec && { label: '处理器', value: cpuSpec.value },
    memSpec && { label: '内存', value: memSpec.value },
    displaySpec && { label: '显示器', value: displaySpec.value },
  ].filter((spec): spec is { label: string; value: string } => Boolean(spec))

  return {
    title: 'Instant OS',
    version: '版本 1.0.5',
    icon: InstantLogoIcon,
    layout: 'about-this-device',
    specs: deviceSpecs,
  }
}

export const INSTANT_ABOUT: AboutAppContent = {
  title: 'Instant OS',
  version: '版本 1.0.5',
  icon: InstantLogoIcon,
  paragraphs: [
    'Instant OS 是一个在浏览器中运行的 AI 桌面操作系统。它复刻经典 macOS / iOS 的视觉与交互，让你无需安装即可体验完整的「桌面 + 应用」环境。',
    '平台定位：以 AI 实时生成为核心——网络浏览器可还原任意网页，应用集市可现场创作并安装微应用，一切即开即用、即时可用。',
  ],
  links: [{ href: 'https://github.com/CasingAI/instant-os', label: 'GitHub：CasingAI/instant-os' }],
}

export const BUILTIN_APP_ABOUT: Record<string, BuiltinAppAbout> = {
  appstore: {
    version: 'AI 微应用集市',
    paragraphs: [
      '应用集市让你发现、搜索并安装由 AI 即时生成的微应用。浏览推荐与分类，查看详情后即可一键安装到桌面。',
      '安装完成后，应用会出现在桌面与 Dock，像原生应用一样在独立窗口中运行。',
    ],
  },
  browser: {
    version: 'AI 网页浏览器',
    paragraphs: [
      '网络浏览器是 Instant OS 内置浏览器。输入任意网址或搜索词，AI 会实时生成对应页面，在标签页中浏览。',
      '支持多标签、历史记录、前进后退与重新加载，体验接近真实浏览器。已生成的网页缓存保存在数据空间（IndexedDB），可在系统设置中管理。',
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
  'scene3d-lab': {
    version: 'AI 3D 场景生成',
    paragraphs: [
      '3D 实验室用于测试内置 CC0 模型与 AI 场景生成。输入场景描述后，AI 会生成使用 Three.js 与内置模型 url 的 3D 页面。',
      '已集成 Rapier 物理引擎：可开启「物理 · Rapier」并在 Demo 按钮加载物理示例。',
      '此应用独立于应用集市的微应用生成流程，便于验证素材目录与运行时注入是否正常。',
    ],
  },
  icode: {
    version: '微应用开发环境',
    paragraphs: [
      'iCode 是 Instant OS 的微应用开发工具。创建项目后自动在桌面生成入口，编辑会实时同步。',
      '左侧实时预览应用，右侧通过对话让 AI 生成或迭代源码，并可查看源代码与应用存储数据。支持导出、导入程序包以备份或分享项目。',
    ],
  },
  news: {
    version: 'AI 新闻阅读器',
    paragraphs: [
      '新闻应用提供可调整日期的 AI 生成中文新闻版面。支持将日期调至过去或未来，查看「未来新闻」。',
      '生成时会参考邻近日的标题，保持事件与叙事的连贯性。所有内容本地持久化保存，可在系统设置的「新闻」栏目中精确删除单篇或整日新闻。',
    ],
  },
  books: {
    version: 'AI 书架',
    paragraphs: [
      '书架应用仿 iBooks iOS 6 拟物风格，提供书架、书城与阅读器。所有书籍均为 AI 虚构网文，涵盖系统、末日囤货、都市、玄幻、离谱指南等分类。',
      '书籍索引保存在系统空间，章节正文保存在数据空间（IndexedDB）。加入书架后 AI 流式撰写章节，全部章节下载完成后方可阅读。',
    ],
  },
  weather: {
    version: 'AI 天气预报',
    paragraphs: [
      '天气应用提供完全由 AI 虚构的中文天气预报，包括逐小时与未来几天预报。',
      '支持搜索任意城市，搜索结果同样由 AI 即时编造，仅供娱乐与演示，不代表真实数据。通知中心天气小组件可一键打开本应用。',
    ],
  },
  stocks: {
    version: 'AI 股票行情',
    paragraphs: [
      '股票应用提供完全由 AI 虚构的股市看板与个股详情。',
      '支持搜索股票代码或公司名，搜索结果同样由 AI 即时编造，仅供娱乐与演示，不代表真实行情。通知中心股票小组件可一键打开本应用。',
    ],
  },
  translate: {
    version: '宇宙语言翻译器',
    paragraphs: [
      '翻译应用仅支持从系统语言（中文）译为内置的宇宙语言，如哈啾噜噜语、波叽哇啦语、哈基语等。',
      '点击翻译时即时生成宇宙语文本；哈基语相传源自遥远哈基米星球——哈基米为何物至今存疑，译文由不明生物所哼南北鲁多之歌的空耳音节拼成。译回中文时返回与原文无关的句子，仅供娱乐。',
    ],
  },
  catgpt: {
    version: '与猫咪之神对话',
    paragraphs: [
      'CatGPT 是与猫咪之神沟通的圣殿。你写下心声，神以喵喵喵回应。',
      '喵与喵之间或有符号与 emoji。对话记录保存在本地，随时续上与神的交流。',
    ],
  },
  gomoku: {
    version: 'AI 智能对弈',
    paragraphs: [
      '15×15 经典五子棋，先连成五子者胜。支持人人对战、人机对战与双 AI 对战三种模式。',
      '人机模式下由当前配置的 AI 模型分析局面并落子；双 AI 模式下本地启发式 AI 与模型 AI 自动对弈。含开局抽签、撤销、对局信息面板，以及落子与胜负的音效与视觉特效。',
    ],
  },
  speech: {
    version: 'Web Speech API 语音识别测试',
    paragraphs: [
      '语音识别是浏览器 Web Speech API（SpeechRecognition）的演示与测试工具。点击麦克风即可开始说话，识别结果与原始事件会实时显示。',
      '可调整识别语言、continuous 连续识别、interimResults 中间结果以及 maxAlternatives 候选数量。所有配置在开始识别后锁定，需停止后再修改。',
      '兼容性提示：Chrome / Edge 走 Google 识别服务，Safari 走 Apple，Firefox 通常不支持。需在 HTTPS 或 localhost 环境运行，并授予麦克风权限。识别依赖厂商云端服务，离线不可用。',
    ],
  },
  'system-info': {
    version: '设备信息查看器',
    paragraphs: [
      '系统信息详细展示当前浏览器可获取的设备与环境信息，包括操作系统、浏览器、处理器、内存、显卡、显示器、网络状态等。',
      '所有数据来源于浏览器 API，仅供展示与调试参考。',
    ],
  },
}
