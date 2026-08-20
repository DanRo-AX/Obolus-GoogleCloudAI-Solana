import * as React from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export type Animated3DCardMetric = {
  label: React.ReactNode
  value: React.ReactNode
}
type Animated3DCardProps = {
  title: React.ReactNode
  eyebrow?: React.ReactNode
  icon?: React.ReactNode
  accent?: string
  primaryLabel: React.ReactNode
  primaryValue: React.ReactNode
  metrics: Animated3DCardMetric[]
  active?: boolean
  className?: string
}

/**
 * A restrained 3D data card for dense marketplace summaries.
 * Pointer movement only changes the viewing angle; it never shifts the card's
 * position, so a four-column grid stays stable while being explored.
 */
export function Animated3DCard({
  title,
  eyebrow,
  icon,
  accent = '#7c6df2',
  primaryLabel,
  primaryValue,
  metrics,
  active = true,
  className,
}: Animated3DCardProps) {
  const reduceMotion = useReducedMotion()
  const [rotation, setRotation] = React.useState({ x: 0, y: 0 })

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (reduceMotion || event.pointerType === 'touch') return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - bounds.left) / bounds.width - 0.5
    const y = (event.clientY - bounds.top) / bounds.height - 0.5
    setRotation({ x: y * -7, y: x * 7 })
  }

  const resetRotation = () => setRotation({ x: 0, y: 0 })

  return (
    <motion.article
      onPointerMove={handlePointerMove}
      onPointerLeave={resetRotation}
      onBlur={resetRotation}
      animate={{ rotateX: rotation.x, rotateY: rotation.y }}
      transition={{ type: 'spring', stiffness: 220, damping: 24, mass: 0.55 }}
      className={cn(
        'group relative isolate flex min-h-[236px] h-full overflow-hidden rounded-2xl border border-white/10 bg-[#111114] p-5 text-white',
        'shadow-[0_3px_10px_-4px_rgba(12,12,16,0.38)] transition-[box-shadow,border-color] duration-300',
        'hover:border-white/20 hover:shadow-[0_14px_34px_-16px_rgba(12,12,16,0.72)]',
        className,
      )}
      style={{
        transformStyle: 'preserve-3d',
        background: active
          ? `radial-gradient(circle at 82% 8%, color-mix(in srgb, ${accent} 64%, white 8%) 0%, transparent 34%), radial-gradient(circle at 10% 110%, color-mix(in srgb, ${accent} 42%, transparent) 0%, transparent 48%), linear-gradient(145deg, #27272b 0%, #111114 64%, #08080a 100%)`
          : `radial-gradient(circle at 86% 4%, color-mix(in srgb, ${accent} 22%, transparent) 0%, transparent 34%), linear-gradient(145deg, #242428 0%, #141417 62%, #0b0b0d 100%)`,
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            'radial-gradient(circle at center, rgba(255,255,255,0.75) 0 0.75px, transparent 0.9px)',
          backgroundSize: '17px 17px',
          maskImage: 'linear-gradient(135deg, black, transparent 72%)',
          WebkitMaskImage: 'linear-gradient(135deg, black, transparent 72%)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-80"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
      />

      <div
        className="relative z-10 flex w-full flex-col"
        style={{ transform: 'translateZ(22px)' }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {eyebrow ? (
              <p className="font-mono text-[9px] uppercase tracking-[1.3px] text-white/45">
                {eyebrow}
              </p>
            ) : null}
            <div className="mt-2 flex items-center gap-2.5">
              <span
                className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/25"
                style={{ color: accent }}
              >
                {icon}
              </span>
              <h3 className="truncate text-[15px] font-medium tracking-[-0.01em]">{title}</h3>
            </div>
          </div>
          <ArrowUpRight className="mt-1 size-4 shrink-0 text-white/45 transition-colors duration-200 group-hover:text-white" />
        </div>

        <div className="mt-7">
          <p className="font-mono text-[9px] uppercase tracking-[1.2px] text-white/45">
            {primaryLabel}
          </p>
          <p className={cn('mt-1.5 font-mono text-[28px] leading-none tracking-[-0.04em]', !active && 'text-white/42')}>
            {primaryValue}
          </p>
        </div>

        <dl className="mt-auto grid grid-cols-3 gap-2 border-t border-white/12 pt-4">
          {metrics.map((metric, index) => (
            <div key={index} className="min-w-0">
              <dt className="truncate text-[10px] text-white/42">{metric.label}</dt>
              <dd className="mt-1 truncate font-mono text-[12px] tabular-nums text-white/88">
                {metric.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </motion.article>
  )
}
