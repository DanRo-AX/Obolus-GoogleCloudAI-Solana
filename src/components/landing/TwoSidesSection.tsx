import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * The market has two sides and they never meet, so the section is literally two
 * columns that never touch — each side reads its own loop top to bottom and the
 * only thing crossing the middle is money.
 */
export function TwoSidesSection() {
  return (
    <section className="border-t border-border px-4 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-[92rem]">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
              Two sides, one shelf
            </p>
            <h2 className="mt-5 max-w-3xl font-display text-[32px] leading-[1.1] sm:text-[44px]">
              One of you is searching. One of you has lived it.
            </h2>
          </div>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_auto_1fr] lg:gap-0">
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
  const accent = side === 'asking' ? '#866FF2' : '#0F766E'
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2">
        <span
          className="size-2 rounded-[1px]"
          style={{ backgroundColor: accent }}
        />
        <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
          {eyebrow}
        </span>
      </div>

      <h3 className="mt-4 font-display text-[24px] leading-tight sm:text-[28px]">
        {title}
      </h3>

      <ol className="mt-9 flex flex-col">
        {steps.map((s, i) => (
          <li
            key={s.head}
            className="flex gap-5 border-t border-border/70 py-5 first:border-t-0 first:pt-0"
          >
            <span className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
              {String(i + 1).padStart(2, '0')}
            </span>
            <div className="flex flex-col gap-1.5">
              <span className="text-[15px] font-medium">{s.head}</span>
              <span className="text-sm leading-relaxed text-muted-foreground">
                {s.body}
              </span>
            </div>
          </li>
        ))}
      </ol>

      <Button asChild variant="monoOutline" size="mono" className="mt-8 self-start">
        <Link to={cta.to}>
          {cta.label}
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
    head: 'SHELF-1 opens a handful, not the index',
    body: 'Five documents that lived it beat the average of everything. Blend it all and you are back to a generic answer.',
  },
  {
    head: 'If nothing fits, it posts an open call',
    body: 'A miss does not return “no results”. Name what one answer is worth and the call goes to people who would know.',
  },
  {
    head: 'You pay per open, in won',
    body: '₩5 to ₩20 to open one document. No subscription, no seat, no minimum.',
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
    body: 'Your answer lands on your shelf as a document. SHELF-1 can quote it later with no open call at all.',
  },
  {
    head: 'Money arrives without asking',
    body: 'Every time somebody opens what you wrote, USDC lands in your wallet. ₩5 to ₩20 a go, and we never touch it.',
  },
]
