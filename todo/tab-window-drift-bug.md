# Tab 键导致所有窗口「飘走」Bug 排查记录

> 记录日期：2026-08-21。状态：**未定位根因**，仅完成排除。复现条件存疑（用户自述只按 Tab 即可复现，未提供键盘事件取证）。

## 现象

一直按住 Tab 键时，所有窗口看起来「飘走」。用户未附实测细节，当前未知：
- 是按一次 Tab 飘一次，还是按住期间一直在飘；
- 按 Tab 时焦点所在应用/输入框；
- 是否已先进入 Flip3D 状态。

## 可能指向：Flip3D

系统里唯一让全部窗口改姿的效果是 Flip3D（仿 Vista Flip 3D：窗口收成卡片排 3D 扇面，切换时队头窗口以 160ms 飞出，`FLIP3D_FLIGHT_OUT_MS`）。

- 进入入口只有 3 个，均与键盘无关：
  1. 桌面空白**长按**（默认动作，`src/dock/dock-settings-storage.ts:93` `desktopHoldAction: 'flip3d'`）；
  2. 终端命令 `.flip3d`（`src/apps/terminal/terminal-repl-panel.tsx:554`）；
  3. URL 参数 `?flip3d=N`（`src/window/flip3d-query-bootstrap.tsx` 自动进入）。
- Flip3D 激活后键盘行为（`src/window/window-frame.tsx:600-625`）：仅方向键切换、Esc/Enter 退出，**没有 Tab**。

怀疑：用户可能已误入 Flip3D（长按桌面 / 跑过 `.flip3d` / URL 残留参数），按 Tab 无法退出（退出键是 Esc），故窗口一直保持扇面「飘走」观感。

## 已排除的假设（带证据）

1. **代码主动绑定 Tab → 窗口移动**
   全库搜 `key === 'Tab'` / `keyCode === 9` / `code === 'Tab'`：仅终端补全（`terminal-repl-panel.tsx:1081`、`terminal-panel.tsx:400`）与 Pages 表格（`pages-sheet-view.tsx:279`），均 `preventDefault` 且只影响输入框。OS/窗口层无 Tab 监听。

2. **浏览器原生 scrollIntoView 把离屏内容滚进视野**
   前提是存在可滚动的祖先容器，但滚动链全锁死：
   - `html/body/#app`：`overflow: hidden` + 100%（`src/global.css:22-35`）；
   - `.os-shell`：`overflow: hidden` + `height: 100%`（`src/os/os-shell.css:1-5`）；
   - `.window-manager`：`position: absolute; inset: 0`（`src/window/window-frame.css:1-5`）。
   因此即使有离屏元素被 Tab 聚焦，浏览器也找不到可滚动容器，视觉不可能移动。

3. **离屏渲染池被 Tab 拉出来**
   离屏渲染**确实存在**：`<WebViewOffscreenPool />`（`src/os/os-shell.tsx:61`）每个 live WebView unit 常驻 iframe，关窗不卸载。
   但该池 `position: fixed; left: 0; top: 0; width: 0; height: 0`（`src/apps/webview/webview.css:94-100`），其祖先也无任何可滚动容器——同上，无法被焦点滚动显示。

4. **CSS 焦点选择器触发 transform**
   全库 `.css` 无窗口层的 `:focus-within` / `:focus` transform 规则（命中项均在应用内部样式）。

## 待排查方向（需要复现取证）

- **首要**：复现时在控制台跑取证脚本，确认 Tab 到底触发了什么：

  ```js
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') requestAnimationFrame(() => {
      const el = document.activeElement
      console.log('focus ->', el.tagName, el.className,
        'scrollTop=', (document.scrollingElement || document.documentElement).scrollTop,
        'active rect=', el.getBoundingClientRect())
    })
  }, true)
  ```

  重点观察：`scrollTop` 是否恒 0（验证滚动理论）、焦点落在哪个元素、`window-manager` 是否出现 `window-manager--flip3d` class（`window-frame.tsx:698`，判断是否卡在 Flip3D）。

- 确认 Swvl）：按 Esc 是否立刻恢复布局（若是 → 处于 Flip3D，且按 Tab 退不出）。
- 确认按 Tab 时焦点所在应用（终端输入框、桌面搜索、或某 iframe 内），缩小按键被谁消费的排查范围。
- 后续如怀疑窗口坐标越界：`WindowState.x/y` 是否可能落在视口外（拖拽保存位置 + 浏览器窗口缩小的组合），窗口溢出 `.os-shell` 的 `overflow: hidden` 部分不可见也不可滚动。

## 备注

- 若用户自述「每按一次 Tab 窗口动一次」属实，且焦点在普通页面而非终端，则上述排除后只剩：Flip3D 残留态 + 其他键位误触，或浏览器扩展/系统层介入——前者可用 Esc 验证，后者需取证脚本输出确认。