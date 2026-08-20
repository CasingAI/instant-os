import type { ModelVisionCapturedView, ModelVisionViewPreview } from './model-vision-types.ts'

/** 缩小 dataURL；用完立刻丢掉 Image/Canvas，避免解码位图滞留。 */
export function shrinkImageDataUrl(
  dataUrl: string,
  maxEdge = 640,
  quality = 0.92,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      try {
        const longest = Math.max(image.width, image.height, 1)
        const scale = Math.min(1, maxEdge / longest)
        const width = Math.max(1, Math.round(image.width * scale))
        const height = Math.max(1, Math.round(image.height * scale))
        // 已在目标清晰度内：直接沿用原图，避免二次 JPEG 损伤
        if (scale >= 0.98 && quality >= 0.9) {
          resolve(dataUrl)
          return
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d', { willReadFrequently: false })
        if (!context) {
          reject(new Error('无法创建画布'))
          return
        }
        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = 'high'
        context.drawImage(image, 0, 0, width, height)
        const next = canvas.toDataURL('image/jpeg', quality)
        canvas.width = 0
        canvas.height = 0
        resolve(next)
      } catch (error) {
        reject(error instanceof Error ? error : new Error('缩略图处理失败'))
      } finally {
        image.onload = null
        image.onerror = null
        image.src = ''
      }
    }
    image.onerror = () => {
      image.onload = null
      image.onerror = null
      image.src = ''
      reject(new Error('缩略图加载失败'))
    }
    image.src = dataUrl
  })
}

/** 存盘预览：保持与截图同级清晰度（约 640px / 高质量 JPEG）。 */
export async function shrinkCapturedViews(
  views: ModelVisionCapturedView[],
): Promise<ModelVisionViewPreview[]> {
  const next: ModelVisionViewPreview[] = []
  for (const view of views) {
    next.push({
      id: view.id,
      label: view.label,
      dataUrl: await shrinkImageDataUrl(view.dataUrl, 640, 0.92),
    })
  }
  return next
}
