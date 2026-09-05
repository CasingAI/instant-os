import { useState } from 'preact/hooks'
import { WindowModal } from '../../../../window/window-modal.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function WindowModalBasicDemo() {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [dangerOpen, setDangerOpen] = useState(false)
  const [result, setResult] = useState('')

  return (
    <DemoVariants>
      <DemoVariant label="确认对话框">
        <button
          type="button"
          class="ui-kit-demo__ghost-btn ui-kit-demo__ghost-btn--accent"
          onClick={() => setConfirmOpen(true)}
        >
          打开确认框
        </button>
        <WindowModal
          open={confirmOpen}
          title="确认操作"
          onClose={() => {
            setResult('已取消')
            setConfirmOpen(false)
          }}
          actions={[
            {
              label: '取消',
              onClick: () => {
                setResult('已取消')
                setConfirmOpen(false)
              },
            },
            {
              label: '确认',
              tone: 'primary',
              onClick: () => {
                setResult('已确认')
                setConfirmOpen(false)
              },
            },
          ]}
        >
          <p>确定要执行此操作吗？</p>
        </WindowModal>
      </DemoVariant>

      <DemoVariant label="危险操作">
        <button type="button" class="ui-kit-demo__ghost-btn" onClick={() => setDangerOpen(true)}>
          打开删除确认
        </button>
        <WindowModal
          open={dangerOpen}
          title="删除项目"
          role="alertdialog"
          onClose={() => setDangerOpen(false)}
          actions={[
            { label: '取消', onClick: () => setDangerOpen(false) },
            {
              label: '删除',
              tone: 'danger',
              onClick: () => {
                setResult('已删除')
                setDangerOpen(false)
              },
            },
          ]}
        >
          <p>此操作无法撤销。</p>
        </WindowModal>
      </DemoVariant>

      {result && (
        <DemoVariant label="结果" wide>
          <p class="ui-kit-demo__status">结果: {result}</p>
        </DemoVariant>
      )}
    </DemoVariants>
  )
}
