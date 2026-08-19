import { useT } from '@/i18n'
import { cardGradient } from '@/lib/cardGradient'

/**
 * The opening argument, made by showing rather than claiming.
 *
 * The thesis is stated once, centred, as the page's second big moment after the
 * hero — then the gap it describes is shown directly: what a general model says
 * on the dull, generic side, and what four people who actually live there say on
 * a vivid card whose colour does the arguing. No section eyebrow, no top stripe;
 * the colour is the only thing spent, and it is spent at full strength.
 */
export function ThesisSection() {
  const t = useT()
  return (
    <section className="border-t border-border px-4 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-[92rem]">
        {/* The thesis, centred — the page's one deliberate break from the
            left-aligned column, so the eye lands here before the comparison. */}
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-balance font-display text-[30px] leading-[1.14] sm:text-[46px]">
            {t('Firsthand knowledge only sold in bulk. Here it sells one answer at a time.')}
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-[17px] leading-8 text-foreground/80">
            {t(
              'A panel of three hundred, a year-long subscription, one thick report — that used to be the smallest thing you could buy. Here the unit is a single document, a single open, a single answer. You pay only for the evidence you need, and the person who lived it is paid for it.',
            )}
          </p>
        </div>

        {/* The gap, shown: a dull generic answer beside a vivid human one. */}
        <div className="mt-16 grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
          {/* The general model — flat, grey, free. Deliberately no colour. */}
          <div className="flex flex-col rounded-lg border border-border bg-muted-2/30">
            <div className="flex items-baseline justify-between gap-3 px-6 pt-6 sm:px-8 sm:pt-8">
              <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
                {t('A general model')}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
                {t('Free')}
              </span>
            </div>
            <p className="px-6 pt-5 text-pretty text-[17px] leading-relaxed text-muted-foreground sm:px-8">
              {t(
                '“Locals tend to eat later than tourists. Neighbourhood bistros are usually a good bet, and reservations are generally recommended.”',
              )}
            </p>
            <p className="mt-auto px-6 pb-6 pt-6 font-mono text-[11px] uppercase tracking-[1px] text-muted-foreground sm:px-8 sm:pb-8">
              {t('Accurate, generic, and easy to guess')}
            </p>
          </div>

          {/* Four people who live there — a real, vivid gradient card, the
              survey-card banner at full strength so it reads as the answer that
              is alive. */}
          <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-background">
            <div
              className="relative h-24 shrink-0 sm:h-28"
              style={{ background: cardGradient('firsthand paris locals', 'deep') }}
            >
              <span className="absolute right-4 top-4 rounded-full bg-white/90 px-2.5 py-1 font-mono text-[11px] font-medium tabular-nums text-foreground shadow-[0_1px_3px_rgba(20,20,25,0.16)] backdrop-blur-sm">
                ₩38
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-4 p-6 sm:p-8">
              <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-foreground">
                {t('Four people who live there')} · {t('example')}
              </span>
              <ul className="flex flex-col gap-3.5">
                {QUOTES.map((q) => (
                  <li key={q.handle} className="flex flex-col gap-1">
                    <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                      {q.handle} · {t(q.tenure)}
                    </span>
                    <span className="text-[15px] leading-relaxed">
                      {t(q.line)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-auto pt-2 font-mono text-[11px] uppercase tracking-[1px] text-[#0F766E]">
                {t('Four authors paid · USDC on Solana')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

const QUOTES = [
  {
    handle: 'PARIS_11',
    tenure: '6 years',
    line: '“Go at 19:30 and you walk in. 20:30 and you wait forty minutes.”',
  },
  {
    handle: 'PARIS_18',
    tenure: '3 years',
    line: '“The place on my street stopped taking walk-ins in March.”',
  },
  {
    handle: 'PARIS_05',
    tenure: '4 years',
    line: '“Marché Monge, Wednesday, before 11.”',
  },
  {
    handle: 'PARIS_20',
    tenure: '9 years',
    line: '“Anywhere with a menu in four languages, keep walking.”',
  },
]
