/** 启动时应用已保存的 NPM 源设置（须在 re-export 前副作用执行） */
import '../os/npm-registry-settings-storage.ts'

export {
  allowPackageHost,
  cancelPackageTask,
  getPackageServiceConfig,
  getPackageTask,
  installPackages,
  listInstalled,
  listPackageTasks,
  outdatedPackages,
  resolvePackageProjectRoot,
  setPackageServiceConfig,
  uninstallPackages,
} from './package-service.ts'
export { subscribePackageEvents } from './package-events.ts'
export type {
  InstantPackageLock,
  PackageLogLine,
  PackageServiceConfig,
  PackageServiceEvent,
  PackageTask,
  PackageTaskKind,
  PackageTaskStatus,
} from './package-types.ts'
export { DEFAULT_PACKAGE_SERVICE_CONFIG } from './package-types.ts'
