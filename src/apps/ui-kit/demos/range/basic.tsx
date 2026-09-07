import { useState } from 'preact/hooks'
import { IosRangeSlider, type IosRangeSliderMark } from '../../../../ui/ios-range-slider.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function IosRangeSliderBasicDemo() {
  const [basic, setBasic] = useState(30)
  const [withMarks, setWithMarks] = useState(25)
  const [disabledVal, setDisabledVal] = useState(60)

  const percentMarks: IosRangeSliderMark[] = [
    { value: 0, label: '0%' },
    { value: 25, label: '25%' },
    { value: 50, label: '50%' },
    { value: 75, label: '75%' },
    { value: 100, label: '100%' },
  ]

  return (
    <DemoVariants>
      <DemoVariant label="基础" wide>
        <IosRangeSlider
          value={basic}
          min={0}
          max={100}
          step={1}
          onChange={setBasic}
        />
      </DemoVariant>

      <DemoVariant label="带标签 + 后缀 + 刻度" wide>
        <IosRangeSlider
          label="音量"
          value={withMarks}
          min={0}
          max={100}
          step={1}
          suffix="%"
          marks={percentMarks}
          onChange={setWithMarks}
        />
      </DemoVariant>

      <DemoVariant label="禁用" wide>
        <IosRangeSlider
          value={disabledVal}
          min={0}
          max={100}
          step={1}
          disabled
          onChange={setDisabledVal}
        />
      </DemoVariant>
    </DemoVariants>
  )
}
