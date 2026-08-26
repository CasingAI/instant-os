/**
 * 第十一期：运行时宿主 syscall hook。
 * 沙箱里的脚本调文件 / 网络 / 终端壳层，只要真正离开沙箱打到宿主，
 * 都经过同一条拦截链。链按实例在创建时挂上（见 QuickJsInstanceOptions.interceptors），
 * 不做进程级默认列表。拦截器看到的是「系统调用名 + 已从沙箱解出的宿主参数」，
 * 不接触沙箱句柄；解参数仍由各内建模块负责。
 *
 * 系统调用名按「域.动作」：
 * - file.readFile / file.writeFile / file.stat …（全部文件桥）
 * - network.fetch / network.fetchStream.read / network.fetchStream.cancel
 * - shell.openApp / shell.git.status …（instant.* 宿主命令）
 * 纯计算内建（路径拼接、缓冲区等）不出沙箱，不进链。
 */

/** 一次跨沙箱调用。before 钩子可原地改写 params 字段，真正实现读到的就是改写后的值 */
export type QuickJsSyscallInvocation = {
  /** 稳定名字，形如 file.writeFile */
  name: string
  /** 已解出的宿主侧参数；实现层可把结果观测值（如新版本戳）回填进来自供 after 使用 */
  params: Record<string, unknown>
}

export type QuickJsSyscallInterceptor = {
  /** 描述性名字，调试日志用 */
  readonly name?: string
  /** 名字过滤：返回 false 的调用整体跳过本拦截器；缺省匹配所有 */
  readonly matches?: (syscallName: string) => boolean
  /**
   * 调用前：可改写 invocation.params 补参 / 改参；
   * 抛错即拒绝 —— 真正实现不会执行，沙箱看到与实现层失败一致的错误。
   */
  before?(invocation: QuickJsSyscallInvocation): void | Promise<void>
  /** 调用后：看到成功结果（实现层回填进 params 的观测字段同样可见） */
  after?(invocation: QuickJsSyscallInvocation, result: unknown): void | Promise<void>
  /** 失败时观察；原错误继续冒泡给沙箱，不被吞掉 */
  onError?(invocation: QuickJsSyscallInvocation, error: unknown): void | Promise<void>
}

export type QuickJsSyscallChain = {
  /**
   * 包装一次真正的宿主实现调用。impl 收到（可能被 before 改写过）的 params。
   * 未挂任何拦截器时各内建拿到的是 undefined，直接走原路径零包装。
   */
  dispatch<T>(
    name: string,
    params: Record<string, unknown>,
    impl: (params: Record<string, unknown>) => Promise<T> | T,
  ): Promise<T>
}

function warnHookFailure(where: string, name: string, error: unknown): void {
  // 拦截器自己的钩子挂了不能静默：从这里报出去（不替换主流程的结果 / 错误）
  console.error(`[quickjs-syscall] interceptor ${where} hook failed for ${name}:`, error)
}

/** 有拦截器才生成链；否则返回 undefined，内建模块完全不包装（行为与未引入本机制一致） */
export function createQuickJsSyscallChain(
  interceptors: readonly QuickJsSyscallInterceptor[] | undefined,
): QuickJsSyscallChain | undefined {
  if (!interceptors || interceptors.length === 0) return undefined
  const list: readonly QuickJsSyscallInterceptor[] = [...interceptors]
  const select = (name: string): QuickJsSyscallInterceptor[] =>
    list.filter((itp) => !itp.matches || itp.matches(name))
  return {
    async dispatch<T>(
      name: string,
      params: Record<string, unknown>,
      impl: (params: Record<string, unknown>) => Promise<T> | T,
    ): Promise<T> {
      const invocation: QuickJsSyscallInvocation = { name, params }
      const picked = select(name)
      // 调用前整条跑完才进真正实现；任一 before 抛错即拒绝
      for (const itp of picked) {
        if (itp.before) await itp.before(invocation)
      }
      let result: unknown
      try {
        result = await impl(params)
      } catch (error) {
        for (const itp of picked) {
          if (!itp.onError) continue
          try {
            await itp.onError(invocation, error)
          } catch (hookError) {
            warnHookFailure('onError', name, hookError)
          }
        }
        throw error
      }
      for (const itp of picked) {
        if (!itp.after) continue
        try {
          await itp.after(invocation, result)
        } catch (hookError) {
          warnHookFailure('after', name, hookError)
        }
      }
      return result as T
    },
  }
}

/**
 * 内建侧惯用法：有链就过链，没链直接跑实现。
 * put 在各内建注入模块里，避免每个调用点重复判断。
 */
export function dispatchSyscallIfExists<T>(
  chain: QuickJsSyscallChain | undefined,
  name: string,
  params: Record<string, unknown>,
  impl: (params: Record<string, unknown>) => Promise<T> | T,
): Promise<T> | T {
  if (!chain) return impl(params)
  return chain.dispatch(name, params, impl)
}
