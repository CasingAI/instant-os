/**
 * 系统启动项：桌面就绪后按顺序执行用户配置的 JavaScript 命令。
 * 执行环境与终端一致（QuickJS + instant shell），但不打开终端窗口。
 */
import { wrapTerminalProgramEval } from '../apps/terminal/terminal-repl-program-eval.ts'
import { createQuickJsInstance } from '../quickjs/quickjs-public.ts'
import type { InstantShellHost } from '../terminal/instant-shell/instant-shell-types.ts'
import { appendSystemDebugLog } from './system-debug-log.ts'
import { getResolvedSystemEnv } from './system-env-settings-storage.ts'
import { getEnabledStartupItems, type StartupItem } from './startup-items-settings-storage.ts'

const WORKSPACE_ROOT = '/user'
/** 单条启动命令超时（避免一项卡死阻塞后续项）。 */
const STARTUP_ITEM_TIMEOUT_MS = 60_000

function itemLabel(item: StartupItem): string {
  const label = item.label.trim()
  if (label) {
    return label
  }
  const command = item.command.trim().replace(/\s+/g, ' ')
  return command.length > 48 ? `${command.slice(0, 48)}…` : command
}

async function runOneStartupItem(item: StartupItem, host: InstantShellHost): Promise<void> {
  const startedAt = Date.now()
  const label = itemLabel(item)
  const instance = await createQuickJsInstance({
    workspaceRoot: WORKSPACE_ROOT,
    env: getResolvedSystemEnv(),
    instantShellHost: host,
    timeoutMs: STARTUP_ITEM_TIMEOUT_MS,
  })
  try {
    const result = await instance.eval(wrapTerminalProgramEval(item.command), {
      timeoutMs: STARTUP_ITEM_TIMEOUT_MS,
      waitUntilIdle: true,
    })
    const durationMs = Date.now() - startedAt
    if (!result.ok) {
      appendSystemDebugLog({
        layer: 'system',
        op: 'startup-item-error',
        detail: `${label}: ${result.error}`,
        durationMs,
        force: true,
      })
      return
    }
    appendSystemDebugLog({
      layer: 'system',
      op: 'startup-item-ok',
      detail: label,
      durationMs,
    })
  } finally {
    instance.destroy()
  }
}

/** 按顺序执行全部已启用启动项；单项失败不阻断后续项。 */
export async function runStartupItems(host: InstantShellHost): Promise<void> {
  const items = getEnabledStartupItems()
  if (items.length === 0) {
    return
  }

  appendSystemDebugLog({
    layer: 'system',
    op: 'startup-items-begin',
    detail: `${items.length} item(s)`,
  })

  for (const item of items) {
    try {
      await runOneStartupItem(item, host)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      appendSystemDebugLog({
        layer: 'system',
        op: 'startup-item-error',
        detail: `${itemLabel(item)}: ${message}`,
        force: true,
      })
    }
  }

  appendSystemDebugLog({
    layer: 'system',
    op: 'startup-items-end',
    detail: `${items.length} item(s)`,
  })
}

/**
 * 挂载时触发一次启动项执行。
 * @returns 取消函数（组件卸载时调用，阻止尚未开始的执行）
 */
export function startStartupItemsService(host: InstantShellHost): () => void {
  let cancelled = false

  void (async () => {
    // 等当前帧的 OS 接线（如 registerOsOpenApp）完成后再跑
    await Promise.resolve()
    if (cancelled) {
      return
    }
    await runStartupItems(host)
  })()

  return () => {
    cancelled = true
  }
}
