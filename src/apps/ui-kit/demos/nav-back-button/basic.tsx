import { useState } from 'preact/hooks'
import { NavBackButton } from '../../../../ui/nav-back-button.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function NavBackButtonDemo() {
  const [page, setPage] = useState<'list' | 'detail'>('detail')

  return (
    <DemoVariants>
      <DemoVariant label="返回导航">
        {page === 'detail' ? (
          <div class="ui-kit-demo__nav-chrome">
            <NavBackButton label="设置" onClick={() => setPage('list')} />
            <span class="ui-kit-demo__nav-title">账号</span>
          </div>
        ) : (
          <div class="ui-kit-demo__nav-chrome">
            <span class="ui-kit-demo__nav-title">设置</span>
            <button type="button" class="ui-kit-demo__ghost-btn" onClick={() => setPage('detail')}>
              进入子页
            </button>
          </div>
        )}
      </DemoVariant>
      <DemoVariant label="禁用">
        <NavBackButton label="返回" onClick={() => undefined} disabled />
      </DemoVariant>
    </DemoVariants>
  )
}
