import type {
  Instant3dAxisSide,
  Instant3dPlacementKind,
} from '../../assets/3d/asset-catalog.ts'

export type ModelVisionViewId = 'iso' | 'top' | 'front' | 'side'

export type ModelVisionCapturedView = {
  id: ModelVisionViewId
  label: string
  dataUrl: string
}

export type ModelVisionCaptureResult = {
  views: ModelVisionCapturedView[]
  thumbnailDataUrl: string
}

export type ModelVisionOrientation = {
  forward?: Instant3dAxisSide
  /** 物体正面朝向的世界轴（椅：坐着的人面朝方向；车：车头；门：门外） */
  face?: Instant3dAxisSide
  /** 椅背 / 床头 / 柜背等背面朝向；无则省略 */
  back?: Instant3dAxisSide
  connects?: Instant3dAxisSide[]
  placementKind?: Instant3dPlacementKind
  placementHint?: string
  /** 关键部件相对坐标轴的对照说明 */
  axisLandmarks?: string
  /** 给场景生成 AI 的摆放操作建议（含 rotation.y 提示） */
  sceneUseHint?: string
  confidence?: 'high' | 'medium' | 'low'
}

export type ModelVisionAnalysis = {
  visualDescription: string
  appearanceNotes: string
  orientation: ModelVisionOrientation
  rawText: string
}

export type ModelVisionViewPreview = {
  id: ModelVisionViewId
  label: string
  dataUrl: string
}

export type ModelVisionResultRecord = {
  modelId: string
  label: string
  source: string
  url: string
  analyzedAt: number
  providerId: string
  model: string
  visualDescription: string
  appearanceNotes: string
  orientation: ModelVisionOrientation
  rawText: string
  /** 送入视觉模型的多视角缩略图（已压缩） */
  viewPreviews?: ModelVisionViewPreview[]
  thumbnailDataUrl?: string
  byteSize: number
  error?: string
}

/** 列表用轻量摘要：不含大图与原始返回，避免整表进内存。 */
export type ModelVisionResultSummary = {
  modelId: string
  label: string
  source: string
  url: string
  analyzedAt: number
  providerId: string
  model: string
  visualDescription: string
  appearanceNotes: string
  orientation: ModelVisionOrientation
  byteSize: number
  error?: string
  hasViewPreviews: boolean
}

export type ModelVisionRowStatus = 'idle' | 'capturing' | 'analyzing' | 'done' | 'error'

export const MODEL_VISION_CHANGED_EVENT = 'instant-os:model-vision-changed'

export function toModelVisionSummary(
  record: ModelVisionResultRecord,
): ModelVisionResultSummary {
  return {
    modelId: record.modelId,
    label: record.label,
    source: record.source,
    url: record.url,
    analyzedAt: record.analyzedAt,
    providerId: record.providerId,
    model: record.model,
    visualDescription: record.visualDescription,
    appearanceNotes: record.appearanceNotes,
    orientation: record.orientation,
    byteSize: record.byteSize,
    error: record.error,
    hasViewPreviews: Boolean(record.viewPreviews && record.viewPreviews.length > 0),
  }
}
