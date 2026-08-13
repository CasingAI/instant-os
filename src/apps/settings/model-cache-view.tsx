import { useCallback, useEffect, useState } from 'preact/hooks'
import {
  cacheModelUrl,
  clearModelCache,
  DEMUCS_MODEL_BYTES,
  DEMUCS_MODEL_LABEL,
  DEMUCS_MODEL_URL,
  getModelCacheBytes,
  isModelCached,
  MDX_MODEL_BYTES,
  MDX_MODEL_LABEL,
  MDX_MODEL_URL,
  ZIPFORMER_MODEL_BYTES,
  ZIPFORMER_MODEL_LABEL,
  ZIPFORMER_MODEL_URL,
} from '../../os/model-cache.ts'
import { formatStorageSize } from './format-storage-size.ts'

type ModelCacheViewProps = {
  onBack?: () => void
}

type ModelEntry = {
  url: string
  label: string
  totalBytes: number
}

const MODELS: ModelEntry[] = [
  { url: DEMUCS_MODEL_URL, label: DEMUCS_MODEL_LABEL, totalBytes: DEMUCS_MODEL_BYTES },
  { url: MDX_MODEL_URL, label: MDX_MODEL_LABEL, totalBytes: MDX_MODEL_BYTES },
  { url: ZIPFORMER_MODEL_URL, label: ZIPFORMER_MODEL_LABEL, totalBytes: ZIPFORMER_MODEL_BYTES },
]

function ModelCard({
  model,
}: {
  model: ModelEntry
}) {
  const [cached, setCached] = useState(false)
  const [bytes, setBytes] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [isCached, cachedBytes] = await Promise.all([
      isModelCached(model.url),
      getModelCacheBytes(model.url),
    ])
    setCached(isCached)
    setBytes(cachedBytes)
  }, [model.url])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleCache = async () => {
    setBusy(true)
    setError(null)
    try {
      await cacheModelUrl(model.url)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const handleClear = async () => {
    setBusy(true)
    setError(null)
    try {
      await clearModelCache(model.url)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="settings__box">
      <dl class="settings__form-row">
        <dt>模型</dt>
        <dd>{model.label}</dd>
      </dl>
      <dl class="settings__form-row">
        <dt>权重大小</dt>
        <dd>{formatStorageSize(model.totalBytes)}</dd>
      </dl>
      <dl class="settings__form-row">
        <dt>缓存状态</dt>
        <dd>{cached ? `已缓存（${formatStorageSize(bytes)}）` : '未缓存'}</dd>
      </dl>

      {error && <p class="settings__hint" style={{ color: '#ff6b6b' }}>{error}</p>}

      <div class="settings__actions settings__actions--inline">
        {cached ? (
          <button
            type="button"
            class="settings__btn settings__btn--danger"
            disabled={busy}
            onClick={() => void handleClear()}
          >
            {busy ? '处理中…' : '清除缓存'}
          </button>
        ) : (
          <button
            type="button"
            class="settings__btn"
            disabled={busy}
            onClick={() => void handleCache()}
          >
            {busy ? '缓存中…' : '缓存模型'}
          </button>
        )}
      </div>
    </div>
  )
}

export function ModelCacheView({ onBack }: ModelCacheViewProps) {
  return (
    <>
      <section class="settings__section">
        <h2 class="settings__section-title">模型缓存</h2>
        <p class="settings__hint">
          模型权重缓存在浏览器的 Cache API 中，与系统的存储空间（虚拟文件系统 /
          IndexedDB）完全独立，不计入「存储空间」统计。缓存后按同一 URL 请求可瞬间完成，
          无需重复下载。
        </p>

        {MODELS.map((model) => (
          <ModelCard key={model.url} model={model} />
        ))}

        <div class="settings__actions settings__actions--inline">
          {onBack && (
            <button type="button" class="settings__btn settings__btn--plain" onClick={onBack}>
              返回
            </button>
          )}
        </div>
      </section>
    </>
  )
}