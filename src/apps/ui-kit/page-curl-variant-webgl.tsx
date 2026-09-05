import { useEffect, useRef, useState } from 'preact/hooks'
import { creaseFromFinger } from './page-curl-geometry.ts'
import { renderMapCanvas } from './page-curl-map.ts'
import type { CurlVariantProps } from './use-curl-gesture.ts'

// 方案三 · WebGL 连续卷曲（原味档）：一张地图纹理 + 一个 64×24 网格。
// 手指直接捏住纸角（iOS 6 捏角模型）：折痕垂直于「纸角原位 C ↔ 手指 F」连线、
// 过反解铰点 K（见 page-curl-geometry.ts 的 creaseFromFinger——纸角绕柱面弧长
// t=(L+πR)/2、再沿切线反向平铺 (t−πR) 后恰好落在 F）。网格存普通页面坐标
// (x,y)，每帧更新三个 uniform（铰点/法向/半径），两千个顶点的变形全在顶点
// 着色器：d = dot(P−K, n) > 0 的部分卷入柱面，绕过 π 后扣平成纸背纸扇。
// 深度按卷角 φ 排序而非高度：铰链处与留平纸面连续（φ=0 → 0.5），柱面近侧
// 四分之一圈遮住远侧——地图正面全程可见（仿斜视相机的自遮挡，纯高度排序会
// 让绕过柱顶的纸背永远盖住柱面正面），翻扣的纸背（φ=π → 0.40）压在留平纸面
// 上、又不遮柱面最前缘。纸白背面色与 gl_FrontFacing 在 φ=90° 处翻转沿用旧版。

const COLS = 64
const ROWS = 24

const VERTEX_SHADER = `
attribute vec2 aXY;
uniform vec2 uSize;
uniform vec2 uCreasePoint;
uniform vec2 uCreaseNormal;
uniform float uRadius;
varying vec2 vUV;
varying float vShade;
const float PI = 3.14159265;
void main() {
  // d>0 在纸角侧：到铰线的距离就是绕柱的弧长；d<=0 留平原位
  float d = dot(aXY - uCreasePoint, uCreaseNormal);
  float arc = max(d, 0.0);
  float phi = min(arc / uRadius, PI);
  float sp = sin(phi);
  float cp = cos(phi);
  // 沿法向的落点位移：柱面段取 R·sin φ（铰线鼓到 R 再折回柱顶正上方），
  // 弧长超过 πR 后沿切线反向平铺（纸背纸扇）。arc=0 时整体为 0，留平侧原位。
  float delta = uRadius * sp - (arc - PI * uRadius) * step(PI * uRadius, arc);
  vec2 pos = aXY + uCreaseNormal * (delta - arc);
  vUV = vec2(aXY.x / uSize.x, 1.0 - aXY.y / uSize.y);
  // 抬起判定用极小量而非 0：合上时法向退化为零向量、全页 d 恰为 0，
  // 若按 d>=0 抬起会整页吃到 0.964 的卷曲明暗（平白暗一档）
  float lifted = step(0.0001, d);
  float diff = max(0.34 * sp + 0.94 * cp, 0.0);
  vShade = mix(1.0, 0.40 + 0.60 * diff, lifted);
  // 深度按卷角（约束见文件头）：铰链连续、近侧遮远侧、纸背压留平面
  float depth = 0.5 - 0.25 * sp - 0.05 * sin(2.0 * phi) - 0.05 * (1.0 - cp);
  gl_Position = vec4(pos.x / uSize.x * 2.0 - 1.0, 1.0 - pos.y / uSize.y * 2.0, depth, 1.0);
}
`

const FRAGMENT_SHADER = `
precision mediump float;
varying vec2 vUV;
varying float vShade;
uniform sampler2D uMap;
void main() {
  vec3 front = texture2D(uMap, vUV).rgb;
  vec3 paper = vec3(0.97, 0.955, 0.92);
  vec3 rgb = gl_FrontFacing ? front * vShade : paper * (0.55 + 0.45 * vShade);
  gl_FragColor = vec4(rgb, 1.0);
}
`

type GlResources = {
  gl: WebGLRenderingContext
  program: WebGLProgram
  positionBuffer: WebGLBuffer
  indexBuffer: WebGLBuffer
  indexCount: number
  texture: WebGLTexture | null
  aXYLocation: number
  uSizeLocation: WebGLUniformLocation | null
  uCreasePointLocation: WebGLUniformLocation | null
  uCreaseNormalLocation: WebGLUniformLocation | null
  uRadiusLocation: WebGLUniformLocation | null
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) {
    return null
  }
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('page-curl shader 编译失败：', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function buildGrid(size: { w: number; h: number }): { positions: Float32Array; indices: Uint16Array } {
  const positions = new Float32Array((COLS + 1) * (ROWS + 1) * 2)
  let pos = 0
  for (let iy = 0; iy <= ROWS; iy++) {
    const y = (size.h * iy) / ROWS
    for (let ix = 0; ix <= COLS; ix++) {
      // 顶点直接存页面坐标 (x, y)：变形方向由折痕 uniform 决定，网格与方向无关
      positions[pos++] = (size.w * ix) / COLS
      positions[pos++] = y
    }
  }
  const indices = new Uint16Array(COLS * ROWS * 6)
  let idx = 0
  for (let iy = 0; iy < ROWS; iy++) {
    for (let ix = 0; ix < COLS; ix++) {
      const i00 = iy * (COLS + 1) + ix
      const i10 = i00 + 1
      const i01 = i00 + COLS + 1
      const i11 = i01 + 1
      indices[idx++] = i00
      indices[idx++] = i10
      indices[idx++] = i11
      indices[idx++] = i00
      indices[idx++] = i11
      indices[idx++] = i01
    }
  }
  return { positions, indices }
}

function setupGl(canvas: HTMLCanvasElement, size: { w: number; h: number }): GlResources | null {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true })
  if (!gl) {
    return null
  }
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  if (!vertexShader || !fragmentShader) {
    if (vertexShader) {
      gl.deleteShader(vertexShader)
    }
    if (fragmentShader) {
      gl.deleteShader(fragmentShader)
    }
    return null
  }
  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
    return null
  }
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('page-curl program 链接失败：', gl.getProgramInfoLog(program))
    gl.deleteProgram(program)
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
    return null
  }
  // 链接完成后 shader 对象已失联，标记删除、随 program 一并回收
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)
  gl.useProgram(program)

  const { positions, indices } = buildGrid(size)
  const positionBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)
  const indexBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)

  const aXY = gl.getAttribLocation(program, 'aXY')
  gl.enableVertexAttribArray(aXY)
  gl.vertexAttribPointer(aXY, 2, gl.FLOAT, false, 0, 0)

  // 页面坐标 y 向下，投影翻上去之后这套索引序是顺时针——把正面定义成 CW，
  // gl_FrontFacing 才在贴地图的一面为真
  gl.frontFace(gl.CW)
  gl.enable(gl.DEPTH_TEST)
  gl.clearColor(0, 0, 0, 0)

  return {
    gl,
    program,
    positionBuffer,
    indexBuffer,
    indexCount: indices.length,
    texture: null,
    aXYLocation: gl.getAttribLocation(program, 'aXY'),
    uSizeLocation: gl.getUniformLocation(program, 'uSize'),
    uCreasePointLocation: gl.getUniformLocation(program, 'uCreasePoint'),
    uCreaseNormalLocation: gl.getUniformLocation(program, 'uCreaseNormal'),
    uRadiusLocation: gl.getUniformLocation(program, 'uRadius'),
  }
}

function destroyGl(resources: GlResources): void {
  const { gl } = resources
  gl.deleteBuffer(resources.positionBuffer)
  gl.deleteBuffer(resources.indexBuffer)
  if (resources.texture) {
    gl.deleteTexture(resources.texture)
  }
  gl.deleteProgram(resources.program)
  gl.getExtension('WEBGL_lose_context')?.loseContext()
}

export function PageCurlVariantWebgl({ finger, size }: CurlVariantProps) {
  const { w, h } = size
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const resourcesRef = useRef<GlResources | null>(null)
  const builtSizeRef = useRef({ w: 0, h: 0 })
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || w <= 0 || h <= 0) {
      return
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (!resourcesRef.current) {
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      resourcesRef.current = setupGl(canvas, { w, h })
      builtSizeRef.current = { w, h }
    }
    const resources = resourcesRef.current
    if (!resources) {
      setFailed(true)
      return
    }
    const gl = resources.gl

    // 尺寸变了：顶点网格是按像素绝对值烘焙的，必须连同画布分辨率一起重建，
    // 否则旧网格被新 uSize 归一化后页面错位、卷轴与折痕脱节；地图纹理随尺寸重绘。
    // 索引只描述拓扑、与尺寸无关，不用动。
    if (builtSizeRef.current.w !== w || builtSizeRef.current.h !== h) {
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.positionBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, buildGrid({ w, h }).positions, gl.STATIC_DRAW)
      if (resources.texture) {
        gl.deleteTexture(resources.texture)
        resources.texture = null
      }
      builtSizeRef.current = { w, h }
    }
    if (!resources.texture) {
      const texture = gl.createTexture()
      if (texture) {
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, renderMapCanvas(w, h, dpr))
        // WebGL1 非 2 次幂纹理：必须 CLAMP + LINEAR、不带 mipmap
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        resources.texture = texture
      }
    }

    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    // finger=null（静止合上）时退化为 F=C：反解出的法向是零向量，整页原位
    const crease = creaseFromFinger(finger ?? { x: w, y: h }, w, h)
    gl.useProgram(resources.program)
    gl.uniform2f(resources.uSizeLocation, w, h)
    gl.uniform2f(resources.uCreasePointLocation, crease.kx, crease.ky)
    gl.uniform2f(resources.uCreaseNormalLocation, crease.nx, crease.ny)
    gl.uniform1f(resources.uRadiusLocation, crease.radius)
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.positionBuffer)
    gl.enableVertexAttribArray(resources.aXYLocation)
    gl.vertexAttribPointer(resources.aXYLocation, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, resources.indexBuffer)
    gl.drawElements(gl.TRIANGLES, resources.indexCount, gl.UNSIGNED_SHORT, 0)
  }, [finger, w, h])

  useEffect(
    () => () => {
      if (resourcesRef.current) {
        destroyGl(resourcesRef.current)
        resourcesRef.current = null
      }
    },
    [],
  )

  if (w <= 0 || h <= 0) {
    return undefined
  }
  if (failed) {
    return <div class="page-curl__gl-fallback">当前环境不支持 WebGL，方案三不可用</div>
  }
  return <canvas ref={canvasRef} class="page-curl__gl" />
}
