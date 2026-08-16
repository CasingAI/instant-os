import { gzipSync } from 'node:zlib'
import { readdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'

/**
 * Cloudflare Pages 单文件上限 25 MiB。onnxruntime-web 的 `ort-wasm-simd-threaded.jsep.wasm`
 * 约 25.6 MiB 会突破该限制，导致部署失败。
 *
 * 此插件在 `writeBundle`（dist 已写出）阶段把超过阈值的 `.wasm` 资产 gzip 为
 * 同名 `.wasm.gz`（约 6.0 MiB）、删除原始文件，并改写 dist 内所有 JS 中对
 * 该资产的 URL 引用。运行时由 `src/os/ort-wasm-loader.ts` fetch 解压后经
 * `ort.env.wasm.wasmBinary` 注入。
 *
 * 只在文件系统层面操作，规避 Rolldown 对 `generateBundle` 中修改 bundle map 的限制。
 */
const WASM_SIZE_LIMIT = 20 * 1024 * 1024

export function wasmGzip(): Plugin {
  let config: ResolvedConfig | undefined

  const walkFiles = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        walkFiles(full, out)
      } else {
        out.push(full)
      }
    }
    return out
  }

  return {
    name: 'instant-wasm-gzip',
    apply: 'build',
    configResolved(resolved) {
      config = resolved
    },
    writeBundle() {
      if (!config) {
        return
      }
      const outDir = config.build.outDir
      const files = walkFiles(outDir)
      const rewrites: Array<[from: string, to: string]> = []

      for (const file of files) {
        if (!file.endsWith('.wasm')) {
          continue
        }
        const size = statSync(file).size
        if (size <= WASM_SIZE_LIMIT) {
          continue
        }
        const gzFile = `${file}.gz`
        writeFileSync(gzFile, gzipSync(readFileSync(file)))
        unlinkSync(file)
        const relPath = relative(outDir, file)
        rewrites.push([relPath, `${relPath}.gz`])
        this.warn(
          `[instant-wasm-gzip] ${relPath} (${(size / 1024 / 1024).toFixed(1)} MiB) ` +
            `超过 Cloudflare Pages 25 MiB 限制，已 gzip 为 ${relPath}.gz（${(
              (statSync(gzFile).size / 1024 / 1024)
            ).toFixed(1)} MiB），由 ort-wasm-loader 运行时解压。`,
        )
      }

      if (rewrites.length === 0) {
        return
      }
      // 改写 dist 内所有 JS/CSS 中对压缩后 wasm 的引用。
      for (const file of files) {
        const isText = /\.(?:js|mjs|cjs|css|html|map)$/.test(file)
        if (!isText) {
          continue
        }
        let content = readFileSync(file, 'utf8')
        let changed = false
        for (const [from, to] of rewrites) {
          if (content.includes(from)) {
            content = content.split(from).join(to)
            changed = true
          }
        }
        if (changed) {
          writeFileSync(file, content)
        }
      }
    },
  }
}
