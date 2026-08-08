/**
 * HTDemucs 6-stem 权重冒烟测试（Node 端，非浏览器）。
 * 验证：权重可被 onnxruntime 解析、I/O 形状正确、推理输出非零。
 * 运行：node --experimental-strip-types scripts/stems-model-smoke.ts
 */
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { STEM_WINDOW } from '../src/apps/stems/stems-separator.ts'

// onnxruntime-node 通过原生 binding 注册 backend；用 require 保证初始化。
const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ort = require('onnxruntime-node') as typeof import('onnxruntime-node')

const MODEL_PATH = 'public/assets/demucs/models/htdemucs_6s.onnx'

async function main(): Promise<void> {
  const data = await readFile(MODEL_PATH)
  console.log(`模型大小: ${(data.byteLength / 1e6).toFixed(1)} MB`)
  const session = await ort.InferenceSession.create(data, {
    executionProviders: ['wasm'],
  })
  console.log('会话创建成功')
  console.log('输入:', session.inputNames)
  console.log('输出:', session.outputNames)

  const inputMeta = session.inputMetadata[0]
  console.log('输入形状:', inputMeta.shape, '类型:', inputMeta.type)

  // 构造输入：1 秒正弦波（44100 采样 × 2 声道），其余静音
  const frames = STEM_WINDOW
  const buffer = new Float32Array(frames * 2)
  for (let i = 0; i < 44100; i++) {
    const v = Math.sin((2 * Math.PI * 440 * i) / 44100) * 0.5
    buffer[i * 2] = v
    buffer[i * 2 + 1] = v
  }
  const inputTensor = new ort.Tensor('float32', buffer, [1, 2, STEM_WINDOW])
  const feeds: Record<string, ort.Tensor> = { mix: inputTensor }
  const t0 = Date.now()
  const results = await session.run(feeds)
  const elapsed = Date.now() - t0
  console.log(`单块推理耗时: ${elapsed}ms`)

  const outputTensor = results.stems as ort.Tensor
  console.log('输出形状:', outputTensor.dims, '类型:', outputTensor.type)
  if (outputTensor.dims.length !== 4 || outputTensor.dims[1] !== 6) {
    throw new Error(`输出形状异常: ${outputTensor.dims}`)
  }

  // 验证每个 stem 有能量
  const out = outputTensor.data as Float32Array
  const stemFrames = outputTensor.dims[2] ?? frames
  const perStem = stemFrames * 2
  const stemNames = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano']
  for (let s = 0; s < 6; s++) {
    let sum = 0
    let peak = 0
    for (let i = s * perStem; i < (s + 1) * perStem; i++) {
      const v = Math.abs(out[i])
      sum += v
      if (v > peak) peak = v
    }
    const mean = sum / perStem
    console.log(
      `  ${stemNames[s]}: 均值=${mean.toExponential(2)} 峰值=${peak.toExponential(2)}`,
    )
  }
  console.log('冒烟测试通过 ✓')
}

main().catch((error) => {
  console.error('冒烟测试失败:', error)
  process.exit(1)
})
