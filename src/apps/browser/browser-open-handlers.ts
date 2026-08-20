import { registerFileOpenHandler } from '../../os/file-open-registry.ts'
import { registerUrlOpenHandler } from '../../os/url-open-registry.ts'

registerFileOpenHandler({
  appId: 'browser',
  extensions: ['html', 'htm', 'xhtml', 'svg'],
  rank: 10,
})

registerUrlOpenHandler({ appId: 'browser', rank: 20 })
