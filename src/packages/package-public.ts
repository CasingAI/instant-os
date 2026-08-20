/** Instant PackageService 对外门面（系统服务入口）。启动时应用已保存的 NPM 源设置。 */
import '../os/npm-registry-settings-storage.ts'

export {
  allowPackageHost,
  cancelPackageTask,
  estimatePackageStoreBytes,
  getCachedStorePackageDetail,
  getInstalledPackageDetail,
  getPackageServiceConfig,
  installPackages,
  listCachedStorePackages,
  listInstalled,
  listPackageScripts,
  listPackageTasks,
  outdatedPackages,
  resolvePackageProjectRoot,
  setPackageServiceConfig,
  uninstallPackages,
} from './package-service.ts'
export { runNpmScript, runNpx, resolveNpmTmpIdentity } from './package-run.ts'
export { subscribePackageEvents } from './package-events.ts'
export type {
  CachedStorePackage,
  CachedStorePackageDetail,
  InstalledPackageDetail,
} from './package-service.ts'
export type {
  InstantPackageLock,
  PackageInstallCounters,
  PackageInstallReport,
  PackageLogLine,
  PackageServiceConfig,
  PackageServiceEvent,
  PackageTask,
  PackageTaskKind,
  PackageTaskProgress,
  PackageTaskStatus,
} from './package-types.ts'
export { DEFAULT_PACKAGE_SERVICE_CONFIG } from './package-types.ts'
export {
  formatInstallLivePlain,
  formatInstallSuccessPlain,
  formatProgressLine,
} from './package-install-report.ts'
