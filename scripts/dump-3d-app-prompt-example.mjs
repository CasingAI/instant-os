/**
 * 生成应用商店 3D 微应用的 Prompt 示例，写入项目根目录 Markdown。
 * 用法：node scripts/dump-3d-app-prompt-example.mjs
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (path) => pathToFileURL(join(root, path)).href

const { buildAppGenerationPrompt } = await import(src('src/apps/appstore/build-app-generation-prompt.ts'))
const {
  buildApp3dSystemPromptExtension,
  resolveApp3dGenerationOptions,
} = await import(src('src/apps/appstore/app-3d-generation-prompt.ts'))

const APP_BUILDER_PROMPT = `你是 Instant OS 的微应用生成器。
根据应用名称、描述及可选的应用集市详情页信息，生成一个完整、可交互的单页 HTML 应用。

运行环境：应用内容渲染在 Instant OS 窗口的内容区内，窗口本身已有标题栏、圆角、边框和外阴影。
因此你生成的是「窗口内的原生应用界面」，不是桌面上的独立小组件卡片。

必须只返回 HTML 文档（可用 \`\`\`html 包裹），不要额外说明。
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
- 背景色或渐变应铺满整个视口，与 Instant OS 窗口内容区协调（如浅灰或与应用主题一致），不要留一圈未使用的画布边距`

const sampleListing = {
  slug: 'cozy-living-room-3d',
  name: '温馨客厅 3D',
  description: '在可交互的 3D 客厅里摆放家具、漫游参观',
  category: '创意工具',
  iconEmoji: '🛋️',
  themeColor: '#8B7355',
  tags: ['3d', 'creative', 'interactive'],
}

const sampleDetail = {
  tagline: 'AI 生成的低多边形室内场景',
  longDescription:
    '打开即可进入一间 cozy 风格的 3D 客厅。你可以拖拽旋转视角，点击家具查看名称，并切换日/夜灯光。适合作为 Instant OS 内置 3D 素材的展示与测试。',
  developer: 'Instant OS',
  compatibility: 'Instant OS 浏览器环境',
  language: '简体中文',
}

const { physicsEnabled } = resolveApp3dGenerationOptions(sampleListing, sampleDetail)
const systemPrompt = `${APP_BUILDER_PROMPT}\n\n${buildApp3dSystemPromptExtension(physicsEnabled)}`
const userPrompt = buildAppGenerationPrompt(sampleListing, { detail: sampleDetail })

const CATALOG_HEADING = '【Three.js 模型资源目录】'
const catalogStart = userPrompt.indexOf(CATALOG_HEADING)
let userPromptDisplay = userPrompt
let catalogNote = ''

if (catalogStart !== -1) {
  const beforeCatalog = userPrompt.slice(0, catalogStart).trimEnd()
  const catalogSection = userPrompt.slice(catalogStart)
  const catalogLines = catalogSection.split('\n')
  const previewLineCount = 24
  const preview = catalogLines.slice(0, previewLineCount).join('\n')
  const omitted = catalogLines.length - previewLineCount
  catalogNote = `\n> 完整目录共 ${catalogLines.length} 行；下方 user 消息中已省略 ${omitted} 行模型条目。\n`
  userPromptDisplay = `${beforeCatalog}\n\n${preview}\n\n…（省略 ${omitted} 行模型目录，安装时实际 Prompt 包含全部 ${catalogLines.length} 行）…`
}

const fence = '````'

const markdown = `# 应用商店 3D 微应用 Prompt 示例

> 由 \`scripts/dump-3d-app-prompt-example.mjs\` 自动生成，内容与安装时的 OpenAI 请求一致。
> 示例应用：**${sampleListing.name}**（tags: ${sampleListing.tags.join(', ')}）

## 判定逻辑

以下条件任一成立即走 3D 分支：

- listing tags 或名称/描述推断含 \`3d\`
- 更新时现有 HTML 含 Three.js / GLTFLoader 标记

本示例未触发物理分支（描述中无「重力/碰撞」等词）。

---

## System 消息

${fence}text
${systemPrompt}
${fence}

---

## User 消息
${catalogNote}
${fence}text
${userPromptDisplay}
${fence}

---

## 结构摘要

| 部分 | 所在消息 | 来源 |
|------|----------|------|
| 微应用生成器通用约束 | system | \`generate-app-stream.ts\` → \`APP_BUILDER_PROMPT\` |
| 3D 运行时 + 场景质量要求 | system | \`buildApp3dSystemPromptExtension()\` |
| 应用名称、描述、详情页 | user | \`buildAppGenerationPrompt()\` |
| 【3D 应用】+ 模型资源目录 | user | \`buildApp3dUserPromptSection()\` |

## 说明

- **无**通用「能力标签白名单 / 至少 2 个标签」要求；\`3d\` meta 标签可选，仅用于宿主注入 Three.js
- **无**重复的 Three.js 教程段落；运行时说明只在 system 出现一次（精简版）
- 模型目录只在 user 消息末尾出现一次
`

const outPath = join(root, '3d-app-prompt-example.md')
writeFileSync(outPath, markdown, 'utf8')
console.log(`Wrote ${outPath}`)
