import { registerFileOpenHandler } from '../../os/file-open-registry.ts'
import { MUSIC_AUDIO_EXTENSIONS, MUSIC_LYRICS_EXTENSIONS } from './music-storage.ts'

registerFileOpenHandler({
  appId: 'music',
  extensions: [...MUSIC_AUDIO_EXTENSIONS, ...MUSIC_LYRICS_EXTENSIONS],
  rank: 10,
})
