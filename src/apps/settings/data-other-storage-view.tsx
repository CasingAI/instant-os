import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { formatStorageSize } from './format-storage-size.ts'

type DataOtherStorageViewProps = {
  totalBytes: number
  onBack: () => void
  onOpenSpaceSniffer: () => void
}

export function DataOtherStorageView({
  totalBytes,
  onBack,
  onOpenSpaceSniffer,
}: DataOtherStorageViewProps) {
  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="存储空间" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">其他</h2>
          <p class="settings__section-subtitle">未归入已知分类的数据空间占用</p>
          <div class="settings__box">
            <dl class="settings__form-row">
              <dt>合计</dt>
              <dd>{formatStorageSize(totalBytes)}</dd>
            </dl>
          </div>
          <div class="settings__actions settings__actions--inline">
            <button type="button" class="settings__btn" onClick={onOpenSpaceSniffer}>
              在空间嗅探中查看
            </button>
          </div>
          <p class="settings__section-footnote">
            此分类无法再拆细。要查看具体文件，请使用空间嗅探。
          </p>
        </section>
      </div>
    </div>
  )
}
