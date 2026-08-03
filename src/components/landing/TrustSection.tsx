import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * The terms, stated as plainly as they will ever be stated.
 *
 * This is the last thing before the FAQ because it is the last objection: a
 * person is being asked to write down their life. The layout is deliberately
 * flat — no cards, no icons — so it reads as terms rather than as marketing.
 */

const GIVE = [
  'What your day actually costs, where it goes, what you gave up on.',
  'The fields you have actually lived — work, family, health, whatever they are.',
  'A wallet address, so money has somewhere to land.',
]

const NEVER = [
  'Your name, your face, your email — an asker sees a handle and nothing else.',
  'Bank details, card numbers, national ID. We never ask and never store them.',
  'Custody of your money. Payments go wallet to wallet; we hold no keys.',
]

export function TrustSection() {
  return (
    <section className="border-t border-border px-4 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-[92rem]">
        <p className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
          The deal, in full
        </p>

        <h2 className="mt-5 max-w-3xl font-display text-[32px] leading-[1.1] sm:text-[44px]">
          You are writing down your life. Here is exactly what happens to it.
        </h2>

        <div className="mt-14 grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-20">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[1.5px] text-foreground">
              What you hand over
            </p>
            <ul className="mt-5 flex flex-col">
              {GIVE.map((g) => (
                <li
                  key={g}
                  className="border-t border-border py-4 text-[15px] leading-relaxed"
                >
                  {g}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
              What we never take
            </p>
            <ul className="mt-5 flex flex-col">
              {NEVER.map((n) => (
                <li
                  key={n}
                  className="border-t border-border py-4 text-[15px] leading-relaxed text-muted-foreground"
                >
                  {n}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-wrap items-center gap-x-10 gap-y-4 border-t border-border pt-8">
          <p className="max-w-xl text-[15px] leading-7">
            <span className="font-medium">Delete your shelf and it burns.</span>{' '}
            <span className="text-muted-foreground">
              Every document you wrote drops out of search immediately and is
              destroyed. We keep nothing for analytics.
            </span>
          </p>
          <Button asChild variant="mono" size="monoLg" className="ml-auto">
            <Link to="/onboarding">
              Start writing
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
