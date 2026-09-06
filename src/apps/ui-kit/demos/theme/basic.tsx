import { Page } from '../../../../ui/page.tsx'
import { PageHeader } from '../../../../ui/page-header.tsx'
import { DarkMode } from '../../../../ui/theme.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

/** 对比用的同一份系统页面：Page + PageHeader（返回键/标题）+ 滚动正文。
 * 两组内容完全一致，唯一差别是外层有没有包 <DarkMode>。 */
function SamplePage() {
  return (
    <div style={{ height: 260 }}>
      <Page
        header={
          <PageHeader
            title="设置"
            backLabel="返回"
            onBack={() => {}}
          />
        }
      >
        <div style={{ padding: '16px 20px', lineHeight: 1.7 }}>
          <p style={{ margin: '0 0 12px' }}>
            页面底色、标题栏、返回键都取自同一套 <code>--page-*</code> 变量。
          </p>
          <p style={{ margin: '0 0 12px' }}>
            变量按「最近的定义祖先」继承：DarkMode 在子树顶端放上
            data-theme="dark"，整棵子树就跟着变暗，包外不受影响。
          </p>
          <p style={{ margin: 0 }}>
            正文够长时这里会出现滚动条，亮暗两组的滚动行为完全一致。
          </p>
        </div>
      </Page>
    </div>
  )
}

/** 基础用法：亮暗并排对比——裸放一组保持亮色，包住的一组自动变暗 */
export default function ThemeBasicDemo() {
  return (
    <DemoVariants>
      <DemoVariant label="裸放 · 亮色（:root 默认）" wide>
        <SamplePage />
      </DemoVariant>
      <DemoVariant label="包在 <DarkMode> 里 · 暗色" wide>
        <DarkMode>
          <SamplePage />
        </DarkMode>
      </DemoVariant>
    </DemoVariants>
  )
}
