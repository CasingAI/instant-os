import type { ComponentChildren, JSX } from 'preact'
import { useContext, useEffect, useState } from 'preact/hooks'
import { ForwardIcon, GrabberIcon, InfoIcon } from '../icons/app-icons.tsx'
import { ListContext, type ListPointerEvent } from './list.tsx'

export type ListItemAccessory = 'none' | 'disclosure' | 'check' | 'detail'

type ListItemProps = {
  /** 稳定 id：List 受控单选（selectedId/onSelect）与编辑模式（删除/重排）靠它结合。 */
  id?: string
  /** 左侧主标题。 */
  label?: ComponentChildren
  /** 灰色第二行副标题。 */
  subtitle?: ComponentChildren
  /** 左侧图标/头像位。 */
  leading?: ComponentChildren
  /** 右侧值文本（与 extra 二选一）。 */
  value?: ComponentChildren
  /** 右侧自定义内容（与 value 二选一）。 */
  extra?: ComponentChildren
  /** 控件槽：放 IosSwitch / IosTextField 等，点击不再触发行选中。 */
  control?: ComponentChildren
  /** 右侧配件：chevron 箭头 / 选中勾（跟随选中态）/ 蓝色 ⓘ 详情钮。 */
  accessory?: ListItemAccessory
  /** 名称旁的徽章文本（settings__row-badge）。 */
  badge?: string
  /** 强制选中态；缺省时由 List 的 selectedId 结合 id 推导。 */
  selected?: boolean
  disabled?: boolean
  /** 有 onClick 渲染为 button（可交互行），否则渲染为 div（静态行）。 */
  onClick?: () => void
  class?: string
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'class'>

/**
 * List 的组合行（AntD List.Item 风格）：槽位自由拼装，行为与 List 结合——
 * 带 id 的行自动参与受控单选；List 进入编辑模式时出现删除钮与排序把手，
 * 此时行退化为静态（onClick 暂停）。
 */
export function ListItem({
  id,
  label,
  subtitle,
  leading,
  value,
  extra,
  control,
  accessory = 'none',
  badge,
  selected,
  disabled,
  onClick,
  class: itemClass,
  ...rest
}: ListItemProps) {
  const list = useContext(ListContext)
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!list.editing) setArmed(false)
  }, [list.editing])

  const active = selected ?? (id !== undefined && list.selectedId !== undefined && list.selectedId === id)
  const interactive = !list.editing && (onClick !== undefined || (id !== undefined && list.onSelect !== undefined))

  const showMinus = list.editing && id !== undefined && list.onDelete !== undefined
  const showGrabber = list.editing && id !== undefined && list.onReorder !== undefined

  const handleClick = () => {
    if (armed) {
      setArmed(false)
      return
    }
    if (id !== undefined && list.onSelect !== undefined) list.onSelect(id)
    onClick?.()
  }

  const className = [
    'settings__row',
    'list-item',
    interactive ? 'settings__row--button' : 'settings__row--static',
    active ? 'settings__row--selected' : '',
    armed ? 'list-item--armed' : '',
    itemClass,
  ]
    .filter(Boolean)
    .join(' ')

  const content = (
    <>
      {showMinus && (
        <span
          class="list-item__minus"
          role="button"
          tabIndex={0}
          aria-label={`删除 ${typeof label === 'string' ? label : '该项'}`}
          onClick={(event) => {
            event.stopPropagation()
            setArmed(true)
          }}
        />
      )}
      {leading !== undefined && <span class="list-item__leading">{leading}</span>}
      {label !== undefined && (
        <span class="list-item__label">
          <span class="settings__row-name">
            {label}
            {badge !== undefined && <span class="settings__row-badge">{badge}</span>}
          </span>
          {subtitle !== undefined && <span class="list-item__subtitle">{subtitle}</span>}
        </span>
      )}
      {control !== undefined ? (
        <span
          class="list-item__control"
          onClick={(event) => event.stopPropagation()}
        >
          {control}
        </span>
      ) : extra !== undefined ? (
        <span class="list-item__extra">{extra}</span>
      ) : value !== undefined ? (
        <span class="settings__row-size">{value}</span>
      ) : undefined}
      {accessory === 'check' && active && (
        <span class="list-item__check" aria-hidden="true">
          ✓
        </span>
      )}
      {accessory === 'disclosure' && (
        <span class="settings__disclosure" aria-hidden="true">
          <ForwardIcon size={13} />
        </span>
      )}
      {accessory === 'detail' && (
        <span
          class="list-item__detail"
          role="button"
          tabIndex={0}
          aria-label="详情"
          onClick={(event) => event.stopPropagation()}
        >
          <InfoIcon size={18} />
        </span>
      )}
      {showGrabber && (
        <span
          class="list-item__grabber"
          aria-hidden="true"
          onPointerDown={(event) => {
            event.preventDefault()
            list.beginReorder?.(event as ListPointerEvent, id)
          }}
          onPointerMove={(event) => list.moveReorder?.(event as ListPointerEvent)}
          onPointerUp={() => list.endReorder?.()}
          onLostPointerCapture={() => list.endReorder?.()}
        >
          <GrabberIcon size={12} />
        </span>
      )}
      {armed && (
        <button
          type="button"
          class="list-item__delete"
          onClick={(event) => {
            event.stopPropagation()
            if (id !== undefined) list.onDelete?.(id)
          }}
        >
          删除
        </button>
      )}
    </>
  )

  return interactive ? (
    <button
      type="button"
      data-list-item-id={id}
      class={className}
      aria-current={active ? 'true' : undefined}
      disabled={disabled}
      onClick={handleClick}
      {...(rest as JSX.HTMLAttributes<HTMLButtonElement>)}
    >
      {content}
    </button>
  ) : (
    <div
      data-list-item-id={id}
      class={className}
      aria-current={active ? 'true' : undefined}
      onClick={handleClick}
      {...rest}
    >
      {content}
    </div>
  )
}
