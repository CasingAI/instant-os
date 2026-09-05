import { Button } from '../../../../ui/button.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function ButtonThemeDemo() {
  return (
    <DemoVariants>
      <DemoVariant label="主题色（CSS 变量）" wide>
        <div
          class="ui-kit-demo__row"
          style={{
            '--ios-button-color': '#c77400',
            '--ios-button-color-active': '#9a5c00',
            '--ios-button-bg': 'linear-gradient(180deg, #fff 0%, #e9dfd0 100%)',
            '--ios-button-bg-active': 'linear-gradient(180deg, #e9dfd0 0%, #ddd2c0 100%)',
            '--ios-button-border': '1px solid #b8a88e',
            '--ios-button-radius': '6px',
            '--ios-button-shadow':
              'inset 0 1px 0 rgba(255, 255, 255, 0.8), 0 1px 2px rgba(0, 0, 0, 0.12)',
            '--ios-button-shadow-active': 'inset 0 1px 2px rgba(0, 0, 0, 0.14)',
            '--ios-button-text-shadow': '0 1px 0 rgba(255, 255, 255, 0.8)',
          }}
        >
          <Button>编辑</Button>
          <Button>书城</Button>
          <Button disabled>
            刷新
          </Button>
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}
