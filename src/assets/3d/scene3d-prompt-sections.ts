import { buildThreejsCatalogPromptSection } from './asset-catalog.ts'

/** 应用商店 3D 微应用的唯一运行时说明；仅 buildApp3dSystemPromptExtension 使用。 */
export const APP_STORE_3D_RUNTIME_SECTION = `【3D 运行时】
宿主已注入 import map（three、three/addons/、@dimforge/rapier3d-compat）及内置 CC0 模型。
- 用 Three.js 搭建 Scene / Camera / Renderer / 灯光 / OrbitControls
- GLTFLoader 加载 user 消息中模型目录给出的 url；禁止 CDN 与外网
- html、body、#app：margin:0;padding:0;width:100%;height:100%;overflow:hidden`

/** 3D 实验室与应用商店 3D 生成共用的运行环境约束；仅 3D 实验室 buildScene3dPromptSections 使用。 */
export const SCENE3D_ENVIRONMENT_SECTION = `【3D 运行环境】
- 页面渲染在 Instant OS 窗口内容区，已有标题栏，不要绘制额外窗口装饰
- 宿主已注入 import map（three、three/addons/、@dimforge/rapier3d-compat）及内置 CC0 模型资源
- 禁止使用外部 CDN、fetch、图片 URL 或网络请求
- 禁止使用 alert/confirm/prompt
- html、body、#app（或根容器）margin:0;padding:0;width:100%;height:100%;overflow:hidden
- 3D 画布容器必须铺满整个视口`

/** 开启物理时追加到 buildScene3dPromptSections；供 3D 实验室 generateScene3dHtmlStreaming 的 system 提示。 */
export const THREEJS_PHYSICS_REF = `物理引用：import RAPIER from '@dimforge/rapier3d-compat'；await RAPIER.init()；new RAPIER.World({ x: 0, y: -9.81, z: 0 })；在 animationLoop 中 world.step() 并同步 dynamic 刚体到 mesh。`

/** Three.js 直连 API 说明；仅 3D 实验室 buildScene3dPromptSections 使用。 */
export const THREEJS_RUNTIME_SECTION = `【Three.js 运行时】
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

/** 3D 实验室专用输出格式（SCENE3D_THINKING + html 围栏）；仅 buildScene3dBuilderPrompt 使用。 */
export const SCENE3D_LAB_OUTPUT_FORMAT_SECTION = `输出格式（严格遵守）：
1. 在输出 HTML 之前，先写出场景规划思考，放在 <!-- SCENE3D_THINKING --> 与 <!-- /SCENE3D_THINKING --> 之间（中文，不要用 \`\`\`html 围栏包裹）。须包含：场景理解、选用的模型或几何体、参考目录尺寸与「摆放」字段后的 position/rotation 估算、道路/栅栏/墙体等拼接方案、地面大小与整体布局。
2. 思考完成后再单独输出完整 HTML 文档（仅用一个 \`\`\`html 围栏包裹，且围栏内必须是 <!DOCTYPE html> 开头的完整页面）。思考段不会进入最终页面，但会保留在原始输出中供调试。`

/** 应用商店 3D 微应用的内容质量要求；仅 buildApp3dSystemPromptExtension 使用。 */
export const APP_STORE_3D_SCENE_REQUIREMENTS_SECTION = `【3D 场景内容要求（应用商店）】
- 场景必须完整实现上方「应用名称 / 描述 / 详情」中的用途，禁止输出敷衍演示（如仅一块地面 + 一个方块/圆球）
- 优先用目录中的模型 url 搭建与主题匹配的丰富场景，几何基元仅作补充（地面、赛道、墙体等）
- 展示/漫游/室内类：通常摆放 6～15 个语义相关模型，参考目录尺寸计算 position，保持合理间距
- 游戏/竞速类：须有可玩性（操控、计分、障碍或赛道等），不是空场景放一两个物体
- 需要物理时用 Rapier 物理引擎；否则不必开
- 默认 scale=1；相机支持 OrbitControls 或应用所需的跟随/第一人称视角`

/** 3D 实验室场景布局与摆放要求；仅 buildScene3dBuilderPrompt 使用。 */
export const SCENE3D_LAB_SCENE_REQUIREMENTS_SECTION = `场景要求：
- 至少添加地面；大小须容纳全部物体（参考目录中的模型尺寸）
- 摆放数量与复杂度应匹配用户描述：客厅/卧室通常 8～15 个物件，餐厅/街道/基地可更多；不要为了省事只放两三个
- 用目录里的「尺寸」计算 position，保持合理间距；可加墙体、栅栏、基元等丰富空间层次
- 选模型时参考尺寸比例：碗碟 < 0.5m，家具 0.5–2.5m，建筑/结构 3–10m
- 默认 scale=1，不要随意缩放；只有用户明确要求「放大/缩小」时才用 scale
- 相机由 OrbitControls 控制，用户可拖拽旋转
- 中文 UI 可选：在角落用 HTML 叠加简短标题（不要用全屏遮罩）`

export type Scene3dPromptSectionOptions = {
  physicsEnabled?: boolean
  includeCatalog?: boolean
}

/** 组装通用 3D 提示段落（环境 + 运行时 + 可选物理 + 模型目录）。 */
export function buildScene3dPromptSections(options: Scene3dPromptSectionOptions = {}): string[] {
  const { physicsEnabled = false, includeCatalog = true } = options

  const sections = [SCENE3D_ENVIRONMENT_SECTION, THREEJS_RUNTIME_SECTION]
  if (physicsEnabled) {
    sections.push(THREEJS_PHYSICS_REF)
  }
  if (includeCatalog) {
    sections.push(buildThreejsCatalogPromptSection())
  }
  return sections
}

/** 3D 实验室 AI 生成的完整 system 提示；由 generate-scene3d-stream 调用。 */
export function buildScene3dBuilderPrompt(physicsEnabled = false): string {
  const labIntro = `你是 Instant OS 的 3D 场景生成器。
根据用户的场景描述，生成一个可在浏览器 iframe 内运行的 3D 页面。忠实还原用户意图，不要擅自把场景做成「演示级简版」。

布局要求：
- 完整 <!DOCTYPE html> 文档，CSS 内联在 <style> 中`

  const sections = [
    labIntro,
    SCENE3D_LAB_OUTPUT_FORMAT_SECTION,
    SCENE3D_ENVIRONMENT_SECTION,
    SCENE3D_LAB_SCENE_REQUIREMENTS_SECTION,
    ...buildScene3dPromptSections({
      physicsEnabled,
      includeCatalog: true,
    }).slice(1),
  ]

  return sections.join('\n\n')
}
