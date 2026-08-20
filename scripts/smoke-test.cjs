const ort = require('onnxruntime-node')
const fs = require('fs')
async function main() {
  const data = fs.readFileSync('public/assets/demucs/models/htdemucs_6s.onnx')
  console.log('模型大小:', (data.byteLength / 1e6).toFixed(1), 'MB')
  const session = await ort.InferenceSession.create(data, { executionProviders: ['cpu'] })
  console.log('会话创建成功')
  console.log('输入:', session.inputNames, '输出:', session.outputNames)
  console.log('输入形状:', session.inputMetadata[0].shape)
  const frames = 343980
  const buffer = new Float32Array(frames * 2)
  for (let i = 0; i < 44100; i++) {
    const v = Math.sin((2 * Math.PI * 440 * i) / 44100) * 0.5
    buffer[i * 2] = v
    buffer[i * 2 + 1] = v
  }
  const inputTensor = new ort.Tensor('float32', buffer, [1, 2, frames])
  const t0 = Date.now()
  const results = await session.run({ mix: inputTensor })
  console.log('推理耗时:', Date.now() - t0, 'ms')
  const out = results.stems
  console.log('输出形状:', out.dims)
  const data2 = out.data
  const perStem = frames * 2
  const names = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano']
  for (let s = 0; s < 6; s++) {
    let sum = 0, peak = 0
    for (let i = s * perStem; i < (s + 1) * perStem; i++) {
      const v = Math.abs(data2[i]); sum += v; if (v > peak) peak = v
    }
    console.log(`  ${names[s]}: 均值=${(sum / perStem).toExponential(2)} 峰值=${peak.toExponential(2)}`)
  }
  console.log('冒烟测试通过 ✓')
}
main().catch(e => { console.error('失败:', e); process.exit(1) })
