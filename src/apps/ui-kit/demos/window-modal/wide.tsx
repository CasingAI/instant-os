import { useState } from 'preact/hooks'
import { WindowModal } from '../../../../window/window-modal.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function WindowModalWideDemo() {
  const [wideOpen, setWideOpen] = useState(false)
  const [chromeOpen, setChromeOpen] = useState(false)

  return (
    <DemoVariants>
      <DemoVariant label="宽对话框">
        <button type="button" class="ui-kit-demo__ghost-btn" onClick={() => setWideOpen(true)}>
          打开宽对话框
        </button>
        <WindowModal
          open={wideOpen}
          title="详细说明"
          wide
          scrollBody
          onClose={() => setWideOpen(false)}
          actions={[{ label: '关闭', tone: 'primary', onClick: () => setWideOpen(false) }]}
        >
          <p>wide + scrollBody 适合较长说明或表单内容。</p>
          <p style={{ marginTop: 8, color: '#666' }}>
            可在此处放置多段文字、列表或设置表单。
          </p>
        </WindowModal>
      </DemoVariant>

      <DemoVariant label="左对齐标题栏 + 副标题 + 关闭钮">
        <button type="button" class="ui-kit-demo__ghost-btn" onClick={() => setChromeOpen(true)}>
          打开历史记录风格
        </button>
        <WindowModal
          open={chromeOpen}
          title="历史记录"
          subtitle="72 个页面"
          titleAlign="left"
          showCloseButton
          onClose={() => setChromeOpen(false)}
          actions={[
            {
              label: '清空历史记录',
              tone: 'danger',
              onClick: () => setChromeOpen(false),
            },
          ]}
        >
          <p class="window-modal__message">浏览历史列表示例内容。</p>
        </WindowModal>
      </DemoVariant>
    </DemoVariants>
  )
}
