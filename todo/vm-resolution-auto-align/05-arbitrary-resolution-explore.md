# 05 · 「让 XP 支持任意分辨率」可行性调研 v3（全网调研后）

> 建立：2026-08-27。
> **v3 重大修正**：v1/v2 都搞错了关键事实——「VMware 的现成品不能直接用」是错的。
> 全网确实只有 **一个**专门为 Bochs/QEMU/虚拟 SVGA 写的 Windows miniport：
> [`ivanagui2/boxvnt`](https://github.com/ivanagui2/boxvnt) (MIT)。它正好跑在
> 我们的同一块硬件上，**只差几行就能扩成任意分辨率**。

## 1. 全网调研结果

| 资源 | 状态 | 关键事实 |
|---|---|---|
| **boxvnt** (ivanagui2, 2012, MIT) | **唯一在用** | NT 3.1–Win7 miniport；硬件就是我们的 1234:1111 + 0x1CE/0x1CF dispi；用 Open Watcom 编译；自带 `.inf`；MIT 许可证可商用；readme 写 "may also work with bochs and qemu"；唯一 fork (Zero3K/boxvnt, 2020) 改的只是 readme 和 CI |
| Zero3K/boxvnt | 改 readme/CI | **没有任何「任意分辨率」相关 commit** |
| VBox Guest Additions miniport | **不能直接用** | 硬件不匹配（PCI 15AD:0405 + 私有端口 vs 我们的 1234:1111 + 0x1CE）、许可证不友好（GPLv2 + 例外条款） |
| QXL Windows driver (QXL/WDDM) | 不能用 | 硬件不匹配（PCI 1AF4:1002 + QXL rings + ioport 0x3C0/0x3CF）、只支持 Vista+ 不支持 XP |
| spice-guest-tools 0.141 | 不能用 | 走 QXL/USB/serial 自家协议，硬件依赖强 |
| VESA VBE 路径（任何 VGA miniport） | 早就用着 | 客机现能枚举 62 个 VBE 档位就是走的这条（BIOS → int10 4F00 → XP vga.sys），**这是固定表，不是任意** |

**结论：全世界对"我们的这块硬件"做 Windows 驱动的人，到今天就 boxvnt 这一个**。
它 13 年没动过、只一位维护者，但 2012 年的代码今天照样可以编。

## 2. boxvnt 的真实机制（v3 关键发现）

读完全部 7 个文件（boxv.c 456 行 + videomp.c 750+ 行 + vidmpdat.c 96 行 + .h），
事实是这样的：

1. **完全绕过 BIOS**（`boxv.c` 注释 28-31："This miniport programs the hardware
   directly and does not use or require the video BIOS or VBE"）。
   它自己直接写 dispi 寄存器，不查 VBE 4F00。
2. **不依赖任何 QEMU/VBox 专有 API**——`BOXV_detect` 只检查 `0x1CE` 端口返回
   `0xB0C0..0xB0C4` 之一，确认是 Bochs/QEMU/SVGA 设备就接管。
3. **`BOXV_ext_mode_set` 已经支持任意 xres/yres**（`boxv.c:281`）——
   它只是把 dispi 的三个寄存器写出去，**w/h/bpp 三个参数进来就行**。
4. **`IOCTL_VIDEO_SET_CURRENT_MODE`（`videomp.c:460-476`）的"是否合法"
   只查 `VideoModes[modeNumber].bValid`**——而 `bValid` 由 `vmpValidateMode`
   决定，规则只有两条（`videomp.c:106-125`）：
   - `HorzRes % 8 == 0`（水平 8 像素对齐）
   - `vmpPitchByBpp(HorzRes, Bpp) * VertRes <= FramebufLen`（显存够）
5. **`VideoModes[]` 是 19 项静态表**（`vidmpdat.c:67-86`），最大 2560×1600。
   `vmpValidateMode` 在 `HwVidFindAdapter` 时**只把这 19 项里显存够的标为 bValid**。

**这意味着**：把 19 项静态表扩成"任何 8 像素对齐 + 显存够"的运行时表，就能让
`IOCTL_VIDEO_SET_CURRENT_MODE` 接受任意 W×H。**核心改造只有 30~50 行 C 代码**。

## 3. boxvnt → 任意分辨率的具体改造面

| 改造点 | 文件 | 行数 | 工作量 |
|---|---|---|---|
| 把 `vmpValidateMode` 改成「运行时缓存最近用过的 N 个 W×H」模式 | videomp.c:106-125 | ~30 行 | 一次写 |
| 改 `IOCTL_VIDEO_SET_CURRENT_MODE`：先用 W×H 在运行时表里查找/插入，再调 `BOXV_ext_mode_set` | videomp.c:460-476 | ~20 行 | 一次写 |
| 改 `BOXV_detect` 接受 `0xB0C5`（v86 用这个 ID，boxvnt 原始不认） | boxv.c:440 | 1 行 | 1 个字符（`<= 0xB0C4` → `<= 0xB0C5`） |
| 加一个**宿主推 W×H 的 IO 端口**（0xE000 已被 COM1 用，0xE001=W/0xE002=H/0xE003=handshake），改 `HwVidStartIO` 在 `IOCTL_VIDEO_SET_CURRENT_MODE` 时从端口拿值 | 驱动 + 宿主两端 | ~30 行 | 一次写 |
| 重写 `VideoModes[]` 为运行时表头+小缓冲，丢弃 `vidmpdat.c` 静态表 | videomp.c + vidmpdat.c | ~30 行 | 一次写 |

**估计总改动：~120 行 C + ~30 行 TS/JS，全部在两个仓库内**。**没有任何 BIOS 重编、没有任何特殊工具链**——boxvnt 自己写明 "Open Watcom C/C++ 1.9 or later" 即可编译，Open Watcom 是免费可下载的。

## 4. 跟 res-agent 的配合

```
[宿主]
  ResizeObserver → debounce → selectResolutionMode (CSS 像素 → 任意目标值 W×H)
      ↓
  bus.send('serial0-input', 任意 W×H 字节)  // 走 COM1，ring3 合法
      ↓
[XP 内]
  res-agent (ring3) 收到 → 写共享 IOCTL 内存 / 直接调 setupapi 触发设备重置
      ↓ (OS 内核: win32k → miniport)
  boxvnt (ring0) 收到 IOCTL_VIDEO_SET_CURRENT_MODE
      ↓
  in 0xE001 (W) + in 0xE002 (H) ← 宿主推过来的值
      ↓
  BOXV_ext_mode_set(pExt, W, H, 32, W, H)
      ↓
  out 0x1CE/0x1CF dispi 寄存器 → v86 帧缓冲立刻换大小
```

**整条链是零干预**：宿主侧装 boxvnt 一次（你启动 XP 装一次驱动），之后随便拖窗口。

## 5. 三方案重判

| 方案 | 真实情况 |
|---|---|
| **T1 密阶梯 BIOS** | 走 v86 当前 64 档 BIOS → 宿主演染黑白边 ≤ 半档。**现实世界就是 VBox 不装 Guest Additions 时的 16 档**——是的，差得不少。 |
| **T3 boxvnt 改造成任意分辨率** | **真实工作量比 v1 估的小一个数量级**（~150 行代码 + 一次 XP 装驱动）。boxvnt 骨架完整可用，许可证 MIT，目标硬件就是我们的硬件。 |
| T1.5 运行时推表 | 仍是伪方案，理由同 v2。 |

## 6. 我前两轮搞错的地方（不删，留作复盘）

- v1：「VMware 的现成品能不能拿来用？不能，硬件不匹配」——**这是对的，但我的语气让
  你以为没有现成代码可用**。事实是**有一个** boxvnt 一直在 GitHub 上，2012 年
  写的、MIT、目标硬件就是我们这块——**是我没去搜**。
- v2：「T3 自研驱动 = 几百行 + 一次 XP 实机调试」——也是对的，但没指出
  boxvnt 已经是「几百行 + 一次实机调试」的现成版本。
- v1 答复里把 boxvnt 推为「VMware 不可拿来」的论据，但**没去查有没有人
  已经为我们的硬件写过驱动**。这是**最大的失查**。

**修正后的明牌**：
1. boxvnt 一直就在那里，**MIT**、**目标硬件即我们的硬件**、**支持 NT 3.1 到 Win7**；
2. 改造它做任意分辨率 ~150 行代码，全部仓库内；
3. 你唯一要做的是**启动 XP 装一次这个驱动**——之后全程零干预。

## 7. 建议路径

- **先做 T1**（密阶梯 BIOS，半档误差，几小时仓库内工作），快速拿到可体验的版本；
- **同时把 boxvnt 改造成目标**放仓库（你启动 XP 装一次），拿到任意分辨率；
- 你实测后选留哪一个，删除另一个的代码。

要不要按这个走？如果要，我**先 T1 落地**（生成器 + 重建 vgabios），**同时**把 boxvnt fork 进仓库改完；装驱动那一步留给你一次性完成。
