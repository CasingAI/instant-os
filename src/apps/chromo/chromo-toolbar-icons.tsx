export function ChromoStarIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 1.6 9.76 6.1 14.6 6.4 10.9 9.4 12.1 14.2 8 11.6 3.9 14.2 5.1 9.4 1.4 6.4 6.24 6.1 Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        stroke-width="1.2"
        stroke-linejoin="round"
      />
    </svg>
  )
}

export function ChromoMoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="3.5" r="1.35" fill="currentColor" />
      <circle cx="8" cy="8" r="1.35" fill="currentColor" />
      <circle cx="8" cy="12.5" r="1.35" fill="currentColor" />
    </svg>
  )
}

export function ChromoSparkleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 1.4 9.15 6.1 14 7.5 9.15 8.9 8 13.6 6.85 8.9 2 7.5 6.85 6.1 Z"
        fill="currentColor"
      />
      <path d="M12.4 2.2 12.9 3.7 14.4 4.2 12.9 4.7 12.4 6.2 11.9 4.7 10.4 4.2 11.9 3.7 Z" fill="currentColor" />
    </svg>
  )
}
