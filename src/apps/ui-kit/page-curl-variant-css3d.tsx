import { useRef } from 'preact/hooks'
import { foldSplit } from './page-curl-geometry.ts'
import { useMapCanvas } from './page-curl-map.ts'
import type { CurlVariantProps } from './use-curl-gesture.ts'

// 方案一 · 纯 CSS 3D 折叠：页面沿对角折线 x+y=s 分成两半。
// 折线的方向向量是 (1,-1,0)——rotate3d 必须绕它转，折线才是铰链（绕法线 (1,1,0) 转
// 折线上的点会离开轴，纸面沿错误方向扭折）。角度 0→180° 取正号：正角把折线外侧
// 朝读者掀起（Rodrigues：a×d = (0,0,1) 朝屏幕外），180° 时整页映到 (-y,-x) 翻出
// 舞台左上外。翻过 90° 后看到纸背——背面元素预旋转 180°（与转子同轴同 origin），
// 但 clip 必须用"留平侧"的镜像裁剪：预旋转把留平区映到翻起区，转子再转 θ 后
// 纸背恰好逐帧贴合翻折中的纸面；若背面也裁翻起区，180° 时纸背会停在原翻起区
// 挡住已揭示的设置页。两张脸 backface-visibility 各自隐藏，90° 处无缝换脸。
// 每帧只写 transform / clip-path / 渐变透明度，全部走合成器，零 JS 布局。
// 代价：纸是"硬折角"——两块平面绕一条直线，没有连续卷曲的弧面。

export function PageCurlVariantCss3d({ p, size }: CurlVariantProps) {
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

  const angle = 180 * p
  const shadeOpacity = Math.sin(Math.PI * p) ** 0.7 * 0.55
  const crease = s / Math.SQRT2
  // 135° 渐变线的 stop 位置恰为 t(q)=(x+y)/√2，折线落在 crease 处。
  // 渐变在最后一个 stop 之后无限延伸，而各脸可见区恰好整个贴着折线的一侧——
  // 所以最暗点必须钉在折痕、向另一头 90px 内渐透，方向写反就成整面黑纱。
  const flatShade = `linear-gradient(135deg, rgba(0,0,0,0) ${(crease - 60).toFixed(2)}px, rgba(0,0,0,0.42) ${crease.toFixed(2)}px)`
  const flapShade = `linear-gradient(135deg, rgba(0,0,0,0.45) ${crease.toFixed(2)}px, rgba(0,0,0,0) ${(crease + 90).toFixed(2)}px)`
  const backShade = `linear-gradient(135deg, rgba(0,0,0,0) ${Math.max(crease - 90, 0).toFixed(2)}px, rgba(0,0,0,0.4) ${crease.toFixed(2)}px)`

  return (
    <>
      {split.flatClip && (
        <div class="page-curl__page" style={{ clipPath: split.flatClip }}>
          <canvas ref={flatCanvasRef} class="page-curl__map-canvas" />
          <div class="page-curl__face-shade" style={{ opacity: shadeOpacity * 0.7, background: flatShade }} />
        </div>
      )}
      {flapVisible && (
        <div class="page-curl__flap3d">
          <div
            class="page-curl__flap-rotor"
            style={{
              transform: `rotate3d(1, -1, 0, ${angle.toFixed(3)}deg)`,
              transformOrigin: `${s - h}px ${h}px`,
            }}
          >
            <div class="page-curl__face page-curl__face--front" style={{ clipPath: split.flapClip }}>
              <canvas ref={flapCanvasRef} class="page-curl__map-canvas" />
              <div class="page-curl__face-shade" style={{ opacity: shadeOpacity, background: flapShade }} />
            </div>
            {/* 背面的 180° 预旋转必须与转子绕同一条折线轴（同一 transform-origin），
                clip 用镜像的留平侧裁剪（见文件头推导）。留平区已空时纸背整面不可见，
                直接不挂，否则无裁剪的整页纸背会盖住设置页。 */}
            {split.flatClip && (
              <div
                class="page-curl__face page-curl__face--back"
                style={{
                  clipPath: split.flatClip,
                  transformOrigin: `${s - h}px ${h}px`,
                }}
              >
                <div class="page-curl__face-shade" style={{ opacity: shadeOpacity, background: backShade }} />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
