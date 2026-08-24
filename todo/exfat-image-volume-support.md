# 磁盘镜像：支持 exFAT 文件系统

> 建立时间：2026-08-24
> 涉及项目：`instant-app`（磁盘镜像挂载 / VFS）
> 状态：方案，未实施

目标：让磁盘镜像卷除了 FAT12/16/32 之外，也能挂载 **exFAT** 格式的镜像，并支持可读可写。

---

## 1. 为什么选 exFAT

| 文件系统 | 是否可纳入考虑 | 原因 |
|---|---|---|
| NTFS | 否 | 结构复杂（日志、ACL、压缩、稀疏文件、重解析点），浏览器 JS/Wasm 中无成熟可写库，自行实现成本极高。 |
| ext2/3/4 | 否 | ext2 可写尚可考虑，但 ext3/4 的 journal、extent、flex_bg 等使成熟实现极少；目前没有发现可在浏览器中直接使用的现成可写库。 |
| APFS / HFS+ | 否 | 苹果私有实现，无公开成熟库。 |
| exFAT | 是 | 结构相对简单，与 FAT 同族，专为闪存设计，Windows / macOS / Linux 都原生支持；npm 上已有 `exfat` 等纯 JS/TS 解析库，具备可行性。 |

exFAT 是 Linux、Windows、macOS 都原生支持的常见文件系统，对跨系统交换文件非常有用，且比 NTFS 和 ext4 更容易在浏览器环境中落地。

---

## 2. 外部依赖调研

候选 npm 包：

- [`exfat`](https://www.npmjs.com/package/exfat) — 纯 JavaScript exFAT 文件系统解析库，支持读取目录、读取文件、基本元信息。
- [`libmount`](https://www.npmjs.com/package/libmount)（当前已用）— 只支持 FAT12/16/32，不支持 exFAT。

**关键问题**：`exfat` 包目前主要提供读取能力，写入能力需要进一步验证。如果写入能力不完整，本方案需要改为：

1. 与上游贡献 / 扩展写入接口；或
2. 放弃可写，仅做只读挂载。

---

## 3. 需要接入的位置

当前 FAT 驱动链路：

```
files-location-image.ts
    ↓ 调用
files-image-mount-store.ts（挂载会话，持有 FatImageVolume）
    ↓ 调用
files-image-fat-volume.ts（基于 libmount 实现 list/stat/read/write/mkdir/remove/rename）
    ↓ 调用
ImageDiskIo + SectorCache（异步块设备读写）
```

exFAT 需要新增一条并行的驱动链路：

```
files-location-image.ts
    ↓ 调用
files-image-mount-store.ts（挂载会话，按文件系统类型选择 FatImageVolume 或 ExfatImageVolume）
    ↓ 分支
    ├── FatImageVolume（FAT12/16/32）
    └── ExfatImageVolume（exFAT）
        ↓ 调用
        files-image-exfat-volume.ts
        ↓ 调用
        ImageDiskIo + SectorCache
```

---

## 4. 实施步骤

### 4.1 先验证 `exfat` 包的写入能力

- 用本地生成的 exFAT 镜像测试读取、列出目录、读取文件。
- 测试创建文件、创建目录、删除、重命名、覆盖写入。
- 如果写入能力不完整，记录缺口并决定是否需要 fork 或仅只读。

### 4.2 抽象通用镜像卷接口

将 `files-image-fat-volume.ts` 中的 `FatImageVolume` 能力抽象成 `ImageVolume` 接口（或改为抽象基类），使挂载层能根据文件系统类型切换实现。

涉及文件：

- `src/apps/files/files-image-fat-volume.ts`
- `src/apps/files/files-image-mount-store.ts`
- `src/apps/files/files-location-image.ts`

### 4.3 实现 `ExfatImageVolume`

新建 `src/apps/files/files-image-exfat-volume.ts`：

- 实现 `ImageVolume` 接口。
- 内部使用 `exfat` 包解析镜像。
- 通过 `ImageDiskIo` 读取/写入底层镜像数据；必要时在 `SectorCache` 之上再做一层同步到异步的桥接。

### 4.4 挂载时自动探测 exFAT

MBR 分区类型 `0x07` 同时表示 NTFS/HPFS/exFAT，不能仅靠分区类型判断。需要在分区起始处读取 exFAT 的 Boot CheckSum 和 `EXFAT` 签名来识别。

在 `files-image-mount-store.ts` 的 `openImageMount` 中：

1. 先探测是否为 FAT（保持现有逻辑）。
2. 若不是 FAT，再探测 exFAT。
3. 都不是则按当前逻辑报“不受支持的文件系统”。

### 4.5 磁盘工具显示 exFAT 信息

在 `src/apps/disk-utility/disk-utility-data.ts` 中：

- 扩展 `DiskFatInfo` 类型为更通用的 `DiskFileSystemInfo`，新增 `exFAT` variant。
- 读取 exFAT 超级块中的卷标、簇大小、总簇数、空闲簇数、序列号等信息并展示。

---

## 5. 明确不做的事

- **不支持 NTFS**：没有成熟可用的浏览器端可写库。
- **不支持 ext2/3/4**：没有成熟可用的浏览器端可写库。
- **不做 exFAT 的碎片整理、TRIM、ACL、流文件（Named Streams）等高级特性**：仅覆盖普通文件/目录读写。
- **不替换 libmount**：FAT 驱动继续用 `libmount`，exFAT 单独走 `exfat` 包。

---

## 6. 验收标准

- [ ] exFAT 镜像可以在文件管理器中挂载、列出目录、读取文件。
- [ ] 若外部库支持写入，则可创建/删除/重命名文件和目录、覆盖写入文件。
- [ ] FAT12/16/32 镜像行为完全不变（回归）。
- [ ] 磁盘工具能识别 exFAT 分区并展示基本信息（卷标、簇大小、容量、已用）。
- [ ] 单元测试覆盖 exFAT fixture 的读写操作。

---

## 7. 风险

- `exfat` npm 包的写入能力未知，如果只能只读，需要产品层面接受“exFAT 只读”。
- `exfat` 包可能假设同步块设备接口，而 `ImageDiskIo` 是异步的，需要做同步到异步的适配层或预读缓冲。
- 如果 `exfat` 包质量不足以支撑生产环境，本方案需要回退为“exFAT 不支持”。
