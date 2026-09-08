import { useEffect, useRef, useState } from 'preact/hooks'
import { creaseFromFinger } from './page-curl-geometry.ts'
import { renderMapCanvas } from './page-curl-map.ts'
import type { PageCurlShadowOptions } from './page-curl-shadow-options.ts'
import type { CurlVariantProps } from './use-curl-gesture.ts'

const VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vPosition;
uniform vec2 uSize;
void main() {
  vPosition = (aPosition + 1.0) * 0.5 * uSize;
  gl_Position = vec4(aPosition.x, -aPosition.y, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `
precision highp float;
varying vec2 vPosition;
uniform vec2 uSize;
uniform vec2 uCreasePoint;
uniform vec2 uCreaseNormal;
uniform float uRadius;
uniform float uEdgeShadow;
uniform float uFrontShadow;
uniform float uBackShadow;
uniform sampler2D uMap;
const float PI = 3.14159265359;
bool onPage(vec2 p) {
  return p.x >= 0.0 && p.y >= 0.0 && p.x <= uSize.x && p.y <= uSize.y;
}
vec3 mapAt(vec2 p) {
  return texture2D(uMap, vec2(p.x / uSize.x, 1.0 - p.y / uSize.y)).rgb;
}
float mapShadow(vec2 backSource, float d) {
  vec2 outside = max(max(-backSource, backSource - uSize), vec2(0.0));
  float edge = uEdgeShadow * 0.26 * exp(-length(outside) / max(uRadius * 0.6, 1.0));
  return edge;
}
void main() {
  if (dot(uCreaseNormal, uCreaseNormal) < 0.5) {
    gl_FragColor = vec4(mapAt(vPosition), 1.0);
    return;
  }
  float d = dot(vPosition - uCreasePoint, uCreaseNormal);
  vec2 base = vPosition - d * uCreaseNormal;
  // 卷筒正面与翻回来的平直纸背共用 d=0，不另画覆盖三角形。
  if (d <= 0.0) {
    vec2 backSource = base + (PI * uRadius - d) * uCreaseNormal;
    if (onPage(backSource)) {
      vec3 paper = mix(vec3(1.0, 0.995, 0.985), mapAt(backSource), 0.055);
      gl_FragColor = vec4(paper, 1.0);
      return;
    }
    float shadow = mapShadow(backSource, d);
    gl_FragColor = vec4(mapAt(vPosition) * (1.0 - shadow), 1.0);
    return;
  }
  if (d > uRadius) discard;
  float phi = asin(clamp(d / uRadius, 0.0, 1.0));
  vec2 backSource = base + uRadius * (PI - phi) * uCreaseNormal;
  if (onPage(backSource)) {
    float shade = 1.0 - uBackShadow * 0.32 * sin(phi) * sin(phi);
    vec3 paper = mix(vec3(1.0, 0.995, 0.985), mapAt(backSource), 0.055);
    gl_FragColor = vec4(paper * shade, 1.0);
    return;
  }
  vec2 source = base + uRadius * phi * uCreaseNormal;
  if (!onPage(source)) discard;
  float light = 1.0 - uFrontShadow * 0.32 * sin(phi) * sin(phi);
  float shadow = mapShadow(backSource, d);
  gl_FragColor = vec4(mapAt(source) * light * (1.0 - shadow), 1.0);
}
`

type GlResources = {
  gl: WebGLRenderingContext
  program: WebGLProgram
  positionBuffer: WebGLBuffer
  texture: WebGLTexture
  size: WebGLUniformLocation | null
  creasePoint: WebGLUniformLocation | null
  creaseNormal: WebGLUniformLocation | null
  radius: WebGLUniformLocation | null
  edgeShadow: WebGLUniformLocation | null
  frontShadow: WebGLUniformLocation | null
  backShadow: WebGLUniformLocation | null
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('page-curl shader 编译失败：', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function setupGl(canvas: HTMLCanvasElement): GlResources | null {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true })
  if (!gl) return null
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  const program = gl.createProgram()
  if (!vertex || !fragment || !program) {
    if (vertex) gl.deleteShader(vertex)
    if (fragment) gl.deleteShader(fragment)
    if (program) gl.deleteProgram(program)
    return null
  }
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('page-curl program 链接失败：', gl.getProgramInfoLog(program))
    gl.deleteProgram(program)
    return null
  }
  const positionBuffer = gl.createBuffer()
  const texture = gl.createTexture()
  if (!positionBuffer || !texture) {
    if (positionBuffer) gl.deleteBuffer(positionBuffer)
    if (texture) gl.deleteTexture(texture)
    gl.deleteProgram(program)
    return null
  }
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'aPosition')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.clearColor(0, 0, 0, 0)
  return {
    gl, program, positionBuffer, texture,
    size: gl.getUniformLocation(program, 'uSize'),
    creasePoint: gl.getUniformLocation(program, 'uCreasePoint'),
    creaseNormal: gl.getUniformLocation(program, 'uCreaseNormal'),
    radius: gl.getUniformLocation(program, 'uRadius'),
    edgeShadow: gl.getUniformLocation(program, 'uEdgeShadow'),
    frontShadow: gl.getUniformLocation(program, 'uFrontShadow'),
    backShadow: gl.getUniformLocation(program, 'uBackShadow'),
  }
}

export function PageCurlVariantWebgl({
  finger,
  size,
  shadows,
}: CurlVariantProps & { shadows: PageCurlShadowOptions }) {
  const { w, h } = size
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const resourcesRef = useRef<GlResources | null>(null)
  const builtSizeRef = useRef({ w: 0, h: 0, dpr: 0 })
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || w <= 0 || h <= 0) return
    if (!resourcesRef.current) resourcesRef.current = setupGl(canvas)
    const resources = resourcesRef.current
    if (!resources) {
      setFailed(true)
      return
    }
    const { gl } = resources
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const built = builtSizeRef.current
    if (built.w !== w || built.h !== h || built.dpr !== dpr) {
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      gl.bindTexture(gl.TEXTURE_2D, resources.texture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, renderMapCanvas(w, h, dpr))
      builtSizeRef.current = { w, h, dpr }
    }
    const crease = creaseFromFinger(finger ?? { x: w, y: h }, w, h)
    gl.useProgram(resources.program)
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.uniform2f(resources.size, w, h)
    gl.uniform2f(resources.creasePoint, crease.kx, crease.ky)
    gl.uniform2f(resources.creaseNormal, crease.nx, crease.ny)
    gl.uniform1f(resources.radius, crease.radius)
    gl.uniform1f(resources.edgeShadow, shadows.edge ? 1 : 0)
    gl.uniform1f(resources.frontShadow, shadows.front ? 1 : 0)
    gl.uniform1f(resources.backShadow, shadows.back ? 1 : 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }, [finger, w, h, shadows.edge, shadows.front, shadows.back])

  useEffect(() => () => {
    const resources = resourcesRef.current
    if (!resources) return
    const { gl } = resources
    gl.deleteBuffer(resources.positionBuffer)
    gl.deleteTexture(resources.texture)
    gl.deleteProgram(resources.program)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    resourcesRef.current = null
  }, [])

  if (w <= 0 || h <= 0) return undefined
  if (failed) return <div class="page-curl__gl-fallback">当前环境不支持 WebGL，方案三不可用</div>
  return <canvas ref={canvasRef} class="page-curl__gl" />
}
