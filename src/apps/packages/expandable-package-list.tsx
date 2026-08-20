import { Fragment } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { ComponentChildren, VNode } from 'preact'

export const PACKAGES_LIST_PREVIEW_COUNT = 10

type ExpandablePackageListProps<T> = {
  items: readonly T[]
  empty: ComponentChildren
  head: ComponentChildren
  showAllLabel: string
  getKey: (item: T) => string
  renderItem: (item: T) => VNode
  /** 数据源变化时收起（例如换项目 / 刷新缓存） */
  resetKey?: string
}

/** 对齐设置「存储管理」：预览前 N 条，末行 `settings__row--show-all` 展开。 */
export function ExpandablePackageList<T>({
  items,
  empty,
  head,
  showAllLabel,
  getKey,
  renderItem,
  resetKey,
}: ExpandablePackageListProps<T>) {
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setExpanded(false)
  }, [resetKey])

  const canExpand = items.length > PACKAGES_LIST_PREVIEW_COUNT
  const showExpandTrigger = canExpand && !expanded
  const visibleItems = showExpandTrigger
    ? items.slice(0, PACKAGES_LIST_PREVIEW_COUNT)
    : items

  return (
    <div class="settings__list">
      {head}
      <div class="settings__list-body settings__list-body--apps">
        {items.length === 0 ? (
          empty
        ) : (
          <>
            {visibleItems.map((item) => (
              <Fragment key={getKey(item)}>{renderItem(item)}</Fragment>
            ))}
            {showExpandTrigger ? (
              <button
                type="button"
                class="settings__row settings__row--show-all"
                onClick={() => setExpanded(true)}
              >
                {showAllLabel}
              </button>
            ) : undefined}
          </>
        )}
      </div>
    </div>
  )
}
