/** 分轨 App（Stems）的类型定义。 */

export type StemId = 'drums' | 'bass' | 'other' | 'other2' | 'vocals' | 'guitar' | 'piano'

/**
 * htdemucs_6s 模型的输出通道顺序（索引即模型输出 channel 顺序），
 * 仅用于拼接模型输出的纯逻辑（stems-separator），不参与 UI/持久化。
 */
export const HTDEMUCS_STEM_IDS: StemId[] = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano']

/**
 * 分轨产品展示/持久化顺序：7 轨。
 * other2 为 htdemucs 在人声通道里提取的伴奏残余（第二轮分轨不再丢弃任何通道）。
 */
export const STEM_IDS: StemId[] = ['drums', 'bass', 'other', 'other2', 'vocals', 'guitar', 'piano']

export const STEM_LABELS: Record<StemId, string> = {
  drums: '鼓',
  bass: '贝斯',
  other: '其他一',
  other2: '其他二',
  vocals: '人声',
  guitar: '吉他',
  piano: '钢琴',
}

export const STEM_COLORS: Record<StemId, string> = {
  drums: '#ff4d6d',
  bass: '#3d7bff',
  other: '#7d8cff',
  other2: '#ff9e3d',
  vocals: '#ffd84d',
  guitar: '#2bffb3',
  piano: '#c95bff',
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
