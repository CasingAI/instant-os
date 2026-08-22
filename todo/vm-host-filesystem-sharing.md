# VM 与宿主机文件系统共享方案

> 讨论时间：2026-08-22  
> 涉及项目：`instant-app` / `Instant-virtual-machine`  
> 目标：让 V86 虚拟机能够访问 instant-app 内部的文件/挂载目录。

---

## 1. 背景与约束

- V86 是浏览器内 x86 模拟器，运行在与 `instant-app` 不同源的 iframe 中。
- 双方通讯只能通过 `postMessage`，协议定义在 `src/apps/virtual-machine/virtual-machine-protocol.ts`。
- 当前 `Instant-virtual-machine/src/v86-runtime.ts` 初始化 V86 时没有启用 `filesystem` 选项。
- V86 网络后端当前配置为 `relay_url: 'fetch'`，仅拦截 VM 内访问 **TCP 80 端口** 的 HTTP 流量。
- `instant-app` 内部已有统一的 `files-api.ts` 与 FSA 挂载实现 `files-location-mount.ts`。

---

## 2. Linux 虚拟机：原生 9P 共享（推荐，体验最好）

### 2.1 可行性

- V86 支持 `filesystem: { handle9p: (msg) => ... }` 自定义 9P2000.L handler。
- Linux 内核自带 `virtio-9p` / `9p_fs` 驱动，客户机内可直接 `mount -t 9p ...`。

### 2.2 需要修改的地方

#### instant-app 侧

- [ ] 在 `virtual-machine-types.ts` 的 `VirtualMachineSettings` 中增加共享目录配置字段（如 `sharedFolderPaths` 或 `sharedVolumes`）。
- [ ] 在 `virtual-machine-protocol.ts` 中新增 9P 相关消息类型，例如：
  - `instantVm9pRequest`
  - `instantVm9pResponse`
- [ ] 在主机侧实现一个 9P2000.L 协议处理层，把 V86 发来的原始 9P 字节解析成文件操作，调用 `files-api.ts` 或 `files-location-mount.ts`。
- [ ] 在 `virtual-machine-runtime.ts` / `virtual-machine-app.tsx` 中把 9P 请求转发给文件系统层，并异步返回结果。

#### Instant-virtual-machine 侧

- [ ] 在 `v86-runtime.ts` 初始化 V86 时增加 `filesystem: { handle9p: (bytes) => postMessageToHost(bytes) }`。
- [ ] 收到主机的 `instantVm9pResponse` 后，把字节回写给 V86 的 9P handler。

### 2.3 参考实现点

- V86 的 `Virtio9pHandler` 接收 `Uint8Array` 形式的 9P2000.L 请求，返回同样是 `Uint8Array`。
- 需要先实现/引入一个最小可用的 9P2000.L parser/server，或手写核心 opcode：
  - `Tversion` / `Rversion`
  - `Tattach` / `Rattach`
  - `Twalk` / `Rwalk`
  - `Topen` / `Ropen`
  - `Tread` / `Rread`
  - `Twrite` / `Rwrite`
  - `Tclunk` / `Rclunk`
  - `Tstat` / `Rstat`
  - `Tcreate` / `Rcreate`
  - `Tremove` / `Rremove`

---

## 3. Windows 虚拟机：9P 不可用，需要替代方案

### 3.1 结论

- Windows 原生没有 9P / virtio-9p 驱动，不能直接挂载 V86 的 `handle9p`。
- SMB（445）/ FTP（21）走原始 TCP，V86 的 `fetch` 后端不会拦截，也不可行。

### 3.2 可选路线

#### 路线 A：动态打包成磁盘镜像（最稳，只读或离线读写）

- [ ] 在 `instant-app` 侧把选定的宿主目录打包成 FAT32 raw image 或 ISO。
- [ ] 通过 `InstantVmStartMessage` 的 `fda` / `cdrom` / 第二块 `hda` 挂载进去。
- [ ] Windows 启动后即可识别为普通磁盘/光驱。
- [ ] 缺点：不能实时同步，启动前/关机后生成镜像。

#### 路线 B：WebDAV over postMessage（可实时同步，最接近网络盘体验）

- [ ] 在 `Instant-virtual-machine` 的 `v86-runtime.ts` 里于 V86 初始化前 patch 全局 `window.fetch`。
- [ ] 拦截以 `http://instant-vm-files.local/` 开头的请求，不真正发网络，而是转成 `postMessage` 发给 `instant-app`。
- [ ] 在 `instant-app` 里新增协议消息（如 `vmHttpRequest` / `vmHttpResponse`）。
- [ ] 主机侧把 HTTP 方法映射为 `files-api.ts` 操作：
  - `PROPFIND` → 列出目录 / 查询元数据
  - `GET` → 读文件
  - `PUT` → 写文件
  - `MKCOL` → 创建目录
  - `DELETE` → 删除
- [ ] 把操作结果封装成 HTTP Response 返回给 VM。
- [ ] VM 内 Windows 使用“映射网络驱动器”挂载 `http://instant-vm-files.local/share/`。

**关键约束**：

- V86 的 `fetch` adapter 只拦截 VM 内 **目标端口为 80** 的 TCP 连接。
- 必须强制 Windows WebDAV 客户端使用 **HTTP（80）**，不能用 HTTPS（443）。
- 当前 iframe 与主窗口跨域，`postMessage` 的 `targetOrigin` 校验需要正确配置。

#### 路线 C：VM 内自定义 Agent

- [ ] 在 Windows 镜像里预装或在启动后注入一个自定义 Agent 程序。
- [ ] Agent 暴露本地 SMB/WebDAV/FTP 服务给 Windows 程序使用。
- [ ] Agent 底层把所有文件操作通过 HTTP（80）发到 V86 拦截地址，再转 postMessage。
- [ ] 适合对体验要求高的场景，但需要维护 VM 内程序。

---

## 4. 虚拟机网络与外部通讯

### 4.1 当前能力

- `network: 'ne2k' | 'virtio'` 加上 `networkBackend: 'fetch'` 可以让 VM 内系统通过 `fetch` 后端访问外网。
- 本质是单向 NAT：VM 主动访问外部可以，外部主动连入 VM 不行。

### 4.2 外部主动连入 VM

- 需要把 `networkBackend` 扩展到 `proxy_url` 并部署一个 WebSocket / WISP 代理。
- 或者把 V86 的 `network_adapter` 替换成自定义实现。
- 当前 `virtual-machine-protocol.ts` 没有网络包转发消息类型，需要新增。

### 4.3 最简单的双向通讯方案

- [ ] 在 `instant-app` 内起一个本地 HTTP/WebSocket 服务（例如 `127.0.0.1:8765`）。
- [ ] VM 内 Windows/Linux 安装网卡驱动后主动连接该服务。
- [ ] 建立长连接后即可双向通讯，无需修改 V86 网络后端。

---

## 5. 修改 V86 fetch 后端的技术路线

### 5.1 方案 1：运行时 patch `window.fetch`（推荐，成本最低）

- 在 `v86-runtime.ts` 中 V86 初始化前替换 `window.fetch`。
- 拦截虚拟 URL（如 `http://instant-vm-files.local/`）并转 postMessage。
- 不改 V86 构建产物，升级无影响。

### 5.2 方案 2：替换 `network_adapter` 实例

- V86 初始化后替换 `emulator.v86.network_adapter`。
- 需要实现 V86 内部的 `bus` 网络事件协议。
- 可以拦截任意端口，但接口属于内部实现，升级风险大。

### 5.3 方案 3：改 V86 源码重新构建

- 修改 `vendor/v86-src` 里的源码并重新 build。
- 最彻底，但 `scripts/vendor-v86.sh` 每次会下载最新 release，需要 freeze 版本或维护 patch。

---

## 6. 推荐优先级

| 优先级 | 事项 | 适用场景 |
| --- | --- | --- |
| P0 | 实现 Linux VM 的 9P 共享 | Linux 虚拟机为主，体验最好 |
| P1 | 运行时 patch fetch，实现 WebDAV over postMessage | Windows 虚拟机共享目录 |
| P2 | 动态打包 ISO/FAT32 镜像挂载 | Windows 只读数据、简单场景 |
| P3 | 自定义 `network_adapter` 或代理支持外部主动连入 | 高级网络需求 |
| P4 | 改 V86 源码重新构建 | 长期需要深度定制网络/文件系统 |

---

## 7. 相关文件清单

- `src/apps/virtual-machine/virtual-machine-types.ts`
- `src/apps/virtual-machine/virtual-machine-protocol.ts`
- `src/apps/virtual-machine/virtual-machine-runtime.ts`
- `src/apps/virtual-machine/virtual-machine-runtime-surface.tsx`
- `src/apps/virtual-machine/virtual-machine-disks.ts`
- `src/apps/files/files-api.ts`
- `src/apps/files/files-location-mount.ts`
- `../Instant-virtual-machine/src/v86-runtime.ts`
- `../Instant-virtual-machine/public/vendor/v86/libv86.js`
- `../Instant-virtual-machine/scripts/vendor-v86.sh`
