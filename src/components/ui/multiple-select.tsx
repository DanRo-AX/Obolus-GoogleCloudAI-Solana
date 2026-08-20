import type { HTMLAttributes, ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type TTag = {
  key: string
  name: string
  group?: string
  groupLabel?: string
}

type MultipleSelectProps = {
  tags: TTag[]
  value: TTag[]
  onChange: (value: TTag[]) => void
  customTag?: (item: TTag) => ReactNode
  className?: string
  /** Targeting fields use one value per dimension. */
  singlePerGroup?: boolean
}

/**
 * Compact tag picker used for audience targeting. It is controlled so the
 * selected chips and the request payload can never drift apart.
 */
export function MultipleSelect({
  tags,
  value,
  onChange,
  customTag,
  className,
  singlePerGroup = false,
}: MultipleSelectProps) {
  const groups = tags.reduce<Map<string, TTag[]>>((map, tag) => {
    const key = tag.group ?? 'all'
    map.set(key, [...(map.get(key) ?? []), tag])
    return map
  }, new Map())

  const select = (item: TTag) => {
    if (value.some((selected) => selected.key === item.key)) {
      onChange(value.filter((selected) => selected.key !== item.key))
      return
    }
    const next = singlePerGroup && item.group
      ? value.filter((selected) => selected.group !== item.group)
      : value
    onChange([...next, item])
  }

  return (
    <div className={cn('grid gap-4', className)}>
      {[...groups.entries()].map(([group, items]) => (
        <fieldset key={group} className="grid gap-2">
          <legend className="font-mono text-[9px] uppercase tracking-[1.2px] text-white/42">
            {items[0]?.groupLabel ?? group}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {items.map((item) => {
              const selected = value.some((candidate) => candidate.key === item.key)
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => select(item)}
                  className={cn(
                    'cursor-pointer rounded-full border px-2.5 py-1.5 text-xs transition-colors duration-200',
                    selected
                      ? 'border-white bg-white text-black'
                      : 'border-white/12 bg-white/[0.035] text-white/65 hover:border-white/30 hover:text-white',
                  )}
                >
                  {customTag ? customTag(item) : item.name}
                </button>
              )
            })}
          </div>
        </fieldset>
      ))}
    </div>
  )
}

type TagProps = HTMLAttributes<HTMLSpanElement> & {
  name: string
  onRemove?: () => void
  tone?: 'light' | 'dark'
}

/** A visible, removable statement of one active search constraint. */
export function Tag({ name, onRemove, tone = 'light', className, ...props }: TagProps) {
  return (
    <span
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] transition-colors duration-200',
        tone === 'dark'
          ? 'bg-white/[0.09] text-white/78'
          : 'bg-foreground/[0.065] text-foreground/75',
        className,
      )}
      {...props}
    >
      <span className="max-w-32 truncate">{name}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
          aria-label={`${name} remove`}
          className={cn(
            '-mr-1 grid size-5 cursor-pointer place-items-center rounded-full transition-colors',
            tone === 'dark' ? 'hover:bg-white/10 hover:text-white' : 'hover:bg-black/10',
          )}
        >
          <X className="size-3" />
        </button>
      ) : null}
    </span>
  )
}
