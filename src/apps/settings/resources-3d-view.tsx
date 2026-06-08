import { useState } from 'preact/hooks'
import { BackIcon } from '../../icons/app-icons.tsx'
import {
  catalogEntriesForSource,
  INSTANT3D_CATALOG,
  INSTANT3D_PRIMITIVES,
  INSTANT3D_SOURCE_PACKS,
  type Instant3dCatalogEntry,
} from '../../assets/3d/asset-catalog.ts'
import type { Resources3dDetailTarget } from './resources-3d-detail-view.tsx'

type Resources3dViewProps = {
  onBack: () => void
  onOpenDetail: (target: Resources3dDetailTarget) => void
}

const MODELS_PREVIEW_COUNT = 10

const PRIMITIVE_LABELS: Record<(typeof INSTANT3D_PRIMITIVES)[number], string> = {
  box: '立方体',
  sphere: '球体',
  cylinder: '圆柱',
  plane: '平面',
}

type PackModelsListProps = {
  entries: Instant3dCatalogEntry[]
  onOpenDetail: (target: Resources3dDetailTarget) => void
}

function PackModelsList({ entries, onOpenDetail }: PackModelsListProps) {
  const [expanded, setExpanded] = useState(false)
  const canExpand = entries.length > MODELS_PREVIEW_COUNT
  const showExpandTrigger = canExpand && !expanded
  const visibleEntries = showExpandTrigger ? entries.slice(0, MODELS_PREVIEW_COUNT) : entries

  return (
    <div class="settings__list">
      <div class="settings__list-head">
        <span>名称</span>
        <span>modelId</span>
      </div>
      <div class="settings__list-body settings__list-body--apps">
        {visibleEntries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            class="settings__row settings__row--button settings__row--nav"
            onClick={() => onOpenDetail({ type: 'model', modelId: entry.id })}
          >
            <span class="settings__row-name">{entry.label}</span>
            <span class="settings__row-size settings__mono">{entry.id}</span>
            <span class="settings__row-disclosure" aria-hidden="true">
              ›
            </span>
          </button>
        ))}
        {showExpandTrigger && (
          <button
            type="button"
            class="settings__row settings__row--show-all"
            onClick={() => setExpanded(true)}
          >
            显示全部模型
          </button>
        )}
      </div>
    </div>
  )
}

export function Resources3dView({ onBack, onOpenDetail }: Resources3dViewProps) {
  return (
    <div class="settings">
      <div class="settings__nav">
        <button type="button" class="settings__nav-back" onClick={onBack}>
          <span class="settings__nav-back-icon" aria-hidden="true">
            <BackIcon size={13} />
          </span>
          资源
        </button>
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">概览</h2>
          <div class="settings__box">
            <dl class="settings__form-row">
              <dt>3D 模型</dt>
              <dd>{INSTANT3D_CATALOG.length} 个</dd>
            </dl>
            <dl class="settings__form-row">
              <dt>几何基元</dt>
              <dd>{INSTANT3D_PRIMITIVES.length} 种</dd>
            </dl>
            <dl class="settings__form-row">
              <dt>素材包</dt>
              <dd>{INSTANT3D_SOURCE_PACKS.length} 个</dd>
            </dl>
            <dl class="settings__form-row">
              <dt>运行时</dt>
              <dd>Three.js · Rapier</dd>
            </dl>
            <dl class="settings__form-row">
              <dt>许可证</dt>
              <dd>模型 CC0 · 引擎 MIT</dd>
            </dl>
          </div>
        </section>

        <section class="settings__section">
          <h2 class="settings__section-title">几何基元</h2>
          <div class="settings__list">
            <div class="settings__list-head">
              <span>类型</span>
              <span>说明</span>
            </div>
            <div class="settings__list-body settings__list-body--apps">
              {INSTANT3D_PRIMITIVES.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  class="settings__row settings__row--button settings__row--nav"
                  onClick={() => onOpenDetail({ type: 'primitive', kind })}
                >
                  <span class="settings__row-name settings__mono">{kind}</span>
                  <span class="settings__row-size">{PRIMITIVE_LABELS[kind]}</span>
                  <span class="settings__row-disclosure" aria-hidden="true">
                    ›
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {INSTANT3D_SOURCE_PACKS.map((pack) => {
          const entries = catalogEntriesForSource(pack.id)
          return (
            <section key={pack.id} class="settings__section">
              <h2 class="settings__section-title">{pack.title}</h2>
              <p class="settings__section-subtitle">
                {pack.subtitle} · {pack.license} · {entries.length} 个模型
              </p>
              <PackModelsList entries={entries} onOpenDetail={onOpenDetail} />
            </section>
          )
        })}

        <p class="settings__section-footnote">
          以上资源随 Instant OS 内置装载，AI 生成 3D 场景时通过 modelId 引用。素材包均为 CC0 许可。
        </p>
      </div>
    </div>
  )
}
