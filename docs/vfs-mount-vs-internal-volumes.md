# VFS：外部挂载卷与内部容器 API 差异

本文记录 Instant OS 虚拟文件系统在 **外部挂载**（`/mount/{键}`，本机文件夹经 File System Access API）与 **内部可写卷**（`/user`、`/dev`、`/tmp`，IndexedDB）之间，在统一门面 `files-api` 上的能力差异。

**范围**

- 以 `src/apps/files/files-api.ts` 导出的 API 为准（内置应用、终端工具、QuickJS `fs` 桥接等均经此门面或等价的 `files-vfs` 路径操作）。
- 不展开底层实现（IDB vs FSA handle、配额存储位置等）；只关心「能否调用、抛什么错、返回字段是否一致」。
- **投影只读卷**（`/system`、`/models`、`/Applications`）未与挂载逐项对比；写类 API 在该类卷上统一按只读失败。

**术语**

- **挂载卷**：`locationId` 为 `mount:*`，路径前缀 `/mount/...`。
- **内部可写卷**：`local`（`/user`）、`dev`（`/dev`）、`tmp`（`/tmp`）。

---

## 结论概览

| 类别 | 说明 |
|------|------|
| 已对齐 | 路径型列举、单文件读写、建删改、复制/移动、批量删除、`filesWatch` 等，挂载与内部可写卷均可调用（仍受只读、受保护路径等通用规则约束）。 |
| 硬缺口 | 符号链接、子树枚举、revision 补齐、批量 upsert：挂载卷会直接失败。 |
| 软差异 | 同一 API 下，元数据字段、symlink 的 stat/lstat 语义、部分重命名、复制优化、错误类型、`filesWatch` 对外部变更的覆盖等不一致。 |

---

## 1. 挂载卷上不可用（内部可写卷可用）

| API | 挂载卷 | 内部可写卷 |
|-----|--------|------------|
| `filesSymlink` | 抛「当前卷不支持创建符号链接」 | `local` / `dev` / `tmp` 可用（见 `canCreateSymlinkOnLocation`） |
| `filesReadlink` | VFS 不暴露 `kind: 'symlink'`；本机真实 symlink 也不会稳定按 symlink 暴露 | 可读已创建的 VFS symlink |
| `filesListSubtreeFiles` | 抛「挂载卷不支持子树枚举」 | `local` / `dev` / `tmp` 可用 |
| `filesBackfillSubtreeContentRevisionIds` | 抛「挂载卷不支持 revision 补齐」 | 同上 |
| `filesUpsertBatch` | 抛「挂载卷暂不支持批量写入」 | 可用（含自动创建缺失父目录） |

相关实现：`files-vfs.ts`（`listSubtreeFiles`、`backfillSubtreeContentRevisionIds`、`upsertFilesBatch`、`createSymlink`）、`files-types.ts`（`canCreateSymlinkOnLocation`）。

---

## 2. 两边均可用的 API（列表）

以下在挂载卷与内部可写卷上**均可调用**（成功仍取决于权限、受保护路径、路径是否存在等）：

- `filesListVolumes`
- `filesList`
- `filesStat` / `filesLstat`
- `filesReadText` / `filesReadBlob`
- `filesWriteText` / `filesWriteBinary`
- `filesCreateText` / `filesCreateBinary`
- `filesMkdir`
- `filesRename`
- `filesRemove`
- `filesRemoveBatch`
- `filesCopy` / `filesMove`
- `filesWatch`

---

## 3. 同一 API，行为或返回值仍不同

### 3.1 `FilesApiEntry` 元数据

| 字段 / 场景 | 内部可写卷 | 挂载卷 |
|-------------|------------|--------|
| `contentRevisionId` | 写入后维护（UUID 版本戳） | 合成节点通常**无**该字段 |
| `filesList` 的 `byteSize` / `updatedAt` | 列举时一般为完整元数据 | 文件项常为 **0 / 占位时间**（轻量列举） |
| 卷根 `writable`（`filesStat`） | 例如 `/dev` 卷根为只读，子路径可写 | 卷根为可写 |

说明：文件应用通过 VFS 内部的 `enrichFilesNodeMeta` / `filesNodeNeedsViewportMeta` 懒加载补齐挂载列表元数据，**未在 `files-api` 导出**；仅调用 `filesList` 的第三方会看到上述差异。

### 3.2 `filesStat` / `filesLstat`

- **内部卷**：`filesStat` 跟随 VFS symlink；`filesLstat` 不跟随；可出现 `kind: 'symlink'`。
- **挂载卷**：路径解析不走 VFS symlink 模型；本机目录中的 symlink 不会稳定表现为 `kind: 'symlink'`（更像普通文件/目录或解析失败），与 Node `lstat` 语义不对齐。

### 3.3 `filesRename`

- 挂载卷重命名**文件夹**依赖 `DirectoryHandle.move`；不支持时抛「当前浏览器不支持重命名挂载文件夹」（文件有 copy + delete 回退）。
- 内部卷无此浏览器能力分支。

### 3.4 `filesCopy` / `filesMove`

- API 相同；跨卷（挂载 ↔ 内部）一律读内容再写。
- 仅 **内部 `local` / `dev` / `tmp` 之间**复制文件可能共享 blob（写时复制）；涉及挂载时不会走该优化。
- `filesMove` 跨目录为 copy + remove，无挂载单卷内 rename 快路径（与内部逻辑一致，大文件在挂载上成本更明显）。

### 3.5 错误类型

- 内部可写卷写入可能抛 **数据空间已满**（`FilesStorageFullError`）。
- 挂载卷可能抛 **权限 / 未授权 / 挂载已不存在** 等；不用「数据空间已满」表达磁盘容量问题。

### 3.6 `filesWatch`

- 经本系统 VFS 写入时，两边都会触发通知。
- 文档约定：不是 OS inotify；**不保证**本机其它程序改磁盘、跨标签旁路写入等（挂载场景更常见）。

### 3.7 `filesRemoveBatch`

- 两边均支持；内部卷走 IndexedDB 批量子树删除，挂载卷走逐路径 `removeMountNode`，大批量时性能与「单事务」语义不同，但成功/失败的路径形态一致。

---

## 4. 内部内置卷特例（非挂载独有）

对比「所有内置容器」时需注意：

| 卷 | 写类 API |
|----|----------|
| `/system`、`/models`、`/Applications` | 只读，写操作失败 |
| `/dev` 卷根 | 不可在卷根新建（`filesMkdir` / `filesCreate*` 等）；子树可写 |
| `/user` 受保护特殊目录 | 额外拒绝规则（与挂载无关） |

挂载卷：卷根下可新建；无 IndexedDB 数据空间配额错误，但有浏览器挂载授权与强制卸载（未授权时类似「外部设备拔出」）。

---

## 5. 与其它模块的交叉引用

- npm 在挂载卷上创建 symlink：**明确不做**（见 `docs/instant-npm-differences.md`）。
- 路径约定与卷根前缀：见 `files-api.ts` 文件头注释、`files-path.ts`（`filesLocationPathRoot`）。
- 第一期 symlink / 批处理策略：`quickjs-runtime-roadmap.md`、`files-types.ts`。

---

## 6. 维护说明

调查基于代码库中 `files-api` / `files-vfs` / `files-location-mount` / `files-types` 的当前实现。若新增 API 或放宽挂载能力（例如 `filesUpsertBatch`、挂载 symlink），请同步更新本文与 `instant-npm-differences.md` 中相关条目。
