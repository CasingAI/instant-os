# 把 res-agent 装进 XP 镜像 —— 第三期照抄手册

> 配套：[todo/vm-resolution-auto-align/03-staged-delivery.md](../todo/vm-resolution-auto-align/03-staged-delivery.md)
> 第一、二期（AI 全程）已完成的部分见该文件；本文只覆盖第三期由你本人执行的 6 步。
> 预计 30~60 分钟（含装 VBEMP 驱动可能占掉大头）。

## 前置确认（AI 已就绪的东西）

| 项 | 状态 | 位置 |
|---|---|---|
| 客机代理源码 + 构建 | ✅ | `src/apps/virtual-machine/guest/res-agent/` |
| 产物校验单测（PE 头 / 导入表 / 体积） | ✅ | 同目录 `res-agent-binary.test.ts`，`pnpm test:vm-res-agent` |
| 部署规格 / 注册表脚本 | ✅ | 同目录 `guest-agent.spec.md`、`res-agent-install.reg.source` |
| **VM 运行时仓库补丁** | ✅ 已套上 | 落地清单见 [04-runtime-repo-patch.md](../todo/vm-resolution-auto-align/04-runtime-repo-patch.md)；`Instant-virtual-machine` 侧改动已由 AI 完成并通过两仓库测试 |

## 第 0 步：编译出 EXE

```bash
brew install zig        # 已装可跳过
cd ~/Documents/GitHub/instant-app
scripts/build-res-agent.sh
# → built: src/apps/virtual-machine/guest/out/res-agent.exe (9728 bytes 附近，产品态无弹框)
```

（或者 `make -C src/apps/virtual-machine/guest/res-agent`。单测 `pnpm test:vm-res-agent`
也会自己编两遍并校验 PE32 i386、版本 5.01、导入表白名单、<200KB。）

### 第 1 步：确认 EXE 路径

`src/apps/virtual-machine/guest/out/res-agent.exe`（构建产物统一落 `guest/out/`）

> 单实例：代理带互斥锁，重复双击会弹「res-agent is already running.」后退出，
> 不影响已在跑的那份（避免两个进程抢同一串口）。

### 第 2 步：拷进镜像（任选其一）

- A. 拖到 XP 桌面后放进 `C:\Tools\`（`C:\Tools` 不存在就在资源管理器里建）
- B. 烧进第二块盘镜像挂载
- C. 临时软盘 / U 盘镜像挂载复制

放别的目录也可以，但第 3 步注册表里的路径要跟着改。

### 第 3 步：注册开机自启

把下面内容存成 `install.reg`（XP 自带记事本即可），双击导入；或直接把仓库里的
`src/apps/virtual-machine/guest/res-agent/res-agent-install.reg.source` 复制过去改名。

```reg
Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run]
"ResAgent"="C:\\Tools\\res-agent.exe"
```

### 第 4 步：判定是否需要 VBEMP 驱动（00 §8.6）

启动 XP（先不用急着装驱动），设备管理器 → 显示卡，或直接做下面的实测：

1. 打开 显示属性 → 设置，看「屏幕分辨率」下拉里有哪几档。
2. 只有 640×480 / 800×600 这种浅表 = 标准 VGA 驱动 → **要装 VBEMP**；
   已经能列到 1280×960 及以上 → 跳过本步。

VBEMP 安装要点：到 vbemp 官网下载 NT4/X2K/XP 通用版（镜像内 IE 可能上不了网，
在宿主下载后按第 2 步的路子拷进去），安装时选「VESA VBE 3.0」适配器，
装完重启一次再重看分辨率列表。这份耗时最不可控（30~60 分钟），其余步骤都是分钟级。

### 第 5 步：通道层 + 功能层实测

> 通道载体 2026-08-26 起为 **COM1 串口帧**（ring3 IN 端口方案在真 XP 必崩，
> 证据与定案见 00 §8.3）。XP 自带串口驱动，无需安装任何东西；
> debug.exe 那套 `i E000` 手法作废——特权指令在用户态根本执行不了。

先开 instant-app 里这台虚拟机的设置，把「**分辨率自动对齐**」开关打开
（默认关；开着但代理没装的机器只是无效果，不报错——00 §6）。

**重要**：刷新浏览器页面让 runtime iframe 拿到新构建（运行时侧改动已由 AI
套入仓库，但页面跑的可能是旧 JS）。

通道层（最省事的验证路径）：

1. 先在 XP 里运行 res-agent.exe（还没注册自启的话双击即可），任务管理器应能看到进程。
2. 在浏览器控制台对 runtime iframe 发一次目标：

```js
// 找到虚拟机页面的 runtime window 后执行
runtimeWindow.postMessage({ type: 'instant-vm:set-resolution', requestId: 'test',
                            width: 1280, height: 960 }, '*')
```

3. XP 桌面应在 1~2 秒内切到 1280×960（每秒重播 + 收帧即应用）。

功能层（00 §9 前两条）：

1. 拖大拖小 instant-app 窗口约 ≥80px，停手 ~300ms；
   XP 桌面应在数秒内跟着变，画面 1:1 无 CSS 拉伸发虚。
2. 缩到一个很小的窗口（小于 640×480）：XP 保持当前分辨率不变（钳制生效）。

调试抓手（可选）：EXE 无窗口无控制台，日志走 `OutputDebugStringA`
（打开 COM1 失败/读错误/越界拒收都会留一行），XP 里装个 DebugView 就能看；
没装的话直接看桌面效果即可。

### 第 6 步：回报结果

告诉 AI「通过」还是「卡在哪一步」。

## 连续自启稳定性（验收 03 §4.3）

以上全通之后，重启 XP 三次，每次确认任务管理器里有 `res-agent.exe` 进程、
且窗口一拉分辨率就跟上。

## 边界情况速查

| 现象 | 含义 | 处置 |
|---|---|---|
| 桌面分辨率毫无反应 | 开关没开 / 页面跑的是旧运行时构建 / XP 里是旧版 EXE | 确认开关已开；硬刷新页面；确认拷进去的是最新构建的 EXE（串口版 7680 字节附近，拷过老 IN 版会启动即崩） |
| DebugView 里见「COM1 open failed」 | 串口被其它程序占用 / 驱动异常 | 关掉占用串口的程序；代理每 500ms 自动重试，释放后自动恢复 |
| 收到帧但 XP 不切换 | 模式表里没有目标档位 | 回第 4 步确认分辨率列表（diag 4/5 报过 62 modes、最大 2560×1600，正常无需 VBEMP） |
| 只能切到低档位 | 白名单以 EnumDisplaySettings 实测为准 | 在显示属性里手动选最大档确认上限 |
| 切换瞬间闪屏 | 正常（模式切换必闪），debounce 已防连切 | 不处理 |
| EXE 双击立即崩溃 | 拷的是旧的 IN 端口版（ring3 特权指令必崩） | 删掉重拷最新 `res-agent.exe` |
| 双击弹「already running」 | 已有代理实例在跑（单实例互斥，正常行为） | 无需处理；若想重启代理，任务管理器结束 res-agent.exe 再启动 |
