import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const outputDir = process.argv.includes('--public')
  ? path.join(rootDir, 'public')
  : path.join(rootDir, 'dist')

const MANIFEST_FORMAT = 'instant-os-ext-app-manifest'
const MANIFEST_SCHEMA_VERSION = 1

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function extractSvgInner(svg) {
  const match = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/i)
  return match ? match[1].trim() : svg
}

function extractSvgViewBox(svg) {
  const match = svg.match(/viewBox="([^"]+)"/i)
  return match ? match[1] : '0 0 64 64'
}

function buildSplashSvg(background, iconSvg) {
  const viewBox = extractSvgViewBox(iconSvg)
  const inner = extractSvgInner(iconSvg)

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="splash">
  <rect width="512" height="512" fill="${background}"/>
  <svg x="128" y="128" width="256" height="256" viewBox="${viewBox}">
    ${inner}
  </svg>
</svg>
`
}

function writeFileEnsured(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, contents, 'utf8')
}

function main() {
  const buildingDist = outputDir.endsWith(`${path.sep}dist`)
  if (buildingDist && !fs.existsSync(outputDir)) {
    throw new Error('dist 目录不存在，请先执行 vite build')
  }

  const appConfig = readJsonFile(path.join(rootDir, 'app.config.json'))
  const packageJson = readJsonFile(path.join(rootDir, 'package.json'))
  const iconSourcePath = path.join(rootDir, appConfig.iconSource)

  if (!fs.existsSync(iconSourcePath)) {
    throw new Error(`找不到图标源文件：${appConfig.iconSource}`)
  }

  const iconSvg = fs.readFileSync(iconSourcePath, 'utf8')
  const iconOutputPath = path.join(outputDir, 'icon.svg')
  const splashLightPath = path.join(outputDir, 'splash-light.svg')
  const splashDarkPath = path.join(outputDir, 'splash-dark.svg')
  const manifestPath = path.join(outputDir, 'instant-os.manifest.json')

  writeFileEnsured(iconOutputPath, iconSvg)
  writeFileEnsured(splashLightPath, buildSplashSvg('#ffffff', iconSvg))
  writeFileEnsured(splashDarkPath, buildSplashSvg('#000000', iconSvg))

  const manifest = {
    format: MANIFEST_FORMAT,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    id: appConfig.id,
    name: appConfig.name,
    description: appConfig.description,
    version: packageJson.version,
    entry: 'index.html',
    icon: 'icon.svg',
    splash: {
      light: 'splash-light.svg',
      dark: 'splash-dark.svg',
    },
    themeColor: appConfig.themeColor,
    tags: appConfig.tags,
  }

  writeFileEnsured(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)

  console.info('[ext-app-template] 已生成：')
  console.info(`  - ${path.relative(rootDir, manifestPath)}`)
  console.info(`  - ${path.relative(rootDir, iconOutputPath)}`)
  console.info(`  - ${path.relative(rootDir, splashLightPath)}`)
  console.info(`  - ${path.relative(rootDir, splashDarkPath)}`)
}

main()
