import { registerFileOpenHandler } from '../../os/file-open-registry.ts'

registerFileOpenHandler({
  appId: 'pages',
  extensions: ['pages', 'md', 'markdown'],
  rank: 4,
})
