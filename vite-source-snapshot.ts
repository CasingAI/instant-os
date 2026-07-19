import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { Plugin } from 'vite'
import { zipSync } from 'fflate'

const SNAPSHOT_URL = '/source-snapshot.zip'
const SNAPSHOT_FILENAME = 'source-snapshot.zip'

/** 纳入帮助/源码检索快照的文本类文件 */
const INCLUDED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.css',
  '.svg',
  '.json',
  '.md',
  '.html',
  '.txt',
  '.mjs',
  '.cjs',
])

/** 跳过体积大或与帮助无关的目录 */
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  '.git',
  '.cursor',
  '.vscode',
  '.idea',
  'public',
  'coverage',
  'terminals',
  'agent-transcripts',
])

function shouldIncludeFile(fileName: string): boolean {
  if (fileName === '.DS_Store' || fileName.startsWith('.')) {
    return false
  }
  // MIT 等无扩展名许可证文件也要进 /system，供「关于本机」等打开
  if (fileName === 'LICENSE' || fileName === 'LICENCE') {
    return true
  }
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) {
    return false
  }
  return INCLUDED_EXTENSIONS.has(fileName.slice(dot).toLowerCase())
}

function collectSnapshotFiles(projectRoot: string): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {}

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIR_NAMES.has(entry)) {
        continue
      }
      const fullPath = join(dir, entry)
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        walk(fullPath)
        continue
      }
      if (!stat.isFile() || !shouldIncludeFile(entry)) {
        continue
      }
      const zipPath = relative(projectRoot, fullPath).split('\\').join('/')
      files[zipPath] = new Uint8Array(readFileSync(fullPath))
    }
  }

  walk(projectRoot)
  return files
}

function buildSourceSnapshotZip(projectRoot: string): Uint8Array {
  const files = collectSnapshotFiles(projectRoot)
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
          const zipBytes = buildSourceSnapshotZip(rootDir)
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
      const zipBytes = buildSourceSnapshotZip(rootDir)
      writeFileSync(resolve(outDir, SNAPSHOT_FILENAME), zipBytes)
    },
  }
}
