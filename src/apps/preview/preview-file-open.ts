import { registerFileOpenHandler } from '../../os/file-open-registry.ts'
import { PREVIEW_OPEN_EXTENSIONS } from '../../preview/preview-kind.ts'

registerFileOpenHandler({
  appId: 'preview',
  extensions: [...PREVIEW_OPEN_EXTENSIONS],
  rank: 5,
})
