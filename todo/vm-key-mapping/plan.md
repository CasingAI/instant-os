# 虚拟机按键映射（Key Mapping）设计与实施计划

日期：2026-08-27 · 分支：experimental

## 1. 目标与动机

Mac 键盘操作 Windows 客机时键位错位：肌肉记忆的 ⌘C 应该变成 Ctrl+C；
Mac 笔记本没有 Forward Delete / Insert / PrintScreen 等键。本功能允许用户为每台虚拟机
配置「物理键 → 目标键」的改写规则，宿主在把键盘事件注入客机之前原地翻译，
让 Mac 键盘在客机里表现得像一块 PC 键盘。

核心交互（按用户原话）：**按一个键 → JS 识别出这是哪个键 → 再让用户按另一个键
（或从常用键里选一个）→ 之后在虚拟机里按前者的效果就是后者。**

## 2. 现状摸底（为什么这样做是安全的）

- 宿主键盘路径：`virtual-machine-app.tsx` 窗口级 `keydown/keyup`（capture）→
  `guestKeyboardFromEvent()` 组装 `InstantVmKeyboardMessage` →
  `pool.sendKeyboard(displayedId, msg)` postMessage 进跨域 iframe。
  客机运行时在独立源（另一仓库），本仓库只管宿主侧。
- **注入点选在 `guestKeyboardFromEvent` 这一层**：纯宿主侧改写，不动协议、不动运行时、
  不动 v86。设置对话框打开期间键盘本就不转发给客机，捕获界面不会把按键漏进客机。
- 消息字段与真实 Chrome KeyboardEvent 完全一致（`virtual-machine-send-keys.ts` 已验证
  该约定可用于合成序列）。修饰键位遵循 UI Events 规范：修饰键自身 keydown 带自己的位、
  keyup 时该位已复位——现有 `buildKeyboardSequence` 测试注释里已有定论。
- 「发送按键」预设菜单（Ctrl+Alt+Del 等）是显式意图注入，**不经过映射**，保持原样。

## 3. 功能设计

### 3.1 数据模型（每台虚拟机独立）

```ts
type VmKeySpec = {
  key: string      // 'Control' / 'c' / 'F5' …
  code: string     // 'ControlLeft' / 'KeyC' / 'F5'（布局无关的物理身份）
  keyCode: number  // 17 / 67 / 116（v86 走的码值）
  location: number // 0 标准 / 1 左 / 2 右
}
type VmKeyMapping = { from: VmKeySpec; to: VmKeySpec }
```

设置新增两个成员（`VirtualMachineSettings`）：

- `keyMappings: VmKeyMapping[]`，默认 `[]`（对所有存量用户零行为变化）
- `keyMappingEnabled: boolean`，默认 `true`（总开关，方便临时停用不清空规则）

规则：以 `event.code` 为物理身份（布局无关、位置确定）；`code` 为空的事件不做映射。
上限 24 条。同一来源键只允许一条（新加覆盖旧的）；来源 === 目标时拒绝；不同来源指向
同一目标允许。不做链式映射（A→B、B→C 时按 A 只会变 B）。

### 3.2 翻译算法（`VmKeyboardTranslator`）

关键难点是**修饰键位**：把 ⌘→Ctrl 后，⌘C 必须以 `ctrlKey:true, metaKey:false` 进客机，
而不是只改被按下那一个键的四个字段。所以：

1. 维护「按住的物理 code 集合」：down 入集、up 出集；窗口失焦 / 释放键盘捕获 /
   切换显示的虚拟机时清空（防漏 keyup 造成粘键位）。
2. 每条转发消息的四个修饰位从**翻译后的按住集合**重算（与 `modifierStateOf` 同构）：
   集合里每个物理 code 先查映射表决定它算哪个修饰键，再 OR 出四个位。
   - 修饰键自身 keydown：入集后重算 → 自己的位自然为 true ✔
   - 修饰键自身 keyup：出集后重算 → 位自然为 false（符合 UI Events）✔
3. 被按下键本身的 `key/code/keyCode/location` 查表整体替换；查不到原样透传。
4. `repeat` 透传；映射表为空时整体旁路（字节级保持现状行为）。

例：⌘ 与 Ctrl 互换（MetaLeft↔ControlLeft）后按 ⌘C：
⌘↓ → `Control ctrlKey:true`；C↓ → `c ctrl:true meta:false`；C↑、⌘↑ 对称。客机看到标准 Ctrl+C。

### 3.3 交互与 UI（设置 → 外设 → 键盘）

遵循设置对话框既有结构（左设备列表 + 右参数面板），全部落在「键盘」面板：

- 保留现有「键盘」开关；新增「按键映射」开关行 + 说明文字（保存后立即生效，
  含运行中的虚拟机——纯宿主侧改写，无风险）。
- **映射列表**：每行 `来源键 → 目标键`（Mac 风格标签：左 Command ⌘、Option ⌥ …）+「移除」。
- **添加映射**：面板内两步捕获（不用嵌套弹窗，轻量）：
  1. 「按下要改写的键」——键盘捕获，Esc 取消；
  2. 显示已捕获键，「按下目标键，或从下面选一个」——再按一次键，或点常用键快选。
     快选：Ctrl / Alt / Win / Delete / Insert / Home / End / PageUp / PageDown /
     PrintScreen / Pause / Menu（Mac 缺的键）。
  - 捕获期间 `preventDefault + stopPropagation`（capture 层），不会误触桌面搜索、
    ⌘N 等全局快捷键；说明文案提示 Fn 键浏览器捕获不到。
- **预设**（一键加一组，同来源覆盖）：
  - 「⌘ 当 Ctrl 用」：MetaLeft→ControlLeft、MetaRight→ControlRight
  - 「⌘ 与 Ctrl 互换」：上述 + ControlLeft→MetaLeft、ControlRight→MetaRight
    （Parallels 默认行为，Mac 肌肉记忆直迁）

### 3.4 持久化与生效链路

- store：`normalizeVirtualMachineSettings` 增加映射归一化（字段类型校验、
  去重、截断到上限），坏条目丢弃，整体字段缺失回落空数组。
- 保存设置 → store 写入 → 订阅刷新 `machines` → 转发路径经 ref 读最新映射，
  **运行中的虚拟机即刻生效**（与 pointerMode 的即时套用同档待遇）。

## 4. 实施步骤（全自动执行）

1. `virtual-machine-keymap.ts`：键位规格表（修饰键/Delete/Insert/Home/End/PageUp/Down/
   PrintScreen/Pause/ScrollLock/Menu/Backspace/CapsLock 等 + Key*/Digit*/F1-F12 派生）、
   `vmKeySpecLabel()`（Mac 味标签）、`vmKeySpecFromKeyboardEvent()`、
   `compileVmKeyMappings()`、`VmKeyboardTranslator`、`normalizeVmKeyMappings()`。
2. `virtual-machine-types.ts`：类型 + 常量（`VM_KEY_MAPPINGS_LIMIT`、默认值）。
3. `virtual-machine-config.ts`：默认值、`settingsFromRecord`。
4. `virtual-machine-store.ts`：归一化接入。
5. `virtual-machine-app.tsx`：键盘 effect 内换用翻译器；ref 提供最新映射；
   blur / displayedId 变化时 `translator.reset()`。
6. `virtual-machine-settings-dialog.tsx`：键盘面板 UI（列表 + 两步捕获 + 快选 + 预设）。
7. `virtual-machine.css`：`virtual-machine-settings__keymap-*` 样式（沿用面板变量与视觉）。
8. 测试（node --experimental-strip-types 脚本，仓库惯例）：
   - `virtual-machine-keymap.test.ts`：空表旁路逐字段相等；单键映射；互换组合的
     down/up 全序列修饰位；修饰键自身 keyup 位复位；非映射键在映射启用时的位重算；
     repeat；held 重置；keyFromEvent；标签；归一化（坏数据/去重/上限）。
   - `virtual-machine-store.test.ts` 增补 keyMappings 归一化用例。
   - package.json 增加 `test:vm-keymap` 并挂进 `test:app-registry`。
9. 验证：新测试 + 既有 vm 相关测试 + `tsc -b --noEmit` + `vite build`。

## 5. 明确不做（本期边界）

- 不做链式映射、不做按客机应用自动切换的映射集、不做修饰键组合整体（如 ⌘C→Ctrl+C）映射。
- 不映射「发送按键」预设菜单（显式意图）。
- 不动 iframe 运行时与协议消息结构。
- Fn、电源等浏览器不上报的键无法捕获（文案说明）。
