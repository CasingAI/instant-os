import { registerFileOpenHandler } from '../../os/file-open-registry.ts'

registerFileOpenHandler({
  appId: 'textedit',
  extensions: ['txt'],
  rank: 10,
})
