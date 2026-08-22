
# Instant OS

**Instant OS 是一个跑在浏览器里的 AI Native 操作系统。**

**本仓库的每一行代码，同样全部由 AI 编写——没有任何一行是人类手写的。**

这不是在传统操作系统上「加一层 AI 助手」，也不是把桌面单纯当成内容生成器。AI 在这里是一等系统资源：钥匙串管账户与模型，设置里看用量，事件日志复盘调用，Agent 和人共用同一套窗口、文件、终端和网络。

因此应用集市、邮件、新闻可以当场生成；文件、Chromo、GitHub、VS Code Agent 也可以去动真实的包、网页和仓库。它们不是两套产品叠在一起，而是同一套 AI Native 系统的不同表面。

Instant OS 复刻菜单栏、图标、Dock 与可拖拽窗口。当前版本是 **2.0.0**。

<p align="center">
  <img src="public/favicon.svg" alt="Instant OS" width="64" />
</p>

## 核心理念

| 传统系统 | Instant OS |
|----------|------------|
| AI 是某个 App、插件或侧栏 | **AI 是系统原语**：账户、用量、事件、Agent、本地模型都挂在操作系统上 |
| 文件、终端、网络只给人类程序用 | **人和 Agent 共用同一套环境**：窗口、VFS、终端、网页、打开方式 |
| 应用来自商店里的固定安装包 | 应用可以现场生成，并作为 `.app` 包落在系统里，再被人或 Agent 打开 |
| 网页要么全是远程 HTML，要么没有网络 | **网页浏览器**用模型想象站点；**Chromo** 经云服务打开真网页——Agent 都能用 |
| 必须自备 API Key 才能用 AI | 系统自带 **Instant 免费额度**，打开即桌面；自己的供应商加在钥匙串里 |
| 帮助是静态文档或外链 FAQ | 帮助对照当前系统真实能力，直接告诉你功能在哪、怎么用 |
| 系统时间只驱动时钟 | 改时间会改写新闻、月历等生成内容的时代语境 |

一句话：**Instant OS 是 AI Native 的操作系统——模型是系统能力，桌面是人和 Agent 的共同环境。**

## 开箱即用

- 首次启动会打开 **欢迎中心**（可关；之后可再打开）。不再经过设置向导。
- 未配置自己的 Key 时，使用内置 **Instant 免费额度**（请求前做 PoW challenge）。
- 想用自己的模型：欢迎中心会带到 **钥匙串**，或打开 **系统设置 → 账户**。
- GitHub 克隆、Chromo 上网、部分托管供应商需要先在 **系统设置 → 云服务** 连接。

## AI 作为系统能力

应用集市、网页、邮件仍然可以按需生成——这是 AI Native 系统的一种表面，不是全部。模型调用记入用量与事件日志；带 AI 丝带的图标表示这个应用主要靠模型产出内容。

### 应用集市 — 从列表到应用，全程生成

- **发现页与搜索**：没有固定目录。策展 AI 根据提示现场构思微应用概念；搜索 AI 根据关键词想象匹配结果。每一批列表都是新的。
- **安装**：点击安装后，生成器 AI 流式输出完整可交互的单页应用（HTML 或 Three.js 3D），写入 **`/Applications/{id}.app`** 并出现在桌面。带 **AI 运行时** 能力标签的微应用可在 iframe 内调用系统 AI（流式对话），用量计入「AI 用量」统计。
- **评价驱动更新**：已安装的应用可在详情页写评论、打分。发布评价后，主按钮会从「打开」变为「更新」，应用集市图标也会出现待更新角标。点击「更新」，生成器 AI 会读取你的评论，在现有源码基础上流式生成新版本。
- **卸载**：桌面或 Dock 图标右键可选择卸载，确认后从本地移除应用及其数据。

### 网页浏览器 — 没有真实网页，只有 AI 渲染的页面

- 输入任意 URL，**网页浏览器不发起对该站点的网络请求**，而是由 AI 根据域名与路径高保真还原静态快照。
- 点击链接、提交表单，系统接管导航，AI 为下一个 URL **重新生成**页面。
- 书签、历史、缓存记录的是你「生成过」的页面。已生成的页面缓存保存在数据空间（IndexedDB）。
- 也可作为本机 `.html` / `.svg` 等文件的打开程序，直接预览文件（不经 AI）。

同一系统里还有 **Chromo**：网页浏览器用模型想象站点，Chromo 经代理打开真网页。人和 Agent 都能用这两套表面。

### 邮件 — 整个收件箱都是 AI 虚构的世界

- 首次打开，AI 生成一批虚拟收件箱邮件。
- 回复时，AI 代入发件人身份撰写回信；给新地址写信，AI 即时构思联系人并回复。
- 没有真实邮箱服务器——**每一封你读到的、写出去后收到的，都是 AI 生成的文本。**

### 娱乐向应用 — 内容是虚构的，不当真

下面这些内置应用（以及上面的 **邮件**、**网页浏览器**）产出的都是 AI 编出来的内容，**仅供娱乐与演示**，不代表真实新闻、气象、行情、邮件或网站：

| 应用 | AI 生成什么 |
|------|-------------|
| **新闻** | 可调整日期的中文新闻版面；邻近日标题保持叙事连贯；语汇跟随所选日期（古代 / 当代 / 未来） |
| **书架** | 仿 iBooks 拟物风格；AI 虚构网文，加入书架后流式撰写 |
| **月历** | 拟物风月视图；节气与节假日随系统时间变化；可 AI 生成月度标注 |
| **天气** | 虚构的逐小时与未来几天预报 |
| **股票** | 虚构行情；可固定到通知中心小组件 |
| **翻译** | 中文译为内置「宇宙语言」 |
| **CatGPT** | 与猫咪之神的喵喵对话 |
| **五子棋** | 人人 / 人机 / 双 AI；人机与双 AI 由模型分析局面后落子 |
| **MIDI 演示** | 自然语言 → ABC 乐谱 → 钢琴 MIDI |

**帮助**、**ProDude**、**评测** 也调模型，但不是娱乐应用：帮助对照当前系统真实能力作答；ProDude 会在 `/user` 调查或改文件；评测用 AttuneBench 打你已配置的文本模型。

### 3D 实验室 — Three.js 场景与物理引擎

- 输入场景描述，AI 流式生成基于 **Three.js** 的 3D 页面，使用内置 CC0 模型素材目录。
- 可选开启 **Rapier** 物理模拟。
- **模型识图** 可对内置 GLTF 做多视角截图，再用视觉模型补目录描述。

应用集市在检测到 3D 相关意图时，也会生成 Three.js 微应用，与 3D 实验室共用运行时与素材。

### 图书 — AI 虚构网文书架

- 仿经典 iBooks 拟物风格：**书架**、**书城**与**阅读器**。
- 书城按系统、末日囤货、都市、玄幻、离谱指南等分类；加入书架后 AI **流式撰写章节**，进度可出现在通知中心。
- 书籍索引保存在系统空间，章节正文保存在数据空间。

### 帮助 — 用 AI 读懂当前这套系统

- 用自然语言问：有哪些功能、某个能力在哪、该点什么。
- 助手对照**当前安装的这版系统**作答：可检索打包的源码快照、只读查看本地存储。
- 对普通用户用菜单名、窗口名、按钮文案指路，而不是堆文件路径。

### 系统时间 — 改时间，等于改生成内容的时代

- **系统设置 → 日期与时间**：跟随设备真实时间，或手动设定任意时刻（含公元 / 公元前）。
- 会改变菜单栏时钟、月历节气、新闻版面语汇、邮件时间线等以「今天」为锚的体验。

## 人和 Agent 共用的环境

AI Native 系统需要可操作的环境，而不是只能生成文本的对话框。下面这些能力给人和 Agent 同一套文件、进程、网页和编辑器。

### 文件与虚拟文件系统

- **文件**是默认程序坞最左侧、不可移除的入口。侧栏切换用户文件、开发者数据、应用包、3D 模型与系统位置；也可挂载本机文件夹。
- 生成应用以真实包结构落地：`/Applications/{id}.app/Contents` 放本体，`…/Data` 放应用数据。
- `/user` 下有 Downloads、Musics、Pictures；另有 `/tmp` 与工作区临时目录。
- 打开文件走系统「打开方式」：文本编辑、文稿、预览、Code、音乐、压缩包实用工具等按后缀接手。
- **文件信息**：右键「显示信息」，看属性、批量摘要。
- **空间嗅探**：矩形树图看占用。
- **压缩包实用工具**：浏览、解压、打包 zip / tar / gz。
- **注册表**：按应用命名空间查看与编辑键值（内置应用按字段拆 key）。

数据空间硬上限约 **8 GB**（IndexedDB）。空间不足时顶部横幅与通知中心会提示，并可跳到「存储空间」。

### Chromo — 真网页

- 基于 virtual-chromo，经 **云服务**（Cloudflare Worker + Service Worker）加载外部网站。
- 多标签、书签、历史、会话；拟物 Chrome 外壳。
- DevTools：控制台、网络、应用程序；可拆到独立窗口。网页助手支持截图并用视觉模型分析。
- **WebView** 给终端脚本用：默认离屏，`show` 才出现窗口。

未连接云服务时，真网页相关能力不可用。

### 终端、包管理与 QuickJS

- **终端**是系统原生 JS 运行环境：QuickJS + 薄 Node 兼容层（`fs`、`require`、部分 `stream` / `crypto` / `zlib` 等）。工作区默认 `/user`。可用 `globalThis.instant` 开应用、管窗口，用 `globalThis.webview` 驱动网页单元。
- **包管理** 与终端 `npm` / `npx` 共用 Instant PackageService：内容寻址 store（`/dev/npm`）+ 符号链接 `node_modules`，锁优先安装。不是官方 npm，不支持原生 addon。Registry 在 **系统设置 → NPM**。
- **Virtual JS** 是按窗口隔离的纯引擎演示，不接 VFS / npm。
- **Virtual Machine** 是虚拟机管理器：新建会打开设置，保存后才加入列表。开机把镜像交给独立源上的 V86 运行时（生产环境 `https://vm.casing-ai.com/`，开发默认 `http://localhost:6175`），画面在跨域 iframe 里。存储可选本地文件、网络地址，或 copy.sh 预制（Android-x86 / ReactOS）。联网走 V86 fetch 后端，仅支持 HTTP，目标站点需允许跨域。
- 旧的类 Unix **模拟终端**仍在，已弃用。

### Virtual Studio Code Desktop

基于 Monaco 的工作区编辑器，并带一套 Agent：

- **Ask / Plan / Agent**；Plan 有待办与实施横幅，模型可切换模式。
- Sub Agent：独立终端与会话；主 Agent 可追问。
- 工作区搜索与替换、类 Cursor 的内联补全、图片附件、空格听写。
- 读写工作区；经 `instant.git` 操作 GitHub Desktop 那套工作树；遵守终端只读 / 受控模式。
- 上下文占用、压缩时间线、工具输出过长时溢到 session tmp。

### GitHub Desktop

- 用 GitHub REST API + PAT，在 `/dev/github/…` 维护当前分支工作树副本。
- 克隆、分支、选择性提交、推送 / 拉取（可显示进度）、stash、Undo / Amend。
- **不是**真实 Git 协议客户端：本地没有完整 `.git` 对象库。
- 提交可标记 Instant Agent 为协作者；VS Code / 终端走同一套 `instant.git`。

### 文稿、文本编辑、预览

- **文稿**：飞书式块编辑，原生 `.pages` 包，也可打开 `.md`；表格、公式、分栏、斜杠插入。
- **文本编辑**：多窗口编辑 `.txt` 等纯文本。
- **预览**：只读看 Markdown、DOCX、图片、glTF / GLB。

### 音乐与音乐实验室

- **音乐**：曲库绑定用户目录「音乐」；播放器、逐字卡拉 OK、分轨可视化特效。
- **音乐实验室**：浏览器内 HTDemucs 分轨、MDX 人声增强、SenseVoice / Zipformer 歌词对齐与行级补救、节拍检测；工程保存为 `.stems.zip`。本地模型默认从 R2 网关拉取，可导入缓存。

### iCode — 微应用开发环境

应用集市负责安装别人的创意，**iCode 负责在系统内创造并发布你自己的微应用**。

- **项目与导入**：新建内部项目、从已安装微应用导入副本、导入 / 导出 ZIP。
- **对话式开发**：左侧预览，右侧对话 / 源码（Monaco）/ 配置 / 数据 / 控制台。支持取消流式生成；3D 与 AI 运行时能力可在对话里授权。
- **发布**：沙箱预览确认后「发布到桌面」才更新外部应用。

### 钥匙串、账户与用量

- **钥匙串**：GitHub Token、多供应商 AI 账户（OpenAI、DeepSeek、小米 MiMo、OpenRouter、火山方舟、OpenCode、Instant 免费额度等），基座 / 副基座分类，定价与词表。
- **系统设置 → 账户**：添加 / 切换供应商与模型、默认账户、Thinking。
- **系统设置 → AI 用量**：按日、按应用、按行为、**按模型**；含 prompt cache 命中率。
- 调用会话在 **事件日志** 里复盘。

### 运维与诊断

- **性能监视器**（原任务管理器）：已打开程序与窗口、结束应用、AI 输出速度、系统服务 Worker 堆、云服务与文件吞吐。
- **服务**：后台 Worker 的自动 / 延迟 / 手动 / 禁用。
- **系统信息**：设备与浏览器环境。
- **启动崩溃守护**：启动阶段不可恢复错误时进入全屏诊断界面，可复制诊断信息。

## 桌面、窗口与通知

### 启动器

- **多页桌面**：网格分页；方向键与触控板横滑切页；长按拖动排序；拖到另一图标上合并为文件夹。
- **程序坞**：默认「文件」居左且不可移除；固定区与正在运行但未固定的应用以分隔线区分。系统设置可调图标尺寸。
- **图标装饰**：生成式应用右上角 AI 丝带；未完成能力底部「开发中」套子。
- **Flip 3D**：点击或按住桌面空白（默认为切换窗口）；触控板切窗；退出后聚焦最前那张。
- **显示桌面**、窗口贴边缩放、最小化对准 Dock 图标、窗口级模态框，仍可用。
- 新建窗口会先盖一层图标启动层再揭开内容。内置应用按窗口加载，冷启动不再附带整个 Monaco。

### 通知中心

- 天气、股票小组件（虚构数据）与系统通知流。
- 图书生成进度、微应用安装、存储告警、进程隔离降级等会汇入此处。

### 显示、壁纸、声音

- **壁纸**：多款内置渐变、纯色与图案。
- **表情符号**：Apple Color Emoji 加载策略与垂直偏移校正。
- **系统设置 → 声音** + 菜单栏音量：主音量是全局乘数（音乐、提示音、朗读、五子棋等）。提示音有多套风格可试听。
- **启动项**：桌面就绪后按序执行用户命令，可拖拽排序。
- **还原**：一键还原桌面布局。

### 开发者选项中的实验特性

部分能力默认关闭或仅供调试：

- **全屏沉浸顶栏**
- **语音实验室 / 语音设置**（未完成）
- **外链应用调试**与 **外链 AI 授权**（Bridge，未完成）
- **停用窗口合成器加速**（临时关掉生成应用的进程隔离）
- **启动界面始终显示指针**
- 模型来源：远端网关或同源 `/assets`

## 你在做什么

| 你在做什么 | 系统在做什么 |
|------------|--------------|
| 浏览 / 搜索 / 安装应用集市 | AI 构思列表并写出微应用，写入 `.app` 包 |
| 在应用集市写评价并点「更新」 | 按评论迭代源码 |
| 在网页浏览器输入 URL | AI 生成该 URL 的页面快照 |
| 在 Chromo 输入真实网址 | 经云服务代理加载真实网页；助手可截图并用视觉模型看页 |
| 打开邮件 / 新闻 / 天气 / 股票 / 书架 | AI 虚构对应内容 |
| 改系统时间 | 新闻、月历等切换时代语境 |
| 向帮助提问 | AI 对照当前代码说明用法 |
| 打开「文件」、挂载本机目录 | 浏览 VFS 或同步真实磁盘；Agent 也走这套路径 |
| 双击文档 / 图片 / 音频 / 压缩包 | 按打开方式交给文稿、预览、音乐、压缩包工具 |
| 在 iCode 里对话 | 流式生成或修改微应用源码 |
| 在 VS Code 里用 Agent | 读写工作区、开 Sub Agent、可选 GitHub 工作树 |
| 在终端里写 JS / npm | QuickJS + PackageService 跑在 VFS 上 |
| 克隆 GitHub 仓库 | API 工作树落到 `/dev/github`，提交可带 Instant Agent 协作者 |
| 把歌放进「音乐」或打开音乐实验室 | 播放 / 分轨 / 对齐歌词（本地模型） |
| 五子棋人机 / 双 AI | 模型根据棋盘落子 |
| 点桌面空白 | 默认 Flip 3D 切窗 |
| 看 AI 用量 | 按日 / 应用 / 行为 / 模型，含缓存命中 |

## 技术栈

| 类别 | 选型 |
|------|------|
| 框架 | [Preact](https://preactjs.com/) |
| 构建 | [Vite](https://vite.dev/) |
| 语言 | TypeScript |
| AI 接入 | [OpenAI SDK](https://github.com/openai/openai-node)（兼容 OpenAI、DeepSeek、小米 MiMo、OpenRouter、火山方舟、OpenCode 等） |
| JS 运行时 | [QuickJS](https://bellard.org/quickjs/)（`quickjs-emscripten`）+ 薄 Node 内建 |
| 真网页 | virtual-chromo + 云服务 Worker 代理 |
| 3D 渲染 | [Three.js](https://threejs.org/) |
| 物理引擎 | [Rapier](https://rapier.rs/)（`@dimforge/rapier3d-compat`） |
| 代码编辑器 | [Monaco Editor](https://microsoft.github.io/monaco-editor/) |
| 文稿编辑 | [Tiptap](https://tiptap.dev/) + HyperFormula |
| 本地模型 | ONNX Runtime Web（分轨、人声增强、语音识别 / 对齐等） |
| 压缩包 | [fflate](https://github.com/101arrowz/fflate) |
| 本地持久化 | localStorage（系统设置与布局）+ IndexedDB（VFS、网页缓存、图书正文、模型缓存等） |

## 快速开始

Instant OS **可以不填自己的 API Key 就打开**（走免费额度）。要用自己的模型、GitHub 或 Chromo，再补账户和云服务。

### 环境要求

- Node.js 18+
- [pnpm](https://pnpm.io/)（本项目用 pnpm）

### 安装与运行

```bash
pnpm install
pnpm dev
```

开发服务器：**http://localhost:6173**

Virtual Machine 生产环境使用托管运行时 **https://vm.casing-ai.com/**。本地开发需要另开 **Instant-virtual-machine** 运行时：在那个仓库执行 `pnpm dev`（端口 **6175**）。存储里可选本地镜像、网络地址，或 copy.sh 预制客户机（Android-x86 / ReactOS）。

```bash
pnpm build
pnpm preview   # 默认 http://localhost:6174
```

### 配置 AI 账户

**界面配置（推荐）**：欢迎中心或 **系统设置 → 账户 / 钥匙串**。可设置默认账户；部分供应商支持 **Thinking**。配置只存在浏览器本地。

**环境变量（可选兜底）**：复制 `.env.example` 为 `.env.local`。设置页里已经没有「环境变量」项。

| 变量 | 说明 |
|------|------|
| `VITE_OPENAI_API_KEY` | API Key |
| `VITE_OPENAI_BASE_URL` | 可选，自定义 API 基址 |
| `VITE_OPENAI_MODEL` | 可选 |

### 支持的 AI 供应商（内置预设）

| 供应商 | 说明 |
|--------|------|
| Instant 免费额度 | 默认启用，PoW 网关，不必自备 Key |
| DeepSeek | V4 Flash / Pro 等 |
| OpenAI | GPT 系列等 |
| 小米 MiMo | 含 Token Plan；部分视觉 / 语音模型 |
| OpenRouter | 手动或目录定价 |
| 火山方舟 | Coding Plan / Agent Plan（通常需云服务） |
| OpenCode Go / Zen | 托管端点（通常需云服务） |
| 自定义 | 任意 OpenAI 兼容 API |

## 数据与隐私

- **API Key 与 GitHub Token** 只存在浏览器本地。
- **生成产物**、**VFS**、**启动器布局**、**模型缓存**均在本机；无后端同步。
- 出网场景主要是：所选 AI 供应商、免费额度网关、云服务代理（Chromo / GitHub zip / 部分模型）、npm registry、模型权重下载。其它内容仍不从「真实网站」当成品来读。
- 除上述调用外，不依赖外部 CDN 当内容源。

## 项目结构

```
src/
├── boot/            # 启动崩溃守护
├── ai/              # 客户端、流式对话、Thinking、用量、事件日志、Sub Agent、上下文压缩
├── apps/            # 内置应用（集市、浏览器、Chromo、文件、VS Code、音乐实验室、欢迎中心等）
├── archive/         # 压缩包编解码 Worker
├── assets/3d/       # CC0 模型目录与 Scene3D 注入
├── quickjs/         # QuickJS 实例、Node 薄内建、fs 桥
├── packages/        # Instant npm PackageService
├── page-host/       # Chromo / WebView 共用页面宿主
├── preview/         # 系统级文件预览
├── fonts/           # Apple Color Emoji 与垂直偏移
├── os/              # 桌面壳：时钟、音量、云服务、注册表、启动项、打开方式、PoW
├── desktop/ dock/ window/ icons/
├── terminal/        # 终端工作模式、instant.git / instant.shell
├── ui/              # 共享控件
├── bridge/          # 外链 Bridge（实验性 · 未完成）
public/
├── boot-crash-guard.js
├── assets/          # 3D、提示音、分轨 / 对齐模型（部分需脚本拉取）
└── vendor/          # vendored Three.js、Rapier、QuickJS guest 等
workers/             # 模型网关等 Worker
```

## 开发说明

### 常用脚本

| 脚本 | 说明 |
|------|------|
| `pnpm dev` | 开发服务器（端口 **6173**；HMR 已关闭） |
| `pnpm build` | 类型检查 + 生产构建 |
| `pnpm preview` | 预览构建产物（端口 **6174**） |
| `pnpm vendor:three` / `vendor:rapier` / `vendor:runtime` | 拷贝 3D 运行时到 `public/vendor/` |
| `pnpm vendor:tokenizers` / `vendor:quickjs-guest` | tokenizer 与 QuickJS guest 内建 |
| `pnpm assets:3d` / `pnpm catalog:3d` | 下载 CC0 素材、生成模型目录 |
| `pnpm vendor:demucs` / `vendor:phoneme` | 分轨与音素模型（体积大，不进 git） |

- 构建时执行 `tsc -b`（见 `vite.config.ts`）
- 3D 提示词示例见根目录 `3d-app-prompt-example.md`
- Instant npm 与桌面 npm 的差异见 `docs/instant-npm-differences.md`

### 启动崩溃测试

地址栏追加查询参数 `instant_crash`：

| 参数值 | 模拟场景 |
|--------|----------|
| `boot`（或 `1`、留空） | 启动守护激活后立即进入诊断界面 |
| `reject` | 未处理的 Promise 拒绝 |
| `font` | 字体初始化完成后的启动失败 |
| `react` | 组件树渲染阶段的未捕获异常 |

示例：`?instant_crash=react`。

## 许可证

本项目采用 [MIT License](LICENSE) 开源。

---

Instant OS 探索一个问题：**如果操作系统从一开始就是为 AI 设计的——模型是系统能力，人和 Agent 共用同一套环境——计算机会变成什么样？** 欢迎通过 [Issue](https://github.com/CasingAI/instant-os/issues) 或 [Pull Request](https://github.com/CasingAI/instant-os/pulls) 参与讨论。
