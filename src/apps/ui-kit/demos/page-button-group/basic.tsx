import { PageButtonGroup } from '../../../../ui/page-button-group.tsx'
import { PageActionButton } from '../../../../ui/page-action-button.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function PageButtonGroupBasicDemo() {
  return (
    <DemoVariants>
      <DemoVariant label="色调 / 选中态" wide>
        <div class="ui-kit-demo__row">
          <PageButtonGroup>
            <PageActionButton activated>收藏</PageActionButton>
            <PageActionButton>标记已读</PageActionButton>
            <PageActionButton>分享</PageActionButton>
            <PageActionButton tone="danger">删除</PageActionButton>
          </PageButtonGroup>
        </div>
      </DemoVariant>
      <DemoVariant label="状态" wide>
        <div class="ui-kit-demo__row">
          <PageButtonGroup>
            <PageActionButton busy>提交中</PageActionButton>
            <PageActionButton disabled>不可用</PageActionButton>
            <PageActionButton icon="＋" aria-label="添加" />
          </PageButtonGroup>
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}
