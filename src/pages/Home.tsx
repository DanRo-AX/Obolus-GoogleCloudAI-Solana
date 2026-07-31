import { useEffect, useState, type ReactNode } from 'react'
import { FaqSection } from '@/components/FaqSection'
import { FieldsSection } from '@/components/landing/FieldsSection'
import { Hero } from '@/components/landing/Hero'
import { LoopSection } from '@/components/landing/LoopSection'
import { ReliabilitySection } from '@/components/landing/ReliabilitySection'
import { SiteFooter } from '@/components/landing/SiteFooter'
import { SourceTicker } from '@/components/landing/SourceTicker'
import { TrialSection } from '@/components/landing/TrialSection'
import { UseCaseSection } from '@/components/landing/UseCaseSection'
import { HOME_FAQ } from '@/data/faq'
import { cn } from '@/lib/utils'

/**
 * The landing, on the same document grammar as /shelf-1: numbered sections, a
 * mono label rail that tracks scroll, everything left-aligned. The rail is what
 * turns a stack of marketing blocks into something you can navigate.
 */

const SECTIONS: { n: string; label: string; node: ReactNode }[] = [
  { n: '00', label: 'The loop', node: <LoopSection /> },
  { n: '01', label: 'The shelf', node: <SourceTicker /> },
  { n: '02', label: 'The fields', node: <FieldsSection /> },
  { n: '03', label: 'The order', node: <ReliabilitySection /> },
  { n: '04', label: 'The proof', node: <TrialSection /> },
  { n: '05', label: 'The range', node: <UseCaseSection /> },
]

export default function Home() {
  const [active, setActive] = useState(SECTIONS[0].n)

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (top?.target.id) setActive(top.target.id.replace('home-', ''))
      },
      { rootMargin: '-15% 0px -70% 0px' },
    )
    SECTIONS.forEach((s) => {
      const el = document.getElementById(`home-${s.n}`)
      if (el) io.observe(el)
    })
    return () => io.disconnect()
  }, [])

  return (
    <div className="relative h-full flex-1">
      <div className="page-enter h-full overflow-y-auto scroll-smooth">
        <Hero />

        <div className="mx-auto w-full max-w-[92rem] px-4 pt-28 sm:px-8">
          <div className="grid gap-10 lg:grid-cols-[132px_1fr] lg:gap-10">
            {/* rail --------------------------------------------------- */}
            <nav className="hidden lg:block">
              <div className="sticky top-10 flex flex-col gap-0.5">
                <span className="mb-3 font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
                  Contents
                </span>
                {SECTIONS.map((s) => (
                  <a
                    key={s.n}
                    href={`#home-${s.n}`}
                    className={cn(
                      'flex items-baseline gap-2.5 rounded-[3px] py-1.5 pl-2 text-[13px] leading-snug transition-colors',
                      active === s.n
                        ? 'bg-foreground/[0.06] text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <span className="font-mono text-[10px] tabular-nums opacity-60">
                      {s.n}
                    </span>
                    {s.label}
                  </a>
                ))}
              </div>
            </nav>

            {/* sections ----------------------------------------------- */}
            <div className="min-w-0">
              {SECTIONS.map((s) => (
                <section
                  key={s.n}
                  id={`home-${s.n}`}
                  className="scroll-mt-10 border-t border-border pb-24 pt-9 first:border-t-0 first:pt-0"
                >
                  <div className="mb-7 flex items-center gap-3 px-4 sm:px-6">
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      {s.n}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
                      {s.label}
                    </span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                  {s.node}
                </section>
              ))}

              <div className="border-t border-border px-4 py-10 sm:px-6">
                <div className="flex flex-wrap items-center gap-x-10 gap-y-3 font-mono text-xs tracking-[1px] text-muted-foreground">
                  <span>
                    SETTLEMENT RAIL{' '}
                    <span className="font-semibold text-foreground">
                      x402 · USDC ON SOLANA
                    </span>
                  </span>
                  <span>
                    UNIT OF TRADE{' '}
                    <span className="font-semibold text-foreground">
                      CASE BY CASE · ONE DOC · ONE OPEN
                    </span>
                  </span>
                </div>
              </div>

              <FaqSection items={HOME_FAQ} className="px-0 py-16 sm:px-0" />
            </div>
          </div>
        </div>

        <SiteFooter />
      </div>
    </div>
  )
}
