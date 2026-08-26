# 磁盘镜像：支持 exFAT 文件系统

> 建立时间：2026-08-24；实施完成：2026-08-25
> 涉及项目：`instant-app`（磁盘镜像挂载 / VFS）
> 状态：**已实施**（含真实 macOS exFAT 镜像互操作验证）

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

- [x] exFAT 镜像可以在文件管理器中挂载、列出目录、读取文件。
- [x] 创建/删除/重命名文件和目录、覆盖写入文件、范围读写、流式写（未采用外部库，自研实现，见下）。
- [x] FAT12/16/32 镜像行为完全不变（回归：files-image-mount / files-location-mount-range / disk-utility 全绿）。
- [x] 磁盘工具能识别 exFAT 分区并展示基本信息（卷标、簇大小、簇总数、容量、空闲簇、序列号）。
- [x] 单元测试覆盖 exFAT fixture 的读写操作（`pnpm test:files-image`，20 组用例，见 6.2 边界补测）。

## 6.1 实施纪要（2026-08-25）

**外部依赖结论**：npm `exfat` 包不可用——其目录项布局基于规范早期草案（FileInfo 字段偏移与正式规范不符），且 `readdir`/`readFile` 均为未实现桩，无写入能力。因此 exFAT 驱动为纯 TS 自研实现，不新增任何依赖。

**落地文件**：

- `src/apps/files/files-image-exfat-volume.ts` — ExfatImageVolume：VBR 解析与几何校验、FAT32 表项读写（双 FAT 镜像）、分配位图、目录项解析/序列化（含规范名字哈希与集合校验和）、NoFatChain 流的连续扩展与转链、目录扩容、list/stat/read/readRange/write/writeRange/streamWrite/mkdir/remove/rename。
- `src/apps/files/files-image-volume.ts` — 抽出 FatImageVolume / ExfatImageVolume 共同实现的 `ImageVolume` 接口，上层（files-location-image.ts）不感知文件系统类型。
- `src/apps/files/files-image-mount-store.ts` — 探测分流：先 FAT（保持既有行为），失败再试 exFAT（superfloppy 与 MBR 分区 0x07 均支持，靠引导区 EXFAT 签名区分 NTFS）。
- `src/apps/disk-utility/disk-utility-data.ts` — `DiskFileSystemInfo = DiskFatInfo | DiskExfatInfo`；读取根目录卷标与分配位图统计空闲簇。
- `src/apps/disk-utility/disk-utility-app.tsx` — exFAT 节点展示容量 / 空闲簇 / 序列号。
- `src/apps/files/files-image-exfat-fixture.ts` — 内存 mkfs（引导区校验和、位图、根目录、预置文件）。
- `src/apps/files/files-image-exfat.test.ts` — 11 组用例；`package.json` 增加 `test:files-image`。

**真实系统互操作验证**（macOS）：用 `newfs_exfat` 生成真镜像 → 驱动读出 macOS 写入的文件（含多簇与中文长名）→ 驱动执行创建/覆盖/mkdir/重命名/删除/范围写 → `fsck_exfat` 判定 "appears to be OK" → macOS 挂载回读内容全部一致。

**实现中踩过并修复的关键点**（后续维护注意）：

1. `VolumeLength` 字段单位是**扇区**不是字节；
2. 名字哈希按大写化 UTF-16 的**小端字节流逐字节**累加（macOS/Linux 实测口径），规范伪代码按码元读会算错；
3. 原地补丁目录项（流扩展项 / 修改时间）后必须重算 SetChecksum，否则 fsck 判损坏；
4. 目录项回收槽位判断要区分 0x85（在用）与 0x05（已删除）——仅差 bit7，不能按掩码类型匹配。

## 6.2 边界补测（2026-08-25，另增 9 组用例 = 20 组）

针对实施时未覆盖的边界路径补充测试，全部落在 `files-image-exfat.test.ts` 与 fixture 扩展 `files-image-exfat-fixture.ts`：

| 用例 | 覆盖点 | 关键结论 |
|---|---|---|
| 双 FAT 镜像写 + ActiveFat 读取 | `numberOfFats=2`、写入镜像到两份 FAT、ActiveFat 位翻转后重挂载 | 驱动 `writeFatEntry` 把**新表项**写入全部 FAT 份数；ActiveFat 只影响读取选择 |
| ActiveFat=1 + 陈旧副本 | VolFlags 置位、非活动 FAT 整区清零 | 读取完全依赖活动副本；镜像写不整体重建陈旧副本——这是 ActiveFat 的本意（崩溃安全），不是缺陷 |
| 512B 簇长链 | shift=0，1MB 文件 = 2048 簇，FAT 表跨 16+ 扇区 | 长链分配/遍历/范围改写无环、无断裂 |
| 256KB 簇 | shift=9 几何 + 单簇读写冒烟 | 几何推导正确 |
| TB 级卷 VBR | 手工构造 16.7M 簇 + 8.6e9 扇区卷长 | u32 簇数 / u64 卷长在 JS 数值范围无溢出；非法几何拒绝 |
| NoFatChain 目录连续扩容 | 目录后簇空闲 + 空文件（不占数据簇） | 保持 NoFatChain，新簇 FAT 表项为 EOC smear；要点：非空文件的数据簇会抢占目录后的簇，导致"无 blocker 也转链" |
| NoFatChain 目录被迫转链 | 目录后紧跟占位簇 | 转 FAT 链后 Stream 标志清零、链完整、集合校验和重算有效 |
| DOS 时间戳边界 | 1980-01-01 / 2107-12-31 23:59:58、越界钳制、百分秒精度 | 编解码往返一致；访问时间无百分秒 |
| 磁盘工具展示 | mount → `loadDiskTree` 端到端：卷标/簇大小/簇数/序列号/容量/空闲簇 | **发现并修复真实 bug**：超软盘分支 `parseFatBootSector` 接受度过宽，把 exFAT 引导区误判成 FAT12 垃圾值 → 改为先试 exFAT 签名（与挂载层探测分流一致） |

**仍不测的一项**：掉电中断恢复。SectorCache 抽象没有"部分落盘"的中间点——镜像只在 flush 时整体变更，浏览器 VFS 里不存在"写一半断电"的原子性语义可供测试；真机掉电后的一致性要靠 `fsck_exfat` 修复，超出本驱动单测范围（真实镜像互操作已用 fsck 验证过修复路径可用）。

---

## 7. 风险

- `exfat` npm 包的写入能力未知，如果只能只读，需要产品层面接受“exFAT 只读”。
- `exfat` 包可能假设同步块设备接口，而 `ImageDiskIo` 是异步的，需要做同步到异步的适配层或预读缓冲。
- 如果 `exfat` 包质量不足以支撑生产环境，本方案需要回退为“exFAT 不支持”。
