/**
 * 仅测试用：在 Node 下模拟浏览器 window，让 FILES_MOUNTS_CHANGED_EVENT 能派发，
 * 从而 files-vfs 的挂载变更缓存失效订阅生效。
 * 必须在导入 files-vfs（及其传递依赖）之前先导入本模块。
 */
class FakeWindowEventTarget {
  private listeners = new Map<string, Set<(event: Event) => void>>()

  addEventListener(type: string, listener: (event: Event) => void): void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(listener)
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  dispatchEvent(event: Event): boolean {
    for (const listener of this.listeners.get(event.type) ?? []) {
      listener(event)
    }
    return true
  }

  // 进度包装器（runFilesOpWithProgress）依赖 window 计时器；Node 下委托给全局
  setTimeout(handler: () => void, timeout?: number): number {
    return setTimeout(handler, timeout) as unknown as number
  }

  clearTimeout(handle?: number): void {
    clearTimeout(handle as unknown as ReturnType<typeof setTimeout>)
  }

  setInterval(handler: () => void, timeout?: number): number {
    return setInterval(handler, timeout) as unknown as number
  }

  clearInterval(handle?: number): void {
    clearInterval(handle as unknown as ReturnType<typeof setInterval>)
  }
}

if (typeof globalThis.window === 'undefined') {
  ;(globalThis as Record<string, unknown>).window = new FakeWindowEventTarget()
}

export {}
