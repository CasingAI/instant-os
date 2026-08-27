# 迭代三 · 边缘打磨（flip3d 打字唤起、焦点与回归）

迭代目标：把「打字即搜」扩展到 3D 切换窗口（flip3d）模式，补齐两类焦点/
时序边缘，最后全量回归（测试 + typecheck + 构建）。

## 1. flip3d 模式打字唤起搜索

现状：`desktopSearchArmed` 显式排除 `flip3dActive / flip3dRestoring`
（desktop.tsx L882-884），且 window-frame 的 flip3d 捕获处理器只拦方向键/
Escape/Enter，字符键事件本身能到达桌面监听——只是监听没注册。

**时序陷阱**：`exitFlip3d()` 会先 `raiseWindow`（立即设置 activeWindowId），
随后一帧才置 `flip3dActive=false / flip3dRestoring=true`（os-context.tsx
L429-466）。若打字时「退出 flip3d + 开搜索」同帧进行，下一渲染里
armed 变 false，L886-892 的 disarm effect 会把刚打开的搜索立刻关掉。

**方案**：armed 公式改为

```ts
const desktopSearchArmed =
  openFolderId === undefined &&
  (desktopRevealed || !hasFrontmostWindow || flip3dActive || flip3dRestoring || appSearchOpen) &&
  reorderSession === undefined
```

- `flip3dActive/flip3dRestoring` 成为**允许**项：3D 模式下打字合法唤起；
- `|| appSearchOpen`：搜索一旦打开就保持 armed（关闭只经 Escape / 点背景 /
  选中结果），彻底绕开「退出动画期间被 disarm 闪关」；这也对齐 macOS
  Spotlight 常驻语义。桌面翻页器（keyboardPageNavEnabled）不受影响，
  仍保持原条件（flip3d 期间箭头归 flip3d 捕获处理器）。

desktop.tsx 的 keydown / compositionstart 里：命中触发键时若 `flip3dActive`
则先 `exitFlip3d()` 再开搜索（deps 补上 flip3dActive、exitFlip3d）。

## 2. enterFlip3d 释放 DOM 焦点

与 reveal 同理：进入 flip3d 只动 WM 状态，DOM 焦点可能残留在原窗口输入框/
iframe 上，导致 flip3d 中打字被 blocked-target 拦截。`enterFlip3d`（os-context
L529）在 `setFlip3dActive(true)` 前 `releaseDomFocusToShell()`。

## 3. 已在前两迭代落地的边缘（本迭代只走查确认）

- 帮助 busy 挂起：pendingHelpQuery 在 busy 时等待，答完自动续发
  （help-app effect 依赖 busy）。
- 消费即去重：`setAppWindowHelpQuery('help', undefined)` 清状态，同词再带
  入会重新触发。
- IME：overlay 捕获键处理 `isComposing` 直接放行；桌面侧 compositionstart
  开空搜索；种子合成中为空串。

## 4. 回归与构建

- [x] `pnpm test:desktop-search`（16 组全绿）
- [x] 相邻套件抽查：`app-registry.test.ts`（14 组）、`single-window.test.ts`
      （5 组）全绿（结尾 IndexedDB 告警为 fake-indexeddb 测试环境拆卸噪音，
      与改动无关）
- [x] `pnpm typecheck` 通过
- [x] `pnpm build`：9.35s 构建成功。pinyin-pro 净增量实测 **467KB minified /
      149KB gzip**，进入 boot-shell（896KB raw / 336KB gzip），落在预设
      ≤150KB gzip 阈值内 → 维持静态导入（保证第一颗按键即可拼音匹配，
      无加载竞态）。备选方案（动态导入 + 到达后重算）已在权衡中否决；
      若未来要压首屏，可改动态导入并在 overlay 订阅就绪重渲染。

### 构建记录（2026-08-28）

- dist/assets/boot-shell-*.js：896.27 KB / gzip 336.02 KB（含 pinyin-pro）
- 无新增打包错误；既有 INEFFECTIVE_DYNAMIC_IMPORT 警告与本次改动无关。

### 会话内外部事件备注

迭代三进行中，用户在外部做了一次工作区快照提交 `3893b1a`（含本任务迭代一/二
全部产出 + 用户并行的 vm/ui-kit 工作）。迭代三改动（desktop.tsx、os-context
的 enterFlip3d 两行、本文档）保持未提交状态，交由用户后续处置。

## 5. 实施记录

- desktop.tsx：`exitFlip3d` 解构、armed 公式按计划替换、keydown 与
  compositionstart 在 flip3dActive 时先退出再唤起（deps 补齐）。
- os-context.tsx：`enterFlip3d` 在 closeOpenDesktopFolder 后调用
  `releaseDomFocusToShell()`。

## 5. 交付物清单（三个迭代合并）

- 修复：散开（reveal）与 flip3d 进入时释放 DOM 焦点 → 打字即搜全场景可用。
- 检索：拼音全拼/包含/简拼（sz、shzh、shzhi、sez…）+ id + 模糊子序列分层排序。
- 视觉：macOS 27 Golden Gate 风 Liquid Glass 面板、命中高亮、分组标签。
- AI 预设项：「让「帮助」AI 代办」常驻建议位，一键带预设问题自动发送。
- 文档：todo/desktop-spotlight-search/00-03 四份。
