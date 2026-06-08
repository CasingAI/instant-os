import { APP_CAPABILITY_TAG_3D, appCapabilityTagsForPrompt } from './app-capability-tags.ts'
import { GENERATED_APP_TAGS_META } from '../generated/generated-app-tags.ts'

const APP_TAGS_SECTION = `【应用能力标签（必须，可多个）】
每个应用必须在 <head> 内声明能力标签，用于宿主注入对应运行时。所有标签写在同一个 meta 里，英文逗号分隔：
<meta name="${GENERATED_APP_TAGS_META}" content="3d,game,interactive">

白名单（只能使用以下值，禁止自造标签）：
${appCapabilityTagsForPrompt()}

规则：
- 必须至少 2 个标签，从白名单中选择
- 多个标签写在同一个 content 里，用英文逗号分隔
- 若主界面为 3D 场景，必须包含 3d
- 非 3D 应用不要加 3d

示例：
- 3D 游戏：content="3d,game,interactive"
- 工具应用：content="utility,productivity,persistent"
- 音乐玩具：content="audio,creative,interactive"`

const INSTANT3D_APP_SECTION = `【3D 应用规范（instant-app-tags 含 3d 时必须遵守）】
宿主会为带 3d 标签的应用注入 Instant3D 运行时与内置 CC0 模型库。你必须：
- 使用 Instant3D API，禁止自行 import three、禁止加载外部 CDN 或编造模型路径
- 3D 画布容器铺满视口；html、body、根容器 margin:0;padding:0;width:100%;height:100%;overflow:hidden
- 使用 <script type="module"> 并在其中 await Instant3DReady 后再初始化场景

Instant3D API：
1. await Instant3DReady
2. const scene = Instant3D.createScene(containerElement)
3. await Instant3D.addModel(scene, modelId, options?)
4. Instant3D.addPrimitive(scene, type, options?)

options：position [x,y,z]、rotation [x,y,z]（弧度）、scale、color（仅 primitive）、width/height/depth/radius 等
modelId 只能使用内置目录中的真实 id（如 kaykit.chair_A、tiny.couch），禁止编造。
几何基元 type 只能取：box、sphere、cylinder、plane。

推荐结构：
<body>
  <div id="app"></div>
  <script type="module">
    await Instant3DReady;
    const scene = Instant3D.createScene(document.getElementById('app'));
    Instant3D.addPrimitive(scene, 'plane', { width: 12, depth: 10, color: '#9aa5b1' });
    await Instant3D.addModel(scene, 'kaykit.chair_A', { position: [0, 0, 0] });
  </script>
</body>`

const INSTANT3D_CATALOG_SUMMARY = `【Instant3D 模型目录概要】
- kaykit.*：家具（椅、桌、床、沙发、柜等）
- tiny.*：家居外壳、篱笆、门窗、庭院物件
- kaykit-city.*：城市建筑、道路、车辆、路灯
- kaykit-restaurant.*：餐厅家具、厨具、食材
- kaykit-space.*：太空基地、着陆台、飞船
- kaykit-halloween.*：万圣节装饰
- 几何基元：box、sphere、cylinder、plane
只能使用上述前缀下的真实 modelId；摆放时家具/道具通常 position: [x, 0, z] 贴地，并铺一块 plane 作地面。`

export function buildGeneratedAppTagPromptSection(): string {
  return [APP_TAGS_SECTION, '', INSTANT3D_APP_SECTION, '', INSTANT3D_CATALOG_SUMMARY].join('\n')
}

export { APP_CAPABILITY_TAG_3D }
