import { useEffect, useRef } from 'preact/hooks'
import { BackIcon } from '../../icons/app-icons.tsx'
import {
  buildScene3dModelPreviewHtml,
  buildScene3dPrimitivePreviewHtml,
} from '../../assets/3d/build-scene3d-preview-html.ts'
import {
  catalogEntryById,
  colorModeLabel,
  formatSizeMeters,
  INSTANT3D_SOURCE_PACKS,
  placementKindLabel,
  type Instant3dPrimitiveKind,
} from '../../assets/3d/asset-catalog.ts'
import { injectScene3dBridge } from '../../assets/3d/inject-scene3d-bridge.ts'
import { ensureIframeBlankDocument, writeHtmlToIframe } from '../../assets/3d/write-html-to-iframe.ts'
export type Resources3dDetailTarget =
  | { type: 'model'; modelId: string }
  | { type: 'primitive'; kind: Instant3dPrimitiveKind }

type Resources3dDetailViewProps = {
  target: Resources3dDetailTarget
  onBack: () => void
}

const PRIMITIVE_LABELS: Record<Instant3dPrimitiveKind, string> = {
  box: '立方体',
  sphere: '球体',
  cylinder: '圆柱',
  plane: '平面',
}

const PRIMITIVE_DETAILS: Record<
  Instant3dPrimitiveKind,
  { style: string; description: string; size: string; color: string }
> = {
  box: {
    style: '程序生成的纯色几何体',
    description: '即时生成的立方体基元，可通过 color 参数自定义颜色。',
    size: '默认 1 × 1 × 1 m（可通过 width / height / depth 调整）',
    color: '可自定义（预览示例 #8ea0b5）',
  },
  sphere: {
    style: '程序生成的纯色几何体',
    description: '即时生成的球体基元，可通过 color 与 radius 参数调整外观。',
    size: '默认直径约 1.5 m（radius 0.75）',
    color: '可自定义（预览示例 #8ea0b5）',
  },
  cylinder: {
    style: '程序生成的纯色几何体',
    description: '即时生成的圆柱基元，可通过 color、height、radiusTop / radiusBottom 调整。',
    size: '默认高约 1.2 m、半径约 0.45 m',
    color: '可自定义（预览示例 #8ea0b5）',
  },
  plane: {
    style: '程序生成的纯色几何体',
    description: '即时生成的水平平面，常用于地面或平台，默认已水平铺放。',
    size: '默认 3 × 3 m（可通过 width / depth 调整）',
    color: '可自定义（预览示例 #8ea0b5）',
  },
}

function ColorSwatches({ colors }: { colors: string[] }) {
  if (colors.length === 0) return null

  return (
    <span class="settings__color-swatches">
      {colors.map((color) => (
        <span
          key={color}
          class="settings__color-swatch"
          style={{ backgroundColor: color }}
          title={color}
          aria-label={color}
        />
      ))}
    </span>
  )
}

function titleForTarget(target: Resources3dDetailTarget): string {
  if (target.type === 'primitive') {
    return PRIMITIVE_LABELS[target.kind]
  }
  return catalogEntryById(target.modelId)?.label ?? target.modelId
}

function previewHtmlForTarget(target: Resources3dDetailTarget): string {
  if (target.type === 'primitive') {
    return buildScene3dPrimitivePreviewHtml(target.kind)
  }
  return buildScene3dModelPreviewHtml(target.modelId)
}

export function resources3dDetailWindowTitle(target: Resources3dDetailTarget): string {
  return titleForTarget(target)
}

export function Resources3dDetailView({ target, onBack }: Resources3dDetailViewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const title = titleForTarget(target)
  const modelEntry = target.type === 'model' ? catalogEntryById(target.modelId) : undefined
  const sourcePack =
    modelEntry && INSTANT3D_SOURCE_PACKS.find((pack) => pack.id === modelEntry.source)

  const targetKey =
    target.type === 'model' ? `model:${target.modelId}` : `primitive:${target.kind}`

  useEffect(() => {
    ensureIframeBlankDocument(iframeRef.current)
    const html = injectScene3dBridge(previewHtmlForTarget(target))
    writeHtmlToIframe(iframeRef.current, html)
  }, [targetKey])

  return (
    <div class="settings">
      <div class="settings__nav">
        <button type="button" class="settings__nav-back" onClick={onBack}>
          <span class="settings__nav-back-icon" aria-hidden="true">
            <BackIcon size={13} />
          </span>
          3D 资源
        </button>
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">{title}</h2>
          <div class="settings__preview" aria-label="3D 预览">
            <iframe
              ref={iframeRef}
              class="settings__preview-frame"
              title={`${title} 预览`}
              sandbox="allow-scripts allow-same-origin"
              src="about:blank"
            />
          </div>
          <p class="settings__section-footnote">拖拽可旋转视角。</p>
        </section>

        <section class="settings__section">
          <h2 class="settings__section-title">外观与样式</h2>
          <div class="settings__box">
            {target.type === 'model' && modelEntry ? (
              <>
                <p class="settings__model-description">{modelEntry.appearance.description}</p>
                <dl class="settings__form-row">
                  <dt>风格</dt>
                  <dd>{modelEntry.appearance.style}</dd>
                </dl>
                <dl class="settings__form-row">
                  <dt>尺寸</dt>
                  <dd>{formatSizeMeters(modelEntry.appearance.sizeMeters)}</dd>
                </dl>
                {modelEntry.appearance.placement.kind !== 'free' && (
                  <>
                    <dl class="settings__form-row">
                      <dt>摆放类型</dt>
                      <dd>{placementKindLabel(modelEntry.appearance.placement.kind)}</dd>
                    </dl>
                    <dl class="settings__form-row">
                      <dt>方向与拼接</dt>
                      <dd>{modelEntry.appearance.placement.hint}</dd>
                    </dl>
                    {(modelEntry.appearance.placement.connects ||
                      modelEntry.appearance.placement.forward ||
                      modelEntry.appearance.placement.face ||
                      modelEntry.appearance.placement.tileStepMeters !== undefined) && (
                      <dl class="settings__form-row">
                        <dt>接口参数</dt>
                        <dd>
                          {[
                            modelEntry.appearance.placement.tileStepMeters !== undefined &&
                              `步长 ${modelEntry.appearance.placement.tileStepMeters} m`,
                            modelEntry.appearance.placement.connects &&
                              `接口 ${modelEntry.appearance.placement.connects.join(' / ')}`,
                            modelEntry.appearance.placement.forward &&
                              `延伸 ${modelEntry.appearance.placement.forward}`,
                            modelEntry.appearance.placement.face &&
                              `正面 ${modelEntry.appearance.placement.face}`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </dd>
                      </dl>
                    )}
                  </>
                )}
                <dl class="settings__form-row">
                  <dt>着色</dt>
                  <dd>
                    {colorModeLabel(modelEntry.appearance.colorMode)}
                    {modelEntry.appearance.textures.length > 0 && (
                      <span class="settings__detail-sub">
                        {' '}
                        · {modelEntry.appearance.textures.join('、')}
                      </span>
                    )}
                    <ColorSwatches colors={modelEntry.appearance.solidColors} />
                  </dd>
                </dl>
                {modelEntry.appearance.materials.length > 0 && (
                  <dl class="settings__form-row">
                    <dt>材质</dt>
                    <dd>{modelEntry.appearance.materials.join('、')}</dd>
                  </dl>
                )}
                <dl class="settings__form-row">
                  <dt>几何</dt>
                  <dd>
                    {modelEntry.appearance.vertices.toLocaleString('zh-CN')} 顶点 ·{' '}
                    {modelEntry.appearance.triangles.toLocaleString('zh-CN')} 三角面
                  </dd>
                </dl>
              </>
            ) : target.type === 'primitive' ? (
              <>
                <p class="settings__model-description">{PRIMITIVE_DETAILS[target.kind].description}</p>
                <dl class="settings__form-row">
                  <dt>风格</dt>
                  <dd>{PRIMITIVE_DETAILS[target.kind].style}</dd>
                </dl>
                <dl class="settings__form-row">
                  <dt>尺寸</dt>
                  <dd>{PRIMITIVE_DETAILS[target.kind].size}</dd>
                </dl>
                <dl class="settings__form-row">
                  <dt>颜色</dt>
                  <dd>{PRIMITIVE_DETAILS[target.kind].color}</dd>
                </dl>
              </>
            ) : (
              <p class="settings__empty-inline">未找到该模型。</p>
            )}
          </div>
        </section>

        <section class="settings__section">
          <h2 class="settings__section-title">目录信息</h2>
          <div class="settings__box">
            {target.type === 'model' && modelEntry ? (
              <>
                <dl class="settings__form-row">
                  <dt>名称</dt>
                  <dd>{modelEntry.label}</dd>
                </dl>
                <dl class="settings__form-row">
                  <dt>modelId</dt>
                  <dd>
                    <code class="settings__mono">{modelEntry.id}</code>
                  </dd>
                </dl>
                <dl class="settings__form-row">
                  <dt>素材包</dt>
                  <dd>{sourcePack?.title ?? modelEntry.source}</dd>
                </dl>
                <dl class="settings__form-row">
                  <dt>关键词</dt>
                  <dd>{modelEntry.keywords.join('、')}</dd>
                </dl>
                <dl class="settings__form-row">
                  <dt>许可证</dt>
                  <dd>{sourcePack?.license ?? 'CC0 1.0'}</dd>
                </dl>
              </>
            ) : target.type === 'primitive' ? (
              <>
                <dl class="settings__form-row">
                  <dt>类型</dt>
                  <dd>
                    <code class="settings__mono">{target.kind}</code>
                  </dd>
                </dl>
                <dl class="settings__form-row">
                  <dt>说明</dt>
                  <dd>{PRIMITIVE_LABELS[target.kind]}</dd>
                </dl>
                <dl class="settings__form-row">
                  <dt>用途</dt>
                  <dd>Three.js 内置几何体，无需加载外部模型</dd>
                </dl>
              </>
            ) : (
              <p class="settings__empty-inline">未找到该模型。</p>
            )}
          </div>
          {target.type === 'model' && modelEntry && (
            <p class="settings__section-footnote">
              尺寸与几何数据从 GLTF 文件自动提取；KayKit / Tiny Treats 未提供独立的产品说明文档，颜色来自共享纹理贴图而非单一色值。
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
