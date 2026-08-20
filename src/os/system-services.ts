/**
 * 系统服务目录：集中 import 全部服务 client（副作用注册），
 * 并在开机时按持久化启动类型拉起。
 *
 * 面板在应用未打开时也能列出全部服务，因为这些 client 模块在此被加载。
 */
import '../ai/model-tokenizer-client.ts'
import '../apps/vscode/vscode-workspace-search.ts'
import '../apps/vscode/vscode-typescript-resolve-client.ts'
import {
  getServiceStartupType,
  subscribeServiceStartupSettings,
} from './service-startup-settings-storage.ts'
import {
  applyWorkerServiceStartup,
  setWorkerServiceStartupType,
} from './service-supervisor.ts'
import {
  listWorkerHeapReports,
  WORKER_HEAP_SERVICE_IDS,
  type ServiceStartupType,
  type WorkerHeapServiceId,
} from './worker-heap-reports.ts'

function resolveDefaultStartupType(id: WorkerHeapServiceId): ServiceStartupType {
  const report = listWorkerHeapReports().find((item) => item.id === id)
  return report?.defaultStartupType ?? 'manual'
}

function resolveStartupType(id: WorkerHeapServiceId): ServiceStartupType {
  return getServiceStartupType(id, resolveDefaultStartupType(id))
}

/** 仅同步启动类型（设置变更时）；不因「自动」重复拉起已停止的服务 */
function syncAllStartupTypes(): void {
  for (const id of WORKER_HEAP_SERVICE_IDS) {
    setWorkerServiceStartupType(id, resolveStartupType(id))
  }
}

/** 开机：同步类型并按自动/延迟拉起 */
function bootAllServices(): void {
  for (const id of WORKER_HEAP_SERVICE_IDS) {
    applyWorkerServiceStartup(id, resolveStartupType(id))
  }
}

/**
 * 开机挂载：按持久化设置应用启动类型（自动→立即拉起，延迟→排 10s），
 * 并订阅设置变更只同步类型（禁用会停；不会把已停止的自动服务再次拉起）。
 * 返回取消订阅函数。
 */
export function startSystemServices(): () => void {
  bootAllServices()
  return subscribeServiceStartupSettings(() => {
    syncAllStartupTypes()
  })
}
