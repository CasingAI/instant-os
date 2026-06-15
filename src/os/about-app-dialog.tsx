import type { ComponentType } from 'preact'
import { createPortal } from 'preact/compat'
import { GeneratedAppIcon } from '../apps/generated/generated-app-icon.tsx'
import { getFloatingOverlayRoot } from '../ui/floating-overlay-root.ts'
import './about-os-dialog.css'

export type AboutAppLink = {
  href: string
  label: string
}

export type AboutAppSpec = {
  label: string
  value: string
}

export type AboutAppLayout = 'default' | 'about-this-device'

export type AboutAppContent = {
  title: string
  version?: string
  icon?: ComponentType<{ size?: number }>
  iconEmoji?: string
  themeColor?: string
  layout?: AboutAppLayout
  paragraphs?: string[]
  list?: string[]
  specs?: AboutAppSpec[]
  links?: AboutAppLink[]
  onMoreInfo?: () => void
}

type AboutAppDialogProps = AboutAppContent & {
  onClose: () => void
  closing?: boolean
}

function AboutThisDeviceDialog({
  title,
  version,
  icon: Icon,
  iconEmoji,
  themeColor,
  specs,
  onMoreInfo,
  onClose,
  closing,
  dialogId,
}: AboutAppDialogProps & { dialogId: string }) {
  return (
    <div class={`about-os-backdrop${closing ? ' about-os-backdrop--closing' : ''}`} role="presentation" onClick={onClose}>
      <div
        class={`about-os-dialog about-os-dialog--device${closing ? ' about-os-dialog--closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogId}
        onClick={(event) => event.stopPropagation()}
      >
        <header class="about-os-dialog__titlebar">
          <div class="about-os-dialog__controls">
            <button
              type="button"
              class="about-os-dialog__control about-os-dialog__control--close"
              aria-label="关闭"
              onClick={onClose}
            />
            <span class="about-os-dialog__control about-os-dialog__control--minimize about-os-dialog__control--disabled" aria-hidden="true" />
            <span class="about-os-dialog__control about-os-dialog__control--fullscreen about-os-dialog__control--disabled" aria-hidden="true" />
          </div>
          <span class="about-os-dialog__titlebar-label">{title}</span>
        </header>
        <div class="about-os-dialog__body">
          <div class="about-os-dialog__icon about-os-dialog__icon--device">
            {Icon && <Icon size={96} />}
            {!Icon && iconEmoji && themeColor && (
              <GeneratedAppIcon emoji={iconEmoji} themeColor={themeColor} size={96} />
            )}
          </div>
          <h2 class="about-os-dialog__title about-os-dialog__title--device" id={dialogId}>
            {title}
          </h2>
          {version && <p class="about-os-dialog__version about-os-dialog__version--device">{version}</p>}
          {specs && specs.length > 0 && (
            <dl class="about-os-dialog__device-specs">
              {specs.map((spec) => (
                <div key={`${spec.label}-${spec.value}`} class="about-os-dialog__device-spec">
                  <dt>{spec.label}</dt>
                  <dd>{spec.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        {onMoreInfo && (
          <div class="about-os-dialog__actions about-os-dialog__actions--device">
            <button
              type="button"
              class="about-os-dialog__btn"
              onClick={() => {
                onMoreInfo()
                onClose()
              }}
            >
              更多信息...
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function AboutAppDialog({
  title,
  version,
  icon: Icon,
  iconEmoji,
  themeColor,
  layout = 'default',
  paragraphs,
  list,
  specs,
  links,
  onMoreInfo,
  closing,
  onClose,
}: AboutAppDialogProps) {
  const dialogId = `about-${title.replace(/\s+/g, '-').toLowerCase()}-title`

  if (layout === 'about-this-device') {
    return createPortal(
      <AboutThisDeviceDialog
        title={title}
        version={version}
        icon={Icon}
        iconEmoji={iconEmoji}
        themeColor={themeColor}
        layout={layout}
        specs={specs}
        onMoreInfo={onMoreInfo}
        closing={closing}
        onClose={onClose}
        dialogId={dialogId}
      />,
      getFloatingOverlayRoot(),
    )
  }

  return createPortal(
    <div class={`about-os-backdrop${closing ? ' about-os-backdrop--closing' : ''}`} role="presentation" onClick={onClose}>
      <div
        class={`about-os-dialog${closing ? ' about-os-dialog--closing' : ''}`}
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
          {(paragraphs?.length || list?.length || specs?.length || links?.length) && (
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
              {specs && specs.length > 0 && (
                <dl class="about-os-dialog__specs">
                  {specs.map((spec) => (
                    <div key={`${spec.label}-${spec.value}`} class="about-os-dialog__spec">
                      <dt class="about-os-dialog__spec-label">{spec.label}</dt>
                      <dd class="about-os-dialog__spec-value">{spec.value}</dd>
                    </div>
                  ))}
                </dl>
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
