/**
 * 音素识别 Worker 冒烟测试。
 *
 * 用法：
 *   1. pnpm dev
 *   2. 浏览器打开 http://localhost:5173
 *   3. F12 控制台粘贴：
 *      import('/src/apps/stems/phoneme-smoke.ts').then(m => m.runPhonemeSmokeTest())
 */

import PhonemeWorker from './phoneme-worker.ts?worker'
import type { PhonemeProgress } from './phoneme-types.ts'

/**
 * 生成一段简单的测试音频（440Hz 正弦波，1 秒，16kHz 单声道）
 */
function generateTestTone(durationSec = 1, frequency = 440, sampleRate = 16000): Float32Array {
  const samples = durationSec * sampleRate
  const audio = new Float32Array(samples)
  for (let i = 0; i < samples; i++) {
    audio[i] = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.5
  }
  return audio
}

/**
 * 把单声道 Float32Array 转成 interleaved stereo（模拟 Demucs 人声输出格式）。
 * Worker 内部会再做 stereo→mono 转换。
 */
function monoToStereo(mono: Float32Array): Float32Array {
  const stereo = new Float32Array(mono.length * 2)
  for (let i = 0; i < mono.length; i++) {
    stereo[i * 2] = mono[i]
    stereo[i * 2 + 1] = mono[i]
  }
  return stereo
}

export async function runPhonemeSmokeTest(): Promise<void> {
  console.log('🎤 音素识别冒烟测试开始...')

  // 生成 2 秒测试音频（440Hz，模拟简单的元音）
  const mono = generateTestTone(2, 440, 16000)
  const stereo = monoToStereo(mono)

  console.log(`  测试音频: ${mono.length} samples, ${stereo.length} stereo samples`)

  const worker = new PhonemeWorker() as Worker

  return new Promise<void>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<PhonemeProgress>) => {
      const progress = event.data

      switch (progress.kind) {
        case 'model-loading':
          console.log('  ⏳ 加载模型中...')
          break

        case 'model-loaded':
          console.log(`  ✅ 模型加载完成 (${progress.provider})`)
          break

        case 'done': {
          const { logits, numFrames, numPhonemes } = progress
          console.log(`  ✅ 推理完成:`)
          console.log(`     帧数: ${numFrames}`)
          console.log(`     音素数: ${numPhonemes}`)
          console.log(`     logits 大小: ${(logits.byteLength / 1024 / 1024).toFixed(2)} MB`)

          // 检查 logits 是否有有效值
          let hasNonZero = false
          let minVal = Infinity
          let maxVal = -Infinity
          for (let i = 0; i < Math.min(logits.length, 10000); i++) {
            if (logits[i] !== 0) hasNonZero = true
            if (logits[i] < minVal) minVal = logits[i]
            if (logits[i] > maxVal) maxVal = logits[i]
          }
          console.log(`     logits 范围: [${minVal.toFixed(2)}, ${maxVal.toFixed(2)}]`)
          console.log(`     有非零值: ${hasNonZero ? '✅' : '❌ (可能有问题)'}`)

          // 打印前几帧 top-3 音素
          const topK = 3
          for (let f = 0; f < Math.min(5, numFrames); f++) {
            const frameStart = f * numPhonemes
            const indices: number[] = []
            for (let p = 0; p < numPhonemes; p++) {
              indices.push(p)
            }
            indices.sort((a, b) => logits[frameStart + b] - logits[frameStart + a])
            const top = indices.slice(0, topK).map((p) => `#${p}:${logits[frameStart + p].toFixed(2)}`)
            console.log(`     帧 ${f}: [${top.join(', ')}]`)
          }

          worker.terminate()
          console.log('🎉 冒烟测试通过！')
          resolve()
          break
        }

        case 'error':
          console.error(`  ❌ 错误: ${progress.message}`)
          worker.terminate()
          reject(new Error(progress.message))
          break
      }
    }

    worker.onerror = (err) => {
      console.error('  ❌ Worker 错误:', err)
      worker.terminate()
      reject(err)
    }

    worker.postMessage({
      type: 'recognize',
      audio: stereo,
      sampleRate: 16000, // 已经是 16kHz
    })
  })
}

// 如果在浏览器环境且是模块顶层，自动运行
if (typeof window !== 'undefined') {
  ;(window as any).runPhonemeSmokeTest = runPhonemeSmokeTest
  console.log('💡 运行冒烟测试: await runPhonemeSmokeTest()')
}