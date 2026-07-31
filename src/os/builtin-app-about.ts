import { InstantLogoIcon } from '../icons/app-icons.tsx'
import type { AboutAppContent } from './about-app-dialog.tsx'
import { collectDeviceInfo } from './collect-device-info.ts'
import type { BuiltinAppAbout } from './builtin-app-about-data.ts'
import { BUILTIN_APP_ABOUT } from './builtin-app-about-data.ts'

export type { BuiltinAppAbout }
export { BUILTIN_APP_ABOUT }

export async function getThisDeviceAbout(): Promise<AboutAppContent> {
  const specs = await collectDeviceInfo()
  const osSpec = specs.find((s) => s.label === '操作系统')
  const browserSpec = specs.find((s) => s.label === '浏览器')
  const cpuSpec = specs.find((s) => s.label === '处理器')
  const memSpec = specs.find((s) => s.label === '内存')
  const displaySpec = specs.find((s) => s.label === '显示器')

  const deviceSpecs = [
    osSpec && { label: '操作系统', value: osSpec.value },
    browserSpec && { label: '浏览器', value: browserSpec.value },
    cpuSpec && { label: '处理器', value: cpuSpec.value },
    memSpec && { label: '内存', value: memSpec.value },
    displaySpec && { label: '显示器', value: displaySpec.value },
  ].filter((spec): spec is { label: string; value: string } => Boolean(spec))

  return {
    title: 'Instant OS',
    version: '版本 1.2.0',
    icon: InstantLogoIcon,
    layout: 'about-this-device',
    specs: deviceSpecs,
  }
}

export const INSTANT_ABOUT: AboutAppContent = {
  title: 'Instant OS',
  version: '版本 1.2.0',
  icon: InstantLogoIcon,
  paragraphs: [
    'Instant OS 是一个在浏览器中运行的 AI 桌面操作系统。它复刻经典 macOS / iOS 的视觉与交互，让你无需安装即可体验完整的「桌面 + 应用」环境。',
    '平台定位：以 AI 实时生成为核心——网页浏览器可还原任意网页，应用集市可现场创作并安装微应用，一切即开即用、即时可用。',
  ],
  links: [{ href: 'https://github.com/CasingAI/instant-os', label: 'GitHub：CasingAI/instant-os' }],
}
