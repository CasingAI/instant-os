/**
 * HTDemucs 6-stem 权重冒烟测试（Node 端，非浏览器）。
 * 验证：权重可被 onnxruntime 解析、I/O 形状正确、推理输出非零、
 *       输出为 ch-major（[stem][L 全段][R 全段]）——用 L 强信号 / R 静音输入
 *       核对各 stem 的 L/R 段能量分布，确认 stitchStemOutputs 的读取假设。
 * 运行：node --experimental-strip-types scripts/stems-model-smoke.ts
 */
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { STEM_WINDOW, deinterleaveStereo } from '../src/apps/stems/stems-separator.ts'

// onnxruntime-node 通过原生 binding 注册 backend；用 require 保证初始化。
const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ort = require('onnxruntime-node') as typeof import('onnxruntime-node')

const MODEL_PATH = 'public/assets/demucs/models/htdemucs_6s.onnx'

async function main(): Promise<void> {
  const data = await readFile(MODEL_PATH)
  console.log(`模型大小: ${(data.byteLength / 1e6).toFixed(1)} MB`)
  const session = await ort.InferenceSession.create(data, {
    // onnxruntime-node 原生绑定提供 CPU backend；wasm 后端属 onnxruntime-web，Node 端不可用
    executionProviders: ['cpu'],
  })
  console.log('会话创建成功')
  console.log('输入:', session.inputNames)
  console.log('输出:', session.outputNames)

  const inputMeta = session.inputMetadata[0]
  console.log('输入形状:', inputMeta.shape, '类型:', inputMeta.type)

  // 构造输入：1 秒正弦波（44100 采样 × 2 声道），其余静音。
  // 立体声验证：L = 强信号、R = 静音。模型输入 ch-major：先构造 interleaved，
  // 再 de-interleave 成 [L 全段, R 全段]。
  // 若输出也是 ch-major（ch0 = L 全段、ch1 = R 全段），则每个有能量的 stem
  // 的 L 段能量应显著大于 R 段；若 ch 顺序颠倒或输出实为 interleaved，则会
  // 出现 R>>L 或 L≈R，据此修正 stitchStemOutputs 的读取索引。
  const frames = STEM_WINDOW
  const buffer = new Float32Array(frames * 2)
  for (let i = 0; i < 44100; i++) {
    const v = Math.sin((2 * Math.PI * 440 * i) / 44100) * 0.5
    buffer[i * 2] = v // L：440Hz 正弦
    buffer[i * 2 + 1] = 0 // R：静音
  }
  const inputTensor = new ort.Tensor('float32', deinterleaveStereo(buffer), [1, 2, STEM_WINDOW])
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

  // 验证每个 stem 的 L/R 声道能量，确认输出 ch-major 假设（L 全段在前、R 全段在后）。
  // 输出 [1, 6, 2, W]：每 stem = [L 全段 W][R 全段 W]。
  const out = outputTensor.data as Float32Array
  const stemFrames = outputTensor.dims[3] ?? frames
  const perStem = stemFrames * 2
  const stemNames = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano']
  let totalL = 0
  let totalR = 0
  for (let s = 0; s < 6; s++) {
    let sumL = 0
    let sumR = 0
    let peakL = 0
    let peakR = 0
    for (let i = 0; i < stemFrames; i++) {
      const l = Math.abs(out[s * perStem + i])
      const r = Math.abs(out[s * perStem + stemFrames + i])
      sumL += l
      sumR += r
      if (l > peakL) peakL = l
      if (r > peakR) peakR = r
    }
    const meanL = sumL / stemFrames
    const meanR = sumR / stemFrames
    console.log(
      `  ${stemNames[s]}: L均值=${meanL.toExponential(2)} L峰值=${peakL.toExponential(2)} ` +
        `R均值=${meanR.toExponential(2)} R峰值=${peakR.toExponential(2)}`,
    )
    totalL += sumL
    totalR += sumR
  }
  // ch-major 假设成立时 L 段承载强信号输入，能量应远大于 R 段；
  // 留 5x 余量排除噪声，但能明确区分「颠倒」(R>>L) 与「interleaved」(L≈R)。
  if (totalL < totalR * 5 && totalR > 0) {
    throw new Error(`输出声道布局异常：L 总能量 ${totalL} 未显著大于 R ${totalR}，ch-major 假设不成立`)
  }
  if (totalL === 0 && totalR === 0) {
    throw new Error('输出全零，模型未产生任何能量')
  }
  console.log('冒烟测试通过 ✓')
}

main().catch((error) => {
  console.error('冒烟测试失败:', error)
  process.exit(1)
})
