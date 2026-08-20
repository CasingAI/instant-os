# QuickJS 流式写重复 eval 崩溃调查（memory access out of bounds）

> 状态：**已修复（2026-08-08）**。根因：asyncify 构建中 `*Sync`（asyncified）函数在
> pending-job / 宿主回调里挂起时，raw export（`QTS_ExecutePendingJob` / `QTS_Call`）绕过
> ccall 的 async 路径，drain 循环重入破坏 asyncify 状态。修复：async-bridge 复刻 ccall
> async 路径（`Asyncify.Qa` 变化检测 + whenDone 等 rewind），drain/宿主回调异步化+串行化。
> 修复前这是**既有潜在 bug**（原始代码即可复现），并阻塞「终端流式下载」Phase 2 的落地；
> 修复后 Phase 2（WriteStream 真增量落盘）已重新落地并通过全部回归。

---

## 1. 结论先行

- **不是内存上限**。QuickJS 实例虽有 `setMemoryLimit(128 MiB)`（`src/quickjs/quickjs-quotas.ts`），但崩溃时 wasm 线性内存占用为 **0 MB**，且错误是 asyncify 状态被破坏后的堆损坏（`free_zero_refcount` / `memory access out of bounds`）——setMemoryLimit 触顶会走干净的 `out of memory`（项目分类器 `quickjs-runtime-fatal.ts` 明确区分二者）。
- **真实机制**（已实证）：
  1. guest job（`executePendingJobs` 驱动的 promise 续体）或宿主回调（timer/microtask/nextTick 经 `callFunction`）内调用 `*Sync`（`newAsyncifiedFunction`）→ `qts_host_call_function` 返回 pending Promise → `Asyncify.handleSleep` 挂起。
  2. 挂起沿 wasm 栈展开——在 release 构建里 `QTS_ExecutePendingJob` / `QTS_Call` 是**全 number 参数导出**，`cwrap` 走捷径直接返回 raw export（**绕过 ccall**），于是没有 `whenDone().then(onDone)` 的 async 处理：raw export 直接返回挂起标记，`Asyncify.currData` 残留已保存栈。
  3. 挂起未结算期间，drain 循环 / 下一次 eval 再次调用 raw export → 在未清理的 asyncify 状态下重入 → 栈/堆损坏；debug 构建对应断言 `The call to QTS_ExecutePendingJob is running asynchronously`，release 表现为第 3 次 `createWriteStream + write + end` eval 必崩（3/3 稳定）。
- **可靠最小复现（修复前）**：同一 QuickJS 实例上，第 3 次执行 `createWriteStream + write + end` eval 必然崩溃；更简：`.then` job 里 `fs.readFileSync` 第 2~3 次必崩。

## 2. 修复内容（`src/quickjs/quickjs-async-bridge.ts`）

1. **挂起感知的 job 泵** `executePendingJobsSuspensionAware`：调 raw `_QTS_ExecutePendingJob` 前后比对 `module.Asyncify.Qa`（currData），变化即注册 `Asyncify.Wa`（whenDone 处理器）等 rewind 完成再结算结果——复刻 ccall `{async:true}` 路径，drain 循环在挂起期间暂停而非重入。
2. **挂起感知的宿主→guest 回调** `callFunctionSuspensionAware`：同上复刻 `_QTS_Call` 的挂起检测与 whenDone 等待；`runGuestCallback`（microtask/nextTick/timer 回调）全部改走该路径。
3. **异步化 + 串行化**：`drainAfterSync` 返回 `Promise` 且经 `drainChain` 串行（避免 eval 泵 / 定时器 / deferred 结算并发重入 wasm）；`flushHostTasks`/`enqueueHostTask` 支持异步任务并经 `hostTaskDrain` 串行。
4. 调用方同步更新：`quickjs-instance.ts`（eval 泵 / waitForIdle 全 await）、`quickjs-fs.ts`（`runCallback` 的 drain 任务 await）。

关键实现细节：
- raw export 指针在 `module._QTS_ExecutePendingJob` / `module._QTS_Call`（cwrap 捷径产物）；**runtime 指针是 `runtime.rt.value`**（runtime 本身无 `.value`，踩过：传 `undefined` 会触发 `null function or function signature mismatch`）。
- `Asyncify.Wa` 由挂起结算（wakeUp→rewind）以最终返回值 resolve；drain 串行化保证同一时刻至多一个 whenDone 在途。
- 修复后 `executePendingJobs` 返回 `OK(0)`（raw 标记）时循环不再立即重入：挂起由当次调用自行等待 rewind，rewind 会跑完剩余 jobs（含被挂起 eval 的续体）。

## 3. 修复前的最小复现（存档）

```ts
// node --experimental-strip-types repro.ts
import 'fake-indexeddb/auto'
import { createQuickJsInstance } from './src/quickjs/quickjs-instance.ts'
import { resetFilesDbForTests } from './src/apps/files/files-storage.ts'
import { filesMkdir } from './src/apps/files/files-api.ts'
await resetFilesDbForTests()
await filesMkdir('/user/proj')
const instance = await createQuickJsInstance({ workspaceRoot: '/user/proj', cwd: '/user/proj' })
for (let i = 0; i < 3; i++) {
  const r = await instance.eval(`(async function () {
    var fs = require('fs')
    return await new Promise(function (resolve, reject) {
      var ws = fs.createWriteStream('out' + ${i} + '.txt')
      ws.on('error', reject)
      ws.on('finish', function () { try { resolve(fs.readFileSync('out' + ${i} + '.txt').length) } catch (e) { reject(e) } })
      for (var k = 0; k < 8; k++) { ws.write(Buffer.from('xy')) }
      ws.end()
    })
  })()`, { waitUntilIdle: true })
  console.log(i, r.ok, r.ok ? r.value : String(r.error).slice(0, 60))
}
```

修复前：`iter 0/1 ok`，`iter 2` 崩溃 `QuickJS: cannot handle error in suspended function RuntimeError: memory access out of bounds`（wasm 栈帧 `QTS_NewError`）。修复后：8+ 次稳定，`.then`+`readFileSync`、timer+`readFileSync`、ENOENT 错误路径、2 MiB 背压写入、destroy 中断清理均稳定。

## 4. 机制分析细节（勘察记录）

崩溃栈特征（修复前）：
```
QuickJS: cannot handle error in suspended function RuntimeError: memory access out of bounds
  wasm-function[106] → QTS_NewError        // 挂起态下创建 guest Error 对象时爆栈
```
“cannot handle error in suspended function” 来自 vendor `handleAsyncify` 的 rejection 分支：
```js
result.then(
  resolvedResult => { this.suspended = undefined; done(resolvedResult) },
  error => { console.error("QuickJS: cannot handle error in suspended function", error); this.suspended = undefined },
)
```
——挂起中宿主 Promise 拒绝时**只打日志不调 `done()`**，wasm 永久停留在挂起态，错误被吞。

排查中排除的假设（见 §5）之外的关键事实：
- **eval 顶层 `await` 不挂起**：`QTS_Eval_MaybeAsync` 对 pending guest promise 直接返回句柄（JS 侧轮询），挂起只来自 asyncified 宿主调用（`*Sync`、`loadModuleSource` 等 asyncify import）。
- release 构建 `cwrap` 捷径：全 number 参数导出直接返回 raw export，`QTS_ExecutePendingJob_MaybeAsync`/`QTS_Call_MaybeAsync` 与 sync 版**同对象**（`{async:true}` 从未生效），必须自行复刻 ccall async 路径。
- `module.Asyncify`（`d.Asyncify=X`）暴露了完整状态机（`Qa`=currData、`Wa`=whenDone、`Sa`=exportCallStack、`state`），可安全读/写。

## 5. 修复验证清单

| 场景 | 修复前 | 修复后 |
|------|--------|--------|
| 3× write-only `createWriteStream+write+end`（同实例） | 3/3 崩 | 8× 稳定 ×3 轮 |
| `.then` job 内 `readFileSync` | iter 2 崩 | 6× 稳定 |
| timer 回调内 `readFileSync` | 同类隐患 | 4× 稳定 |
| ENOENT 错误路径（job 内） | 偶发 | 4× 稳定 |
| 纯 `fs.promises.readFile` | 稳定 | 稳定（回归不破） |
| 2 MiB 背压多 chunk 流式写 | — | 稳定 |
| destroy 中断（新建/覆盖） | — | 无残留 / 旧内容保留 |
| quickjs sandbox / terminal-controlled / files 全套 | 通过 | 全绿 + tsc 干净 |

## 6. 遗留

- vendor `handleAsyncify` rejection 分支（挂起中宿主 Promise 拒绝）仍会吞错误并挂起 wasm——本次修复让我们的 asyncified 包装**永不 reject**（一律 `context['fail'](...)` 走 resolve），故不触发；若未来有第三方 promise-returning host 回调抛错，仍会命中该 vendor 缺陷。
- `quickjs-console-cap.test.ts` 在修复前后均失败（`16050 !== 16001`），与本 bug 无关，未处理。
