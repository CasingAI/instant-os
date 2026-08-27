# boxvideo.sys —— XP 任意分辨率显示驱动（boxvnt 改造版）

背景与三层机制见 `todo/vm-arbitrary-resolution/00-overview.md`；上游来源与
逐文件改动清单见 [VENDOR.md](./VENDOR.md)。本文件只讲构建、校验与安装要点
（第二期手册 `02-user-phase.md` 的原料）。

## 构建

```sh
scripts/build-boxvnt.sh            # 产物落 src/apps/virtual-machine/guest/boxvnt/out/
```

- 工具链：Open Watcom V2 snapshot（含 `h/nt/ddk` 头与 `videoprt.lib`）。
  首次运行自动下载 ~150MB 到 `~/.cache/boxvnt/ow-snapshot/`（GitHub 直连
  失败自动回落本机代理 127.0.0.1:7890），之后离线可用。
  已有自己的 OW 树时用 `BOXVNT_WATCOM=/path/to/ow` 指过去。
- 宿主：macOS arm64（armo64 工具，开发机实测）/ macOS x64 / Linux x64 / Linux x86。
- 重生成模式表：`node --experimental-strip-types scripts/gen-boxvnt-modes.ts`
  （改步长/纵横比等参数后跑它，`--check` 供 CI 漂移检测）。

## 校验（单测）

```sh
pnpm test:vm-boxvnt        # 产物级：构建两遍 + PE 断言 + INF 回归守卫
pnpm test:vm-boxvnt-modes  # 生成器级：阶梯不变量 + vidmpdat.c 防漂移
```

断言内容：PE32 (0x10b)、i386 (0x14c)、native 子系统（内核驱动）、校验和字段
非零、入口点非零（NT 驱动入口 = PE entry point `_DriverEntry@8`，**没有导出
表**——验收项按此理解）、导入表 ⊆ {VIDEOPRT.SYS}、体积 <200KB、两次构建
结构等价（含校验和相等）。OW 未就绪（无 `BOXVNT_WATCOM` 且缓存未建）时
SKIP，不阻塞无工具链环境。

## 安装要点（第二期，详见 02-user-phase.md）

1. 需要 `out/boxvideo.sys` + `out/vidmini.inf` 两 个文件（构建脚本已一并拷出）。
2. XP 显示属性 → 高级 → 适配器 → 更新驱动 → 从磁盘安装选 `vidmini.inf`；
   未签名警告选「仍然继续」；装完重启。
3. INF 主设备行是 `PCI\VEN_1234&DEV_1111`（v86 BGA），保留 VBox `80EE:BEEF`
   兼容行；显示驱动仍是 XP 自带 `framebuf.dll`（INF 只登记不拷贝）。
4. 虚拟机设置里把**显存调到 16MB**（默认值已改 16，但旧机器的存量设置仍是
   创建时的值）——密阶梯最大档 ~15.5MiB，8MB 时高分辨率档会被驱动显存
   校验拒绝（不是花屏，是不出现该档）。

## 行为语义（对照上游）

- 宿主「分辨率自动对齐」开关关闭 / 端口未注册：读 0xE003 得 0xFFFF ≠
  0x5AB0，`NumDynamicModes = 0`，模式列表 = 静态 95 项 + 密阶梯 821 项，
  其余行为与上游 boxvnt 一致。
- 开关打开：win32k 每次枚举模式表（`QUERY_NUM_AVAIL_MODES`）都会重读
  端口刷新动态项——宿主改目标 → res-agent 下一次 `EnumDisplaySettings`
  即见新档，`ChangeDisplaySettingsEx` 精确命中。
- 动态项索引固定为 `ulAllModes`（静态表之后第一个）；同一目标重复刷新
  不动槽位，防抖。
