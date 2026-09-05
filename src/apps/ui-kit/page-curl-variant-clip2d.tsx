import { useRef } from 'preact/hooks'
import { foldSplit } from './page-curl-geometry.ts'
import { useMapCanvas } from './page-curl-map.ts'
import type { CurlVariantProps } from './use-curl-gesture.ts'

// 方案二 · 纯 2D 裁剪压缩：不用任何 3D transform，也不上 WebGL。
// 绕折线 x+y=s 折 θ 角的正交投影 = 沿折线法向按 k=cos θ 压缩，单个矩阵即完成：
//   Sq(k) = [[(1+k)/2, (k-1)/2], [(k-1)/2, (1+k)/2]]，平移 s(1-k)/2。
// 折线上的点对一切 k 不动（铰链），k=1 恒等、k=0 塌到折线、k<0 自然翻扣到折线
// 另一侧，θ=180° 恰为纯反射、整页落出舞台左上外——终态与另两方案一致。
// 旧实现 scale(k)·matrix(0,-1,-1,0,s,s) 配折线中点 origin：origin 平移被卷进矩阵
// 内部，实际镜面落到 x+y=2s，镜像纸面与折痕脱节——已废弃。
// 翻面没有真背面，90°（纸面立起）之后用渐变把地图混成纸白假装。
// 零 3D、零 WebGL——PaperFold for iOS 2012 年"截屏 + 变换 + 假光照"的网页版。

export function PageCurlVariantClip2d({ p, size }: CurlVariantProps) {
  const { w, h } = size
  const s = (1 - p) * (w + h)
  const split = w > 0 && h > 0 ? foldSplit(s, w, h) : null
  const flapVisible = !!split?.flapClip && p > 0.001

  const flatCanvasRef = useRef<HTMLCanvasElement>(null)
  const flapCanvasRef = useRef<HTMLCanvasElement>(null)
  useMapCanvas(flatCanvasRef, w, h, !!split?.flatClip)
  useMapCanvas(flapCanvasRef, w, h, flapVisible)

  if (!split || w <= 0 || h <= 0) {
    return undefined
  }

  const foldDeg = 180 * p
  const k = Math.cos((foldDeg * Math.PI) / 180)
  // Sq(k) 的 CSS matrix(a,b,c,d,e,f) 展开。transform-origin 必须 0 0——
  // 折线位置全部由平移项 (t,t) 携带，任何非零 origin 都会把镜面搬离折线。
  const a = (1 + k) / 2
  const b = (k - 1) / 2
  const t = (s * (1 - k)) / 2
  const flapTransform = `matrix(${a.toFixed(5)}, ${b.toFixed(5)}, ${b.toFixed(5)}, ${a.toFixed(5)}, ${t.toFixed(2)}, ${t.toFixed(2)})`
  const paperOpacity = Math.max(0, Math.min(1, (foldDeg - 90) / 30))
  const crease = s / Math.SQRT2
  // 135° 渐变线 stop 位置恰为 t(q)=(x+y)/√2：折线在 crease、翻起面可见区全在
  // 折线外侧——最暗钉在折痕、向自由边 90px 渐透（最后 stop 之后颜色无限延伸，
  // 反着写就会把整张翻起面罩成均匀黑纱）。留平侧向折痕加深，方向本来就对。
  const flapShade = `linear-gradient(135deg, rgba(0,0,0,0.45) ${crease.toFixed(2)}px, rgba(0,0,0,0) ${(crease + 90).toFixed(2)}px)`
  const flatShade = `linear-gradient(135deg, rgba(0,0,0,0) ${(crease - 60).toFixed(2)}px, rgba(0,0,0,0.45) ${crease.toFixed(2)}px)`
  const shadeOpacity =
    (0.25 + 0.75 * Math.abs(Math.sin((foldDeg * Math.PI) / 180))) * Math.min(1, p * 6)

  return (
    <>
      {split.flatClip && (
        <div class="page-curl__page" style={{ clipPath: split.flatClip }}>
          <canvas ref={flatCanvasRef} class="page-curl__map-canvas" />
          <div
            class="page-curl__face-shade"
            style={{ opacity: shadeOpacity * 0.7, background: flatShade }}
          />
        </div>
      )}
      {flapVisible && (
        <div
          class="page-curl__flap2d"
          style={{
            clipPath: split.flapClip,
            transform: flapTransform,
            transformOrigin: '0 0',
          }}
        >
          <canvas ref={flapCanvasRef} class="page-curl__map-canvas" />
          <div class="page-curl__paper" style={{ opacity: paperOpacity }} />
          <div class="page-curl__face-shade" style={{ opacity: shadeOpacity, background: flapShade }} />
        </div>
      )}
    </>
  )
}
