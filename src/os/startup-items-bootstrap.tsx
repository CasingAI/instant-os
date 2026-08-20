import { useEffect } from 'preact/hooks'
import { useStartupItemsShellHost } from './startup-items-host.ts'
import { startStartupItemsService } from './startup-items-service.ts'

/**
 * 桌面就绪后执行一次用户配置的启动项。
 * 放在 GeneratedAppsProvider 内，以便 instant.listApps / openApp 能覆盖生成应用与外链应用。
 */
export function StartupItemsBootstrap() {
  const host = useStartupItemsShellHost()

  useEffect(() => {
    // 应用数据迁移已并入启动流程（main.tsx：localStorage → 注册表）
    return startStartupItemsService(host)
  }, [host])

  return null
}
