export type PageCurlShadowKey = 'underlay' | 'edge' | 'front' | 'back'

export type PageCurlShadowOptions = Record<PageCurlShadowKey, boolean>

export const DEFAULT_PAGE_CURL_SHADOWS: PageCurlShadowOptions = {
  underlay: true,
  edge: true,
  front: true,
  back: true,
}

export function togglePageCurlShadow(
  shadows: PageCurlShadowOptions,
  key: PageCurlShadowKey,
  checked: boolean,
): PageCurlShadowOptions {
  return { ...shadows, [key]: checked }
}

export function shadowToggleValues(shadows: PageCurlShadowOptions): number[] {
  return [shadows.underlay, shadows.edge, shadows.front, shadows.back].map((enabled) => enabled ? 1 : 0)
}
