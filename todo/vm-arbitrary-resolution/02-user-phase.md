# vm-arbitrary-resolution · 02 第二期：实机装驱动 + 最终验证（用户执行）

> 第一期全部由 AI 完成；本期的全部动作由**你本人**执行（一次性）。
> 完成后 XP 具备任意分辨率能力，后续零干预。
> 预期耗时：15–30 分钟（含一次重启）。

## 前置（AI 已交付）

| 项 | 位置 | 状态 |
|---|---|---|
| 4 个交付物（`boxvideo.sys` / `vidmini.inf` / `res-agent.exe` / `install.reg`） | `src/apps/virtual-machine/guest/out/` | `scripts/collect-guest-files.sh` 一次性收口产出 |
| 宿主「分辨率自动对齐」开关 | instant-app 虚拟机设置 | 已存在 |

> 注意（R9）：**虚拟机设置的显存 ≥ 16MB**。新建机器默认已是 16MB（密阶梯
> 最大档 ~15.5MiB 恰好够用），设置里最高可选 256MB。这台 XP 是存量机器的
> 话还是创建时的值（可能 8MB）——8MB 时高分辨率档位不会出现在列表里
> （驱动显存校验拒绝，表现为「档位缺失」而非花屏），调到 16MB 或更高即可。

## 第 1 步：拷文件进 XP

`src/apps/virtual-machine/guest/out/` 里 4 个文件（`scripts/collect-guest-files.sh`
一次性收口产出），把它们放进 XP 的 `C:\Tools\`（或烧第二块盘挂载）：

```
boxvideo.sys
vidmini.inf
res-agent.exe
install.reg   （从 res-agent-install.reg.source 展开，路径默认 C:\Tools\res-agent.exe）
```

如果 res-agent 不放 `C:\Tools\`，先编辑 `install.reg` 里的路径再双击导入。

## 第 2 步：安装显示驱动

1. 桌面右键 → 属性 → 设置 → 高级 → 适配器 → 属性；
2. 更新驱动程序 → 从列表或指定位置安装 → 不要搜索 → 从磁盘安装 → 浏览到
   `C:\Tools\` 选 `vidmini.inf`；
3. 出现「未通过 Windows 徽标测试」警告 → **仍然继续**（XP 32 位允许未签名驱动）；
4. 安装完成后**重启 XP**。

## 第 3 步：注册 res-agent 自启（如未装过）

双击导入 `install.reg`；或沿用
[guest-installation.md](../../../docs/guest-installation.md) 第 3 步的手法。
（已有自启的机器跳过此步。）

## 第 4 步：验证

1. instant-app 里打开这台虚拟机的设置，确认「分辨率自动对齐」开关为开；
2. 硬刷新浏览器页面（让 runtime iframe 加载新构建）；
3. 在 XP 里确认任务管理器有 `res-agent.exe`（没有就双击一次）；
4. **拖大拖小窗口到任意尺寸**（含非标准尺寸，如 1371×913）：
   - 预期：画面在 1–2 秒内跟随窗口尺寸变化，**无黑边、无溢出、无模糊拉伸**；
   - 切到极小窗口（<640×480）：XP 保持当前分辨率不变（钳制生效，行为同旧版）。

## 第 5 步：回报

截图（窗口任意尺寸 + XP 桌面）+ 一句话结论（「通过」或「卡在第 N 步 / 现象 X」）。
若「通过」，AI 收尾：归档本分支、必要时把驱动产物并入发布资产。

## 边界情况速查

| 现象 | 含义 | 处置 |
|---|---|---|
| **任何崩溃/异常（含蓝屏）** | COM1 串口黑匣子已常驻驱动 | 抓宿主串口日志里**最后一条 `[IVM]V…` 行**，对照 [guest/boxvnt/ARCHITECTURE.md](../../src/apps/virtual-machine/guest/boxvnt/ARCHITECTURE.md) §7 判读表定位崩溃点（一条 V 都没有 = 镜像没被加载，换 `boxvideo-min2.sys` 对照） |
| 设备管理器里显卡还是旧驱动 | INF 没认到设备 | 确认 `vidmini.inf` 里 `VEN_1234&DEV_1111` 段；重做第 2 步 |
| 装了驱动后黑屏 | 驱动与 v86 不兼容（如 dispi 写时序） | 重启进安全模式卸掉；回报 AI，第一期代码加兼容性修正 |
| 窗口变化但分辨率不跟随 | 开关没开 / res-agent 没跑 | 查任务管理器；开关确认；页面硬刷新 |
| 分辨率跟随但画面有一档档的台阶 | 动态注入未生效（R1 缓存型 XP） | 不影响使用（密阶梯兜底，≤4px 误差）；回报 AI，改走 R1 回退验证 |
| 显示属性里模式列表超长 | 正常（密阶梯 + 动态项） | 忽略 |
