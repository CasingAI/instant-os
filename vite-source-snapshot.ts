import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { Plugin } from 'vite'
import { zipSync } from 'fflate'

const SNAPSHOT_URL = '/source-snapshot.zip'
const SNAPSHOT_FILENAME = 'source-snapshot.zip'
const INCLUDED_EXTENSIONS = new Set(['.ts', '.tsx', '.css', '.svg', '.json'])

function shouldIncludeFile(fileName: string): boolean {
  if (fileName === '.DS_Store') {
    return false
  }
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) {
    return false
  }
  return INCLUDED_EXTENSIONS.has(fileName.slice(dot).toLowerCase())
}

function collectSourceFiles(srcRoot: string): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {}

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry)
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        walk(fullPath)
        continue
      }
      if (!stat.isFile() || !shouldIncludeFile(entry)) {
        continue
      }
      const zipPath = relative(srcRoot, fullPath).split('\\').join('/')
      files[zipPath] = new Uint8Array(readFileSync(fullPath))
    }
  }

  walk(srcRoot)
  return files
}

function buildSourceSnapshotZip(srcRoot: string): Uint8Array {
  const files = collectSourceFiles(srcRoot)
  return zipSync(files, { level: 6 })
}

/** 开发态即时打包 / 构建态写出 dist/source-snapshot.zip */
export function sourceSnapshot(): Plugin {
  let rootDir = process.cwd()
  let outDir = 'dist'

  return {
    name: 'source-snapshot',
    configResolved(config) {
      rootDir = config.root
      outDir = resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0]
        if (url !== SNAPSHOT_URL) {
          next()
          return
        }

        try {
          const zipBytes = buildSourceSnapshotZip(resolve(rootDir, 'src'))
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/zip')
          res.setHeader('Cache-Control', 'no-store')
          res.end(Buffer.from(zipBytes))
        } catch (error) {
          next(error instanceof Error ? error : new Error(String(error)))
        }
      })
    },
    closeBundle() {
      const zipBytes = buildSourceSnapshotZip(resolve(rootDir, 'src'))
      writeFileSync(resolve(outDir, SNAPSHOT_FILENAME), zipBytes)
    },
  }
}
