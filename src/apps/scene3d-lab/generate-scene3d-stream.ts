import { extractHtmlFromAiText } from '../../ai/parse-json-response.ts'
import { mergeOpenAiConfig } from '../../ai/openai-config.ts'
import { getOpenAiClient } from '../../ai/openai-client.ts'
import {
  buildCatalogPromptSection,
  buildThreejsCatalogPromptSection,
} from '../../assets/3d/asset-catalog.ts'
import type { TokenUsageSnapshot } from '../browser/browser-token-usage.ts'
import {
  buildLiveTokenUsage,
  estimatePromptTokens,
  finalizeTokenUsage,
  type LiveTokenUsage,
} from '../browser/estimate-token-usage.ts'
import type { Scene3dRuntimeMode } from './scene3d-lab-prefs.ts'

const SCENE3D_COMMON_PROMPT = `你是 Instant OS 的 3D 场景生成器。
根据用户的场景描述，生成一个可在浏览器 iframe 内运行的 3D 页面。忠实还原用户意图，不要擅自把场景做成「演示级简版」。

运行环境：
- 页面渲染在 Instant OS 窗口内容区，已有标题栏，不要绘制额外窗口装饰
- 宿主已注入 import map（three、three/addons/）及内置 CC0 模型资源
- 禁止使用外部 CDN、fetch、图片 URL 或网络请求
- 禁止使用 alert/confirm/prompt

输出格式（严格遵守）：
1. 在输出 HTML 之前，先写出场景规划思考，放在 <!-- SCENE3D_THINKING --> 与 <!-- /SCENE3D_THINKING --> 之间（中文）。须包含：场景理解、选用的模型或几何体、参考目录尺寸与「摆放」字段后的 position/rotation 估算、道路/栅栏/墙体等拼接方案、地面大小与整体布局。
2. 思考完成后再输出完整 HTML 文档（用 \`\`\`html 围栏包裹）。思考段不会进入最终页面，但会保留在原始输出中供调试。

布局要求：
- 完整 <!DOCTYPE html> 文档，CSS 内联在 <style> 中
- html、body、#app（或你使用的根容器）margin:0;padding:0;width:100%;height:100%;overflow:hidden
- 3D 画布容器必须铺满整个视口

场景要求：
- 至少添加地面；大小须容纳全部物体（参考目录中的模型尺寸）
- 摆放数量与复杂度应匹配用户描述：客厅/卧室通常 8～15 个物件，餐厅/街道/基地可更多；不要为了省事只放两三个
- 用目录里的「尺寸」计算 position，保持合理间距；可加墙体、栅栏、基元等丰富空间层次
- 选模型时参考尺寸比例：碗碟 < 0.5m，家具 0.5–2.5m，建筑/结构 3–10m
- 默认 scale=1，不要随意缩放；只有用户明确要求「放大/缩小」时才用 scale
- 相机由 OrbitControls 控制，用户可拖拽旋转
- 中文 UI 可选：在角落用 HTML 叠加简短标题（不要用全屏遮罩）`

const INSTANT3D_RUNTIME_SECTION = `【当前运行时：Instant3D】
使用宿主注入的 Instant3D API 加载内置模型与几何基元，不要自己从零搭建渲染管线。

Instant3D API：
1. await Instant3DReady  // 等待运行时就绪
2. const scene = Instant3D.createScene(containerElement)
3. await Instant3D.addModel(scene, modelId, options?)
4. Instant3D.addPrimitive(scene, type, options?)

options 字段：
- position: [x, y, z]  默认 [0,0,0]
- rotation: [x, y, z]  弧度，默认 [0,0,0]；plane 已默认水平铺地
- scale: number 或 [x, y, z]
- color: CSS 颜色（仅 primitive）
- width / height / depth / radius 等（仅 primitive）

modelId 与 primitive type 只能使用目录中列出的值，禁止编造。

推荐结构：
<body>
  <div id="app"></div>
  <script type="module">
    await Instant3DReady;
    const container = document.getElementById('app');
    const scene = Instant3D.createScene(container);
    // Instant3D.addPrimitive(scene, 'plane', { width: 16, depth: 14, color: '#9aa5b1' });
    // await Instant3D.addModel(scene, 'kaykit.chair_A', { position: [0, 0, 0] });
  </script>
</body>`

const THREEJS_RUNTIME_SECTION = `【当前运行时：Three.js 直接模式】
自行用 Three.js 搭建完整渲染管线，使用 GLTFLoader 加载目录中的模型 url。

必须 import（import map 已注入）：
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

须自行实现：
- THREE.Scene、PerspectiveCamera、WebGLRenderer（antialias，铺满容器）
- AmbientLight + DirectionalLight
- OrbitControls（enableDamping）
- window resize 时更新 camera.aspect 与 renderer.setSize
- renderer.setAnimationLoop 或 requestAnimationFrame 渲染循环

加载模型：
- 只能使用目录中列出的 url 字符串，禁止编造路径
- const gltf = await new GLTFLoader().loadAsync(url)
- const model = gltf.scene；设置 position / rotation / scale 后 scene.add(model)

几何体：可用 THREE.BoxGeometry、SphereGeometry、CylinderGeometry、PlaneGeometry 等补充场景

推荐结构：
<body>
  <div id="app"></div>
  <script type="module">
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
    import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
    // 搭建 scene / camera / renderer / lights / controls ...
    // await loader.loadAsync('/assets/3d/models/...');
  </script>
</body>`

export function buildScene3dBuilderPrompt(runtimeMode: Scene3dRuntimeMode): string {
  const runtimeSection = runtimeMode === 'instant3d' ? INSTANT3D_RUNTIME_SECTION : THREEJS_RUNTIME_SECTION
  const catalogSection =
    runtimeMode === 'instant3d' ? buildCatalogPromptSection() : buildThreejsCatalogPromptSection()

  return [SCENE3D_COMMON_PROMPT, runtimeSection, catalogSection].join('\n\n')
}

export type Scene3dGenerationPhase = 'waiting' | 'generating'

export type Scene3dGenerationUpdate = {
  phase: Scene3dGenerationPhase
  progress: number
  textLength: number
  rawText: string
  html: string
  usage: LiveTokenUsage
  streamConnected?: boolean
}

export type Scene3dGenerationResult = {
  html: string
  rawText: string
  usage: LiveTokenUsage
}

export type Scene3dGenerationOptions = {
  runtimeMode: Scene3dRuntimeMode
}

const EXPECTED_MAX_CHARS = 14 * 1000
const PROGRESS_START = 10
const PROGRESS_CAP = 92

function pushUpdate(
  onUpdate: (update: Scene3dGenerationUpdate) => void,
  promptTokenEstimate: number,
  text: string,
  generating: boolean,
  usage: TokenUsageSnapshot | undefined,
) {
  const liveUsage = buildLiveTokenUsage(promptTokenEstimate, text, !usage)
  onUpdate({
    phase: generating ? 'generating' : 'waiting',
    progress: progressFromTextLength(text.length, generating),
    textLength: text.length,
    rawText: text,
    html: text.trim() ? extractHtmlFromAiText(text) : '',
    usage: liveUsage,
  })
}

function progressFromTextLength(textLength: number, generating: boolean): number {
  if (!generating) {
    return 0
  }
  if (textLength <= 0) {
    return PROGRESS_START
  }
  const ratio = Math.min(1, textLength / EXPECTED_MAX_CHARS)
  return PROGRESS_START + ratio * (PROGRESS_CAP - PROGRESS_START)
}

type OpenAIUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

function snapshotFromUsage(usage: OpenAIUsage | undefined): TokenUsageSnapshot | undefined {
  if (!usage) {
    return undefined
  }

  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
  }
}

export function buildScene3dUserMessage(userPrompt: string, runtimeMode: Scene3dRuntimeMode): string {
  const modeLabel = runtimeMode === 'instant3d' ? 'Instant3D' : 'Three.js'
  return `运行时：${modeLabel}\n\n用户场景描述：\n${userPrompt.trim()}`
}

/** 调试面板用：展示与 OpenAI API 一致的 system + user 消息全文。 */
export function formatScene3dOutboundPrompt(
  userPrompt: string,
  runtimeMode: Scene3dRuntimeMode,
): string {
  const systemPrompt = buildScene3dBuilderPrompt(runtimeMode)
  const userMessage = buildScene3dUserMessage(userPrompt, runtimeMode)
  return [
    '──────── system ────────',
    systemPrompt,
    '',
    '──────── user ────────',
    userMessage,
  ].join('\n')
}

export async function generateScene3dHtmlStreaming(
  userPrompt: string,
  onUpdate: (update: Scene3dGenerationUpdate) => void,
  options: Scene3dGenerationOptions,
): Promise<Scene3dGenerationResult> {
  const config = mergeOpenAiConfig()
  const client = getOpenAiClient(config)
  const model = config.defaultModel
  const systemPrompt = buildScene3dBuilderPrompt(options.runtimeMode)
  const userMessage = buildScene3dUserMessage(userPrompt, options.runtimeMode)
  const promptTokenEstimate = estimatePromptTokens(systemPrompt, userMessage)

  let text = ''
  let generating = false
  let usage: TokenUsageSnapshot | undefined
  let liveUsage = buildLiveTokenUsage(promptTokenEstimate, '')

  onUpdate({
    phase: 'waiting',
    progress: 0,
    textLength: 0,
    rawText: '',
    html: '',
    usage: liveUsage,
  })

  const stream = await client.chat.completions.create({
    model,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  })

  pushUpdate(onUpdate, promptTokenEstimate, text, false, usage)
  onUpdate({
    phase: 'waiting',
    progress: 0,
    textLength: 0,
    rawText: '',
    html: '',
    usage: buildLiveTokenUsage(promptTokenEstimate, '', true),
    streamConnected: true,
  })

  for await (const chunk of stream) {
    if (chunk.usage) {
      usage = snapshotFromUsage(chunk.usage)
    }

    const delta = chunk.choices[0]?.delta?.content ?? ''
    if (!delta) {
      continue
    }
    if (!generating) {
      generating = true
    }
    text += delta
    pushUpdate(onUpdate, promptTokenEstimate, text, true, usage)
  }

  if (!text.trim()) {
    throw new Error('AI 未返回任何 3D 页面内容')
  }

  liveUsage = finalizeTokenUsage(
    buildLiveTokenUsage(promptTokenEstimate, text, !usage),
    usage,
  )
  const html = extractHtmlFromAiText(text)
  const result: Scene3dGenerationResult = { html, rawText: text, usage: liveUsage }
  onUpdate({
    phase: 'generating',
    progress: 100,
    textLength: text.length,
    rawText: text,
    html,
    usage: liveUsage,
  })
  return result
}

/** 内置示例提示词，便于在实验室中快速测试素材目录。 */
export const SCENE3D_SAMPLE_PROMPTS = [
  '布置一个 cozy 客厅：沙发、茶几、落地灯和地毯，中间留 walking space',
  '做一个简单卧室：双人床、台灯、小柜子和一张椅子',
  '户外小场景：房子、两棵树、邮箱、长椅和地面',
  '办公室角落：桌子、两把椅子、书架和仙人掌盆栽',
] as const

export const SCENE3D_DEFAULT_PROMPT = SCENE3D_SAMPLE_PROMPTS[0]
