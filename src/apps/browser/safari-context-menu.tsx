export type { AdaptiveActionMenuItem as SafariContextMenuItem } from '../../ui/adaptive-action-menu.tsx'

export type SafariContextMenuTarget =
  | { kind: 'link'; url: string }
  | { kind: 'image'; url: string }
  | { kind: 'page' }
