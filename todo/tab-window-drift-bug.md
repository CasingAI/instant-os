# Tab 键导致所有窗口「飘走」Bug 排查记录

> 记录日期：2026-08-21；深挖更新：2026-08-25。状态：**已定位根因（静态证据链完整，待运行时取证最终确认）**。

## 现象

一直按住 Tab 键时，所有窗口看起来「飘走」（连同壁纸、菜单栏、程序坞整体位移，且松手后不回来）。

## 根因（2026-08-25 深挖结论）

**`overflow: hidden` 的容器仍然是滚动容器**——它只是不显示滚动条、拦截用户滚轮，但浏览器的**焦点滚动（顺序焦点导航 / focus() 触发的 scroll-into-view）照样会改写它的 `scrollTop` / `scrollLeft`**。此前排查记录里"滚动链全锁死，视觉不可能移动"的排除依据（假设 2）建立在错误前提上：`overflow: hidden ≠ 不可滚动`；真正不可被焦点滚动的是 `overflow: clip`。

完整机制链条（均有代码证据）：

1. **滚动容器**：`.os-shell` 是 `position: relative; overflow: hidden`（`src/os/os-shell.css:1-5`），它包住了菜单栏、桌面、**全部窗口**、程序坞（`src/os/os-shell.tsx:53-66`）。`html/body/#app` 同为 `overflow: hidden`（`src/global.css:22-35`）。
2. **溢出来源**：`.window-manager` 只有 `position: absolute; inset: 0`，**自身没有 overflow**（`src/window/window-frame.css:1-5`）；窗口 `.window-frame` 是绝对定位、`left/top = WindowState.x/y`（`window-frame.tsx:472-475`）。任何窗口探出视口右/下缘的部分，其溢出直接传导给 `.os-shell`，使 `scrollWidth/scrollHeight` 超过视口。
3. **越界窗口是常态而非异常**：拖拽钳制 `clampFloatingPosition` 只要求窗口保留 **48px** 可见（`src/window/window-snap.ts:99-103`，`minVisible = 48`）——把窗口拖到屏幕右缘/底缘是日常操作；`moveWindow` 本身不做任何钳制（`os-context.tsx:1204-1212`）；`reflowWindows` 的全量适配只在浏览器 resize / 程序坞设置变化时触发（`os-context.tsx:1499-1501`）。
4. **越界处存在大量可聚焦元素**：每个有窗饰的窗口都渲染真实的 `<button>`（关闭/最小化/全屏，`window-frame.tsx:509-542`），加上各应用内部的输入框、按钮。窗口贴底时三个窗控按钮全部在折叠线下；窗口贴右时最小化/全屏按钮与整个内容区都在右缘外。
5. **Tab 触发**：焦点在桌面/body 上按 Tab，浏览器顺序焦点导航逐个聚焦上述按钮；焦点落到越界元素时，浏览器对 `.os-shell` 执行 scroll-into-view → **整个系统（壁纸 + 全部窗口 + 菜单栏 + 程序坞）平移**。菜单栏 `position: relative`（`menu-bar.css:2`）、程序坞 `position: absolute`（`dock.css:1-3`）都在 `.os-shell` 内，会一起飘走。
6. **按住 = 持续飘**：Tab 按键重复（约 30 次/秒）不断把焦点切到下一个越界元素，滚动持续跟进；松手后 `scrollTop/scrollLeft` 不会被任何代码复位（全库无 scroll 监听），位移**保留**直到刷新页面。

该机制完美解释"只按 Tab 即可复现、所有窗口一起飘、持续按住一直在飘、且不是 Flip3D（Esc 救不回来）"。

### 排除过程中确认的无辜者

- 桌面分页器 `.desktop__pager`（`overflow: hidden`）+ `.desktop__pages` 用 **transform** 平移（`desktop.css:20-32`）——transform 不产生可滚动溢出，桌面图标不贡献 `.os-shell` 的 scrollWidth。
- WebView 离屏池 `position: fixed; width/height: 0`——fixed 元素不参与祖先滚动溢出（与此前结论一致）。
- 桌面搜索只接受单字符键，Tab 不是触发键（`desktop-app-search.ts:115-119`）。
- 桌面翻页键盘导航只认方向键（`use-desktop-page-pager.ts:108-121`）。

## 与 Flip3D 假设的关系

Flip3D（扇面收拢）仍是另一种"全部窗口变位"的效果，但其进入入口只有三个且全与 Tab 无关：桌面空白**长按**（`dock-settings-storage.ts:93` 默认动作）、终端 `.flip3d`、URL 参数 `?flip3d=N`（`flip3d-query-bootstrap.tsx` 自动进入）；Flip3D 内键盘只认方向键与 Esc/Enter（`window-frame.tsx:600-625`）。本次根因**不需要** Flip3D 参与。二者可用下面方式区分：

| 观察 | 焦点滚动（本次根因） | Flip3D 残留 |
|---|---|---|
| 按 Esc 是否恢复 | 否（位移保留） | 是（立即收扇面） |
| 刷新页面是否恢复 | 是（scrollTop 归零） | 视 URL 参数是否残留 |
| `window-manager--flip3d` class | 无 | 有（`window-frame.tsx:698`） |

## 待办：运行时取证（复现时在控制台跑）

```js
const shell = document.querySelector('.os-shell')
console.log('before: shell scroll', shell.scrollTop, shell.scrollLeft,
  'scrollSize', shell.scrollWidth, shell.scrollHeight)
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return
  requestAnimationFrame(() => {
    const el = document.activeElement
    console.log('focus ->', el.tagName, el.className,
      'shell scrollTop/Left =', shell.scrollTop, shell.scrollTop && 'DRIFT!' || shell.scrollLeft,
      'active rect=', el.getBoundingClientRect().toJSON())
  })
}, true)
```

预期：按 Tab 后 `shell.scrollTop` 或 `scrollLeft` 变为非 0、`activeElement` 是某窗口的窗控按钮或应用内控件、其 `rect` 原本在视口外。若如此，根因坐实。

## 修复建议（未实施）

1. **首选：把锁滚动的容器从 `overflow: hidden` 改为 `overflow: clip`**——`clip` 盒子根本不是滚动容器，焦点滚动无从下手，属于规范层面的正解：
   - `src/os/os-shell.css` 的 `.os-shell`
   - `src/global.css` 的 `html, body, #app`
   - 浏览器支持：Chrome 90+ / Safari 16+ / Firefox 81+，与项目现有 CSS 基线一致。
   - 注意：改后这些容器的 `scrollTop` 不可再编程设置（当前无代码依赖）。
2. **纵深防御**：`os-shell.tsx` 的 `shellRef` 上挂 scroll 复位守卫（任何意外滚动立即归零），覆盖未来新增的隐藏滚动路径：
   ```ts
   useEffect(() => {
     const el = shellRef.current
     if (!el) return
     const reset = () => { el.scrollTop = 0; el.scrollLeft = 0 }
     el.addEventListener('scroll', reset)
     return () => el.removeEventListener('scroll', reset)
   }, [])
   ```
3. 可选：`clampFloatingPosition` 的 `minVisible = 48` 属于有意的"窗口可以探出屏幕"交互，不建议收紧；根因在滚动容器，不在窗口坐标。

## 历史排查记录（2026-08-21，保留供对照）

已排除的假设（带当时证据）：

1. **代码主动绑定 Tab → 窗口移动**：全库 `key === 'Tab'` / `keyCode === 9` 仅终端补全（`terminal-repl-panel.tsx:1081`、`terminal-panel.tsx:400`）与 Pages 表格（`pages-sheet-view.tsx:279`），均 `preventDefault` 且只影响输入框。（2026-08-25 复核：结论仍成立，且补充确认桌面搜索/翻页/菜单栏/模态层均不响应 Tab。）
2. **浏览器原生 scrollIntoView 把离屏内容滚进视野**：当时的排除理由是"滚动链全锁死"——**该前提有误**（`overflow: hidden` 仍是滚动容器），此假设实为本根因，见上文。
3. **离屏渲染池被 Tab 拉出来**：池为 `position: fixed; 0×0`，fixed 元素不参与祖先滚动溢出——结论仍成立（无辜）。
4. **CSS 焦点选择器触发 transform**：OS 层无 `:focus`/`:focus-within` 变换；程序坞放大仅 `:hover`（且带 `@media (hover:hover)` 门控），`button:focus-visible` 只有 outline（`global.css:56-59`）。结论仍成立。

当时的 Flip3D 怀疑（用户误入扇面态）保留为备选解释，但按"只按 Tab 即可复现"的自述，焦点滚动机制更贴合。
