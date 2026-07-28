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
    version: '版本 1.2.0',
    icon: InstantLogoIcon,
    layout: 'about-this-device',
    specs: deviceSpecs,
  }
}

export const INSTANT_ABOUT: AboutAppContent = {
  title: 'Instant OS',
  version: '版本 1.2.0',
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
      '支持多标签、历史记录、前进后退与重新加载；也可作为 .html / .htm / .xhtml / .svg 等本机文件的打开程序，直接预览文件内容（不经 AI 生成）。已生成的网页缓存保存在数据空间（IndexedDB），可在系统设置中管理。',
    ],
  },
  chromo: {
    version: 'WebView 浏览器',
    paragraphs: [
      'Chromo 是基于 virtual-chromo 的真网页浏览器，通过 Cloudflare Worker 与 Service Worker 代理加载外部网站。',
      '与 AI 网络浏览器不同，Chromo 渲染真实网页内容，支持页内链接跳转、前进后退与刷新。网页渲染由 virtual-chromo 组件负责，Instant OS 提供 Chrome 风格外壳与多标签管理。',
    ],
  },
  'chromo-devtools': {
    version: 'Chromo 开发者工具',
    paragraphs: [
      'Chromo 开发者工具是 Chromo 浏览器的独立调试窗口，支持控制台与网络面板。',
      '可从 Chromo 内嵌开发者工具的设置菜单中「在独立窗口中打开」；每个标签页对应一扇独立窗口，行为对齐 Chrome 开发者工具。',
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
  files: {
    version: '拟物文件柜',
    paragraphs: [
      '文件应用仿早期 iOS 拟物风格，通过侧边栏切换虚拟位置：用户文件、开发者数据、内置 3D 模型与系统文件。',
      '用户文件与开发者数据位置支持新建文件夹与文件、重命名与删除；3D 模型与系统文件为只读浏览。也可在侧栏直接挂载本机文件夹，改动会同步到真实磁盘。打开文件由系统「文件打开关联」决定交给哪个应用处理，文件应用本身不内置编辑器。用户文件与开发者数据计入数据空间（IndexedDB），可在系统设置中查看与管理。',
    ],
  },
  textedit: {
    version: '简易文本编辑器',
    paragraphs: [
      '文本编辑用于打开与编辑本机文本文件。启动时可通过系统打开对话框选择已有文件，或新建文本文件后再编辑。',
      '默认注册为 .txt 文件的打开程序；也可从「文件」应用中直接打开文本文件。可同时打开多个文稿窗口。只读文件可查看但不可保存。',
    ],
  },
  preview: {
    version: '文档、图片与 3D 预览',
    paragraphs: [
      '预览用于以只读方式查看本机文档、图片与三维模型。支持 Markdown（.md / .markdown / .mdx）的拟物纸面渲染，Word 文档（.docx），常见图片（.png / .jpg / .gif / .webp / .ico），以及 glTF / GLB 模型（含「文件」中的内置 3D 模型卷）。',
      '默认作为上述格式的打开程序；可在同一窗口用多标签页同时打开多个文件。编辑请使用 Virtual Studio Code Desktop 或文本编辑。',
    ],
  },
  vscode: {
    version: '代码编辑器',
    paragraphs: [
      'Virtual Studio Code Desktop 是基于 Monaco 的轻量代码编辑器：文件夹浏览、多标签编辑、内嵌终端（QuickJS REPL）与简易编辑器设置。',
      '内置 AI 侧栏支持 Ask / Edit / Agent 三种模式，可感知工作区、读写文件、搜索与在终端运行 JavaScript / npm（敏感操作需确认）。',
      '默认作为常见源码后缀的打开程序；.txt 仍由文本编辑处理，.html 等网页文件默认仍由网络浏览器打开。只读卷可预览但不可保存。',
    ],
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
  'model-vision': {
    version: '3D 模型视觉标注',
    paragraphs: [
      '模型识图会对内置 GLTF 资源做多视角截图，再调用钥匙串中配置的图像识别模型（推荐小米 MiMo V2.5 / Token Plan）写清外观、朝向与道路接口方向。',
      '识别结果保存在数据空间（IndexedDB），可在应用内预览；调用会计入 AI 用量与事件日志。适合在套餐额度到期前批量补全目录描述。',
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
  calendar: {
    version: '拟物风月历',
    paragraphs: [
      '月历应用仿早期 iOS Calendar 拟物风格，展示月视图与本地算定的二十四节气，并按月加载特殊日期短标记；时间与系统「日期与时间」虚拟时钟一致。',
      '改系统时间（含古代或未来）会切换月历所处时代：当代年份会纳入国庆、劳动节等固定节日，不同时代口吻与节气语境也会随之变化。标记按月缓存。',
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
    version: '实验性 · 未完成',
    paragraphs: [
      '语音实验室是未完成的实验特性（默认需在「设置 → 开发者选项」开启），用于测试系统语音服务。',
      '识别与合成只调用统一系统入口，不自行选择供应商、语种或音色；模型在钥匙串按能力选用，语种与音色在「系统设置 → 语音」调整。',
      '请先配置对应能力模型（例如 mimo-v2.5-asr / mimo-v2.5-tts）。调用会计入 AI 用量与事件日志。',
    ],
  },
  'system-info': {
    version: '设备信息查看器',
    paragraphs: [
      '系统信息详细展示当前浏览器可获取的设备与环境信息，包括操作系统、浏览器、处理器、内存、显卡、显示器、网络状态等。',
      '所有数据来源于浏览器 API，仅供展示与调试参考。',
    ],
  },
  'task-manager': {
    version: '程序与性能监视',
    paragraphs: [
      '「程序」页列出当前所有已打开的应用与窗口，显示前台、后台或最小化等状态；点击可切换到前台，「结束」会关闭该应用的全部窗口。性能监视器本身无法在此处结束。',
      '「性能」页打开监视器后即按采样间隔写入输出速度点（默认每秒，不依赖是否停留在性能页），填满窗口后丢掉最旧点；可在菜单栏「视图」中切换 1 / 3 / 5 秒间隔。',
    ],
  },
  'event-log': {
    version: 'AI 调用日志',
    paragraphs: [
      '事件日志在 AI 请求开始时就会出现「生成中」记录，流式输出过程中实时更新正文与速度；结束后落盘完整输入、输出与耗时等字段。',
      '日志保存在 IndexedDB 数据空间中，不会占用 localStorage。',
    ],
  },
  packages: {
    version: 'Instant npm',
    paragraphs: [
      '包管理是 Instant PackageService 的 GUI：可打开项目安装、卸载、更新依赖，并浏览全局 CAS 缓存；与终端 npm / npx CLI 适配器共用同一套宿主安装器。',
      '依赖以内容寻址方式缓存在系统 store，工作区 node_modules 使用符号链接；install 对齐锁优先。可在设置 → NPM 更换 registry。不支持原生 addon 与官方 npm 二进制。',
    ],
  },
  'archive-utility': {
    version: '解压缩',
    paragraphs: [
      '压缩包实用工具用于打开 .zip、.tar、.tar.gz / .tgz、.gz 等归档：内容解压到压缩包所在目录，行为类似 macOS「归档实用工具」。',
      '无窗口应用：不提供预览或编辑。解压较快时不显示界面；耗时较长时展开为可拖动的系统进度窗口（统一标题栏），显示进度与时间信息。可在「文件」中设为默认打开程序。',
    ],
  },
  'space-sniffer': {
    version: '文件占用可视化',
    paragraphs: [
      '空间嗅探用矩形树图展示卷或文件夹的磁盘占用：面积越大，占用越多。可在扫描过程中下钻与导航。',
      '启动时选择要扫描的卷或文件夹。单击文件夹可在原框内细分；双击可放大进入。右键可在「文件」中显示对应位置。',
    ],
  },
  keychain: {
    version: '凭证与 API Key',
    paragraphs: [
      '钥匙串用于管理本机保存的 API 凭证。一级列表可进入 GitHub 或 AI 模型供应商；在 GitHub 页点击 Token 行会弹出对话框填写 Personal Access Token。',
      '所有配置仅保存在本机，不会上传到服务器。',
    ],
  },
  'github-desktop': {
    version: 'GitHub API 同步客户端',
    paragraphs: [
      'GitHub Desktop 基于 GitHub REST API 与 Personal Access Token，在本地维护当前分支的工作树副本（保存在 /dev/github/…），支持克隆、切换分支、commit 与推送、拉取。',
      '不是真实 Git 协议客户端：本地不保存 .git 对象库；日常编辑与 AI Agent 读写走本地文件，仅在同步时访问 GitHub API。',
    ],
  },
  help: {
    version: '系统 AI 使用指南',
    paragraphs: [
      '帮助是 Instant OS 的重磅能力：用自然语言直接问当前系统有哪些功能、在哪里、怎么用。',
      '助手会对照本机真实实现作答（可查阅源码快照与本地存储只读信息），再用菜单名、按钮文案与操作步骤指路，而不是堆内部实现细节。',
    ],
  },
  terminal: {
    version: '系统原生终端',
    paragraphs: [
      '终端是系统的原生 JavaScript 运行环境：基于 QuickJS + Node 兼容层（process、fs、require 等），可在终端式 REPL 中直接执行 JS 代码操作整个虚拟系统。',
      '工作区默认为 /user，同一窗口内多次回车共享一个全局环境；清屏仅清空输出，.reset 或菜单「重建实例」可重置运行时。',
    ],
  },
  /** @deprecated 模拟终端已弃用，此 about 条目保留仅为过渡，后续移除 */
  'simulated-terminal': {
    version: '类 Unix 壳层演示（模拟）',
    paragraphs: [
      '模拟终端提供自然语言 / 类 Unix 命令行演示，面向高级用户的文件系统浏览与特权操作确认入口。',
      '它不是原生 JS 运行环境——需要真正执行 JavaScript 或 Node 脚本，请使用「终端」。',
    ],
  },
  'virtual-js': {
    version: 'QuickJS 实例演示',
    paragraphs: [
      'Virtual JS 接通系统级 QuickJS 服务：每个窗口对应一个隔离 JS 实例，多次运行会保留全局变量；关闭窗口后实例销毁。',
      '当前为纯引擎演示，无 Node / VFS / npm。与「终端」职责不同——终端面向文件与特权操作，Virtual JS 面向可复用的 JS 执行环境。',
    ],
  },
  'ui-kit': {
    version: 'UI 组件库',
    paragraphs: [
      'UI 组件库展示系统内所有可复用的 UI 组件，包括表单控件、设置界面组件、导航交互组件和窗口系统组件。',
      '每个组件提供实时可交互的 Demo、使用代码示例（可一键复制）和详细的 Props 说明，方便开发者了解和使用系统组件。',
    ],
  },
}
