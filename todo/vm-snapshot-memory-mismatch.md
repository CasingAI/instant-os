# VM 快照恢复内存不匹配问题

## 现象

加载快照时 v86 WASM 崩溃：

```
Uncaught RuntimeError: memory access out of bounds
    at v86.wasm._RNvMs0_NtCshLrrydh1LUZ_8dlmalloc...insert_large_chunk
    ...
panicked at src/rust/jit.rs:89:70:
called `Result::unwrap()` on an `Err` value: "WouldBlock"
```

把虚拟机内存调到最大值（2032 MB）后不再报错。

## 根因

v86 的快照里保存了保存时的 `memory_size` 和 `vga_memory_size`。`restore_state` 时只是把这些值写回，**不会重新分配 WASM 内存**。如果当前虚拟机配置内存小于快照保存时的内存，后续访问内存就会越界。

相关源码：

- `Instant-virtual-machine/vendor/v86-src/src/cpu.js:629-636`
  - `CPU.prototype.set_state` 只设置 `this.memory_size[0]`，不扩容 WASM memory。
- `Instant-virtual-machine/vendor/v86-src/src/vga.js:465-467`
  - `VGAScreen.prototype.set_state` 只设置 `this.vga_memory_size`，不重新分配 SVGA memory。

堆栈中的 `WouldBlock` panic 是继发问题：内存损坏后鼠标 IRQ 重入 Rust JIT，触发了 `jit.rs:89` 的 `JIT_STATE.try_lock().unwrap()` 失败。

## 已做的临时修复

- `src/apps/virtual-machine/virtual-machine-disks.ts`
  - 快照文件不再走异步流式读取（`loadDisk(..., allowStream = false)`），因为 v86 的 `initial_state` 要求完整同步 buffer。
  - 提交：`a6d1f87 fix(virtual-machine): 快照文件不再走异步流式读取`

## 待办修复

### 1. 启动前自动读取快照内存需求并覆盖配置

位置：`src/apps/virtual-machine/virtual-machine-disks.ts`

v86 快照格式（见 `Instant-virtual-machine/vendor/v86-src/src/state.js:1-11`）：

```javascript
const STATE_MAGIC = 0x86768676|0;
const STATE_INDEX_MAGIC = 0;
const STATE_INDEX_VERSION = 1;
const STATE_INDEX_TOTAL_LEN = 2;
const STATE_INDEX_INFO_LEN = 3;
const STATE_INFO_BLOCK_START = 16;
```

实现步骤：

1. 新增 `peekSnapshotMemorySizes(stateBuffer: ArrayBuffer)`：
   - 读取前 16 字节 Int32Array，校验 `STATE_MAGIC` 和 `STATE_VERSION`。
   - 读取 `STATE_INFO_BLOCK_START` 到 `info_len` 的 JSON。
   - 从 JSON `state[0]` 拿到 `memory_size`，从 `state[52][0]` 拿到 `vga_memory_size`。
   - 返回 MB 单位。
2. 在 `loadVirtualMachineDisks` 返回结果里增加 `stateMemoryHint?: { memoryMb: number; vgaMemoryMb: number }`。
3. 在 `VirtualMachineApp` 启动流程里，如果快照 hint 存在：
   - 方案 A：自动把当前机器配置提升到快照所需大小（用户无感知）。
   - 方案 B：暂停启动，弹窗提示用户"快照需要 X MB 内存，当前为 Y MB"，确认后修改配置再启动。

### 2. 运行时 iframe 内显示错误

位置：`Instant-virtual-machine/src/v86-runtime.ts`

当前 `start()` 里 `new V86(options)` 和 `restore_state` 抛出的同步 `RuntimeError` 不会被 `try/await` 捕获。需要：

1. 在 `new V86` 和 `restore_state` 周围加 `try/catch`。
2. 调用 `setBootMessage()` 把错误显示在启动屏上（而不是只出现在控制台）。
3. 通过 `hostRef?.post()` 发 `error` 消息给宿主，宿主弹窗提示用户。

### 3. v86 源码层防御性检查（可选）

位置：`Instant-virtual-machine/vendor/v86-src/src/state.js`

在 `restore_state` 开头校验快照内存需求：

```javascript
const state_memory_size = info_block_obj.state[0];
if (state_memory_size > cpu.wasm_memory.buffer.byteLength) {
    throw new StateLoadError(
        `Snapshot requires memory_size=${state_memory_size}, ` +
        `but current memory is only ${cpu.wasm_memory.buffer.byteLength}. ` +
        `Please increase memory size before restoring.`
    );
}
```

这能让错误信息更明确，但不能自动修复问题。

## 决策点

- 自动提升内存 vs 弹窗提示用户确认？
- 是否同时在运行时 iframe 内显示错误？（建议做，覆盖所有未知崩溃）
- 是否修改 v86 源码？（建议只做防御性检查，不改内存分配逻辑）
