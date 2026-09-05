import { useState } from 'preact/hooks'
import { AiModelCapabilityTags } from '../../../../ui/ai-model-capability-tags.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function AiModelCapabilityTagsDemo() {
  const [caps, setCaps] = useState<Array<'text' | 'vision'>>(['text', 'vision'])

  return (
    <DemoVariants>
      <DemoVariant label="只读展示">
        <AiModelCapabilityTags capabilities={['text', 'speech-recognition']} />
      </DemoVariant>
      <DemoVariant label="可编辑视觉能力">
        <AiModelCapabilityTags
          capabilities={caps}
          visionEditable
          onVisionChange={(supportsVision) =>
            setCaps(supportsVision ? ['text', 'vision'] : ['text'])
          }
        />
      </DemoVariant>
    </DemoVariants>
  )
}
