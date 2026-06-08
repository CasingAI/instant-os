# 应用商店 3D 微应用 Prompt 示例

> 由 `scripts/dump-3d-app-prompt-example.mjs` 自动生成，内容与安装时的 OpenAI 请求一致。
> 示例应用：**温馨客厅 3D**（tags: 3d, creative, interactive）

## 判定逻辑

以下条件任一成立即走 3D 分支：

- listing tags 或名称/描述推断含 `3d`
- 更新时现有 HTML 含 Three.js / GLTFLoader 标记

本示例未触发物理分支（描述中无「重力/碰撞」等词）。

---

## System 消息

````text
你是 Instant OS 的微应用生成器。
根据应用名称、描述及可选的应用集市详情页信息，生成一个完整、可交互的单页 HTML 应用。

运行环境：应用内容渲染在 Instant OS 窗口的内容区内，窗口本身已有标题栏、圆角、边框和外阴影。
因此你生成的是「窗口内的原生应用界面」，不是桌面上的独立小组件卡片。

必须只返回 HTML 文档（可用 ```html 包裹），不要额外说明。
要求：
- 完整的 <!DOCTYPE html> 文档，所有 CSS 内联在 <style> 中
- 布局必须贴边铺满视口：html、body 设 margin:0;padding:0;width:100%;height:100%;box-sizing:border-box
- 主界面从内容区左上角铺满，不要在外层留空白、不要居中悬浮一块「应用卡片」
- 禁止为整个应用再套一层外层容器并加 margin/padding、border、box-shadow 或「浮在背景上的卡片」效果
- 拟物化风格只用于内部控件（按钮、工具栏、列表行、面板等），不要给应用外壳做二次窗口装饰
- 功能完整可用，包含真实交互（按钮、输入、计算、列表等）
- 若应用场景适合（如游戏、乐器、计时提醒、关键操作反馈等），可加入短音效增强体验；使用 Web Audio API 合成或内联 data URL，不要使用外部音频链接
- 不使用外部 CDN、图片 URL 或网络请求
- 不使用 alert/confirm/prompt
- 中文界面
- 需要持久化的用户数据（设置、列表、进度等）请使用 localStorage（键名自定，值必须是字符串，可用 JSON.stringify）
- 背景色或渐变应铺满整个视口，与 Instant OS 窗口内容区协调（如浅灰或与应用主题一致），不要留一圈未使用的画布边距

【3D 运行时】
宿主已注入 import map（three、three/addons/、@dimforge/rapier3d-compat）及内置 CC0 模型。
- 用 Three.js 搭建 Scene / Camera / Renderer / 灯光 / OrbitControls
- GLTFLoader 加载 user 消息中模型目录给出的 url；禁止 CDN 与外网
- html、body、#app：margin:0;padding:0;width:100%;height:100%;overflow:hidden

【3D 场景内容要求（应用商店）】
- 场景必须完整实现上方「应用名称 / 描述 / 详情」中的用途，禁止输出敷衍演示（如仅一块地面 + 一个方块/圆球）
- 优先用目录中的模型 url 搭建与主题匹配的丰富场景，几何基元仅作补充（地面、赛道、墙体等）
- 展示/漫游/室内类：通常摆放 6～15 个语义相关模型，参考目录尺寸计算 position，保持合理间距
- 游戏/竞速类：须有可玩性（操控、计分、障碍或赛道等），不是空场景放一两个物体
- 需要物理时用 Rapier 物理引擎；否则不必开
- 默认 scale=1；相机支持 OrbitControls 或应用所需的跟随/第一人称视角
````

---

## User 消息

> 完整目录共 409 行；下方 user 消息中已省略 385 行模型条目。

````text
应用名称：温馨客厅 3D
一句话描述：在可交互的 3D 客厅里摆放家具、漫游参观
分类：创意工具
能力标签：3d, creative, interactive
主题色：#8B7355

【应用集市详情页信息】
副标题：AI 生成的低多边形室内场景
详细介绍：打开即可进入一间 cozy 风格的 3D 客厅。你可以拖拽旋转视角，点击家具查看名称，并切换日/夜灯光。适合作为 Instant OS 内置 3D 素材的展示与测试。
开发者：Instant OS
兼容性：Instant OS 浏览器环境
语言：简体中文

【3D 应用】
根据上方应用描述生成完整可玩的 3D 微应用，禁止仅地面+单一方块的敷衍演示。
- 从下方目录选取语义匹配的模型 url 搭建场景；须有真实交互（操控、点击、漫游、计分等）
- 可选：head 中加 <meta name="instant-app-tags" content="3d">，便于宿主注入 Three.js 运行时

【Three.js 模型资源目录】加载 GLTF 时只能使用下列 url，禁止编造路径：
格式：modelId | url | 名称 | 尺寸 | 关键词

摆放与比例规则：
- 坐标系：X 右、Y 上、Z 前；尺寸为包围盒 宽×高×深（米）
- 模型按 1:1 比例加载；除非用户明确要求缩放，否则不要设置 scale
- 加载后设置 position，家具/道具通常 y=0 让底面贴地
- 水平间距：相邻物体中心距离 ≥ (两者宽度之和)/2 + 0.3m
- 地面需用 PlaneGeometry 等铺地，大小覆盖全部物体并留 ≥1m 边距
- 带「摆放」字段的模型须按 hint 理解默认朝向；tile/linear/corner/junction/wall 按接口拼接
- 改变朝向用 object.rotation.y（弧度）；90° = Math.PI/2

■ KayKit 家具（低多边形卡通家具（KayKit），共 53 个）
- kaykit.armchair_pillows | /assets/3d/models/kaykit-furniture/armchair_pillows.gltf | 带靠垫扶手椅 | 尺寸 1.8 × 1.22 × 1.6 m | 扶手椅、armchair、pillow、靠垫
- kaykit.armchair | /assets/3d/models/kaykit-furniture/armchair.gltf | 扶手椅 | 尺寸 1.8 × 1.22 × 1.6 m | 扶手椅、armchair
- kaykit.bed_double_A | /assets/3d/models/kaykit-furniture/bed_double_A.gltf | 双人床 A | 尺寸 3.1 × 1 × 3 m | 床、bed、double
- kaykit.bed_double_B | /assets/3d/models/kaykit-furniture/bed_double_B.gltf | 双人床 B | 尺寸 3.1 × 1 × 3 m | 床、bed、double
- kaykit.bed_single_A | /assets/3d/models/kaykit-furniture/bed_single_A.gltf | 单人床 | 尺寸 1.6 × 1 × 3 m | 床、bed、single
- kaykit.bed_single_B | /assets/3d/models/kaykit-furniture/bed_single_B.gltf | 单人床 B | 尺寸 1.6 × 1 × 3 m | 床、bed、single
- kaykit.book_set | /assets/3d/models/kaykit-furniture/book_set.gltf | 一摞书 | 尺寸 0.78 × 0.5 × 0.36 m | 书、books
- kaykit.book_single | /assets/3d/models/kaykit-furniture/book_single.gltf | 单本书 | 尺寸 0.26 × 0.5 × 0.36 m | 书、book
- kaykit.cabinet_medium_decorated | /assets/3d/models/kaykit-furniture/cabinet_medium_decorated.gltf | 装饰中号柜 | 尺寸 2.04 × 1.83 × 1 m | 柜子、cabinet、decorated
- kaykit.cabinet_medium | /assets/3d/models/kaykit-furniture/cabinet_medium.gltf | 中号柜子 | 尺寸 2 × 1 × 1 m | 柜子、cabinet、storage
- kaykit.cabinet_small_decorated | /assets/3d/models/kaykit-furniture/cabinet_small_decorated.gltf | 装饰小柜 | 尺寸 1.05 × 1.62 × 1.1 m | 柜子、cabinet、decorated

…（省略 385 行模型目录，安装时实际 Prompt 包含全部 409 行）…
````

---

## 结构摘要

| 部分 | 所在消息 | 来源 |
|------|----------|------|
| 微应用生成器通用约束 | system | `generate-app-stream.ts` → `APP_BUILDER_PROMPT` |
| 3D 运行时 + 场景质量要求 | system | `buildApp3dSystemPromptExtension()` |
| 应用名称、描述、详情页 | user | `buildAppGenerationPrompt()` |
| 【3D 应用】+ 模型资源目录 | user | `buildApp3dUserPromptSection()` |

## 说明

- **无**通用「能力标签白名单 / 至少 2 个标签」要求；`3d` meta 标签可选，仅用于宿主注入 Three.js
- **无**重复的 Three.js 教程段落；运行时说明只在 system 出现一次（精简版）
- 模型目录只在 user 消息末尾出现一次
