# three.js Editor 集成 Scene3D Lab（场景修理厂）规划

> 记录日期：2026-08-21。本文是讨论结论的存档，不是实施计划；动手前需按「待决策」一节拍板。

## 目标

把 three.js 官方 Editor（`three/examples/jsm/editor`，即 threejs.org/editor）接入 **Scene3D Lab**，作为它的「场景修理厂」：AI 生成场景不满意？进编辑器手动拖方块、换材质、调灯光、摆位置，改完存回，形成「AI 生成 → 手动微调 → 预览 / 存档」闭环。

明确不做：不把它做成独立的第三方外链应用；它是 Scene3D Lab 的一个编辑视图，与生成/预览共用同一存档。

## 现状（已核实）

- Scene3D Lab（`src/apps/scene3d-lab/`）让 AI 流式生成 three.js HTML：`generate-scene3d-stream.ts` 出 HTML，`extract-scene3d-html.ts` 从流中提取，`writeHtmlToIframe` + `injectScene3dBridge` 注入预览 iframe。
- `injectScene3dBridge`（`src/assets/3d/inject-scene3d-bridge.ts`）注入 importmap：`three` → `/vendor/three/three.module.js`、`three/addons/` → `/vendor/three/examples/jsm/`，并阻止触控板手势；支持 `absoluteAssetUrls` 走 Blob 进程隔离。
- 存档格式 `Scene3dLabArchive`（`scene3d-lab-storage.ts`）：`{ id, title, prompt, html, rawText, savedAt, usage }`，上限 40 条，`isValidArchive` 逐字段校验。
- `scripts/vendor-three.sh` 只拷了 `three.module.js`、`three.core.js`、GLTFLoader、OrbitControls、utils（examples/jsm 全量）。
- `three: ^0.184.0` 已在 package.json（Editor 属于这个包的 examples，不改依赖）。
- 系统已有 iframe 应用桥基建（`src/apps/generated/inject-generated-app-*-bridge.ts`）：files / storage / ai / terminal / heartbeat / error，全部是「往 `<head>` 注入一段 `<script>`，用 postMessage 与宿主 RPC」的模式，与 `injectScene3dBridge` 同构。
- 多窗口由 OS 窗口层决定（`src/os/single-window.ts`），与 iframe 与否无关。

## 承载方式（结论）

**iframe + importmap 沙箱，嵌入 Scene3D Lab 内部**，复用 `injectScene3dBridge` 同款模板注入套路。理由：

- 与现有预览 iframe 模式一致，工程增量最小；
- Editor 自带的全局样式 / DOM 单例与 OS 样式天然隔离，关掉即卸载；
- 体积不进主 bundle、按需加载，符合项目「独立 realm + 按需 + 可卸载」的一贯策略。
- 代价：编辑器与系统的文件/存储互操作需要 postMessage 桥（MVP 阶段可先不做，直接读写 localStorage / 内存，够用）。

## 技术要点

### 1. vendor 扩展（必经步骤）

`vendor-three.sh` 需把 `examples/jsm/` 扩到 Editor 依赖树（参照官方 `examples/editor.html` 的 import）：

- `examples/jsm/editor/` 整目录（Editor.js / History / Player / Resizable / Sidebar / Toolbar / Viewport / commands / config / operators / ...）
- `examples/jsm/controls/TransformControls.js`（Editor 视口必用，现在没有）
- `examples/jsm/objects/*`（Sky、Reflector、Water、LightningStorm 等面板可加项）
- `examples/jsm/loaders/*`（GLTF/FBX/OBJ/PLY/STL/etc 导入源；GLTFLoader 已有）
- `examples/jsm/libs/*`（draco 等 GLTF 解压依赖）
- `examples/jsm/helpers/*`、`examples/jsm/math/*` 等散依赖

建议先按「Editor.js 的 import 闭包」自动收集（脚本扫一遍 import 语句），而不是手抄清单。体积由 iframe 按需承担，不在主包。

### 2. HTML → Editor JSON（生成场景进编辑器）

AI 产出的是**程序化 HTML**（`new THREE.Scene()` …），Editor 要的是 **JSON 场景**。转换路径：

- 在隐藏/预览 iframe 里执行生成 HTML（已有 `writeHtmlToIframe` + importmap 桥）；
- 执行完成后拿到 `scene` 对象，调 `renderer` 上下文的 `scene.toJSON()` 导出 JSON；
- 把 JSON 送入编辑器 iframe，`Editor.loadJSON()` 载入。

关键假设：生成 HTML 里场景对象需要能从外面拿到（提示词约定暴露 `window.scene` / `scene`，或注入一段提取脚本）；若拿不到，退化用「编辑器里重新搭」+ 提示词约束生成代码可序列化。

### 3. Editor JSON → 预览 HTML（编辑完导回）

- Editor 侧 `Editor.toJSON()` 导出 JSON；
- 宿主用一个「JSON 播放器」HTML 模板（类似 `build-scene3d-preview-html.ts` 的 previewShell：标准场景、相机、灯光、光源 + `ObjectLoader` 加载 JSON）渲染回去；
- 走既有 `injectScene3dBridge` 注入 importmap，进预览 iframe。

### 4. 存档演进

`Scene3dLabArchive` 增加可选字段 `sceneJson?: string`（Editor JSON）。旧存档校验保持兼容（`isValidArchive` 不要求该字段）；有 sceneJson 的存档「编辑场景」直接进编辑器，无的走第 2 节提取。

### 5. 桥（分批做）

- MVP：编辑视图内直接读写（内存 / localStorage），不需要宿主桥。
- 深化：复用 `inject-generated-app-files-bridge.ts` 模式做一个 editor 专用桥（导出 `.scene.json` 到 VFS、从文件 App 打开）。

## 分期规划

### MVP：场景修理厂 v1

1. `vendor-three.sh` 扩展 Editor 依赖树（脚本自动收集 import 闭包）。
2. `build-three-editor-html.ts`（仿 `build-scene3d-preview-html.ts`）：生成 Editor HTML，head 注入 importmap，module script 实例化官方 Editor 并挂载。
3. Scene3D Lab 加「编辑场景」按钮 → 提取当前 HTML 的 `scene.toJSON()` → iframe 打开编辑器载入。
4. 「完成编辑」→ `Editor.toJSON()` 导出 → JSON 播放器模板 + `injectScene3dBridge` 回预览 iframe。
5. 存档增加 `sceneJson`（含从旧存档 HTML 提取的路径）。

### 深化

- Editor 专用 postMessage 桥：`.scene.json` 导出到 VFS / 从文件 App 双击打开。
- 模型导入（系统内 3D 资产目录喂给 Editor 的 AddMenu）。
- 动画片段编辑（Editor 自带 Animation 面板，确认其在 iframe 中的可用性）。

### 远期

- 编辑器面板拆多窗口（Editor 官方是单页多面板，分离要改造）。
- 「编辑 → 让 AI 继续改」的双向会话；AI 辅助微调（对 sceneJson 直接做结构化 diff 修改）。
- 独立「3D 场景」文件格式注册（`.scene.json` 进入系统文件类型）。

## 待决策

- [ ] 入口形态：「编辑场景」按钮进独立 iframe 视图 vs Scene3D Lab 内部 tab 切换。
- [ ] HTML→JSON 提取的兜底策略：提示词约束暴露 `window.scene` vs 注入提取脚本，两者都要的话先做哪个。
- [ ] 存档格式：`sceneJson` 是否直接内联在 `Scene3dLabArchive`（体积顾虑：JSON 可能数百 KB，40 条上限需重新评估）。
- [ ] vendor 范围：最小 import 闭包 vs 直接整拷 examples/jsm（省事但 volume 翻倍）。
- [ ] MVP 是否需要文件桥：先内存读写即可，还是要一步到位 VFS。