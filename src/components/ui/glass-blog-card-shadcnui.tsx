import * as React from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowUpRight, BookOpen } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { deterministicAvatar } from '@/lib/avatar'
import { cardGradient, cardTexture } from '@/lib/cardGradient'
import { cn } from '@/lib/utils'

type GlassDemandCardProps = {
  title: React.ReactNode
  excerpt: React.ReactNode
  icon?: React.ReactNode
  seed: string
  coverFilter?: string
  status: React.ReactNode
  amount: React.ReactNode
  contributorHandles?: string[]
  contributorLabel: React.ReactNode
  emptyContributorLabel: React.ReactNode
  answerCount: number
  answerCountLabel: React.ReactNode
  actionLabel: React.ReactNode
  active?: boolean
  className?: string
}

/**
 * A full-bleed demand card built from the same generative surfaces as the
 * question marketplace. There is no separate description panel: context stays
 * on the image and the marketplace details rise into view on hover or focus.
 */
export function GlassDemandCard({
  title,
  excerpt,
  icon,
  seed,
  coverFilter,
  status,
  amount,
  contributorHandles = [],
  contributorLabel,
  emptyContributorLabel,
  answerCount,
  answerCountLabel,
  actionLabel,
  active = true,
  className,
}: GlassDemandCardProps) {
  const reduceMotion = useReducedMotion()

  return (
    <motion.article
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
      className={cn(
        'group relative isolate flex h-full min-h-[310px] overflow-hidden rounded-xl bg-neutral-950 text-white',
        'shadow-[0_8px_28px_-18px_rgba(0,0,0,0.72)] transition-[transform,box-shadow] duration-300 ease-out',
        'hover:-translate-y-1 hover:shadow-[0_18px_42px_-20px_rgba(0,0,0,0.82)]',
        'focus-within:-translate-y-1 focus-within:shadow-[0_18px_42px_-20px_rgba(0,0,0,0.82)]',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 transition-transform duration-500 ease-out group-hover:scale-110 group-focus-within:scale-110"
        style={{
          background: cardGradient(seed, 'deep'),
          filter: coverFilter,
        }}
      >
        <div
          className="absolute inset-0 opacity-90"
          style={{
            backgroundImage: cardTexture(seed),
            backgroundPosition: 'center',
            backgroundSize: 'cover',
          }}
        />
      </div>

      <div
        aria-hidden="true"
        className={cn(
          'absolute inset-0 bg-gradient-to-t from-black/68 via-black/10 to-transparent',
          !active && 'from-black/78 via-black/18 grayscale-[0.1]',
        )}
      />

      <div className="relative z-10 flex min-h-[310px] w-full flex-col p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            {icon ? (
              <span className="grid size-10 place-items-center rounded-full bg-black/25 text-white shadow-sm backdrop-blur-md">
                {icon}
              </span>
            ) : null}
            <span className="rounded-full bg-black/30 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.9px] text-white/72 backdrop-blur-md">
              {status}
            </span>
          </div>
          <ArrowUpRight className="size-4 text-white/68 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </div>

        <div className="mt-auto translate-y-[54px] transition-transform duration-500 ease-out group-hover:translate-y-0 group-focus-within:translate-y-0">
          <h3 className="max-w-[18ch] text-[23px] font-semibold leading-[1.16] tracking-[-0.035em] text-white drop-shadow-sm">
            {title}
          </h3>
          <p className="mt-2 line-clamp-2 max-w-[34ch] text-[12px] leading-[1.65] text-white/68">
            {excerpt}
          </p>

          <div className="mt-4 flex items-end justify-between gap-4 border-t border-white/18 pt-4 opacity-0 transition-opacity duration-300 delay-75 group-hover:opacity-100 group-focus-within:opacity-100">
            <div className="min-w-0">
              <p className="font-mono text-[9px] uppercase tracking-[0.9px] text-white/45">
                {actionLabel}
              </p>
              <p className={cn(
                'mt-1 font-mono text-[22px] font-medium tabular-nums tracking-[-0.035em] text-white',
                !active && 'text-white/62',
              )}>
                {amount}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <div className="flex items-center">
                {contributorHandles.length > 0 ? (
                  <div className="flex -space-x-2">
                    {contributorHandles.slice(0, 3).map((handle) => (
                      <Avatar
                        key={handle}
                        config={deterministicAvatar(handle)}
                        size={28}
                        className="border-2 border-white/80"
                      />
                    ))}
                  </div>
                ) : (
                  <span className="grid size-7 place-items-center rounded-full bg-white/12 text-white/65">
                    <BookOpen className="size-3.5" />
                  </span>
                )}
              </div>
              <div className="max-w-[100px] text-right">
                <p className="truncate text-[10px] text-white/58">
                  {contributorHandles.length > 0
                    ? `${contributorHandles.length} ${contributorLabel}`
                    : emptyContributorLabel}
                </p>
                <p className="mt-1 font-mono text-[11px] tabular-nums text-white">
                  {answerCount} <span className="text-white/52">{answerCountLabel}</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.article>
  )
}
