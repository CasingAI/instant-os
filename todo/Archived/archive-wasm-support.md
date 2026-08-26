# ISO 镜像支持决策记录

> 2026-08-25 拍板。本文只留结论；调研过程与弃用方案见 git 历史。
> 2026-08-26 已全部落地（引擎接入、读写链路、双入口、图标）。

## 结论

- **范围**：只做 ISO（浏览目录树 + 提取文件 + 新建数据镜像）；7z / rar / cab / xz / bz2 / zst 等其余新格式不做——可行后端全部只能读不能写，光能读意义不大。
- **引擎**：`@gcu/iso9660`（MIT，v0.1.0）。纯 JS 约 36 KB、无 wasm，直接进 `src/archive/` Worker 同步路径，与 fflate 同待遇。
- **写边界**：库只能从零构建镜像；「编辑已有 ISO」= 读入目录树 → 内存增删 → `ISOWriter` 重建整盘字节 → **覆盖写回原文件路径**（同 zip / tar 的既有 rewrite 模式）。
- **vendor 方式**：整包拷入。`src/archive/vendor/iso9660/` 收录上游 `src/*.js` + LICENSE + package.json 原样不动（便于对 upstream diff）；类型经手写 `src/index.d.ts` 桥接（仓库既有惯例），不开 allowJs。
- **新建镜像入口**：两处都做——Files 右键「归档 ▸ 压缩为 ISO」（复用 compressNodesToArchiveOp）与压缩包实用工具「新建归档」对话框的 ISO 格式项（SegmentedControl 第三项），与 ZIP / tar.gz 入口完全对称。
- **ISO 光盘图标**：同心环 + 虹彩高光 + 中孔，正圆独立 viewBox（48×48），不沿用折角纸模板；在 `files-node-icon.tsx` 中先于拉链纸图标按扩展名拦截。

## 能力边界

- 读：PVD + Joliet 自动识别、零拷贝读取；中文长文件名靠 Joliet 树。
- 无 Rock Ridge / UDF / El Torito 引导 / 多会话；无 Joliet 的老盘退化为 8.3 大写名。
- 写入侧继承库限制：目录深度 ≤ 8、单文件 ≤ 4 GiB、重复路径报错；空文件夹不进镜像（条目模型是纯文件平铺表，目录由路径前缀推导）。
- pre-1.0 单人项目 → 整包 vendor 进仓库维护。

## 实施要点

- 「不能原地修改」是字节层面的限制，用户不可感知：压缩包工具本就「整个读进内存 → 浏览」，编辑只动内存虚拟树，点保存才重建 + 回写同一路径。不提供「导出副本」作为唯一出口。
- 覆盖写回的安全档可选「临时文件 + 原子替换」（可借 VFS chunk CoW 基建），或交给 OS 回收站/版本机制；压缩工具自身不实现版本管理。
- 魔数识别：sector 16（偏移 0x8001）起 `CD001` 卷描述符序列，判定优先于扩展名；实现在 `archive-iso.ts` 的 `isIsoImageBytes`，接入 `detectArchiveFormat` 后 zip/tar/gzip/iso 四类全走统一 auto 链路。
- 扩展名注册：`.iso` 进 `archive-utility-format.ts` 与 `files-archive.ts` 的 `isArchiveFileName`，口径已统一（后者补上了 `.tar` / `.gz`，现两边同为 zip / tar / tar.gz / tgz / gz / iso）。
- 编解码适配层集中在 `src/archive/archive-iso.ts`（unisoBytes / isoBytes / listIsoEntries / 魔数），Worker decode/list/encode 三条请求路径均已接入；测试见 `archive-iso.test.ts`（挂 `pnpm test:archive`）。
