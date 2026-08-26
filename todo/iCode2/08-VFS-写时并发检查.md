# 第八期：VFS 写时并发检查

> 建立时间：2026-08-26
> 期次：第八期（VFS 层；与第十二期解耦）
> 涉及项目：`instant-app`（VFS / iCode agent / vscode AI 框架 / github-desktop）
> 状态：未实施
> 前置：无（VFS 内部改动）
> 后续：第九期（iCode agent 用运行时拦截器接入本期原语）+ 第十期（github-desktop 拆旁路）；第十一期（运行时 hook）不依赖本期
> 与第一至六期 / 第十二期解耦

目标：给通用 VFS 写 API 加可选的「期望内容版本」。调用方在**自己上次读到内容时**记下版本，写入时带上；存储层对比当前版本与传入值，不等则抛「版本不匹配」。这是存储原语，类似比较并交换：不感知是谁在写、不自动替调用方填写期望值。iCode agent 怎么记住「上次读到的版本」由第九期走运行时拦截器完成；github-desktop 自己传。第八期只做存储层——不接入任何 agent，不在写入口上挂全局钩子。

## 1. 为什么要有第八期

### 1.1 现状

- VFS 节点 metadata 已有 `contentRevisionId`（`src/apps/files/files-api.ts:97`），是文件内容发生变化时单调递增的戳。
- `FilesApiEntry`（`src/apps/files/files-api.ts:86-101`）的 `filesStat` / `filesList` / `filesReadText` 都会带上 `contentRevisionId`；读端用得上。
- **写端** `filesWriteText` / `filesWriteBinary`（`src/apps/files/files-api.ts:388-395`、`:604-617`）目前**没有** `expectedContentRevisionId` 参数——VFS 层不校验，调用方无法用 VFS 原生 API 实现"被外部改过就拒绝"。
- 应用层自维护：github-desktop 在 `src/apps/github-desktop/github-revision-diff.ts` 自己维护 `contentRevisionId` 与 `hash` 的对应表来比对；这是**应用私有**的能力，不可被 iCode agent 等其他写方复用。
- 写入口**不得**在内部偷偷「现看版本再当作期望」——那会让校验空转。期望版本只来自调用方明确传入。谁在何时传入，是运行时策略（第十一 / 九期）或应用自己（第十期）。

### 1.2 对话面板那期留下的口子

- iCode agent 写草稿时，如果用户在源码 tab 改了同一文件，**没有存储层兜底**。
- 第十二期（对话外壳）把「用户改的代码可能被 AI 覆盖」当成已知取舍，不在那期做并发检查。
- 第十二期**不依赖**本期；真正的「记读、写时核对」在第九期。

### 1.3 已有形态对照

| 系统 | 写时并发检查 | 位置 |
|---|---|---|
| Cursor / Cline / Continue | 读时记 hash；写时比对；不等就拒 | 各 agent 私有 |
| 本仓库 github-desktop | 应用层维护 `GithubFileIndexEntry.revisionId`；写时由 `github-revision-diff` 给 `needsHashCheck` 提示 | `src/apps/github-desktop/` |
| 本仓库 VFS | 读时已有 `contentRevisionId`；**写时不校验**（本期补） | `src/apps/files/` |

第八期要做的，是把"写时按 `contentRevisionId` 校验"这条**下放到 VFS 公开 API**。`contentRevisionId` 已经是 VFS 自己的字段，没必要让应用层各自维护 hash/sha 缓存。

## 2. 已拍板规则

### 2.1 VFS 写 API 加可选参数

- `filesWriteText(path, text, options?: { expectedContentRevisionId?: string })`：`expectedContentRevisionId` 与当前节点 `contentRevisionId` 不等时抛 `FilesContentRevisionMismatchError`（新错误类型，带 path / expected / current 字段）。
- `filesWriteBinary(path, bytes, options?: { ... })`：同上。
- `filesWriteBytesRange`（range write）：同上，参数位置一致。
- `filesUpsertBatch`：批量项的每条带 `expectedContentRevisionId`；任一不等则整批回滚（与现有"任一失败整批回滚"语义一致）。
- `filesSetSparse` / `filesMkdir` / `filesCreateText` / `filesCreateBinary` / `filesRemove` / `filesRename` / `filesTrash` / `filesRestore` / `filesMove` / `filesCopy`：**不**加 revisionId 校验——这些是结构性/创建性操作，"被外部修改"语义不适用。

### 2.2 错误类型

新增 `FilesContentRevisionMismatchError`（位置：`src/apps/files/files-api.ts` 现有 `FilesPathExistsError` 旁边）：

```ts
class FilesContentRevisionMismatchError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly expected: string | undefined,
    public readonly current: string | undefined,
  ) { super(message) }
}
```

错误信息中文："文件 /path 已被外部修改（expected=xxx, current=yyy），请重读后重试"。

### 2.3 不做"自动重读并合并"

第八期只做"拒并要求重读"——**不**做 auto-merge / 三方合并 / diff 应用。AI agent 拿到错误后由模型自己决定怎么合。

### 2.4 旧调用方不受影响

`expectedContentRevisionId` 是**可选**——不传则行为与现一致（盲写）。所有现有调用方（iCode agent / github-desktop / 文件管理器 / 任何使用 `filesWriteText` 的地方）自动兼容。

### 2.5 与第十一期 / 第九期的边界

- **第八期**：只动存储公开写接口：可选期望版本 + 不等则拒。不做钩子，不替调用方填写期望值。
- **第十一期**：Instant Node 实例上的跨沙箱拦截链。不实现版本比对。不依赖本期。
- **第九期**：在 agent 用的实例上挂拦截器，记住上次读到的版本，写时把期望版本传入本期原语。
- **第十期**：github-desktop 不走 Instant Node，自己往本期原语传期望版本（并拆掉它现在那套应用层 revision 优化）。

## 3. 与第十二期的关系

- 第十二期只换对话外壳，不做写时并发。
- 本期不改第十二期；两期可并行。

## 4. 验收清单

- `filesWriteText(path, text, { expectedContentRevisionId: 'rev1' })` 在节点当前 `contentRevisionId === 'rev1'` 时成功；不等时抛 `FilesContentRevisionMismatchError`，错误带 path / expected / current。
- `filesWriteText(path, text)`（不传 options）行为与现一致——盲写通过。
- `filesWriteBytesRange` / `filesWriteBinary` / `filesUpsertBatch` 同步覆盖。
- 结构性操作（`filesMkdir` / `filesCreateText` / `filesCreateBinary` / `filesRemove` / `filesRename` / `filesTrash` / `filesMove` / `filesCopy` / `filesSetSparse`）**不**抛 `FilesContentRevisionMismatchError`。
- 现有调用方（github-desktop / iCode / 文件管理器 / 任何使用 `filesWriteText` 的地方）**不**因第八期改动而行为变化。
- 错误信息可被模型读取并自修（中文，可读）。

## 5. 明确不做的事

- 不做 auto-merge / 三方合并 / 文本 diff 应用。
- **不在第八期接入任何 agent**——iCode agent 由第九期接入，github-desktop 由第十期接入。
- **不在第八期做 hook 框架**——运行时拦截链由第十一期立项；也不在文件系统公开入口上挂全局钩子。
- 不改第十二期（对话面板）。
- 不动 `contentRevisionId` 的生成算法（已是单调递增戳，保持）。
- 不动 `filesWatch` 触发 revisionId 变更的逻辑（已经正确，第八期不破）。
- 不动 iCode 以外的 agent（vscode / Produde）的写流程。

## 6. 建议实施顺序

1. VFS 层 `writeTextFile` / `writeBinaryFile` / `writeFileBytesRange`（`src/apps/files/files-vfs.ts`）加 `expectedContentRevisionId` 校验。
2. 公开 API `filesWriteText` / `filesWriteBinary` / `filesWriteBytesRange`（`src/apps/files/files-api.ts`）加 `options?: { expectedContentRevisionId?: string }` 透传。
3. 新增 `FilesContentRevisionMismatchError` 类型。
4. `filesUpsertBatch`（`src/apps/files/files-api.ts:635`）批项带 `expectedContentRevisionId`；任一失败整批回滚。
5. 测试：构造两个客户端同时写，第二个写方带旧 revisionId 应被拒。
6. 文档：在 `src/apps/files/files-api.ts` 顶部 JSDoc 简述新参数。

## 7. 状态

未实施。第八期仅做存储原语；运行时拦截链由第十一期独立立项（可与本期并行）；agent 接入由第九期处理；github-desktop 由第十期处理。
