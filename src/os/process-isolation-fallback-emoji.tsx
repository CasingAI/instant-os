import { PROCESS_ISOLATION_FALLBACK_EMOJI } from './process-isolation-fallback.ts'

type ProcessIsolationFallbackEmojiProps = {
  variant: 'banner' | 'list' | 'detail'
}

export function ProcessIsolationFallbackEmoji({ variant }: ProcessIsolationFallbackEmojiProps) {
  return (
    <span
      class={`process-isolation-fallback-emoji process-isolation-fallback-emoji--${variant}`}
      aria-hidden="true"
    >
      {PROCESS_ISOLATION_FALLBACK_EMOJI}
    </span>
  )
}
