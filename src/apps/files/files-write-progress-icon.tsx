/**
 * 写入中文件的行内进度图标（替换原文件图标位，Finder 风格）：
 * 已知总量（expectedSize）画比例填充的圆饼；未知总量画旋转弧线。
 * 传入 node 且为文件夹时改为叠加：文件夹图标保留，右下角叠小圆饼，
 * 表示「已占位、还没就绪」（粘贴/导入/解压正在填充的目标文件夹）。
 *
 * 圆饼本体在 FilesOpProgressPie；迷你窗走横条，不复用这套绘制。
 */
import type { FilesNode } from './files-types.ts'
import { FilesNodeIcon } from './files-node-icon.tsx'
import { FilesOpProgressPie } from './files-op-progress-pie.tsx'
import type { FilesWriteProgressEntry } from './files-write-progress.ts'

export function FilesWriteProgressGlyph({
  node,
  entry,
  size = 'grid',
}: {
  /** 提供且为文件夹时：图标保留 + 右下角叠小圆饼；否则整个图标位换成圆饼 */
  node?: FilesNode
  entry: FilesWriteProgressEntry
  size?: 'list' | 'grid'
}) {
  // 登记表直接给百分比：undefined 画旋转弧、0 画灰底占位盘、>0 画扇形
  const fraction = entry.fraction
  if (node?.kind === 'folder') {
    return (
      <span
        class={`files-write-progress files-write-progress--${size} files-write-progress--folder`}
        aria-hidden="true"
      >
        <FilesNodeIcon node={node} size={size} />
        <span class="files-write-progress__badge">
          <FilesOpProgressPie fraction={fraction} />
        </span>
      </span>
    )
  }
  return (
    <span class={`files-write-progress files-write-progress--${size}`} aria-hidden="true">
      <FilesOpProgressPie fraction={fraction} />
    </span>
  )
}
