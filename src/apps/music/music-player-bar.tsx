import { useEffect, useState } from 'preact/hooks'
import {
  getMusicPlayerState,
  playNext,
  playPrevious,
  seekTo,
  setMusicVolume,
  subscribeMusicPlayer,
  togglePlay,
  type MusicPlayerState,
} from './music-player.ts'
import { formatTrackDuration } from './music-storage.ts'
import { MusicMiniSpectrum } from './music-mini-spectrum.tsx'

function PlayIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5.14v13.72a1 1 0 0 0 1.52.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z" fill="currentColor" />
    </svg>
  )
}

function PauseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" />
      <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" />
    </svg>
  )
}

function PreviousIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 5h2v14H7zM19 5.5v13a1 1 0 0 1-1.56.83L9.6 13.2V10.8l7.84-4.13A1 1 0 0 1 19 5.5Z" fill="currentColor" />
    </svg>
  )
}

function NextIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 5h2v14h-2zM5 5.5v13a1 1 0 0 0 1.56.83l7.84-4.13V10.8L6.56 6.67A1 1 0 0 0 5 5.5Z" fill="currentColor" />
    </svg>
  )
}

function VolumeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3 9.5v5a1 1 0 0 0 1 1h3.1l4.36 3.6A1 1 0 0 0 13 18.3V5.7a1 1 0 0 0-1.54-.8L7.1 8.5H4a1 1 0 0 0-1 1Z"
        fill="currentColor"
      />
      <path
        d="M16 8.2a1 1 0 0 1 1.42 1.3 3.9 3.9 0 0 1 0 4.9 1 1 0 1 1-1.5-1.32 1.9 1.9 0 0 0 0-2.26 1 1 0 0 1 .08-1.42Z"
        fill="currentColor"
      />
      <path
        d="M18.8 5.9a1 1 0 0 1 1.42 1.3 7.9 7.9 0 0 1 0 9.6 1 1 0 0 1-1.6-1.2 5.9 5.9 0 0 0 0-7.2 1 1 0 0 1 .18-1.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function MusicPlayerBar() {
  const [state, setState] = useState<MusicPlayerState>(() => getMusicPlayerState())

  useEffect(() => subscribeMusicPlayer(() => setState(getMusicPlayerState())), [])

  const { current, isPlaying, loading, currentTime, duration, volume, error, sourceKind, queue } =
    state
  const canStep = sourceKind === 'library' && queue.length > 1

  return (
    <div class="music__player-bar">
      <div class="music__player-progress">
        <span class="music__player-time">{formatTrackDuration(currentTime)}</span>
        <input
          class="music__player-slider music__player-progress-slider"
          type="range"
          min={0}
          max={Math.max(duration, 0)}
          step={0.5}
          value={Math.min(currentTime, duration)}
          disabled={duration <= 0}
          aria-label="播放进度"
          onInput={(event) => seekTo(Number((event.target as HTMLInputElement).value))}
        />
        <span class="music__player-time">{formatTrackDuration(duration)}</span>
      </div>

      {error ? (
        <div class="music__player-error">{error}</div>
      ) : (
        <div class="music__player-controls">
          <div class="music__player-track">
            <MusicMiniSpectrum />
            <div class="music__player-track-meta">
              <div class="music__player-title" title={current?.title}>
                {current?.title ?? '未在播放'}
              </div>
              <div class="music__player-artist">{current?.artist ?? '未知艺人'}</div>
            </div>
          </div>

          <div class="music__player-buttons">
            <button
              type="button"
              class="music__player-btn"
              disabled={!canStep}
              aria-label="上一首"
              title="上一首"
              onClick={playPrevious}
            >
              <PreviousIcon />
            </button>
            <button
              type="button"
              class="music__player-btn music__player-btn--play"
              disabled={!current || loading}
              aria-label={isPlaying ? '暂停' : '播放'}
              title={isPlaying ? '暂停' : '播放'}
              onClick={togglePlay}
            >
              {loading ? <span class="music__player-spinner" aria-hidden="true" /> : isPlaying ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button
              type="button"
              class="music__player-btn"
              disabled={!canStep}
              aria-label="下一首"
              title="下一首"
              onClick={playNext}
            >
              <NextIcon />
            </button>
          </div>

          <div class="music__player-volume">
            <VolumeIcon />
            <input
              class="music__player-slider music__player-volume-slider"
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(volume * 100)}
              aria-label="音量"
              onInput={(event) => setMusicVolume(Number((event.target as HTMLInputElement).value) / 100)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
