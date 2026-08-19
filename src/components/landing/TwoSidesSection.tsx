import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { CardSlider } from '@/components/landing/CardSlider'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { cardGradient } from '@/lib/cardGradient'

/**
 * The market has two sides and they never meet, so the section is two loops
 * that never touch — one for the person asking, one for the person answering.
 *
 * Each loop is a swipeable rail of cards rather than a stacked list, so the
 * four beats read as steps you move through instead of a paragraph you skim.
 * Every card leads with a vivid survey-card gradient banner at full strength —
 * the same colour the dashboard cards carry — so the rail reads as a row of
 * real cards rather than a bulleted list.
 */
export function TwoSidesSection() {
  const t = useT()
  return (
    <section className="border-t border-border px-4 py-28 sm:px-8 sm:py-40">
      <div className="mx-auto max-w-[92rem]">
        <h2 className="max-w-4xl text-balance font-display text-[32px] leading-[1.05] tracking-[-0.01em] sm:text-[54px]">
          {t('One of you is searching. One of you has lived it.')}
        </h2>

        <div className="mt-16 grid grid-cols-1 gap-12 sm:mt-24 lg:grid-cols-[1fr_auto_1fr] lg:gap-0">
          <Side
            side="asking"
            eyebrow="If you came to ask"
            title="Search people, not the web"
            steps={ASKING}
            cta={{ label: 'Ask something', to: '/' }}
          />

          <div
            aria-hidden
            className="hidden w-px bg-border lg:mx-14 lg:block"
          />

          <Side
            side="answering"
            eyebrow="If you came to earn"
            title="Write it once, get paid every time"
            steps={ANSWERING}
            cta={{ label: 'See open calls', to: '/dashboard' }}
          />
        </div>
      </div>
    </section>
  )
}

function Side({
  side,
  eyebrow,
  title,
  steps,
  cta,
}: {
  side: 'asking' | 'answering'
  eyebrow: string
  title: string
  steps: { head: string; body: string }[]
  cta: { label: string; to: string }
}) {
  const t = useT()
  const accent = side === 'asking' ? '#866FF2' : '#0F766E'
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center gap-2">
        <span
          className="size-2 rounded-[1px]"
          style={{ backgroundColor: accent }}
        />
        <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
          {t(eyebrow)}
        </span>
      </div>

      <h3 className="mt-4 text-balance font-display text-[24px] leading-tight sm:text-[28px]">
        {t(title)}
      </h3>

      <CardSlider ariaLabel={t(title)} className="mt-9">
        {steps.map((s, i) => (
          <article
            key={s.head}
            className="flex snap-start basis-[86%] shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-background sm:basis-[62%] lg:basis-[calc(50%-0.375rem)]"
          >
            {/* The vivid banner — full-strength survey-card gradient, the step
                number sitting on it in a white chip that stays readable over
                any hue the seed lands on. */}
            <div
              className="relative h-16 shrink-0"
              style={{ background: cardGradient(`${side}-step-${i}`, 'deep') }}
            >
              <span className="absolute bottom-2.5 left-3.5 rounded-md bg-white/90 px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums text-foreground shadow-[0_1px_2px_rgba(20,20,25,0.18)] backdrop-blur-sm">
                {String(i + 1).padStart(2, '0')}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-2.5 p-5 sm:p-6">
              <span className="text-[15px] font-medium">{t(s.head)}</span>
              <span className="text-pretty text-sm leading-relaxed text-muted-foreground">
                {t(s.body)}
              </span>
            </div>
          </article>
        ))}
      </CardSlider>

      <Button asChild variant="monoOutline" size="mono" className="mt-8 self-start">
        <Link to={cta.to}>
          {t(cta.label)}
          <ArrowRight className="size-3.5" />
        </Link>
      </Button>
    </div>
  )
}

const ASKING = [
  {
    head: 'Ask in plain language',
    body: 'Search and ranking are free. You only pay to open a document.',
  },
  {
    head: 'It opens a handful, not the index',
    body: 'Five people who lived it beat the average of everything.',
  },
  {
    head: 'You pay per open, in won',
    body: '₩5 to ₩25 to open one, fee included. No subscription, no minimum.',
  },
]

const ANSWERING = [
  {
    head: 'Answer one question, not a form',
    body: 'One screen, one question. No panel to sit on.',
  },
  {
    head: 'It stays yours and keeps earning',
    body: 'Your answer lands on your shelf and can be quoted again.',
  },
  {
    head: 'Money arrives without asking',
    body: '90% of every open settles to you in USDC on Solana.',
  },
]
