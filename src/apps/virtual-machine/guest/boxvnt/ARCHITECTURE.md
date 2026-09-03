# boxvnt 驱动架构与串口黑匣子

> 面向读者：要「看懂整个驱动」的人，以及拿着串口日志排崩溃的人。
> 上游与 vendored 来源见 [VENDOR.md](VENDOR.md)；改造历史见
> [todo/vm-arbitrary-resolution/](../../../todo/vm-arbitrary-resolution/)。
> 本文对应的是 **Instant VM 改造版**（动态模式通道 + 串口日志框架版）。

## 1. 一屏架构

```
[浏览器宿主]                                [XP 客机]
ResizeObserver（virtual-machine-runtime-surface.tsx）
  → debounce 300ms / 阈值 80px / clamp 640×480..2560×1600
  → 8px 网格取整（resolution-channel.ts）
  → postMessage instant-vm:set-resolution
  → runtime（另一仓库）发布目标：
      a. COM1 帧 → res-agent.exe（ring3：枚举→精确匹配→ChangeDisplaySettings）
      b. IO 端口（见 §5）→ 本驱动（ring0）
                                            win32k（GDI）
                                              ↓ IOCTL_VIDEO_*
                                            video port 驱动（VIDEOPRT.SYS）
                                              ↓ VRP
                                            HwVidStartIO（videomp.c）
                                              ↓ BOXV_ext_mode_set（boxv.c）
                                            dispi 寄存器 0x1CE/0x1CF
                                              ↓
                                            v86 vga.js → 宿主画布换尺寸
```

驱动本身不画任何东西——它只负责「把硬件编程成 win32k 想要的 W×H×Bpp」，
以及「把 win32k 能选的模式列表准备出来」。

## 2. 文件地图

| 文件 | 角色 |
|---|---|
| `videomp.c` | 主体：DriverEntry / FindAdapter / Initialize / StartIO / 电源与子设备回调；动态模式刷新与解析；全部日志打点 |
| `videomp.h` | 设备扩展结构（`HW_DEV_EXT`）、宿主端口常量、目标窗口常量、Video Port 版本号 |
| `vidmpdat.c` | 静态数据：`VideoModes[]` 821 项（19 经典×5 色深 + 8px 步长 32bpp 密阶梯，`scripts/gen-boxvnt-modes.ts` 生成）、legacy 资源表、`PortVersion` |
| `boxv.c` | 硬件编程原语：dispi 模式设置/禁用、DAC、适配器探测（读 dispi ID + 显存） |
| `boxv_io.h` | `vid_outw/vid_inw/...` 端口读写内联原语 |
| `vmplog.h/.c` | 串口黑匣子：`[IVM]<tag>=<8hex>` 行，零导入，见 §6 |
| `videomp-min2.c` | bisect 探针构建（零导入，仅证明「镜像能加载」），排查期保留 |
| `vidmini.inf` | 安装 INF（认 `PCI\VEN_1234&DEV_1111`） |
| `boxvideo.lnk` / `makefile` | Open Watcom 链接指令 / 构建规则（POSIX 适配见 VENDOR.md） |

## 3. 生命周期（驱动怎么看自己的一生）

1. **`DriverEntry`**（加载即跑）：打 `VLD1`（镜像已加载在跑）→ `VLD2`（第一条
   导入调用之前）→ `VLD3`（第一条导入存活）→ 按版本从 XP→2000→NT4→NT3.1 逐级
   尝试 `VideoPortInitialize`（每次打 `VLD4`=尝试的版本），任何一次非
   REVISION_MISMATCH 即停。返回值打 `VLDR`。
2. **`HwVidFindAdapter`**（PnP 选中设备时）：
   `VFA0` 进入 → 校验 ConfigInfo 尺寸（太小 `VFAc` 拒）→
   `VideoPortVerifyAccessRanges` 声明 0x1CE-0x1CF 端口 + 0xE0000000 帧缓冲
   （冲突 `VFAr`，状态值即 NTSTATUS）→ 映射（NULL `VFAm`，值=第几个范围）→
   `BOXV_detect` 读 dispi ID + 显存（`VFA3`=chip id、`VFA4`=显存字节；
   未检出 `VFAd`，显存为 0 `VFAl`，>4MB 声明 `VFAf` 仅提示）→
   给 821 项静态表逐项跑 `vmpValidateMode`（`VFA5`=有效模式数）→ 写注册表
   硬件名 → `VFA6` 成功。
3. **`HwVidInitialize`**：`VINI`，之后允许改硬件状态。
4. **`HwVidStartIO`**：全部业务在这里，每个 IOCTL 一对 `VSTI`(入口,值=ioctl)/
   `VSTO`(出口,值=status)。win32k 的典型顺序是
   `QUERY_NUM_AVAIL_MODES → QUERY_AVAIL_MODES → MAP_VIDEO_MEMORY →
   SET_CURRENT_MODE → SET_COLOR_REGISTERS`，改分辨率时再走一遍
   QUERY/SET。
5. **`HwVidResetHw`**：关机/崩溃路径也会进来（`VRHW`），禁用扩展模式回 VGA。

注：源码里的 `#pragma alloc_text(PAGE, …)` 是装饰——`boxvideo.lnk` 把全部
CODE/DATA 段链接成 nonpageable，驱动没有任何可换页内存，这也是
DISPATCH_LEVEL 下跑 StartIO 安全的原因。

## 4. 模式列表的三层（任意分辨率怎么「凑」出来）

win32k 只信它枚举到的列表。本驱动给它的列表 = 三层叠加：

1. **静态表**（`vidmpdat.c`，821 项）：19 个经典分辨率×5 色深，加上
   640–2560 步长 8、四种纵横比的 32bpp 密阶梯。**这是 R1 兜底**：win32k
   是缓存型客户端，不重查列表也能让任何 8px 对齐目标吸附到 ≤4px 误差。
2. **动态模式**（精确值）：宿主在 IO 端口上发布的精确 W×H（§5），追加在
   列表尾部索引 `ulAllModes + DynamicModeSlot`。目标每次变化，模式搬到
   **另一个槽**（VirtualBox XPDM 技巧：索引不变时 win32k 会忽略模式切换）。
3. **LastDyn 兜底**：最近一次被接受的动态目标长期记住。动态槽被清
   （RESET_DEVICE / 宿主停发）之后，win32k 缓存里的旧尾部索引仍能解析成
   「它指的那个模式已经在屏上了」，不再报 ERROR_INVALID_PARAMETER。

验证统一走 `vmpCheckDims`（videomp.c）：Bpp∈{8,15,16,24,32}、宽
640..2560、高 480..1600、宽 8 对齐、pitch×高 ≤ 显存。静态表、动态刷新、
SET 前复查三条路共用这一份真相。

## 5. 动态模式通道契约（宿主 ↔ 驱动）

| 端口 | 读宽 | 含义 |
|---|---|---|
| `0xE001` | 16 位 | 目标宽度（px） |
| `0xE002` | 16 位 | 目标高度（px） |
| `0xE003` | 16 位 | 魔数 `0x5AB0` = 「宿主在发布」 |

- **开关语义**：runtime 只在「分辨率自动对齐」开着时注册这三个端口；
  关闭/未实现时驱动读到 0xFFFF → 魔数不中 → 零动态模式，行为与上游
  逐字节一致（不会崩，只是没有精确档）。
- **驱动侧行为**：`vmpRefreshDynamicMode` 在两次列表查询前各刷新一次；
  同目标不动槽位（索引稳定 → 不触发无谓的模式切换）；新目标写另一个槽
  并更新 LastDyn；目标非法（`VDMJ`=2..5）或宿主停发（`VDMJ`=0）则清空
  动态槽，静态密阶梯继续兜底。
- **发布端在 runtime 仓库**（不在 instant-app）：寄存器注册代码、开关
  门控、与 res-agent COM1 帧的并行存在都必须由 runtime 实现。宿主侧
  目标推导与 postMessage 见 `src/apps/virtual-machine/resolution-channel.ts`。

## 6. 串口黑匣子（vmplog.c）

**行格式**：`[IVM]<tag>=<8位十六进制>\r\n`，COM1（0x3F8）8N1。

- **零导入**：写串口走 `#pragma aux` 内联 OUT/IN，没有 IAT 项、没有重定位
  依赖——就算崩在导入解析路径本身，之前的日志也已发出（这正是当年五轮
  蓝屏查不出位置的坑）。
- **有界等待**：每字节前读 LSR 等 THRE，上限 65535 次轮询；v86 没注册串口
  时 LSR 读回 0xFF（THRE=1），直接落空不悬挂。
- **与 res-agent 共存**：同走 COM1。agent 用 4 字符 tag（PONG/EXEC/…）经
  Win32 WriteFile 回执；本驱动 tag 一律以 `V` 开头，宿主按 tag 路由互不
  误读；方向上驱动只写 TX、agent 只读 RX，互不踩。
- **体量**：每个 IOCTL 约 3 行（入口/分支细节/出口），模式查询只发生在
  PDEV 初始化与改分辨率时，一次引导总量几百行。

### Tag 注册表

引导/加载：

| tag | 值含义 |
|---|---|
| `VLD1` | DriverEntry 已执行 = 镜像被加载且在跑（0xDEDEDEDE） |
| `VLD2` | 第一条导入调用之前（0） |
| `VLD3` | 第一条导入调用存活（1） |
| `VLD4` | VideoPortInitialize 尝试，值=PortVersion（0x050100=XP … 0x030100=NT3.1） |
| `VLDR` | DriverEntry 返回值（status） |
| `VPRB` | bisect 探针构建标记（仅 min2/探针构建） |

FindAdapter：

| tag | 值含义 |
|---|---|
| `VFA0` / `VFA6` | 进入 / 成功（0xF9F9F9F9） |
| `VFA1` / `VFA2` | 资源声明通过 / 映射完成（2） |
| `VFA3` | BOXV_detect 的 chip id（0 = 未检出） |
| `VFA4` | 显存字节数（dispi index 0x0A，64KB 单位换算） |
| `VFA5` | 静态表有效模式数（16MB 显存时应为 821） |
| `VFAf` | 显存 > 4MB 声明范围（提示，映射按物理地址进行） |
| `VFAc` | ConfigInfo 太小，拒绝；值=Length |
| `VFAr` / `VFAm` | 资源声明失败(status) / 映射 NULL(值=第几个范围) |
| `VFAd` / `VFAl` | 未检出适配器 / 显存读数为 0 |

StartIO（入口 `VSTI`=ioctl、出口 `VSTO`=status，0 为成功）：

| tag | 值含义 |
|---|---|
| `VNUM` / `VLST` | 模式总数 / 列表字节数 |
| `VQCM` / `VQCF` | 当前模式 (w<<16)\|h / 解析失败(值=索引) |
| `VSET` / `VMDR` / `VMD0` | 请求的索引 / 解析失败 / 解析出 (w<<16)\|h |
| `VSVB` / `VSMS` | 维度校验拒绝(原因码见下) / BOXV_ext_mode_set 返回值 |
| `VRST` | RESET_DEVICE（LastDyn 保留） |
| `VEXT` | 扩展区自检钳制，值=(NumDynamicModes<<16)\|DynamicModeSlot |
| `VMBF` / `VIBF` | 输出缓冲不足 / 输入缓冲不足（值=字节数） |
| `VMAP` / `VUMA` | 映射成功=长度或失败=status / unmap status |
| `VCLT` / `VCLF` | CLUT 条目数 / CLUT 越界拒绝 |
| `VPTR` / `VSHR` / `VSHF` | 无硬件指针 / 共享视图字节 / 视图越界 |
| `VUSR` / `VCHD` / `VINV` | unshare status / 子设备状态 / 未处理 ioctl |

动态模式通道：

| tag | 值含义 |
|---|---|
| `VDMT` | 宿主发布的目标 (w<<16)\|h |
| `VDMJ` | 拒绝：**0**=宿主停发（曾有动态模式在位）；**2..5**=`vmpCheckDims` 原因码 |
| `VDMA` | 接受：值=(slot<<16)\|NumDynamicModes |

原因码（`VSVB` / `VDMJ` 2..5 共用）：
1=Bpp 非法（仅 VSVB 可能）｜2=宽度出界｜3=高度出界｜4=宽度非 8 对齐｜5=显存不够。

其它：`VINI` 初始化；`VRHW` ResetHw（0xAAAAAAAA，关机/蓝屏路径也会打）；
`VCH0` 子设备枚举；`VPWG`/`VPWS` 电源 get/set。

## 7. 崩溃 triage 判读表

抓串口输出，看**最后一条 `[IVM]` 行**（宿主 runtime 的 serial0 tap 会把
`[IVM]V…` 行留在日志里）：

| 最后一条 | 判读 | 下一步 |
|---|---|---|
| 一条 `V` 开头的都没有 | 镜像没被加载 / DriverEntry 未执行——加载器拒收，问题在 PE 形态，**与 C 代码无关** | 换 `boxvideo-min2.sys`（零导入）装一次：有 `VPRB`=加载路径死在导入处理，无 `VPRB`=镜像本身被拒，查 normalize 步骤 |
| `VLD1` / `VLD2` | 崩在第一条导入调用之前/之中（导入解析路径） | 对照 normalize-boxvnt-pe.mjs 的「导入派发 N 处改写」日志 |
| `VLD3` / `VLD4` | 崩在 VideoPortInitialize / 版本探测 | 看值=尝试到哪个版本 |
| `VFAr` / `VFAm` | 资源声明/映射失败——本应干净失败；若真蓝屏，问题在 video port 内部 | 报值（NTSTATUS），加 0x1CC/PCI 变体排查 |
| `VFA3` 且值=0 | dispi 未检出（ID 不在 B0C0..B0C5） | 确认 v86 svga_version、0x1CE 是否被别的驱动占走 |
| `VFA4` / `VFAl` | 显存读数异常（0 或离谱值） | 查 dispi index 0x0A 契约（VENDOR.md R8） |
| `VFA5`=0 | 显存太小，全部静态档无效 | 虚拟机设置把显存调到 ≥16MB |
| `VSTI` 后的 `VMD0`/`VSMS` 附近 | 崩在模式切换路径 | 看 `VMD0` 的 w/h 是否在 §5 窗口内、`VFA4` 显存是否够 |
| 能进桌面但分辨率不跟随 | 看串口有无 `VDMT`/`VDMJ` | 无 `VDMT`=宿主没发布（runtime 未注册端口 / 开关没开）；`VDMJ`=2..5=目标被驱动拒（对一下原因码）；有 `VDMA` 且 `VSET`/`VMD0` 正常但画面不动=v86 dispi 侧问题 |

## 8. 已知边界与设计取舍

- **帧缓冲声明 4MB vs 实际显存最大 16MB**（`videomp.c` accessRanges）：
  上游行为原样保留——映射走 `VideoPortMapMemory` 按物理地址进行，超出声明
  范围在 Bochs/QEMU/VBox 上多年无恙；`VFAf` 会在显存>4MB 时打一行提示。
  改声明有资源仲裁回归风险，不轻动。
- **SET 收下任何一个尾部索引**：win32k 缓存了旧槽索引时，与其报
  BADMODE 让改分辨率「卡住」，不如解析成当前动态目标（二者本就该一致）。
  代价：用户手动选「上一个动态档」会直接落在新档上——auto-align 场景
  无感。
- **QUERY_AVAIL 也刷新动态模式**：正常流 win32k 必先 QUERY_NUM，此处是
  同目标 no-op；两调之间宿主恰好变目标时，刷新保证列表与后续 SET 一致，
  缓冲长度检查兜住溢出。
- **日志默认全开**（`vmplog.h` 的 `VMP_LOG_SERIAL=1`）：黑匣子的价值在
  「出事时一定在」。归零即全局静默，留给发布定案后决定。

## 9. 构建与守卫

```sh
sh scripts/build-boxvnt.sh          # 编译 + normalize → guest/out/boxvideo.sys
pnpm test:vm-boxvnt                 # 双次构建 + PE 结构守卫 + 日志编入断言
pnpm test:vm-boxvnt-modes           # 密阶梯生成器回归
pnpm test:vm-collect-guest-files    # 客机交付物收口
```

守卫单测覆盖的「必蓝屏形态」清单与原理见
`scripts/normalize-boxvnt-pe.mjs` 头注释与 `boxvnt-binary.test.ts`。
