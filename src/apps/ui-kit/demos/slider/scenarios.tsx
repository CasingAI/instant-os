import { useState } from 'preact/hooks'
import { Slider, type SliderMark } from '../../../../ui/slider.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function SliderScenariosDemo() {
  const [memory, setMemory] = useState(1024)
  const [disk, setDisk] = useState(512)

  const memoryMarks: SliderMark[] = [
    { value: 512, label: '512M' },
    { value: 1024, label: '1G' },
    { value: 1536, label: '1.5G' },
    { value: 2032, label: '2G' },
  ]

  const diskMarks: SliderMark[] = [
    { value: 256, label: '256M' },
    { value: 512, label: '512M' },
    { value: 1024, label: '1G' },
    { value: 2048, label: '2G' },
  ]

  return (
    <DemoVariants>
      <DemoVariant label="业务场景：虚拟机内存 (16–2032 MB / step 16)" wide>
        <Slider
          label="内存"
          value={memory}
          min={16}
          max={2032}
          step={16}
          suffix="MB"
          marks={memoryMarks}
          onChange={setMemory}
        />
      </DemoVariant>

      <DemoVariant label="业务场景：新建空盘容量 (16–2048 MB / step 16)" wide>
        <Slider
          label="容量"
          value={disk}
          min={16}
          max={2048}
          step={16}
          suffix="MB"
          marks={diskMarks}
          onChange={setDisk}
        />
      </DemoVariant>
    </DemoVariants>
  )
}
