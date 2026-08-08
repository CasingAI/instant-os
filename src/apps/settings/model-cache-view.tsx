import { useCallback, useEffect, useState } from 'preact/hooks'
import {
  cacheModelUrl,
  clearModelCache,
  DEMUCS_MODEL_BYTES,
  DEMUCS_MODEL_LABEL,
  DEMUCS_MODEL_URL,
  getModelCacheBytes,
  isModelCached,
} from '../../os/model-cache.ts'
import { formatStorageSize } from './format-storage-size.ts'

type ModelCacheViewProps = {
  onBack?: () => void
}

export function ModelCacheView({ onBack }: ModelCacheViewProps) {
  const [cached, setCached] = useState(false)
  const [bytes, setBytes] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [isCached, cachedBytes] = await Promise.all([
      isModelCached(DEMUCS_MODEL_URL),
      getModelCacheBytes(DEMUCS_MODEL_URL),
    ])
    setCached(isCached)
    setBytes(cachedBytes)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleCache = async () => {
    setBusy(true)
    setError(null)
    try {
      await cacheModelUrl(DEMUCS_MODEL_URL)
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
      await clearModelCache(DEMUCS_MODEL_URL)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section class="settings__section">
        <h2 class="settings__section-title">模型缓存</h2>
        <div class="settings__box">
          <p class="settings__hint">
            模型权重缓存在浏览器的 Cache API 中，与系统的存储空间（虚拟文件系统 /
            IndexedDB）完全独立，不计入「存储空间」统计。缓存后按同一 URL 请求可瞬间完成，
            无需重复下载。
          </p>
          <dl class="settings__form-row">
            <dt>模型</dt>
            <dd>{DEMUCS_MODEL_LABEL}</dd>
          </dl>
          <dl class="settings__form-row">
            <dt>权重大小</dt>
            <dd>{formatStorageSize(DEMUCS_MODEL_BYTES)}</dd>
          </dl>
          <dl class="settings__form-row">
            <dt>缓存状态</dt>
            <dd>{cached ? `已缓存（${formatStorageSize(bytes)}）` : '未缓存'}</dd>
          </dl>
        </div>

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
