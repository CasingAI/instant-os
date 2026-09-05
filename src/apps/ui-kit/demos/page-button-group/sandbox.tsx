import { useState } from 'preact/hooks'
import { Icon } from '../../../../ui/icon.tsx'
import { PageButtonGroup } from '../../../../ui/page-button-group.tsx'
import { PageActionButton } from '../../../../ui/page-action-button.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function PageButtonGroupSandboxDemo() {
  // 挤压沙盒：滑杆控制容器宽，PageButtonGroup 自带 ResizeObserver 实时多级解压
  const [sandboxWidth, setSandboxWidth] = useState(340)
  const [dualSandboxWidth, setDualSandboxWidth] = useState(340)

  return (
    <DemoVariants>
      <DemoVariant label="icon + 文字（放不下退化为图标）" wide>
        <div class="ui-kit-demo__sandbox" style={{ width: `${dualSandboxWidth}px` }}>
          <PageButtonGroup>
            <PageActionButton icon={<Icon name="favorite" size={13} />}>收藏</PageActionButton>
            <PageActionButton icon={<Icon name="download" size={13} />}>下载</PageActionButton>
            <PageActionButton>分享</PageActionButton>
            <PageActionButton tone="danger">删除</PageActionButton>
          </PageButtonGroup>
        </div>
        <div class="ui-kit-demo__sandbox-controls">
          <input
            class="ui-kit-demo__sandbox-slider"
            type="range"
            min={90}
            max={380}
            value={dualSandboxWidth}
            onInput={(e) => setDualSandboxWidth(Number(e.currentTarget.value))}
          />
          <span class="ui-kit-demo__sandbox-width">{dualSandboxWidth}px</span>
        </div>
      </DemoVariant>
      <DemoVariant label="挤压沙盒（拖滑杆收窄容器）" wide>
        <div class="ui-kit-demo__sandbox" style={{ width: `${sandboxWidth}px` }}>
          <PageButtonGroup>
            <PageActionButton activated>收藏</PageActionButton>
            <PageActionButton>标记已读</PageActionButton>
            <PageActionButton>分享</PageActionButton>
            <PageActionButton>导出备份</PageActionButton>
          </PageButtonGroup>
        </div>
        <div class="ui-kit-demo__sandbox-controls">
          <input
            class="ui-kit-demo__sandbox-slider"
            type="range"
            min={90}
            max={380}
            value={sandboxWidth}
            onInput={(e) => setSandboxWidth(Number(e.currentTarget.value))}
          />
          <span class="ui-kit-demo__sandbox-width">{sandboxWidth}px</span>
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}
