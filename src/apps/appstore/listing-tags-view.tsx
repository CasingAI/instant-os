import {
  APP_CAPABILITY_TAG_3D,
  formatAppCapabilityTagForDisplay,
  hasAppCapabilityTag,
} from './app-capability-tags.ts'

type ListingMixedTagsRowProps = {
  category: string
  tags: string[]
  categoryClassName?: string
}

export function ListingMixedTagsRow({
  category,
  tags,
  categoryClassName = 'appstore__category',
}: ListingMixedTagsRowProps) {
  const show3d = hasAppCapabilityTag(tags, APP_CAPABILITY_TAG_3D)

  return (
    <div class="appstore__meta-tags-row">
      <span class={categoryClassName}>{category}</span>
      {show3d && (
        <span class="appstore__tag appstore__tag--3d">
          {formatAppCapabilityTagForDisplay(APP_CAPABILITY_TAG_3D)}
        </span>
      )}
    </div>
  )
}
