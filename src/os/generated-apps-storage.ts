/**
 * 已安装生成应用的读取 / 保存入口：委托 generated-apps-store。
 * 生成应用本体存于 Contents 真实文件，localStorage 仅索引；
 * 同步读走内存缓存，异步写走 files 层。
 */
import type { GeneratedAppRecord } from '../apps/appstore/types.ts'
import {
  getGeneratedAppIndexBytes,
  loadInstalledAppsFromCache,
  saveInstalledAppsToFiles,
} from './generated-apps-store.ts'

/** 同步读取已安装生成应用（内存缓存；启动 hydrate 后即有数据） */
export function loadInstalledApps(): GeneratedAppRecord[] {
  return loadInstalledAppsFromCache()
}

/** 异步保存全部已安装生成应用（差分写 Contents）；成功返回 true */
export async function saveInstalledApps(apps: GeneratedAppRecord[]): Promise<boolean> {
  return saveInstalledAppsToFiles(apps)
}

/** 生成应用本体索引的 localStorage 字节（轻量） */
export function getInstalledAppsStorageBytes(): number {
  return getGeneratedAppIndexBytes()
}
