# 压缩包扩展引擎调研与想法记录

> 记录日期：2026-08-21。本文是讨论结论的存档，不是实施计划；动手前需按「待决策」一节拍板。

## 目标

让压缩包实用工具支持更多格式（7z、rar、iso、xz、bz2、zst、cab 等），并为各格式画拟物图标（ISO 画成光盘，而不是在纸模板上写字）。

## 现状

- 压缩包实用工具（`archive-utility`）+ 文件 App 的压缩/解压共用 `src/archive/` 编解码层。
- 引擎：fflate（zip / gzip）+ 自写 ustar（tar）；ZIP 中文名做了 GB18030 兜底。
- 支持：`.zip`、`.tar`、`.tar.gz` / `.tgz`、单文件 `.gz`；写出只支持 zip / tar / tar.gz。
- 结构：Worker 内同步编解码，不碰 VFS；VFS 里压缩包就是普通二进制文件，不挂载。
- 双击打开走 `file-open-registry` 进压缩包工具；右键「归档」菜单由 `archive-utility-open.ts` 贡献。

## 核心想法：并行只读后端

- zip / tar / gz / tar.gz 继续走 fflate（保留 GB18030 文件名修补等既有调优）。
- 其余格式走第二后端（如 archive-wasm / 7z-wasm），**按需加载**，避免常驻体积。
- 写出 / 改归档（rewrite）仍只支持 zip / tar / tar.gz；新格式只读浏览 + 解压。
- 接入点：`src/archive/` 的 Worker 分流；扩展名注册（`archive-utility-format.ts`、`files-archive.ts` 的 `isArchiveFileName` 现在连 `.tar` 都不算，需统一）。

## 许可证（关键决策点，已逐个核实）

| 候选 | 许可证 | 能解 7z / RAR / ISO | 备注 |
|---|---|---|---|
| `@gcu/iso9660` | MIT | 仅 ISO | 最干净，但缺 7z / RAR |
| fflate（现用） | MIT | 仅 zip / gzip | 现状 |
| `7z-wasm`（use-strict） | LGPL-2.1 + unRAR 限制 | 全都能（7-Zip 全家桶） | LGPL 比 GPL 好过，但打包为静态集成时仍需按 LGPL 处理（可替换/声明） |
| `archive-wasm`（HeavenVolkoff，npm 上当前维护者是 spacedrive） | **GPL-3.0** | 全都能（RAR5 偏弱） | 传染性最强；libarchive 原生是 BSD，GPL 来自这个 npm 包装 |
| libarchive 原生 | BSD | ISO/Joliet/RockRidge、tar、zip 等（RAR5 弱） | 最干净但需自己编 WASM + 胶水，工程量大 |

结论：**npm 上没有「纯 MIT 且全格式」的现成引擎**。要全格式，只能在「接受 GPL/LGPL 的移植包」和「自己用 BSD 源编译」之间选。

## 运行时下载/扩展隔离思路（降低 GPL 传染）

把新引擎做成「用户显式安装的可选扩展」，而非内核内置：

1. 内核只定义接口与回调（如「未安装 XX 解压引擎」→ 引导去内置 NPM 安装）。
2. 用户**明确点击安装**才从内置 NPM 拉取；安装行为记录为「扩展」。
3. 引擎跑在独立 Worker / iframe，只通过消息 / Blob 交换字节；**不 import 进内核 bundle**、不写进内核缓存、可卸载。
4. 首次安装强制展示第三方许可（GPL/LGPL 声明）。
5. README 声明「Instant OS 本体不含 GPL 组件；解压扩展为可选第三方组件，独立分发」。

注意：只要引擎在**我们的进程/Worker 里**被 import、由我们的 UI 驱动，FSF 倾向视为「运行期并入」，GPL 义务仍可能回溯——所以「自动静默下载并绑进系统」不算清白；必须满足「用户主动装 + 可卸载可替换」。

## 技术要点

- `archive-wasm` 包结构不是「单个 wasm」：核心是 `src/wasm/libarchive.wasm`（约 558 KB），但必须配 `libarchive.mjs`（约 86 KB Emscripten 胶水）+ bridge/enums/errors/pointer 等运行时绑定才可实例化。可运行最小单元是「wasm + 胶水文件组」。
- 浏览器不能直接 import 裸 wasm；需 fetch 二进制 + `WebAssembly.instantiate`，或用胶水的 `locateFile`。
- 外部域加载 wasm 可行（unpkg / jsdelivr / GitHub raw 已开 CORS），但要满足：
  - CDN 返回 `Access-Control-Allow-Origin`；
  - 我们自身站点 `COEP: require-corp` + 被加载方 `CORP: cross-origin`（跨域隔离）；
  - 全站 https（混合内容）。
  - 更省心：wasm + 胶水从我们自己的域 / 我们 CDN 同源拉取。
- 体积参考：archive-wasm 整包解压约 750 KB；远低于 Cloudflare Pages 25 MiB 单文件线，但若走运行时下载扩展，与系统的 ort-wasm-gzip 策略（构建期 gzip、运行时解压）不同，不必套用。

## 图标想法

- zip：保留现有「折角纸 + 拉链」拟物。
- tar / tar.gz / tar.xz 等：捆扎卷 / 油布包（圆柱 + 绳）。
- 单流压缩（gz / xz / bz2 / zst）：压扁的气罐 / 胶囊。
- 7z / rar：金属提箱 / 锁扣箱，深色，无字母。
- **iso：光盘**——同心环 + 虹彩高光 + 中孔，圆形，脱离纸模板 viewBox。
- cab：文件柜抽屉。
- 不沿用「纸 + 四字母」的 Code 卡片体系来解释压缩包。

## 待决策

- [ ] 后端选型：GPL 的 archive-wasm / LGPL 的 7z-wasm / MIT 的 @gcu/iso9660（仅 ISO）/ 自编 BSD libarchive。
- [ ] 分发形态：内置进 Worker（接受许可证义务并声明） vs 扩展式运行时下载（用户显式安装）。
- [ ] 若走扩展：内置 NPM 的包形态（wasm + 胶水文件组如何打包、如何定位）。
- [ ] 新格式的魔数识别清单与扩展名注册表。
- [ ] 图标优先级：先 ISO 光盘，还是全套一次做。