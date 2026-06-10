import type { BookListing, BookRecordMeta } from './books-types.ts'

type BooksCoverProps = {
  title: string
  author?: string
  coverColor: string
  coverEmoji: string
  size?: 'small' | 'medium' | 'large'
  dimmed?: boolean
  progress?: number
}

const SIZE_MAP = {
  small: { width: 72, emoji: 28, spine: 6 },
  medium: { width: 96, emoji: 36, spine: 8 },
  large: { width: 140, emoji: 52, spine: 10 },
} as const

export function BooksCover({
  title,
  author,
  coverColor,
  coverEmoji,
  size = 'medium',
  dimmed = false,
  progress,
}: BooksCoverProps) {
  const dims = SIZE_MAP[size]

  return (
    <div
      class={`books-cover books-cover--${size}${dimmed ? ' books-cover--dimmed' : ''}`}
      style={{ width: `${dims.width}px` }}
      title={title}
    >
      <div
        class="books-cover__spine"
        style={{
          width: `${dims.spine}px`,
          background: `linear-gradient(90deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.15) 100%)`,
        }}
      />
      <div
        class="books-cover__face"
        style={{
          background: `linear-gradient(145deg, ${lighten(coverColor)} 0%, ${coverColor} 45%, ${darken(coverColor)} 100%)`,
        }}
      >
        <div class="books-cover__gloss" />
        <span class="books-cover__emoji" style={{ fontSize: `${dims.emoji}px` }}>
          {coverEmoji}
        </span>
        <div class="books-cover__meta">
          <span class="books-cover__title">{title}</span>
          {author && <span class="books-cover__author">{author}</span>}
        </div>
        {progress !== undefined && progress < 100 && (
          <div class="books-cover__progress" aria-hidden="true">
            <div class="books-cover__progress-fill" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
    </div>
  )
}

export function listingToCoverProps(listing: BookListing | BookRecordMeta): Omit<BooksCoverProps, 'size' | 'dimmed' | 'progress'> {
  return {
    title: listing.title,
    author: listing.author,
    coverColor: listing.coverColor,
    coverEmoji: listing.coverEmoji,
  }
}

function lighten(hex: string): string {
  return adjustHex(hex, 30)
}

function darken(hex: string): string {
  return adjustHex(hex, -35)
}

function adjustHex(hex: string, amount: number): string {
  const normalized = hex.replace('#', '')
  if (normalized.length !== 6) {
    return hex
  }
  const r = clamp(parseInt(normalized.slice(0, 2), 16) + amount)
  const g = clamp(parseInt(normalized.slice(2, 4), 16) + amount)
  const b = clamp(parseInt(normalized.slice(4, 6), 16) + amount)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, value))
}
