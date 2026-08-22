import { registerFileOpenHandler } from '../../os/file-open-registry.ts'

registerFileOpenHandler({
  appId: 'downloader',
  extensions: ['metalink'],
  rank: 1,
})
