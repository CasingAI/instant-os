# VENDOR —— boxvnt（Windows NT 显示 miniport）

- 来源：<https://github.com/ivanagui2/boxvnt>（作者 Michal Necasek / The OS/2 Museum）
- commit：`865ef784038654c46cf873fa4c0e29f06f3a4fa8`（2014-07-28，master 顶端；仓库此后无提交）
- 许可证：**MIT**（无独立 LICENSE 文件，全文嵌在每个源文件头部，vendored 副本原样保留版权头）
- 引入原因：它是为 `1234:1111` BGA + Bochs dispi 接口（正是 v86 模拟的显卡）写的
  NT 显示 miniport，MIT 许可、代码量小（3 个 .c）、支持 NT 3.1–Win7。改造它实现
  XP 任意分辨率（`todo/vm-arbitrary-resolution/00-overview.md`）。

## Vendored 文件

`boxv.c` `boxv.h` `boxv_io.h` `videomp.c` `videomp.h` `vidmpdat.c` `videomp.rc`
`vidmini.inf` `oemsetup.inf` `readme.txt` `disk1`（软盘卷标占位，保持原样）。

## 改动清单（全部以 `Instant VM changes` 注释就地标注）

### C 代码

| 文件 | 改动 |
|---|---|
| `boxv.c` | ① 接受 dispi ID5（0xB0C5，v86 的 `svga_version`）；② `BOXV_detect` 显存探测改读 dispi index 0x0A（64KB 单位）——上游连读两次数据端口把 ID 当显存，且 v86 未注册的 read32 返回 0xFFFFFFFF，令显存校验彻底失效（R8）；③ `VBE_DISPI_MAX_XRES/MAX_YRES` 1024×768 → 2560×1600 |
| `vidmpdat.c` | `VideoModes[]` 在上游 19 分辨率（×5 色深 = 95 项）之后追加密阶梯：宽度 640–2560 步长 8 × 纵横比 {4:3, 16:10, 16:9, 3:2}，仅 32bpp，共 821 项（`scripts/gen-boxvnt-modes.ts` 生成，勿手改）。用途：win32k 不重查模式列表时的兜底（R1），任何目标吸附误差 ≤4px |
| `videomp.c` | ① 动态模式通道：`vmpRefreshDynamicMode()` 每次 `IOCTL_VIDEO_QUERY_NUM_AVAIL_MODES` 前读宿主端口 0xE003（握手魔数 0x5AB0）/0xE001（宽）/0xE002（高），校验后填 `pExt->DynamicMode`（无宿主→零动态模式，行为与上游一致）；② `QUERY_NUM/AVAIL_MODES` 计入动态项（ModeIndex = `ulAllModes`）；③ `QUERY_CURRENT_MODE`/`SET_CURRENT_MODE`/`SET_COLOR_REGISTERS` 统一经 `vmpGetModeDims()` 解析（顺带修复上游 `modeNumber > ulAllModes` 的越界 off-by-one）；④ `RESET_DEVICE` 清动态项 |
| `videomp.h` | `HW_DEV_EXT` 增加 `DynamicMode`/`NumDynamicModes`；宿主端口常量 `VMP_PORT_MODE_*`/`VMP_MODE_MAGIC` |

### 构建/安装

| 文件 | 改动 |
|---|---|
| `makefile` | POSIX 宿主三处适配：`.c.obj` 规则加 `-fo=$@`（OW 在 POSIX 默认产出 `.o`）；`RCFLAGS` 加 `-bt=nt`（否则 wrc 产出 Win16/OS2 资源，wlink 拒收）；链接改 `wlink @boxvideo.lnk`（wmake 不剥引号 + wlink 把 argv 里的 `@` 当间接文件，命令行形态必挂）。clean 增加 `*.o`/`*.err` |
| `boxvideo.lnk` | **新增**：wlink 链接指令文件（内容 = 上游 makefile 链接行，`libpath` 改用 `%WATCOM%` 展开） |
| `vidmini.inf` | ① `[BOXV.Mfg]` 增加主设备行 `PCI\VEN_1234&DEV_1111`（v86 的 BGA；原 80EE:BEEF VBox 行保留）；② `[SourceDisksFiles]` `vidmini.sys` → `boxvideo.sys`（makefile 产出名，R7）；③ Strings 增加 `InstantVM = "Instant VM Graphics Adapter"` |
| `.gitignore` | **新增**：构建产物不入库（同 `../res-agent` 惯例） |

未改动：`oemsetup.inf`（NT 3.x 专用安装文件）、`videomp.rc`（版本资源保持上游 1.4）、`readme.txt`、`disk1`、所有源文件的 MIT 版权头。

## 与上游的验证基线

§0 gate（`todo/vm-arbitrary-resolution/01-ai-phase.md` §0）：Open Watcom V2
snapshot（`Last-CI-build`）在本机原样编译未改动的 boxvnt 成功产出 `boxvideo.sys`
（PE32/i386/native、9,984B、仅导入 VIDEOPRT.SYS）后才做的上述改动。
