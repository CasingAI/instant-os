/**
 * Apple app icon composition grid (1024 canvas proportions scaled to 100×100).
 * Matches the keylines in Apple's design templates: rounded rect, center cross,
 * outer content circle (~80% width), inner circle, and diagonal guides.
 */
type AppIconDesignGridProps = {
  class?: string
}

export function AppIconDesignGrid({ class: className }: AppIconDesignGridProps) {
  return (
    <svg
      class={className}
      viewBox="0 0 100 100"
      width="100%"
      height="100%"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <rect
        x="0.5"
        y="0.5"
        width="99"
        height="99"
        rx="22"
        ry="22"
        fill="none"
        stroke="currentColor"
        stroke-width="0.75"
        opacity="0.4"
      />
      <line x1="50" y1="0" x2="50" y2="100" stroke="currentColor" stroke-width="0.5" opacity="0.28" />
      <line x1="0" y1="50" x2="100" y2="50" stroke="currentColor" stroke-width="0.5" opacity="0.28" />
      <circle cx="50" cy="50" r="39.0625" fill="none" stroke="currentColor" stroke-width="0.75" opacity="0.4" />
      <circle cx="50" cy="50" r="28.125" fill="none" stroke="currentColor" stroke-width="0.5" opacity="0.28" />
      <line x1="0" y1="0" x2="100" y2="100" stroke="currentColor" stroke-width="0.5" opacity="0.16" />
      <line x1="100" y1="0" x2="0" y2="100" stroke="currentColor" stroke-width="0.5" opacity="0.16" />
    </svg>
  )
}
