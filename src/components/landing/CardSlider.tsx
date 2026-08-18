import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * A horizontal, swipeable card track.
 *
 * The landing used to stack every point as a paragraph, which read as a wall.
 * This lays a set of sibling cards on one rail instead: you swipe or scroll on
 * touch, and on a pointer device the two arrows page one card at a time. The
 * rail is the source of truth — the buttons only call `scrollBy`, so keyboard,
 * trackpad, and touch all move the same thing and never fall out of sync.
 *
 * Motion is a courtesy, not the mechanism: with `prefers-reduced-motion` the
 * arrows jump the scroll instead of animating it, and nothing here animates on
 * its own. Arrows disable at each end and the whole control hides when the
 * cards already fit, so it degrades to a plain row on a wide screen.
 */
export function CardSlider({
  children,
  ariaLabel,
  className,
}: {
  children: React.ReactNode
  ariaLabel: string
  className?: string
}) {
  const t = useT()
  const trackRef = useRef<HTMLDivElement>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(false)
  const [overflowing, setOverflowing] = useState(false)

  const measure = useCallback(() => {
    const el = trackRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setOverflowing(max > 1)
    setAtStart(el.scrollLeft <= 1)
    setAtEnd(el.scrollLeft >= max - 1)
  }, [])

  useEffect(() => {
    measure()
    const el = trackRef.current
    if (!el) return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure])

  const page = (dir: 1 | -1) => {
    const el = trackRef.current
    if (!el) return
    // Advance by one card, inferred from the first child plus the flex gap, so
    // a swipe and an arrow tap land on the same snap point. Falls back to most
    // of the viewport if the track is somehow empty.
    const first = el.firstElementChild as HTMLElement | null
    const gap = parseFloat(getComputedStyle(el).columnGap || '0') || 0
    const step = first ? first.offsetWidth + gap : el.clientWidth * 0.8
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({ left: dir * step, behavior: reduce ? 'auto' : 'smooth' })
  }

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div
        ref={trackRef}
        onScroll={measure}
        role="group"
        aria-label={ariaLabel}
        className="scrollbar-none -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-1 pb-1 [scroll-padding-inline:0.25rem] motion-reduce:scroll-auto"
      >
        {children}
      </div>

      {overflowing ? (
        <div className="flex items-center gap-2">
          <SliderButton
            label={t('Previous')}
            disabled={atStart}
            onClick={() => page(-1)}
          >
            <ArrowLeft className="size-4" />
          </SliderButton>
          <SliderButton
            label={t('Next')}
            disabled={atEnd}
            onClick={() => page(1)}
          >
            <ArrowRight className="size-4" />
          </SliderButton>
        </div>
      ) : null}
    </div>
  )
}

function SliderButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-9 items-center justify-center rounded-lg border border-foreground/[0.12] text-foreground transition-colors',
        'hover:bg-foreground/[0.06] disabled:pointer-events-none disabled:opacity-30',
        'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
      )}
    >
      {children}
    </button>
  )
}
