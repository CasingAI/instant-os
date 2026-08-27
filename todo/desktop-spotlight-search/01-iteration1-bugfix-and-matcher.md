# 迭代一 · 散开打字失效修复 + 拼音/模糊检索内核

迭代目标：让「开窗 → 散开 → 打字」恢复搜索；把匹配从 startsWith/includes
升级为拼音（全拼/简拼）+ 英文模糊的分层排序。全部纯逻辑可单测，UI 不动。

## 1. Bug 修复：散开模式下打字无反应

**改动点**：`src/os/os-context.tsx` 的 `toggleDesktopReveal`（进入散开分支）。

```ts
const toggleDesktopReveal = useCallback(() => {
  if (desktopRevealedRef.current) { startDesktopRestore(); return }
  releaseDomFocusToShell()   // 新增
  setActiveWindowId(undefined)
  setDesktopRevealed(true)
}, [startDesktopRestore])
```

新增小工具 `releaseDomFocusToShell()`：若 `document.activeElement` 不是
body/html，则 `(activeElement as HTMLElement).blur()`。放在
`src/os/dom-focus.ts`（新文件，避免 os-context 直接摸 DOM 细节）。

**为什么这样就够了**：
- 焦点回 body 后，keydown target 是 body → `isDesktopAppSearchBlockedTarget`
  不再命中（INPUT/aria-modal 分支都不触发）；
- iframe 场景：blur 掉的是 iframe 宿主元素，后续 keydown 回到父文档派发；
- Dock 热区/桌面空白 tap 的 `preventDefault()` 保持不动（它防的是点击时
  抢焦点，进入散开的那一刻我们主动把焦点交还 shell，两者职责不冲突）。
- `desktopSearchArmed` 判定（desktop.tsx L877-884）在 reveal 态本就为 true
  （`desktopRevealed || !hasFrontmostWindow`），无需改。

**不做**：flip3d 中的打字（留给迭代三评估）；`desktopRevealRestoring` 相关。

## 2. 检索内核：`src/desktop/app-search-ranking.ts`（新文件）

### 2.1 拼音键（复用 vendor pinyin-pro）

```ts
import { pinyin } from '../apps/align/vendor/pinyin-pro/index.mjs'
```

- `getAppSearchPinyinKeys(name)`：模块级 `Map` 缓存；无 CJK 字符直接返回
  `undefined`（英文名走模糊匹配即可）。
- 产物：`{ full: 'xitongshezhi', initials: 'xtsz', syllables: ['xi','tong','she','zhi'] }`；
  `toneType:'none'`、`type:'array'`、`v:true`（ü→v 符合输入习惯）、
  `nonZh:'consecutive'`（英数段合并成一个 token，不参与简拼逐字对齐——
  简拼只对汉字音节有意义）。
- 音节数组与汉字的对应：`type:'all'` 结果含 `isZh` 与 `origin`，可精确标出
  哪些位置是汉字音节；简拼匹配只消费 `isZh` 的音节。

### 2.2 分层匹配（tier 越小越靠前）

| tier | 含义 | 例（目录含 设置/系统设置/天气/天气时钟/settings） |
| --- | --- | --- |
| 0 | 原名前缀（不区分大小写） | 「天」→ 天气、天气时钟 |
| 1 | 原名包含 | 「气时」→ 天气时钟 |
| 2 | 全拼前缀 | 「shezhi」→ 设置（shezhi 前缀命中） |
| 3 | 全拼包含 | 「tongshe」→ 系统设置 |
| 4 | 拼音简写：query 逐段匹配连续音节的前缀（每段 ≥1 字母） | 「sz」「shzh」「sez」「shzhi」→ 设置 |
| 5 | id 前缀（0）/包含（1），沿用现有 +2 基准 |
| 6 | 模糊子序列（fzf 风格）：原名与 id 任一命中 | 「stgs」→ settings |

- 简写匹配用 (音节下标, query 下标) 的记忆化 DFS；音节数 ≤ 8、query ≤ 24，
  开销可忽略。**同名命中多 tier 时取最小 tier**；tier 内按 `score` 排：
  前缀长度、连续段奖励、词首奖励；再按目录原顺序稳定排序。
- 模糊子序列评分：命中位置越靠前、连续命中越长分越高；仅接受纯 ASCII
  query（含汉字/空格的 query 跳过该 tier，避免中文误命中拼音串）。
- 现有 `filterDesktopAppSearchResults(entries, query)` **签名不变**，
  内部改调 `rankDesktopAppSearchEntry(entry, query)`；已有 4 个过滤断言
  （空前缀/前缀优先/名称与 id/无结果）必须原样通过。

### 2.3 高亮信息（为迭代二 UI 备好，本迭代先出数据）

`rankDesktopAppSearchEntry` 额外返回 `nameRanges: [start, end][]`
（原名上的命中字符区间）：tier 0/1 直接给出；拼音 tier 给出对应汉字区间
（音节→汉字位置映射）；模糊 tier 给出子序列位置；id tier 返回空区间。

## 3. 测试

新增 `src/desktop/app-search-ranking.test.ts`（node assert 风格）：

- 拼音键：`设置`→ full shezhi/initials sz；`天气时钟`→ tianqishizhong/tqsz；
  纯英文 `CatGPT` → undefined。
- 全拼：`shezhi`、`tianqi` 命中；`XTSZ` 大写不敏感。
- 简拼：`sz`/`shzh`/`shez`/`szi` → 设置；`xz`（跳音节）不命中。
- 模糊：`stgs` → settings；`天气q`（含汉字）不进模糊 tier。
- 排序：`天气` 时「天气」(t0) 在「天气时钟」(t0 但前缀更长/目录序) 前——
  与旧断言一致；`sz` 时 设置 排在 系统设置 前（同为简写，按首音节命中更早）。
- 原有 `desktop-app-search.test.ts` 全绿。

package.json 挂 `test:desktop-search`（两份测试串跑）。

## 4. 自验清单

- [x] `node --experimental-strip-types src/desktop/desktop-app-search.test.ts`（8 组全绿）
- [x] `node --experimental-strip-types src/desktop/app-search-ranking.test.ts`（7 组全绿）
- [x] `pnpm typecheck` 通过
- [x] Bug 修复代码走查：reveal 进入路径必经 `releaseDomFocusToShell`
      （os-context.tsx `toggleDesktopReveal` 进入分支第一行）

## 5. 实施记录（与计划的偏差）

- 计划中「shez / szi 属于简拼层」的示例有误：`shez` 是全拼 `shezhi` 的前缀，
  天然落在 tier 2（全拼前缀优先于简拼）；`szi` 无法拆成合法音节前缀组合
  （`zi` 不是 `zhi` 的前缀），不应命中。测试用例已按正确语义修正。
- `filterDesktopAppSearchResults` 直接委托新内核 `rankDesktopAppSearchResults`
  （计划中原留旧逻辑，实际删除旧 matchRank 逻辑，签名与旧行为兼容）。
