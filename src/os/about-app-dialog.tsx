import type { ComponentType } from 'preact'
import { createPortal } from 'preact/compat'
import { GeneratedAppIcon } from '../apps/generated/generated-app-icon.tsx'
import { getFloatingOverlayRoot } from '../ui/floating-overlay-root.ts'
import './about-os-dialog.css'

export type AboutAppLink = {
  href: string
  label: string
}

export type AboutAppContent = {
  title: string
  version?: string
  icon?: ComponentType<{ size?: number }>
  iconEmoji?: string
  themeColor?: string
  paragraphs?: string[]
  list?: string[]
  links?: AboutAppLink[]
}

type AboutAppDialogProps = AboutAppContent & {
  onClose: () => void
}

export function AboutAppDialog({
  title,
  version,
  icon: Icon,
  iconEmoji,
  themeColor,
  paragraphs,
  list,
  links,
  onClose,
}: AboutAppDialogProps) {
  const dialogId = `about-${title.replace(/\s+/g, '-').toLowerCase()}-title`

  return createPortal(
    <div class="about-os-backdrop" role="presentation" onClick={onClose}>
      <div
        class="about-os-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogId}
        onClick={(event) => event.stopPropagation()}
      >
        <div class="about-os-dialog__body">
          <div class="about-os-dialog__icon">
            {Icon && <Icon size={64} />}
            {!Icon && iconEmoji && themeColor && (
              <GeneratedAppIcon emoji={iconEmoji} themeColor={themeColor} size={64} />
            )}
          </div>
          <h2 class="about-os-dialog__title" id={dialogId}>
            {title}
          </h2>
          {version && <p class="about-os-dialog__version">{version}</p>}
          {(paragraphs?.length || list?.length || links?.length) && (
            <div class="about-os-dialog__copy">
              {paragraphs?.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {list && list.length > 0 && (
                <ul>
                  {list.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
              {links && links.length > 0 && (
                <p class="about-os-dialog__links">
                  {links.map((link) => (
                    <a
                      key={link.href}
                      class="about-os-dialog__link"
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {link.label}
                    </a>
                  ))}
                </p>
              )}
            </div>
          )}
        </div>
        <div class="about-os-dialog__actions">
          <button type="button" class="about-os-dialog__btn" onClick={onClose}>
            好
          </button>
        </div>
      </div>
    </div>,
    getFloatingOverlayRoot(),
  )
}
