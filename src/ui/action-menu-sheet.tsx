import type { ComponentChildren } from 'preact'
import './overlay-presence.css'
import './action-menu-sheet.css'

export type ActionMenuSheetMount = 'contained' | 'portal'

type ActionMenuSheetProps = {
  mount: ActionMenuSheetMount
  exiting: boolean
  title: string
  ariaLabel?: string
  headerStart?: ComponentChildren
  headerEnd?: ComponentChildren
  footer?: ComponentChildren
  onBackdropClose: () => void
  children: ComponentChildren
}

export function ActionMenuSheet({
  mount,
  exiting,
  title,
  ariaLabel,
  headerStart,
  headerEnd,
  footer,
  onBackdropClose,
  children,
}: ActionMenuSheetProps) {
  return (
    <div
      class={[
        'action-menu-sheet__backdrop',
        'overlay-presence__backdrop',
        exiting ? 'overlay-presence__backdrop--exiting' : '',
        mount === 'portal' ? 'action-menu-sheet__backdrop--portal' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="presentation"
      onClick={onBackdropClose}
    >
      <div
        class={[
          'action-menu-sheet',
          'overlay-presence__sheet',
          exiting ? 'overlay-presence__sheet--exiting' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
        onClick={(event) => event.stopPropagation()}
      >
        <header
          class={[
            'action-menu-sheet__header',
            headerStart ? 'action-menu-sheet__header--with-start' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {headerStart}
          <h2 class="action-menu-sheet__title">{title}</h2>
          {headerEnd ?? <span class="action-menu-sheet__header-spacer" aria-hidden="true" />}
        </header>

        <div class="action-menu-sheet__body">{children}</div>

        {footer}
      </div>
    </div>
  )
}
