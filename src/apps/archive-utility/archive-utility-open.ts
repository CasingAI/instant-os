import { registerFileOpenHandler } from '../../os/file-open-registry.ts'
import {
  registerFilesContextMenuContribution,
  type FilesContextMenuOpItem,
} from '../../os/file-context-menu-registry.ts'
import { ARCHIVE_UTILITY_OPEN_EXTENSIONS } from './archive-utility-format.ts'

registerFileOpenHandler({
  appId: 'archive-utility',
  extensions: [...ARCHIVE_UTILITY_OPEN_EXTENSIONS],
  rank: 8,
})

registerFilesContextMenuContribution({
  id: 'archive-utility.archive-ops',
  label: '归档',
  matches: ({ canCreateHere }) => canCreateHere,
  buildItems: ({ node, targetNodes, ops }) => {
    const multi = targetNodes.length > 1
    const countLabel = (action: string) => (multi ? `${action} ${targetNodes.length} 项` : action)
    const items: FilesContextMenuOpItem[] = [
      {
        label: countLabel('压缩为 ZIP'),
        onClick: () => ops.compressAsZip(targetNodes),
      },
      {
        label: countLabel('压缩为 tar.gz'),
        onClick: () => ops.compressAsTarGz(targetNodes),
      },
      {
        label: countLabel('压缩为 ISO'),
        onClick: () => ops.compressAsIso(targetNodes),
      },
    ]
    if (!multi && node.kind === 'file' && ops.isArchiveFileName(node.name)) {
      items.push({
        label: '解压到当前文件夹',
        onClick: () => ops.extractHere(node),
      })
    }
    return items
  },
})
