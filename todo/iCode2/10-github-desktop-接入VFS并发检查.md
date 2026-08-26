# 第十期：github-desktop 接入 VFS 写时并发检查

> 建立时间：2026-08-26
> 期次：第十期（github-desktop 接入第八期）
> 涉及项目：`instant-app`（github-desktop / VFS / files-api）
> 状态：未实施
> 前置：`08-VFS-写时并发检查.md`（VFS 公开 API 已就绪）
> 不依赖第七、九期；与 iCode agent 解耦

目标：github-desktop 现有"应用层用 `contentRevisionId` 优化 fileIndex 构建"的整套代码（`GithubFileIndexEntry.revisionId` / `diffRevisionSnapshot` / `reconcileFileIndexRevisionIds` / `buildFileIndexFromRevisionSnapshot` / `collectWorkingTreeRevisionSnapshot`）全部下线。fileIndex 仅保留 `hash` + `byteSize`（用于内容 diff 与 push 重建 tree）；并发检查走 VFS 公开 API。`filesBackfillSubtreeContentRevisionIds` 调用保留——它是 VFS 自身一致性 backfill，与并发检查无关。

## 1. 为什么要有第十期

### 1.1 现状

github-desktop 当前维护一套"应用层 revisionId 元数据对比"机制，**与并发检查无关**——纯粹是 fileIndex 构建的性能优化。代码散布在：

- `src/apps/github-desktop/github-revision-diff.ts`：`diffRevisionSnapshot`（按 revisionId 对比，给 `needsHashCheck` 标志）、`fileIndexHasAnyRevisionId`
- `src/apps/github-desktop/github-sync-meta.ts`：`GithubFileIndexEntry.revisionId` 字段、`reconcileFileIndexRevisionIds`（用 revisionId 对齐 fileIndex）、`buildFileIndexFromRevisionSnapshot`（用 revisionId 跳过 hash 计算）、`GithubRevisionSnapshotEntry` 类型
- `src/apps/github-desktop/github-baseline.ts`：`persistBaselineFromFiles(files, revisionIds?)` 入参的 `revisionIds` map
- `src/apps/github-desktop/github-working-tree.ts`：`collectWorkingTreeRevisionSnapshot`（拉工作区 contentRevisionId）
- `src/apps/github-desktop/github-changes.ts`：`detectGithubChanges` / `persistBaselineFromWorkingTree` / `persistBaselineForCommittedChanges` / `stampFileIndexRevisionIdsFromWorkingTree` / `ensureGithubRevisionIdsReady` 全部用 `collectWorkingTreeRevisionSnapshot` + `reconcileFileIndexRevisionIds` + `buildFileIndexFromRevisionSnapshot`
- `src/apps/github-desktop/github-revision-diff.test.ts`：测试上述逻辑
- `src/apps/files/files-api.ts:269` 的 `filesBackfillSubtreeContentRevisionIds`：VFS 公开 API——**保留**（VFS 自身 backfill 老节点；与并发检查无关）

### 1.2 第八期上线后这套机制的角色

- `contentRevisionId` 在 VFS 是单调戳，**自带的**——应用层不需要再维护一份"上次读到的 revisionId"。
- `revisionId` 作为"跳过 hash 计算"的优化：第八期上线后**没有理由保留**——VFS 已经提供，写时直接拿 `expectedContentRevisionId` 校验；fileIndex 也不需要它（hash 已足够做内容指纹与基线比对）。
- `GithubFileIndexEntry.hash` 必须保留——它是**内容指纹**，用于 `diffFileIndexes`（`github-file-index-diff.ts:23`）、`buildFileIndex`、基线 blob key、push 重建 tree；与并发检查无关。

### 1.3 已有形态对照

| 系统 | fileIndex 字段 | 用途 |
|---|---|---|
| Cursor / Cline | 不维护 fileIndex | 直接走 VFS / 文件系统 |
| 本仓库 github-desktop（现） | `hash` + `byteSize` + `revisionId?` | `hash` 内容指纹；`revisionId` 优化 |
| 本仓库 github-desktop（第十期后） | `hash` + `byteSize` | 内容指纹；并发走 VFS |

## 2. 已拍板规则

### 2.1 下线应用层 revisionId 维护

**删**以下符号与代码：

| 符号 | 位置 | 第十期处理 |
|---|---|---|
| `GithubFileIndexEntry.revisionId` 字段 | `github-sync-meta.ts:21` | **删**字段；构造处不再写 |
| `GithubRevisionSnapshotEntry` 类型 | `github-sync-meta.ts:850-852` | **删**；re-export 也删 |
| `buildFileIndexFromRevisionSnapshot` 函数 | `github-sync-meta.ts:858-893` | **删** |
| `reconcileFileIndexRevisionIds` 函数 | `github-sync-meta.ts:905-…` | **删**；`github-changes.ts:192` 的 re-export 也删 |
| `diffRevisionSnapshot` 函数 | `github-revision-diff.ts:24-88` | **删**；`github-changes.ts:13` import 也删 |
| `fileIndexHasAnyRevisionId` 函数 | `github-revision-diff.ts:91-98` | **删**；`github-changes.ts:13` import 也删 |
| `collectWorkingTreeRevisionSnapshot` 函数 | `github-working-tree.ts:219-234` | **删**；`github-changes.ts:32`、`github-changes.ts:57` 的 re-export 也删 |
| `persistBaselineFromFiles` 的 `revisionIds` 入参 | `github-baseline.ts:55-71` | **删**入参；函数签名简化为 `(files: Map<string, Uint8Array>)` |
| `github-revision-diff.test.ts` | `src/apps/github-desktop/` | **删**文件 |

### 2.2 `detectGithubChanges` 重写

当前 `detectGithubChanges`（`github-changes.ts:61-127`）的核心循环：拉 revision 快照 → `diffRevisionSnapshot` 给出 `provisional` → 逐项判断 `needsHashCheck` → 走 `readWorkingTreeBytes` + `hashBytes` 比对 `previous.hash`。

**第十期后**改为：

```ts
export async function detectGithubChanges(meta: GithubRepoSyncMeta): Promise<GithubChange[]> {
  const root = githubRepoRootPath(meta.owner, meta.repo)
  const fileIndex = currentFileIndex(meta)
  // 1. 列工作区所有文件（含 byteSize）
  const working = await collectWorkingTreeFileStats(meta.owner, meta.repo)
  // 2. 用 diffFileIndexes（hash 比对）找出 added/upsert/remove
  // 3. 工作区里"byteSize 变化但 hash 未变"的边角：实际不存在，VFS 的 byteSize 是 metadata，与内容 hash 同步更新
  // 4. 输出 GithubChange[]
}
```

`GithubRevisionChange` / `needsHashCheck` / `contentRevisionId` 字段全部去掉；只保留 `path` / `kind` / `absolutePath`。

### 2.3 `persistBaselineFromWorkingTree` 重写

当前（`github-changes.ts:133-148`）：拉 revision 快照 → `buildFileIndexFromRevisionSnapshot` → 走 `hashPath` 计算 hash。

**第十期后**：直接走 `buildFileIndex`（`github-sync-meta.ts` 已存在的纯 hash 版）+ `persistBaselineFromFiles`（删 `revisionIds` 入参后）。**无 revisionId 优化**——每次都算 hash。性能：每次打开仓库会多算 N 次 hash（N = 工作区文件数）。这是一次性成本；之后 fileIndex 已稳定，开销可接受。

### 2.4 `persistBaselineForCommittedChanges` 重写

当前（`github-changes.ts:151-177`）：hash 算好后调用 `stampFileIndexRevisionIdsFromWorkingTree`。

**第十期后**：删 `stampFileIndexRevisionIdsFromWorkingTree` 调用；只保留 hash 计算 + 写入 fileIndex。

### 2.5 `ensureGithubRevisionIdsReady` 重写

当前（`github-changes.ts:199-…`）：
1. `filesBackfillSubtreeContentRevisionIds(root)` —— **保留**（VFS 自身 backfill；与并发检查无关）
2. `fileIndexHasAnyRevisionId(fileIndex)` 检查 —— **删**
3. 后续 stamp fileIndex revisionId —— **删**

**第十期后**简化为：

```ts
export async function ensureGithubRevisionIdsReady(meta, onProgress): Promise<GithubRepoSyncMeta> {
  const root = githubRepoRootPath(meta.owner, meta.repo)
  onProgress?.('补齐文件版本戳…')
  try {
    await filesBackfillSubtreeContentRevisionIds(root)
  } catch {
    return meta
  }
  return meta
}
```

第十期后函数名仍是"补齐版本戳"——但做的事只剩 VFS backfill 一步。

### 2.6 VFS 公开 API 不动

- `filesBackfillSubtreeContentRevisionIds`（`src/apps/files/files-api.ts:269`）保留——它是 VFS 自身 backfill 工具，与应用层是否使用 revisionId 无关。
- 第八期新增的 `expectedContentRevisionId` 校验是**写**时的事；github-desktop 的写流程（`github-working-tree.ts:79-95` 的 `writeWorkingTreeFile`）改一下：调 `filesWriteBinary` / `filesCreateBinary` 时透传 `expectedContentRevisionId`（与第九期做法一致）——但**这条已在第八期范围内**（`writeWorkingTreeFile` 是"应用层调用 VFS 写 API"的封装）。**第十期只做 fileIndex 这条线，写流程的具体改造不在 plan 内**。

### 2.7 与第一至六期的边界

- 第十期**不**碰 VFS 公开 API。
- 第十期**不**碰 iCode agent、vscode AI、Produde 的写流程。
- 第十期**不**碰 `diffFileIndexes`（hash 比对；与 revision 无关，保留）。

## 3. 验收清单

- `GithubFileIndexEntry` 仅保留 `hash` + `byteSize`；`revisionId` 字段删除；构造处不再写。
- `diffRevisionSnapshot` / `fileIndexHasAnyRevisionId` / `buildFileIndexFromRevisionSnapshot` / `reconcileFileIndexRevisionIds` / `collectWorkingTreeRevisionSnapshot` / `GithubRevisionSnapshotEntry` 全部从代码库删除。
- `persistBaselineFromFiles(files)` 签名简化（无 `revisionIds` 入参）；调用方 `github-changes.ts:412` 不再传 `revisionIds`。
- `detectGithubChanges` / `persistBaselineFromWorkingTree` / `persistBaselineForCommittedChanges` / `ensureGithubRevisionIdsReady` 重写后，行为等价（输出同样的 `GithubChange[]` 列表）。
- `github-revision-diff.test.ts` 文件删除。
- `github-changes.ts` 的 `collectWorkingTreeRevisionSnapshot` re-export 删除（`github-changes.ts:57`）；`reconcileFileIndexRevisionIds` re-export 删除（`:192`）。
- `filesBackfillSubtreeContentRevisionIds` 调用保留（VFS 公开 API；不影响）。
- 现有 github-desktop 行为：克隆 / 拉取 / 检出 / 提交 / 推送 / 切分支 / 比对 / 冲突解决——**全部不变**。
- 性能：每次打开仓库多算一次工作区全量 hash——一次性成本，fileIndex 稳定后无持续开销。

## 4. 明确不做的事

- 不动 VFS 公开 API（第八期的活）。
- 不动 `filesBackfillSubtreeContentRevisionIds`（VFS 自身 backfill 工具）。
- 不动 `diffFileIndexes`（hash 比对；与 revision 无关）。
- 不动 github-desktop 写流程（`writeWorkingTreeFile` 等）—— `expectedContentRevisionId` 透传是第八期与第九期的工作；第十期只清理 fileIndex 索引层。
- 不在 github-desktop 内"加回"任何形式的"应用层 revision 缓存"。
- 不动 iCode / vscode / Produde。

## 5. 建议实施顺序

1. **删 `github-revision-diff.ts`** 整文件 + 它的 test。
2. **删 `github-sync-meta.ts` 的 `revisionId` 字段 / `reconcileFileIndexRevisionIds` / `buildFileIndexFromRevisionSnapshot` / `GithubRevisionSnapshotEntry`**；`persistBaselineFromFiles` 删 `revisionIds` 入参。
3. **删 `github-working-tree.ts` 的 `collectWorkingTreeRevisionSnapshot`**。
4. **重写 `github-changes.ts`**：`detectGithubChanges` / `persistBaselineFromWorkingTree` / `persistBaselineForCommittedChanges` / `stampFileIndexRevisionIdsFromWorkingTree`（删除） / `ensureGithubRevisionIdsReady`。同步清理 re-export。
5. **全仓 grep `contentRevisionId` / `revisionId` / `GithubRevisionSnapshotEntry` / `reconcileFileIndexRevisionIds` / `buildFileIndexFromRevisionSnapshot` / `diffRevisionSnapshot`**——确认仅在 `filesBackfillSubtreeContentRevisionIds`（VFS API）与 `github-changes.ts:217`（`detectGithubChanges` 内部）保留。
6. **跑回归**：github-desktop 克隆 / 拉取 / 检出 / 提交 / 推送 / 切分支 / 冲突解决；iCode / vscode 应用层无回归。

## 6. 状态

未实施。第八期 VFS API 上线后即可开工。本期改动集中在 `src/apps/github-desktop/` 与 `src/apps/files/files-baseline.ts`（删入参）。代码量减少（删的 > 加的）；性能影响仅在"打开仓库时多算一次全量 hash"。
