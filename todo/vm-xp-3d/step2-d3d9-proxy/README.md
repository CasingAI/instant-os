# step2：假 d3d9.dll —— 使用与验证手册

> 状态：代码完成（2026-08-31），本机产物校验全过，待 XP 实机验证。  
> 阶梯定位：05 文档第 0~1 级的前置——证明「客机 D3D 调用能被记录并送出墙」。

## 文件清单

| 文件 | 作用 |
|---|---|
| `d3d9-proxy.c` | 假库本体：Direct3DCreate9 导出 + IDirect3D9/IDirect3DDevice9 全量虚表 + 调用记录 + 信箱 op=2 上行 + 同目录日志 |
| `d3d9-proxy-stubs.h` | 118 个设备方法中 109 个未实现项的签名精确 stub（`gen-stubs.mjs` 从 zig 自带 d3d9.h 生成，勿手改） |
| `gen-stubs.mjs` | stub 生成器（换 zig 版本后重跑） |
| `build-d3d9-proxy.sh` | 构建：zig cc -shared -nostdlib → PE 5.01 补丁 → 导出名去 `@n` 修饰 → marker 防呆 |
| `patch-export-kill-at.mjs` | 导出名就地截短 `Direct3DCreate9@4 → Direct3DCreate9`（lld 不支持 --kill-at//EXPORT/.def，实测三路全堵死后的正名方案） |
| `d3d9-proxy-binary.test.ts` | 产物单测：PE32/i386/5.01/导入白名单/导出表恰好无修饰名 |
| `0001-ivm-shm-op-3d.patch` | 宿主侧改动的 patch 备份（已应用到 `Instant-virtual-machine` 分支 `vm-d3d-channel`） |
| `out/d3d9-proxy.dll` | 产物（部署时改名 `d3d9.dll`） |
| `spike/` | S0 导出名 spike 留档 |

## 构建

```sh
todo/vm-xp-3d/step2-d3d9-proxy/build-d3d9-proxy.sh
node --experimental-strip-types todo/vm-xp-3d/step2-d3d9-proxy/d3d9-proxy-binary.test.ts
```

## 部署（测试台：step1 的 ivm-3dprobe.exe）

1. 把 `out/d3d9-proxy.dll` 改名 **`d3d9.dll`**，经文件传输送进 XP。
2. 与 `ivm-3dprobe.exe` 放**同一目录**（Windows DLL 搜索顺序：exe 目录优先于 System32）。
3. 双击探针 → A 窗点「Open Direct3D 9 test window」→ B 窗。

## 预期观察（三样齐 = step2 成功）

| 位置 | 成功样子 |
|---|---|
| B 窗日志 | `CreateDevice(HAL/SWVP) FAILED` 不再出现；取而代之是假库成功、动画清屏跑起来（标题栏变化） |
| 假库同目录 | 出现 `d3d9-proxy.log`：逐行 Direct3DCreate9 / CreateDevice / 每帧批次发布 |
| 浏览器 console | 每帧一条 `[vm-d3d] iframe: 收到 3D 命令批次（N 条）：…Clear×N Present×N` |

第三条的前提：宿主运行时跑的是带 op=2 分流的代码——分支 `vm-d3d-channel`（dev 模式 `Instant-virtual-machine` 起 Vite 6175 端口即是；生产需 deploy）。

## 失败定位

- B 窗仍 `FAILED 0x8876086A` → 假库没被加载：确认文件名是 `d3d9.dll` 且与探针同目录。
- B 窗 OK 但无 log 文件 → 看假库目录写权限；log 打不开时 OutputDebugStringA 仍可用（DebugView）。
- log 有批次发布、浏览器无 `[vm-d3d]` → 宿主运行时不是 `vm-d3d-channel` 分支的代码；此时 op=2 帧被读走后静默丢弃，属预期兼容行为，不卡信箱。
- 日志出现 `shm ack timeout` → 宿主 3 秒内没 ACK；批帧丢弃不重试（宁丢不卡），属设计行为。

## 已知限制（step3 再解决）

- G2H 单槽两写者（剪贴板桥 + 本库）：同时发布存在理论碰撞窗口，靠 3s 超时自愈；测试期无剪贴板流量则无实际影响。
- 只实现了探针路径会调用的 10 个设备方法 + 全量 stub（stub 返回 0 并日志一次）；游戏要的 DrawPrimitive/纹理/状态位全在 stub 里。
- SDK 版本宽松接受（不校验 D3D_SDK_VERSION），记录实际值。
- 信箱吞吐上限 ≈ 32KB/4ms；60fps 大批次会触顶，step3 需要压缩或环形缓冲。
