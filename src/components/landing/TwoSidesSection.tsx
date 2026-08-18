import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { CardSlider } from '@/components/landing/CardSlider'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { cardGradient } from '@/lib/cardGradient'

/** The wash is strongest at the top of a card and fades before the text. */
const WASH_MASK = 'linear-gradient(to bottom, black 0%, transparent 72%)'

/**
 * The market has two sides and they never meet, so the section is two loops
 * that never touch — one for the person asking, one for the person answering.
 *
 * Each loop is a swipeable rail of cards rather than a stacked list, so the
 * four beats read as steps you move through instead of a paragraph you skim.
 * Every card carries a faint gradient wash from the survey-card palette and a
 * hairline in the side's own accent, which is the only point of colour the
 * section ever spends.
 */
export function TwoSidesSection() {
  const t = useT()
  return (
    <section className="border-t border-border px-4 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-[92rem]">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
              {t('Two sides, one shelf')}
            </p>
            <h2 className="mt-5 max-w-3xl text-balance font-display text-[32px] leading-[1.1] sm:text-[44px]">
              {t('One of you is searching. One of you has lived it.')}
            </h2>
          </div>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-12 lg:grid-cols-[1fr_auto_1fr] lg:gap-0">
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
            className="relative flex snap-start basis-[86%] shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-background p-6 sm:basis-[62%] lg:basis-[calc(50%-0.375rem)]"
          >
            <span
              aria-hidden
              className="absolute inset-x-0 top-0 h-px"
              style={{ backgroundColor: accent }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.12]"
              style={{
                background: cardGradient(`${side}-step-${i}`, 'deep'),
                WebkitMaskImage: WASH_MASK,
                maskImage: WASH_MASK,
              }}
            />
            <div className="relative z-10 flex h-full flex-col gap-2.5">
              <span
                className="font-mono text-[11px] tabular-nums"
                style={{ color: accent }}
              >
                {String(i + 1).padStart(2, '0')}
              </span>
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
    body: 'Searching and ranking cost nothing. You only ever pay to open a document.',
  },
  {
    head: 'SHELF opens a handful, not the index',
    body: 'Five documents that lived it beat the average of everything. Blend it all and you are back to a generic answer.',
  },
  {
    head: 'If nothing fits, it posts an open call',
    body: 'A miss does not return “no results”. Name what one answer is worth and the call goes to people who would know.',
  },
  {
    head: 'You pay per open, in won',
    body: '₩5 to ₩25 to open one document. No subscription, no seat, no minimum. The displayed price already includes the 10% protocol fee.',
  },
]

const ANSWERING = [
  {
    head: 'Say what you actually know',
    body: 'Pick the fields you have lived. Calls in those fields sort to the top of your board.',
  },
  {
    head: 'Answer one question, not a form',
    body: 'One screen, one question, a few warm-ups first. No forty-question form, no panel to sit on.',
  },
  {
    head: 'It stays yours and keeps working',
    body: 'Your answer lands on your shelf as a document. SHELF can quote it later with no open call at all.',
  },
  {
    head: 'Money arrives without asking',
    body: 'Every qualified open settles 90% of its ₩5 to ₩25 price to you. The 10% protocol fee funds payment, recovery, quality and network operations.',
  },
]
