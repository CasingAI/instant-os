/** 检测截图是否几乎全白（跨域资源未 rasterize 时的典型表现） */
export function isScreenshotMostlyBlank(dataUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const w = img.naturalWidth
      const h = img.naturalHeight
      // 优先采样画面中央区域（验证码 tile 等主要内容常在中部）
      const cropW = Math.min(w, Math.max(120, Math.floor(w * 0.55)))
      const cropH = Math.min(h, Math.max(120, Math.floor(h * 0.55)))
      const sx = Math.floor((w - cropW) / 2)
      const sy = Math.floor((h - cropH) / 2)
      const sampleW = Math.min(cropW, 160)
      const sampleH = Math.min(cropH, 160)
      const canvas = document.createElement('canvas')
      canvas.width = sampleW
      canvas.height = sampleH
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(true)
        return
      }
      ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, sampleW, sampleH)
      const { data } = ctx.getImageData(0, 0, sampleW, sampleH)
      let nonWhite = 0
      const pixels = sampleW * sampleH
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) {
          nonWhite++
        }
      }
      resolve(nonWhite / pixels < 0.008)
    }
    img.onerror = () => resolve(true)
    img.src = dataUrl
  })
}

export function formatChromoAgentError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/connection error/i.test(message)) {
    return 'AI 接口连接失败（Connection error）。请检查钥匙串中的 API 地址、网络与代理设置后重试。'
  }
  return message
}
