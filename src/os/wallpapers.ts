export type WallpaperKind = 'gradient' | 'solid' | 'pattern'

export type BuiltinWallpaper = {
  id: string
  name: string
  kind: WallpaperKind
  background: string
  backgroundSize?: string
  backgroundPosition?: string
  overlay?: string
}

export const DEFAULT_WALLPAPER_ID = 'ocean'

export const BUILTIN_WALLPAPERS: BuiltinWallpaper[] = [
  {
    id: 'ocean',
    name: '海洋',
    kind: 'gradient',
    background:
      'radial-gradient(ellipse 120% 80% at 50% 120%, rgba(255, 255, 255, 0.35) 0%, transparent 55%), linear-gradient(180deg, #4facfe 0%, #2f76c0 38%, #1c4f8f 100%)',
    overlay:
      'radial-gradient(circle at 20% 15%, rgba(255, 255, 255, 0.18) 0%, transparent 35%), radial-gradient(circle at 78% 28%, rgba(255, 255, 255, 0.12) 0%, transparent 30%)',
  },
  {
    id: 'sunset',
    name: '日落',
    kind: 'gradient',
    background:
      'radial-gradient(ellipse 100% 70% at 50% 110%, rgba(255, 220, 180, 0.45) 0%, transparent 55%), linear-gradient(180deg, #ff9a76 0%, #ff6b6b 42%, #c44569 100%)',
    overlay:
      'radial-gradient(circle at 30% 20%, rgba(255, 255, 255, 0.2) 0%, transparent 40%), radial-gradient(circle at 75% 35%, rgba(255, 200, 150, 0.15) 0%, transparent 35%)',
  },
  {
    id: 'aurora',
    name: '极光',
    kind: 'gradient',
    background:
      'radial-gradient(ellipse 90% 60% at 20% 30%, rgba(120, 255, 200, 0.35) 0%, transparent 50%), radial-gradient(ellipse 80% 55% at 80% 25%, rgba(180, 120, 255, 0.3) 0%, transparent 45%), linear-gradient(180deg, #0f2027 0%, #203a43 45%, #2c5364 100%)',
    overlay:
      'radial-gradient(circle at 50% 15%, rgba(255, 255, 255, 0.08) 0%, transparent 30%)',
  },
  {
    id: 'dawn',
    name: '晨曦',
    kind: 'gradient',
    background:
      'radial-gradient(ellipse 110% 75% at 50% 100%, rgba(255, 200, 220, 0.4) 0%, transparent 55%), linear-gradient(180deg, #ffd1dc 0%, #ffb7c5 38%, #e8a0bf 100%)',
    overlay:
      'radial-gradient(circle at 25% 18%, rgba(255, 255, 255, 0.25) 0%, transparent 38%)',
  },
  {
    id: 'meadow',
    name: '草地',
    kind: 'gradient',
    background:
      'radial-gradient(ellipse 100% 70% at 50% 115%, rgba(200, 255, 180, 0.35) 0%, transparent 55%), linear-gradient(180deg, #7ec850 0%, #56ab2f 42%, #2d6a1e 100%)',
    overlay:
      'radial-gradient(circle at 70% 22%, rgba(255, 255, 255, 0.15) 0%, transparent 32%)',
  },
  {
    id: 'lavender',
    name: '薰衣草',
    kind: 'gradient',
    background:
      'radial-gradient(ellipse 100% 75% at 50% 110%, rgba(220, 200, 255, 0.4) 0%, transparent 55%), linear-gradient(180deg, #c9b1ff 0%, #9b7fd4 42%, #6b4fa0 100%)',
    overlay:
      'radial-gradient(circle at 35% 20%, rgba(255, 255, 255, 0.18) 0%, transparent 36%)',
  },
  {
    id: 'midnight',
    name: '午夜',
    kind: 'gradient',
    background:
      'radial-gradient(ellipse 80% 55% at 60% 20%, rgba(80, 100, 180, 0.25) 0%, transparent 50%), linear-gradient(180deg, #1a1a2e 0%, #16213e 45%, #0f3460 100%)',
    overlay:
      'radial-gradient(circle at 15% 12%, rgba(255, 255, 255, 0.06) 0%, transparent 28%)',
  },
  {
    id: 'citrus',
    name: '柑橘',
    kind: 'gradient',
    background:
      'radial-gradient(ellipse 100% 70% at 50% 105%, rgba(255, 240, 150, 0.4) 0%, transparent 55%), linear-gradient(180deg, #f7d794 0%, #f5a623 42%, #e67e22 100%)',
    overlay:
      'radial-gradient(circle at 40% 18%, rgba(255, 255, 255, 0.2) 0%, transparent 35%)',
  },
  {
    id: 'slate',
    name: '石板灰',
    kind: 'solid',
    background: '#3a3a3c',
  },
  {
    id: 'silver',
    name: '银灰',
    kind: 'solid',
    background: '#c7c7cc',
  },
  {
    id: 'coral',
    name: '珊瑚',
    kind: 'solid',
    background: '#ff6b6b',
  },
  {
    id: 'mint',
    name: '薄荷',
    kind: 'solid',
    background: '#98d8c8',
  },
  {
    id: 'sky',
    name: '晴空',
    kind: 'solid',
    background: '#87ceeb',
  },
  {
    id: 'charcoal',
    name: '炭黑',
    kind: 'solid',
    background: '#2c2c2e',
  },
  {
    id: 'cream',
    name: '米白',
    kind: 'solid',
    background: '#f5f0e8',
  },
  {
    id: 'rose',
    name: '玫瑰',
    kind: 'solid',
    background: '#e8a0bf',
  },
  {
    id: 'grid-light',
    name: '浅灰网格',
    kind: 'pattern',
    background:
      'linear-gradient(rgba(0, 0, 0, 0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 0, 0, 0.07) 1px, transparent 1px), #e8e8ed',
    backgroundSize: '22px 22px',
  },
  {
    id: 'grid-blue',
    name: '深蓝网格',
    kind: 'pattern',
    background:
      'linear-gradient(rgba(255, 255, 255, 0.14) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.14) 1px, transparent 1px), #2f4f7a',
    backgroundSize: '36px 36px',
  },
  {
    id: 'grid-bold',
    name: '粗线网格',
    kind: 'pattern',
    background:
      'linear-gradient(rgba(255, 255, 255, 0.22) 2px, transparent 2px), linear-gradient(90deg, rgba(255, 255, 255, 0.22) 2px, transparent 2px), linear-gradient(180deg, #5b9be8 0%, #2f76c0 100%)',
    backgroundSize: '48px 48px',
  },
  {
    id: 'dots-soft',
    name: '柔和圆点',
    kind: 'pattern',
    background:
      'radial-gradient(circle, rgba(0, 0, 0, 0.11) 1.4px, transparent 1.4px), #f2f2f7',
    backgroundSize: '18px 18px',
  },
  {
    id: 'dots-night',
    name: '夜空星点',
    kind: 'pattern',
    background:
      'radial-gradient(circle, rgba(255, 255, 255, 0.35) 1px, transparent 1px), radial-gradient(circle, rgba(255, 255, 255, 0.15) 1px, transparent 1px), #1a1a2e',
    backgroundSize: '24px 24px, 24px 24px',
    backgroundPosition: '0 0, 12px 12px',
  },
  {
    id: 'stripes-diagonal',
    name: '斜纹',
    kind: 'pattern',
    background:
      'repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.1) 0, rgba(255, 255, 255, 0.1) 2px, transparent 2px, transparent 14px), #2c5364',
  },
  {
    id: 'stripes-horizontal',
    name: '横条纹',
    kind: 'pattern',
    background:
      'repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.12) 0, rgba(255, 255, 255, 0.12) 3px, transparent 3px, transparent 22px), #6b4fa0',
  },
  {
    id: 'checker',
    name: '棋盘格',
    kind: 'pattern',
    background:
      'linear-gradient(45deg, rgba(0, 0, 0, 0.07) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.07) 75%), linear-gradient(45deg, rgba(0, 0, 0, 0.07) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.07) 75%), #d4d4d8',
    backgroundSize: '28px 28px',
    backgroundPosition: '0 0, 14px 14px',
  },
  {
    id: 'crosshatch',
    name: '十字纹',
    kind: 'pattern',
    background:
      'repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.06) 0, rgba(0, 0, 0, 0.06) 1px, transparent 1px, transparent 14px), repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.06) 0, rgba(0, 0, 0, 0.06) 1px, transparent 1px, transparent 14px), #f5f0e8',
  },
  {
    id: 'graph-paper',
    name: '方格纸',
    kind: 'pattern',
    background:
      'linear-gradient(rgba(120, 160, 220, 0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(120, 160, 220, 0.35) 1px, transparent 1px), linear-gradient(rgba(120, 160, 220, 0.55) 1px, transparent 1px), linear-gradient(90deg, rgba(120, 160, 220, 0.55) 1px, transparent 1px), #fffef8',
    backgroundSize: '14px 14px, 14px 14px, 70px 70px, 70px 70px',
  },
]

const wallpaperById = new Map(BUILTIN_WALLPAPERS.map((wallpaper) => [wallpaper.id, wallpaper]))

export function getBuiltinWallpaper(id: string): BuiltinWallpaper | undefined {
  return wallpaperById.get(id)
}

export function resolveBuiltinWallpaper(id: string): BuiltinWallpaper {
  return getBuiltinWallpaper(id) ?? wallpaperById.get(DEFAULT_WALLPAPER_ID)!
}

export function wallpaperPresentationStyle(
  wallpaper: BuiltinWallpaper,
): Record<string, string> {
  const style: Record<string, string> = {
    background: wallpaper.background,
  }

  if (wallpaper.backgroundSize) {
    style.backgroundSize = wallpaper.backgroundSize
  }

  if (wallpaper.backgroundPosition) {
    style.backgroundPosition = wallpaper.backgroundPosition
  }

  return style
}

/** 正方形缩略图：背景居中裁切，渐变叠加层一并展示。 */
export function wallpaperPreviewStyle(wallpaper: BuiltinWallpaper): Record<string, string> {
  const layers = wallpaper.overlay
    ? `${wallpaper.overlay}, ${wallpaper.background}`
    : wallpaper.background

  const style: Record<string, string> = {
    background: layers,
    backgroundPosition: 'center',
    backgroundRepeat: wallpaper.kind === 'pattern' ? 'repeat' : 'no-repeat',
  }

  if (wallpaper.backgroundSize) {
    style.backgroundSize = wallpaper.backgroundSize
  }

  return style
}
