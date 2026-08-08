/** 分轨 App（Stems）的类型定义。 */

export type StemId = 'drums' | 'bass' | 'other' | 'vocals' | 'guitar' | 'piano'

/** 与 htdemucs_6s 输出顺序一致（索引即模型输出 channel 顺序）。 */
export const STEM_IDS: StemId[] = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano']

export const STEM_LABELS: Record<StemId, string> = {
  drums: '鼓',
  bass: '贝斯',
  other: '其他',
  vocals: '人声',
  guitar: '吉他',
  piano: '钢琴',
}

export const STEM_COLORS: Record<StemId, string> = {
  drums: '#e05a4e',
  bass: '#4e8fe0',
  other: '#9a97a6',
  vocals: '#e0b34e',
  guitar: '#4ed0a1',
  piano: '#a17ee0',
}

/** 分轨推理实际使用的执行后端（WebGPU 或 WASM 回退）。 */
export type StemEngineProvider = 'webgpu' | 'wasm'

/** 分轨进度事件（Worker → 主线程）。 */
export type StemProgress =
  | { kind: 'model-loading' }
  | { kind: 'model-loaded'; provider: StemEngineProvider }
  | { kind: 'chunk'; index: number; total: number }
  | { kind: 'done'; stems: StemAudio[]; sampleRate: number }
  | { kind: 'error'; message: string }

/** 分轨请求（主线程 → Worker）。 */
export type StemRequest = {
  type: 'separate'
  /** PCM 音频数据（interleaved stereo float32，范围 -1..1） */
  audio: Float32Array
  sampleRate: number
}

export type StemAudio = {
  stemId: StemId
  /** interleaved stereo float32，长度 = 帧数 × 2 */
  data: Float32Array
}
