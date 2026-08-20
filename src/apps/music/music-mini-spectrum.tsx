import { useEffect, useState } from 'preact/hooks'
import { getMusicPlayerState, subscribeMusicPlayer } from './music-player.ts'
import { MusicSpectrumCanvas } from './music-spectrum-canvas.tsx'

/**
 * 播放器栏 ♪ 徽标位的迷你频谱：有曲目时显示 5 柱跳动频谱，否则显示 ♪。
 */
export function MusicMiniSpectrum() {
  const [hasTrack, setHasTrack] = useState(() => Boolean(getMusicPlayerState().current))

  useEffect(() => {
    return subscribeMusicPlayer(() => setHasTrack(Boolean(getMusicPlayerState().current)))
  }, [])

  if (!hasTrack) {
    return (
      <span class="music__player-note" aria-hidden="true">
        ♪
      </span>
    )
  }
  return (
    <span class="music__player-note music__player-note--spectrum" aria-hidden="true">
      <MusicSpectrumCanvas mode="bars" barCount={5} className="music__mini-spectrum" />
    </span>
  )
}
