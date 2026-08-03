/**
 * The opening argument, made by showing rather than claiming.
 *
 * Two answers to the same question sit side by side: what a general model says,
 * and what four people who actually live there say. The gap between the columns
 * is the entire product, so the layout gives it the whole width and nothing else
 * competes for attention.
 */
export function ThesisSection() {
  return (
    <section className="border-t border-border px-4 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-[92rem]">
        <p className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
          Why nobody wrote it down
        </p>

        <h2 className="mt-5 max-w-4xl font-display text-[32px] leading-[1.1] sm:text-[48px]">
          Every agent on the internet reads for free.
          <span className="text-muted-foreground">
            {' '}
            So nobody bothered writing down the part worth reading.
          </span>
        </h2>

        <p className="mt-6 max-w-2xl text-[15px] leading-7 text-muted-foreground">
          Publishing a blog post is one thing. Writing down where you eat lunch
          on a Tuesday, what it cost, how long the queue was is another. Nobody
          ever had a reason to give that away.
        </p>

        {/* the gap, shown ------------------------------------------------ */}
        <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-2">
          <div className="flex flex-col gap-5 bg-background p-7 sm:p-9">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
                A general model
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
                Free
              </span>
            </div>
            <p className="text-[17px] leading-relaxed text-muted-foreground">
              “Locals tend to eat later than tourists. Neighbourhood bistros are
              usually a good bet, and reservations are generally recommended.”
            </p>
            <p className="mt-auto pt-4 font-mono text-[11px] uppercase tracking-[1px] text-muted-foreground">
              True, useless, and you could have guessed it
            </p>
          </div>

          <div className="flex flex-col gap-5 bg-background p-7 sm:p-9">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-foreground">
                Four people who live there
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[1px] tabular-nums text-foreground">
                ₩38
              </span>
            </div>
            <ul className="flex flex-col gap-3.5">
              {QUOTES.map((q) => (
                <li key={q.handle} className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                    {q.handle} · {q.tenure}
                  </span>
                  <span className="text-[15px] leading-relaxed">{q.line}</span>
                </li>
              ))}
            </ul>
            <p className="mt-auto pt-4 font-mono text-[11px] uppercase tracking-[1px] text-[#0F766E]">
              Four authors paid · USDC on Solana
            </p>
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
