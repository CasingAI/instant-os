# App Data 目录 TODO

`/Applications/{appId}.app/Data/` 是每个应用的「应用私有文件目录」（真实文件，计入数据空间 / 与用户文件同一全局 IndexedDB 存储池，见 `files-app-data-root.ts`）。

## 现状

- 应用数据（键值类）已统一迁入 **App Registry**（IndexedDB，`src/os/app-registry.ts`），不再使用本目录存 JSON 副本。
- 迁移前的 `weather.json`、`app-data.json` 等是过渡产物，已在 `runAppRegistryMigration()` 启动迁移时删除。
- 当前**没有任何应用**使用本目录。

## TODO

- [ ] 为需要保存**用户不可见**的大体积私有文件（MP3、图片、缓存等）的应用提供正式 API：
  - 写入应通过系统层 VFS 直写 API（当前 `APP_DATA_ROOT_ATTRIBUTES` 为 `writable: false`，文件管理器 / 终端只读浏览）。
  - 应用不想把这些文件混在用户可见的 Documents 目录时使用本目录。
  - 需新增配额统计与清理入口（可参考 `files-app-data-quota.ts` 与设置页「应用数据」分类）。

## 相关代码

- `src/apps/files/files-app-data-root.ts` — Data 目录名与路径工具
- `src/os/app-registry-migration.ts` — 旧 Data JSON 副本清理（`deleteLegacyAppDataFiles`）
- `src/os/app-registry.ts` — 键值应用数据注册表（替代本目录的旧用途）
